"use strict";
/* global t, Net, Game, Path, AiController */

// React port of tunneler.js. Session (the rollback-netcode game loop) stays the same
// imperative class, constructed once inside a mount effect and driving the canvas
// directly (putImageData/drawImage) - React never touches canvas pixels. Changes vs.
// the old vanilla version:
//   - scoreEl.innerHTML writes become an onScoreChange(data) callback -> React state ->
//     <Score/>, same treatment as spectator.jsx.
//   - a stop() method (clearing both setIntervals) is added so the mount effect's
//     cleanup can tear the session down - the page never unmounted before, so this was
//     never needed.
//   - document.onkeydown/onkeyup assignment becomes addEventListener/removeEventListener
//     inside the mount effect, for proper cleanup symmetry.
//   - the restart button is conditionally rendered (role play/ai only) instead of
//     always-present-but-hidden + a separate addEventListener.

import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState } from "react";

// Legacy hotseat bit layout (unchanged since before the N-player rework): one shared
// 11-bit keyState field, bits 6-10 = tank0's up/down/left/right/fire, bits 0-4 = tank1's
// up/right/down/left/fire (note tank1's right/down ORDER differs from tank0's - a
// historical quirk of the old combined-field design, harmless since both tanks were
// always decoded by fixed bit position, never relative order). Online seats now each
// get their own independent 0-31 scalar in a single unified order (see netcode.js's
// Game.decodeInput()), so these two helpers translate the still-unchanged hotseat
// (0/"play") bit positions into that same unified order - tank0's slice already matches
// it 1:1 once shifted, tank1's needs its right/down bits swapped.
function legacyTank0Bits(keyState11) { return (keyState11 >> 6) & 0x1f; }
function legacyTank1Bits(keyState11) {
  const up = keyState11 & 1, right = (keyState11 >> 1) & 1, down = (keyState11 >> 2) & 1,
        left = (keyState11 >> 3) & 1, fire = (keyState11 >> 4) & 1;
  return up | (down << 1) | (left << 2) | (right << 3) | (fire << 4);
}

class Session {
  // how long movement stays frozen at the start of each round
  static COUNTDOWN_MS = 3000;

  // first to this many round wins takes the match - a per-session setting (server.js's
  // createSession/session.winScore) fetched in waitForPlayers() for online seats; offline
  // hotseat roles (0/play/ai) have no session to read one from, so they keep this default.
  static DEFAULT_WIN_SCORE = 3;

  isMatchOver(s) {
    return Object.values(s.teamScores).some((v) => v >= this.winScore);
  }

  // role: 0 (bare tunneler.html) and "play" (/play) show the full split screen and run
  // fully local/offline, no networking at all. A numeric role (online, /<id>/seat/<n>)
  // crops to that seat's own camera pane and talks to the server, so remote players
  // can't see anyone else's. "ai" (/ai/<difficulty>) is also fully local/offline like
  // 0/"play", but only tank0 is keyboard-driven - tank1's bits come from this.ai (an
  // AiController, see ai.js) every frame instead of a second human at the same keyboard.
  //
  // offline fully disambiguates "numeric role" between bare-tunneler.html's role 0 and
  // online seat 0 (both are the JS value 0) - see the bootstrap code at the bottom of
  // this file, which computes it from the URL directly rather than from role.
  //
  // blueName/greenName: cosmetic hotseat display names (default "Blue"/"Green"), only
  // meaningful for the offline 0/"play"/"ai" roles - online seats' names/colors/teams
  // come from the live roster fetched in waitForPlayers() instead.
  constructor(ctx, role, offline, onScoreChange, blueName, greenName, aiDifficulty) {
    this.ctx = ctx;
    this.role = role;
    this.offline = offline;
    this.onScoreChange = onScoreChange;
    this.blueName = blueName;
    this.greenName = greenName;
    this.winScore = Session.DEFAULT_WIN_SCORE;
    this.net = new Net();
    this.gameLocal = new Game();
    this.gameRemote = new Game();
    this.keyState = 0;
    this.waitSync = false;
    this.running = false;
    this.matchEnded = false;
    this.matchEndedAt = null;
    this.stopped = false;
    this.iterateTimer = null;
    this.netsyncTimer = null;
    // freeze movement for COUNTDOWN_MS at the start of every round (including the
    // first) - lastRound null means "never seen a round yet", so the very first
    // iterate() call also counts as a round start. All clients detect this off the same
    // engine-driven s.round value, which advances at an identical frame number for
    // every client (lockstep), so the two countdowns start within real-time sync
    // tolerance of each other without needing an explicit handshake.
    this.lastRound = null;
    this.countdownEnd = null;
    // online only - tracks whether every OTHER connected seat is still connected, from
    // every sync response's connectedMask (see updateOpponentConnection()). Assumed
    // true at construction: start() doesn't flip `running` on until waitForPlayers() has
    // already confirmed the match started, so by the time iterate()/netsync() run this
    // is accurate.
    this.opponentConnected = true;

    // Online-only state, populated once waitForPlayers() resolves (see start()):
    // roster ([{team,color},...], tank-index order), friendlyFire, mySeat (this
    // client's raw seat number, 0-7), myTankIndex (mySeat's position within roster - can
    // differ from mySeat if lower-numbered seats are empty), seatOfTank (roster
    // index -> raw seat number, the inverse mapping) and names (roster-index-order
    // display names). seatEstimates holds this client's current best guess of every
    // OTHER tank's live input, by tank index - the online generalization of the old
    // single-opponent `keyEstimate` scalar.
    this.roster = null;
    this.friendlyFire = false;
    this.mapSizeX = undefined;
    this.mapSizeY = undefined;
    this.mySeat = null;
    this.myTankIndex = null;
    this.seatOfTank = null;
    this.names = null;
    this.seatEstimates = null;
    this.connectedMask = 0;

    this.ai = role == "ai" ? new AiController(this.gameLocal, aiDifficulty) : null;
    if (!offline) {
      this.fullCanvas = document.createElement("canvas");
      this.fullCanvas.width = 320; // widened once roster size is known - see start()
      this.fullCanvas.height = 400;
      this.fullCtx = this.fullCanvas.getContext("2d");
    }
  }

  stop() {
    this.stopped = true;
    if (this.iterateTimer) clearInterval(this.iterateTimer);
    if (this.netsyncTimer) clearInterval(this.netsyncTimer);
  }

  async start() {
    if (this.offline) {
      // no networking at all - gameRemote is never touched (simulate()/recalc() only
      // ever run from netsync(), which only fires once running via the online path
      // below), just gameLocal needs loading. iterate() steps it once per tick off its
      // own setInterval directly (see buildRawStates()/iterate()) rather than via
      // Net.currentFrame()'s wall-clock reconciliation - there's no server round trip
      // to reconcile against offline.
      await this.gameLocal.load();
      this.running = true;
      this.iterateTimer = setInterval(() => { this.iterate(); }, 1000 / this.net.fps);
      return;
    }

    // net.connect() rejects outright on a closed/refused websocket (unknown session, or
    // this seat already has a live connection elsewhere - see server.js's seat-taken
    // check) - previously unhandled here, which left the page silently blank forever
    // (an async function's rejection with nobody awaiting it further just vanishes,
    // confirmed by user: "clicking a server opens a blank screen with just Home").
    // Show an actual message and send them back to the lobby instead.
    let state;
    try {
      state = await this.net.connect(this.gameLocal.seed, false);
    } catch (e) {
      this.renderConnectionError();
      return;
    }
    if (this.stopped) return;
    this.gameRemote.seed = this.gameLocal.seed = state.seed;
    await this.waitForPlayers();
    if (this.stopped) return;
    this.fullCanvas.width = 320 * this.roster.length;
    this.seatEstimates = this.roster.map(() => 0);
    await Promise.all([
      this.gameLocal.load(this.roster, this.friendlyFire, this.mapSizeX, this.mapSizeY),
      this.gameRemote.load(this.roster, this.friendlyFire, this.mapSizeX, this.mapSizeY),
    ]);
    if (this.stopped) return;
    this.running = true;
    this.iterateTimer = setInterval(() => { this.iterate(); }, 1000 / this.net.fps);
    this.netsyncTimer = setInterval(async () => { await this.netsync(); }, 100);
  }

  renderConnectionError() {
    const canvas = this.ctx.canvas;
    this.ctx.fillStyle = "#000";
    this.ctx.fillRect(0, 0, canvas.width, canvas.height);
    this.ctx.fillStyle = "#fff";
    this.ctx.font = "18px sans-serif";
    this.ctx.textAlign = "center";
    this.ctx.fillText(t("seatUnavailable"), canvas.width / 2, canvas.height / 2);
    const sid = document.location.pathname.split("/").filter(Boolean)[0];
    // this browser's remembered seat (lobby.jsx's sessionStorage, see its own SEAT_KEY)
    // is exactly what sent it here - if that seat turned out to be taken by someone
    // else's live connection, clearing it now is what stops the lobby from bouncing it
    // straight back to this same failing seat every 2s poll forever.
    sessionStorage.removeItem(`tunneler_seat_${sid}`);
    setTimeout(() => { document.location.href = "/" + sid + "/"; }, 2000);
  }

  // Online seats/spectators shouldn't be able to move before the match actually starts -
  // the game clock (Net.currentFrame()) runs off wall-clock time from when the server
  // seeds the session regardless, so starting solo would give whoever arrives first a
  // head start once the others catch up. Poll /:id/status (same endpoint the lobby
  // polls) until the server reports `started`, then fetch the final seat roster (locked
  // in at that point - see server.js's startSessionIfReady()) and build the
  // tank-index<->seat-number mappings every client needs to agree on identically:
  // roster order is just "occupied seats, in ascending seat-number order" - deterministic
  // because every client reads the exact same seats array in the exact same order.
  async waitForPlayers() {
    const sid = document.location.pathname.split("/").filter(Boolean)[0];
    this.renderWaitingMessage();
    while (!this.stopped) {
      const status = await fetch(`/${sid}/status`).then((r) => r.json()).catch(() => null);
      if (status && status.started) {
        this.friendlyFire = status.friendlyFire;
        this.mapSizeX = status.mapSizeX;
        this.mapSizeY = status.mapSizeY;
        this.winScore = status.winScore;
        const occupied = [];
        status.seats.forEach((s, seatNum) => { if (s) occupied.push({ seatNum, ...s }); });
        this.roster = occupied.map((o) => ({ team: o.team, color: o.color }));
        this.names = occupied.map((o) => o.name);
        this.seatOfTank = occupied.map((o) => o.seatNum);
        this.myTankIndex = occupied.findIndex((o) => o.seatNum === this.mySeat);
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (this.stopped) return;
    // the server doesn't generate a real seed until the match actually starts - connect()'s
    // original handshake may have come back with seed=0/started=0 if we got here first,
    // fetch it again now that it's guaranteed to exist.
    const state = await this.net.reInit(this.gameLocal.seed);
    this.gameRemote.seed = this.gameLocal.seed = state.seed;
  }

  renderWaitingMessage() {
    const canvas = this.ctx.canvas;
    this.ctx.fillStyle = "#000";
    this.ctx.fillRect(0, 0, canvas.width, canvas.height);
    this.ctx.fillStyle = "#fff";
    this.ctx.font = "20px sans-serif";
    this.ctx.textAlign = "center";
    this.ctx.fillText(t("waitingForPlayers"), canvas.width / 2, canvas.height / 2 + 16);
  }

  // remaining: ms left in the round-start freeze (0 once it's over) - drives the
  // countdown overlay. forceRedraw: true only on the one render() call right after
  // the freeze ends, so the role 0/play/ai branch below can force a real repaint and
  // erase the overlay's last paint - see its own comment for why that branch can't
  // just rely on the usual dirty-frame-gated redraw for that. disconnectedName: the
  // name of a disconnected opponent while online, null otherwise (offline roles have no
  // networked opponent to lose) - greys out this player's own half and shows a banner
  // instead of the countdown.
  render(remaining = 0, forceRedraw = false, disconnectedName = null) {
    if (this.offline) {
      // offline/hotseat roles (0/play/ai) have no session to tell the server about
      // (that fetch("/"+sid+"/end") below is online-only) and never crop the canvas,
      // but still need matchEnded set so the "any key"/"any tap" handler (see
      // handleMatchEndInput() below) knows to fire once teamScores hits WIN_SCORE.
      if (!this.matchEnded && this.isMatchOver(this.gameLocal.state())) {
        this.matchEnded = true;
        this.matchEndedAt = performance.now();
      }
      this.gameLocal.render(this.ctx, forceRedraw);
      this.drawCountdown(this.ctx, remaining);
      return;
    }
    // once someone's won the match (first to WIN_SCORE round wins), the engine reveals
    // the whole map on its own frame - showing just this player's pane would cut off a
    // screen that's no longer split-camera gameplay at all.
    const s = this.gameLocal.state();
    const gameOver = this.isMatchOver(s);
    if (gameOver) {
      if (this.ctx.canvas.width != 640)
        this.ctx.canvas.width = 640;
      if (!this.matchEnded) {
        // the server has nothing left to relay once the match is decided - tell it to
        // drop the session rather than waiting out the normal empty-socket grace period
        this.matchEnded = true;
        this.matchEndedAt = performance.now();
        const sid = document.location.pathname.split("/").filter(Boolean)[0];
        fetch("/" + sid + "/end").catch(() => {});
      }
      this.gameLocal.render(this.ctx);
      return;
    }
    if (this.ctx.canvas.width != 320)
      this.ctx.canvas.width = 320;
    this.gameLocal.render(this.fullCtx);
    // this drawImage runs unconditionally every call (unlike gameLocal.render()'s
    // dirty-frame-gated blit), so it already erases any leftover countdown paint from
    // the previous frame on its own - no forceRedraw needed on this branch. ctx.filter
    // only applies to drawImage/fill calls, not gameLocal.render()'s putImageData
    // above, so grayscaling has to happen here rather than earlier in the pipeline.
    this.ctx.filter = disconnectedName ? "grayscale(1)" : "none";
    this.ctx.drawImage(this.fullCanvas, this.myTankIndex * 320, 0, 320, 400, 0, 0, 320, 400);
    this.ctx.filter = "none";
    if (disconnectedName)
      this.drawDisconnected(this.ctx, disconnectedName);
    else
      this.drawCountdown(this.ctx, remaining);
  }

  // banner shown in place of the countdown while any other seat is disconnected - see
  // updateOpponentConnection(). No timer of its own (unlike drawCountdown): it just
  // reflects opponentConnected, which only flips back on an actual reconnect.
  drawDisconnected(ctx, name) {
    const canvas = ctx.canvas;
    const cy = canvas.height / 2 - 36;
    ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
    ctx.fillRect(0, cy - 30, canvas.width, 60);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 18px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(t("disconnected", { name }), canvas.width / 2, cy);
    ctx.textBaseline = "alphabetic";
  }

  // draws the "3/2/1" freeze overlay on top of whatever render() already drew for
  // this frame. Purely a function of remaining - iterate() owns the countdown timer
  // state, this just paints (or doesn't).
  drawCountdown(ctx, remaining) {
    if (remaining <= 0) return;
    const canvas = ctx.canvas;
    const cx = canvas.width / 2, cy = canvas.height / 2 - 36;
    // paint an opaque box behind the number ourselves every call - gameLocal.render()
    // doesn't reliably repaint over it every frame (see the force-redraw comment in
    // render()/iterate()), so without this "3"/"2"/"1" would stack on top of each
    // other instead of each replacing the last.
    ctx.fillStyle = "#000";
    ctx.fillRect(cx - 40, cy - 44, 80, 80);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 64px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(Math.ceil(remaining / 1000)), cx, cy);
    ctx.textBaseline = "alphabetic";
  }

  iterate() {
    if (!this.running) return;

    // a round start is just s.round changing value - the engine drives that itself
    // (map/spawn reset), so this fires identically for offline (0/play/ai) and online
    // seats alike, no extra server signal needed. The winning round itself still bumps
    // this the same way any other round does, which used to make the countdown pop up
    // right over the map-reveal screen - matchOver() gates both starting a fresh
    // countdown here and (below) actually showing/enforcing one that was already in flight.
    const s = this.gameLocal.state();
    const matchOver = this.isMatchOver(s);
    if (!matchOver && (this.lastRound === null || s.round != this.lastRound)) {
      this.lastRound = s.round;
      this.countdownEnd = performance.now() + Session.COUNTDOWN_MS;
    }
    const remaining = matchOver || this.countdownEnd === null ? 0 : this.countdownEnd - performance.now();
    // opponentConnected only ever goes false online (see updateOpponentConnection()) -
    // freezes the same way a round-start countdown does, just with no timer of its
    // own: it holds until the reconnect flips it back and re-arms countdownEnd, at
    // which point the ordinary countdown branch below takes back over.
    const disconnected = !this.opponentConnected;
    const frozen = remaining > 0 || disconnected;
    // the exact frame the freeze ends - forces one real repaint below (see render()'s
    // offline branch): that branch draws straight to the visible canvas only when the
    // engine flags a dirty frame, which can stay false indefinitely if nothing else
    // changes on screen before the player's first move - otherwise the last-drawn digit
    // + its background box would sit there frozen until some other event (e.g. that
    // first move) finally triggered a real repaint.
    const justExpired = this.countdownEnd !== null && !frozen;
    if (justExpired) this.countdownEnd = null;

    const netFrame = this.offline ? this.gameLocal.frame + 1 : this.net.currentFrame();
    while (this.gameLocal.frame < netFrame) {
      const rawStates = this.buildRawStates(frozen);
      if (!this.gameLocal.step(rawStates)) {
        // this could be a local glitch
        this.running = false;
        break;
      }
    }
    this.render(frozen ? remaining : 0, justExpired, disconnected ? this.disconnectedOpponentName() : null);
    this.renderScore();
  }

  // Builds this tick's per-tank raw 5-bit scalar array for gameLocal.step() - see
  // netcode.js's Game.step()/decodeInput() for the unified bit order every tank now
  // shares. Offline hotseat (0/play/ai) still drives exactly 2 tanks from one shared
  // legacy keyState field (legacyTank0Bits/legacyTank1Bits, defined above); online seats
  // build one array entry per tank, this client's own tank real-time, every other tank
  // from its current best-guess estimate (this.seatEstimates, updated in netsync()).
  buildRawStates(frozen) {
    if (this.offline) {
      if (frozen) return [0, 0];
      const tank1Raw = this.ai ? legacyTank1Bits(this.ai.computeKeys()) : legacyTank1Bits(this.keyState);
      return [legacyTank0Bits(this.keyState), tank1Raw];
    }
    const rawStates = this.seatEstimates.slice();
    rawStates[this.myTankIndex] = frozen ? 0 : this.keyState;
    return rawStates;
  }

  disconnectedOpponentName() {
    // whichever other tank's seat isn't in the latest connectedMask - only meaningful
    // while disconnected==true (exactly one seat down at a time is the common case;
    // if more than one drop simultaneously this just names the first found, which is
    // fine for a banner that's naming a problem, not enumerating every one).
    for (let i = 0; i < this.roster.length; i++)
      if (i != this.myTankIndex && !(this.connectedMask & (1 << this.seatOfTank[i])))
        return this.names[i];
    return "";
  }

  renderScore() {
    const s = this.gameLocal.state();
    const gameOver = this.isMatchOver(s);
    const myTeam = this.offline ? null : s.tanks[this.myTankIndex].team;
    const winningTeam = gameOver
      ? Object.keys(s.teamScores).find((team) => s.teamScores[team] >= this.winScore)
      : null;
    this.formatScore(s.round, s.teamScores, gameOver, winningTeam, myTeam);
    this.reportScore(s.round, s.teamScores);
  }

  // tells the server this session's live round/teamScores so index.html's public games
  // list can show it - only the lowest-CONNECTED seat reports (every client computes the
  // identical deterministic value, no need for more than one to send the same thing
  // twice), and only on an actual change, not every frame, since this runs from
  // iterate() every tick.
  reportScore(round, teamScores) {
    if (this.offline) return;
    const lowestConnectedSeat = [...Array(8).keys()].find((i) => this.connectedMask & (1 << i));
    if (lowestConnectedSeat !== this.mySeat) return;
    const key = `${round}:${JSON.stringify(teamScores)}`;
    if (this.lastReportedScore == key) return;
    this.lastReportedScore = key;
    const sid = document.location.pathname.split("/").filter(Boolean)[0];
    fetch(`/${sid}/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ round, teamScores }),
    }).catch(() => {});
  }

  // shared by renderScore() (real values, once the game is running) and
  // waitForPlayers()'s placeholder - waitForPlayers() has nothing to format yet (roster
  // isn't known before the match starts), so it just shows a static "waiting" message
  // instead (see renderWaitingMessage()).
  //
  // Once the match is decided, "Round N" no longer means anything (the engine's own
  // full-map reveal replaces split-camera play - see render()'s gameOver branch), so
  // this player's own outcome replaces it instead - only meaningful online (a single
  // human with one tank/team to call a win or loss for); hotseat roles (0/"play") have
  // two humans sharing the screen with no single "you", so they keep showing "Round N".
  formatScore(round, teamScores, gameOver = false, winningTeam = null, myTeam = null) {
    const label = gameOver && myTeam !== null
      ? (String(myTeam) == String(winningTeam) ? t("victory") : t("defeat"))
      : t("round", { n: round });
    const teams = Object.keys(teamScores).sort((a, b) => a - b);
    this.onScoreChange({ label, teams, teamScores });
  }

  // called from every netsync() response with the current connected-seat bitmask. A
  // seat that was missing coming back (reconnect) re-arms the same round-start
  // countdown so play doesn't resume mid-stride - see iterate()'s `disconnected` freeze
  // and render()'s drawDisconnected() for the other half of this.
  updateOpponentConnection(connectedMask) {
    const wasConnected = this.opponentConnected;
    this.connectedMask = connectedMask;
    this.opponentConnected = this.roster.every((_, i) =>
      i == this.myTankIndex || !!(connectedMask & (1 << this.seatOfTank[i])));
    if (this.opponentConnected && !wasConnected)
      this.countdownEnd = performance.now() + Session.COUNTDOWN_MS;
  }

  async netsync() {
    if (this.waitSync) return;
    if (!this.running) return;

    this.waitSync = true;
    await this.net.sync(this.gameLocal.frame, this.gameLocal.paths[this.myTankIndex]).then((resp) => {
      this.waitSync = false;
      this.updateOpponentConnection(resp.connectedMask);

      // resp.paths is seat-tagged (raw seat numbers, see netcode.js's parseSyncPacket) -
      // remap to tank-index order (this.seatOfTank) so the rest of the pipeline works
      // in the same indexing gameLocal/gameRemote's tanks[] already use.
      const paths = this.roster.map((_, tankIndex) => resp.paths[this.seatOfTank[tankIndex]] || []);

      // Each tank's path is now its own fully independent scalar (never combined with
      // any other tank's bits into one shared field, unlike the old 2-tank design) -
      // just take the latest confirmed value verbatim as the new estimate, no masking
      // needed (the old design's keyFilter existed only to strip THIS client's own bits
      // back out of a value that used to be a combined field spanning both tanks).
      if (paths.some((p) => p.length))
        this.seatEstimates = paths.map((p, i) => (p.length ? p[p.length - 1][1] : this.seatEstimates[i]));

      // unshift previous state per tank, so we can extract keys in simulation - same
      // reasoning as the old single-path design: each seat's delta only covers frames
      // since THIS socket's own last ack, so Path.Extract's binary search needs a known
      // baseline value in effect right before the delta window starts.
      // Unconditional, even when p is empty (no NEW change reported for this tank this
      // round - the common case for a seat holding steady) - the server only ever
      // sends entries newer than what THIS socket already acked, so "nothing new"
      // means "still whatever it last was", not "released". Without this baseline, an
      // empty p would fall back to Path.Extract's new empty-path default of 0 (see
      // netcode.js) - silently treating "still holding the key" as "key released" the
      // moment the one-time change event aged out of the response window (confirmed by
      // user: movement would advance briefly then get stuck/reset on any held key).
      paths.forEach((p, i) => {
        p.unshift(this.gameRemote.paths[i].length ? this.gameRemote.paths[i][this.gameRemote.paths[i].length - 1] : [0, 0]);
      });

      // keep remote instance in sync with slowest client
      if (paths.every((p) => p.length <= 1) && resp.frame > this.gameRemote.frame)
        paths.forEach((p) => p.push([resp.frame - 1, p.length ? p[0][1] : 0]));

      const needsRecalc = this.simulate(paths);
      if (needsRecalc) this.recalc();
    }).catch((e) => {});
  }

  // paths: per-tank-index sparse arrays (see netsync() above), each already unshifted
  // with a baseline value at/before gameRemote.frame.
  simulate(paths) {
    // we got new paths from server which represent source of truth, during simulation
    // into gameRemote instance check if we need to rerun our local instance
    let recalc = false;
    const last = Math.max(-1, ...paths.map((p) => (p.length ? p[p.length - 1][0] : -1)));
    for (let i = this.gameRemote.frame; i <= last; i++) {
      // TODO: slow!
      const rawStates = paths.map((p) => Path.Extract(p, i));
      const localStates = this.gameLocal.paths.map((p) => Path.Extract(p, i));
      if (!rawStates.every((v, ti) => v == localStates[ti])) recalc = true;
      if (!this.gameRemote.step(rawStates)) {
        this.running = false;
        console.log("Game finished");
      }
    }
    return recalc;
  }

  recalc() {
    const myTankIndex = this.myTankIndex;
    const extend = [];
    // these are our local frames which we need to append to gameRemote instance
    for (let i = this.gameRemote.frame; i < this.gameLocal.frame; i++)
      extend.push(Path.Extract(this.gameLocal.paths[myTankIndex], i));
    // copy gameRemote to gameLocal, both represent source of truth
    this.gameLocal.copy(this.gameRemote);
    for (let i = 0; i < extend.length; i++) {
      const rawStates = this.seatEstimates.slice();
      rawStates[myTankIndex] = extend[i];
      if (i <= 3)
        for (let s = 0; s < rawStates.length; s++)
          if (s !== myTankIndex) rawStates[s] = 0;
      this.gameLocal.step(rawStates);
    }
  }

  onKey(key, pressed) {
    this.keyState = pressed ? (this.keyState | (1 << key)) : (this.keyState & ~(1 << key));
  }
}

const pathSegments = document.location.pathname.split("/").filter(Boolean);
let role = 0, mySeat = null, isOffline;
if (pathSegments[0] == "play") { role = "play"; isOffline = true; }
else if (pathSegments[0] == "ai") { role = "ai"; isOffline = true; }
else if (pathSegments[1] == "seat" && /^\d+$/.test(pathSegments[2] || "")) {
  mySeat = Number(pathSegments[2]);
  role = mySeat;
  isOffline = false;
} else {
  role = 0; // bare tunneler.html - offline hotseat, same as before
  isOffline = true;
}
// /ai's difficulty is its own path segment (like a seat number under an id) - defaults
// to "medium" for a bare /ai with none given.
const aiDifficulty = role == "ai" ? (pathSegments[1] || "medium") : null;

// role 0 and "play" keep the hardcoded "Blue"/"Green" labels - they're pure hotseat
// with no session/settings to pull custom names from at all. "ai" overrides them below
// to "Human"/"AI" instead, since there's no second human behind tank1. Online seats'
// names come from the live roster (waitForPlayers()), not any static markup.
let blueName = t("blueDefault"), greenName = t("greenDefault");
if (isOffline) {
  // bare tunneler.html (role 0) keeps the static <title> from the HTML itself - only
  // /play and /ai override it, same as before this rework.
  if (role == "play") document.title = t("splitScreenTitle");
  else if (role == "ai") {
    document.title = t("vsAiTitle", { difficulty: t(aiDifficulty) });
    blueName = t("humanDefault");
    greenName = t("aiDefault");
  }
} else {
  const sessionName = document.getElementById("root").dataset.sessionName;
  document.title = `${sessionName} - Tunneler`;
}

// bit index within the 11-bit keyState for each logical action, hotseat only (0/"play" -
// both share one keyboard between two people, so tank0/tank1 need two DISJOINT key sets
// live simultaneously - only the fire key differs between them, see onKey below). Online
// seats each get their own browser/keyboard, so they all use ONE fixed map instead - see
// ONLINE_KEYMAP below.
const KEYMAPS = {
  blue: { up: 6, down: 7, left: 8, right: 9, fire: 10 },
  green: { up: 0, right: 1, down: 2, left: 3, fire: 4, esc: 5 },
};
// Unified bit order every online seat shares (up=0,down=1,left=2,right=3,fire=4) -
// matches netcode.js's Game.decodeInput() exactly, so no per-role remapping is needed
// online at all (unlike the hotseat KEYMAPS above).
const ONLINE_KEYMAP = { up: 0, down: 1, left: 2, right: 3, fire: 4 };

function Score({ score }) {
  if (!score) return null;
  return (
    <div id="score">
      {score.label}
      {score.teams.length > 0 && (
        <>
          {" — "}
          {score.teams.map((team, i) => (
            <span key={team}>
              {i > 0 && "  |  "}
              {t("team")} {team}: {score.teamScores[team]}
            </span>
          ))}
        </>
      )}
    </div>
  );
}

function GameView() {
  const canvasRef = useRef(null);
  const touchControlsRef = useRef(null);
  const joystickRef = useRef(null);
  const knobRef = useRef(null);
  const fireBtnRef = useRef(null);
  const [score, setScore] = useState(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!isOffline) canvas.width = 320;
    const session = new Session(canvas.getContext("2d"), role, isOffline, setScore, blueName, greenName, aiDifficulty);
    session.mySeat = mySeat;
    session.start();

    // the engine's own "press any key" prompt on the match-over map reveal (see
    // Session.render()'s gameOver branch) only ever reads scancodes for the bits in
    // KEYMAPS/ONLINE_KEYMAP - it has no way to see an arbitrary keypress/tap, so that
    // prompt would sit there forever with no input able to satisfy it. Handle "any
    // key"/"any tap" ourselves instead: online seats have nothing left to rejoin
    // (matchEnded already told the server to drop the session - see Session.render()),
    // so send them back to the index; offline modes (0/play/ai) just reload, same as
    // their restart button. Shared by onKey() below and the touch controls' pointerdown
    // handlers - session.onKey() (used to actually move/fire) has no idea about
    // match-end, so every input entry point has to check this itself before it does
    // anything else.
    // Minimum time the map-reveal screen stays up before any input can dismiss it -
    // otherwise the very same fire-key hold that landed the winning shot (the browser
    // keeps sending auto-repeat keydowns for a held key) would instantly dismiss the
    // reveal the player hasn't even seen yet.
    const MATCH_END_INPUT_DELAY_MS = 3000;

    function handleMatchEndInput(repeat = false) {
      if (!session.matchEnded) return false;
      // an OS auto-repeat keydown from a key still held since before the match ended -
      // require it to actually be released and pressed again (or a fresh tap/click).
      if (repeat) return false;
      if (performance.now() - session.matchEndedAt < MATCH_END_INPUT_DELAY_MS) return false;
      if (!isOffline) document.location.href = "/";
      else document.location.reload();
      return true;
    }

    function onKey(e, pressed) {
      let consumed = true;

      if (pressed && handleMatchEndInput(e.repeat)) {
        e.preventDefault();
        return;
      }

      if (!isOffline) {
        // each online seat may use either arrows or WASD to move, and any of
        // space/enter/ctrl to fire - only its own tank's bits ever get set.
        const map = ONLINE_KEYMAP;
        let action = null;
        switch (e.keyCode) {
          case 38: case 87: action = "up"; break;
          case 40: case 83: action = "down"; break;
          case 37: case 65: action = "left"; break;
          case 39: case 68: action = "right"; break;
          case 32: case 13: case 17: action = "fire"; break;
          default: consumed = false;
        }
        if (action && map[action] !== undefined) session.onKey(map[action], pressed);
        else if (action) consumed = false;
      } else if (role == "ai") {
        // "ai" always drives tank0's bits from the keyboard (tank1 is the AiController) -
        // same key layout as KEYMAPS.blue.
        const map = KEYMAPS.blue;
        let action = null;
        switch (e.keyCode) {
          case 38: case 87: action = "up"; break;
          case 40: case 83: action = "down"; break;
          case 37: case 65: action = "left"; break;
          case 39: case 68: action = "right"; break;
          case 32: case 13: case 17: action = "fire"; break;
          default: consumed = false;
        }
        if (action && map[action] !== undefined) session.onKey(map[action], pressed);
        else if (action) consumed = false;
      } else if (role == "play") {
        // classic single-browser split-screen: arrows+Enter for one tank, WASD+Space for the other
        const tbit = (n, p) => session.onKey(n, p);
        switch (e.keyCode) {
          case 38: tbit(0, pressed); break; // up arrow
          case 39: tbit(1, pressed); break; // right arrow
          case 40: tbit(2, pressed); break; // down arrow
          case 37: tbit(3, pressed); break; // left arrow
          case 13: tbit(4, pressed); break; // enter -> fire
          case 27: tbit(5, pressed); break; // esc
          case 87: tbit(6, pressed); break; // w
          case 83: tbit(7, pressed); break; // s
          case 65: tbit(8, pressed); break; // a
          case 68: tbit(9, pressed); break; // d
          case 32: tbit(10, pressed); break; // space -> fire
          default: consumed = false;
        }
      } else {
        // bare tunneler.html (no /<id> at all) - original hotseat bindings, kept as-is
        const tbit = (n, p) => session.onKey(n, p);
        switch (e.keyCode) {
          case 38: tbit(0, pressed); break;
          case 39: tbit(1, pressed); break;
          case 40: tbit(2, pressed); break;
          case 37: tbit(3, pressed); break;
          case 32: tbit(4, pressed); break;
          case 27: tbit(5, pressed); break;
          case 87: tbit(6, pressed); break;
          case 83: tbit(7, pressed); break;
          case 65: tbit(8, pressed); break;
          case 68: tbit(9, pressed); break;
          case 16: tbit(10, pressed); break;
          default: consumed = false;
        }
      }
      if (consumed) e.preventDefault();
    }

    const onKeyDown = (evt) => onKey(evt, 1);
    const onKeyUp = (evt) => onKey(evt, 0);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);

    const onCanvasPointerDown = () => handleMatchEndInput();
    canvas.addEventListener("pointerdown", onCanvasPointerDown);

    const cleanupFns = [
      () => document.removeEventListener("keydown", onKeyDown),
      () => document.removeEventListener("keyup", onKeyUp),
      () => canvas.removeEventListener("pointerdown", onCanvasPointerDown),
    ];

    // Touch controls: online seats drive exactly one tank via ONLINE_KEYMAP, so a
    // single on-screen joystick+fire button maps onto it cleanly. "play"/0 hotseat
    // share one keyboard between two people sitting at the same device - there's no
    // touch-input equivalent for a second player, so mobile drops that mode entirely
    // instead (see index.html's local-splitscreen-row, hidden on touch/narrow viewports).
    const touchControls = touchControlsRef.current;
    const isTouchViewport = window.matchMedia("(pointer: coarse)").matches || window.innerWidth <= 900;
    if (touchControls && isTouchViewport && (!isOffline || role == "ai")) {
      document.body.classList.add("touch-enabled");
      touchControls.hidden = false;
      const map = isOffline ? KEYMAPS.blue : ONLINE_KEYMAP;

      const fireBtn = fireBtnRef.current;
      const firePress = (e) => {
        e.preventDefault();
        if (handleMatchEndInput()) return;
        fireBtn.classList.add("active");
        session.onKey(map.fire, 1);
      };
      const fireRelease = (e) => {
        e.preventDefault();
        fireBtn.classList.remove("active");
        session.onKey(map.fire, 0);
      };
      fireBtn.addEventListener("pointerdown", firePress);
      fireBtn.addEventListener("pointerup", fireRelease);
      fireBtn.addEventListener("pointercancel", fireRelease);
      fireBtn.addEventListener("pointerleave", fireRelease);
      cleanupFns.push(
        () => fireBtn.removeEventListener("pointerdown", firePress),
        () => fireBtn.removeEventListener("pointerup", fireRelease),
        () => fireBtn.removeEventListener("pointercancel", fireRelease),
        () => fireBtn.removeEventListener("pointerleave", fireRelease),
      );

      // Drag joystick: setting both an x-axis and a y-axis bit at once (e.g. up+right)
      // drives a diagonal, same as holding two arrow keys together on a keyboard - a
      // fixed set of up/down/left/right buttons can't do that with a single thumb.
      // DEADZONE/RADIUS are in the knob's own translated pixels, not screen pixels, so
      // they stay correct regardless of CSS transform scaling.
      const joystick = joystickRef.current;
      const knob = knobRef.current;
      const RADIUS = 32; // (.joystick 116px - .joystick-knob 52px) / 2, see tunneler.css
      const DEADZONE = 10;
      let activePointerId = null;

      const setAxes = (dx, dy) => {
        session.onKey(map.left, dx < -DEADZONE);
        session.onKey(map.right, dx > DEADZONE);
        session.onKey(map.up, dy < -DEADZONE);
        session.onKey(map.down, dy > DEADZONE);
      };
      const moveKnob = (clientX, clientY) => {
        const rect = joystick.getBoundingClientRect();
        let dx = clientX - (rect.left + rect.width / 2);
        let dy = clientY - (rect.top + rect.height / 2);
        const dist = Math.hypot(dx, dy);
        if (dist > RADIUS) {
          dx = (dx / dist) * RADIUS;
          dy = (dy / dist) * RADIUS;
        }
        knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        setAxes(dx, dy);
      };
      const resetKnob = () => {
        knob.style.transform = "translate(-50%, -50%)";
        setAxes(0, 0);
      };

      const onJoystickDown = (e) => {
        e.preventDefault();
        if (handleMatchEndInput()) return;
        activePointerId = e.pointerId;
        joystick.setPointerCapture(activePointerId);
        moveKnob(e.clientX, e.clientY);
      };
      const onJoystickMove = (e) => {
        if (e.pointerId !== activePointerId) return;
        e.preventDefault();
        moveKnob(e.clientX, e.clientY);
      };
      const endDrag = (e) => {
        if (e.pointerId !== activePointerId) return;
        activePointerId = null;
        resetKnob();
      };
      joystick.addEventListener("pointerdown", onJoystickDown);
      joystick.addEventListener("pointermove", onJoystickMove);
      joystick.addEventListener("pointerup", endDrag);
      joystick.addEventListener("pointercancel", endDrag);
      cleanupFns.push(
        () => joystick.removeEventListener("pointerdown", onJoystickDown),
        () => joystick.removeEventListener("pointermove", onJoystickMove),
        () => joystick.removeEventListener("pointerup", endDrag),
        () => joystick.removeEventListener("pointercancel", endDrag),
      );
    }

    return () => {
      session.stop();
      cleanupFns.forEach((fn) => fn());
      document.body.classList.remove("touch-enabled");
    };
  }, []);

  return (
    <>
      <div className="banner">
        <a className="new-game-btn" href="/">
          {t("home")}
        </a>
        <Score score={score} />
        {/* /play and /ai both have a restart concept - they're the fully local/offline
            modes with no opponent to disrupt by reloading; a reload is enough to reset
            either since all their state (both Game instances) lives in this page,
            nothing on the server. */}
        {(role == "play" || role == "ai") && (
          <button
            className="restart-btn"
            type="button"
            onClick={() => document.location.reload()}
          >
            {t("newGame")}
          </button>
        )}
      </div>
      <div id="gameArea">
        <canvas ref={canvasRef} id="canvas1" width="640" height="400" />
        <div ref={touchControlsRef} id="touchControls" className="touch-controls" hidden>
          <div ref={joystickRef} id="joystick" className="joystick" aria-label="Move">
            <div ref={knobRef} className="joystick-knob" />
          </div>
          <button ref={fireBtnRef} type="button" id="fireBtn" className="fire-btn" aria-label="Fire">
            FIRE
          </button>
        </div>
      </div>
    </>
  );
}

createRoot(document.getElementById("root")).render(<GameView />);
