"use strict";
/* global t, Net, Game, Path, EngineRender */

// React port of spectator.js. SpectatorSession itself stays the same imperative class
// (constructed once per mount, driving the two canvases directly via
// putImageData/drawImage - React never touches canvas pixels) - the only change is how
// it reports the score line: instead of writing scoreEl.innerHTML directly, it now
// calls an onScoreChange(data) callback wired to React state, letting <Score/> render
// it declaratively (and drop the manual escapeHtml() call - JSX text children are
// escaped automatically).

import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState } from "react";

class SpectatorSession {
  // First to this many round wins takes the match - a per-session setting (server.js's
  // session.winScore) fetched in waitForPlayers(), same as tunneler.jsx's Session.

  constructor(ctx, mapCtx, onScoreChange, sessionName) {
    this.ctx = ctx;
    this.mapCtx = mapCtx;
    this.onScoreChange = onScoreChange;
    this.sessionName = sessionName;
    this.net = new Net();
    this.game = new Game();
    this.running = false;
    this.stopped = false;
    this.waitSync = false;
    this.netsyncTimer = null;
    this.fullCanvas = document.createElement("canvas");
    this.fullCanvas.height = 400;
    this.fullCtx = this.fullCanvas.getContext("2d");
    // Online-only state, populated once waitForPlayers() resolves - see tunneler.jsx's
    // Session for the same roster/seatOfTank/names shape and why it's needed (a tank's
    // roster position and its raw seat number can differ when lower seats are empty).
    this.roster = null;
    this.names = null;
    this.seatOfTank = null;
    this.mapSizeX = undefined;
    this.mapSizeY = undefined;
    this.connectedMask = 0;
    this.winScore = 3;
    // no facing byte is exposed by Game.state(), so heading is derived from movement
    // between samples instead (per tank index) - holds the last heading while
    // stationary rather than snapping to 0. Starts at 0 for everyone (unlike the old
    // fixed 2-base left/right default) since bases can be anywhere on the map now.
    this.heading = [];
    this.prevPos = [];
    this.cols = 1;
    this.rows = 1;
  }

  stop() {
    this.stopped = true;
    if (this.netsyncTimer) clearInterval(this.netsyncTimer);
  }

  async start() {
    // this proposal is normally moot - the server doesn't seed a session until enough
    // seats are ready (see startSessionIfReady() in server.js), so it just ignores
    // whatever we propose here.
    const fallbackSeed = Math.floor(Math.random() * 0x10000) | (Math.floor(Math.random() * 0x10000) << 16);
    // net.connect() rejects outright on a closed/refused websocket (unknown session, or
    // spectating disabled for this one) - previously unhandled here, silently leaving
    // the page blank forever. Show a message and send them back to the lobby instead.
    let state;
    try {
      state = await this.net.connect(fallbackSeed, false);
    } catch (e) {
      this.renderConnectionError();
      return;
    }
    if (this.stopped) return;
    this.game.seed = state.seed;
    await this.waitForPlayers();
    if (this.stopped) return;
    this.game.seed = state.seed; // reInit() below may have refreshed it again
    await this.game.load(this.roster, this.friendlyFire, this.mapSizeX, this.mapSizeY);
    this.running = true;
    this.netsyncTimer = setInterval(() => {
      this.netsync();
    }, 100);
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
    setTimeout(() => {
      document.location.href = "/" + sid + "/";
    }, 2000);
  }

  // The server doesn't generate a seed - i.e. there's no map, no game, nothing to
  // spectate at all - until the match actually starts (see startSessionIfReady() in
  // server.js). Poll /:id/status (same endpoint the lobby polls) until `started`, then
  // fetch the final locked-in roster - mirrors tunneler.jsx's Session.waitForPlayers()
  // exactly (see its own comment for why the tank-index<->seat-number mapping matters).
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
        this.mapCtx.canvas.width = this.mapSizeX;
        this.mapCtx.canvas.height = this.mapSizeY;
        const occupied = [];
        status.seats.forEach((s, seatNum) => { if (s) occupied.push({ seatNum, ...s }); });
        this.roster = occupied.map((o) => ({ team: o.team, color: o.color }));
        this.names = occupied.map((o) => o.name);
        this.seatOfTank = occupied.map((o) => o.seatNum);
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (this.stopped) return;
    this.heading = this.roster.map(() => 0);
    this.prevPos = this.roster.map(() => null);
    this.cols = Math.ceil(Math.sqrt(this.roster.length));
    this.rows = Math.ceil(this.roster.length / this.cols);
    this.ctx.canvas.width = this.cols * 320;
    this.ctx.canvas.height = this.rows * 400;
    this.fullCanvas.width = 320 * this.roster.length;
    // the server doesn't generate a real seed until the match actually starts - connect()'s
    // original handshake may have come back with seed=0/started=0 if this spectator got
    // here first, fetch it again now that it's guaranteed to exist.
    const state = await this.net.reInit(this.game.seed);
    this.game.seed = state.seed;
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

  async netsync() {
    if (this.waitSync || !this.running) return;
    this.waitSync = true;
    // frame 0/no path - a spectator has no seat/inputs of its own to report, only ever
    // receives (matches how tunneler.jsx's Game.paths[] works for a tank that never
    // reports its own path - see netcode.js's Net.sync()).
    await this.net
      .sync(this.game.frame, [])
      .then((resp) => {
        this.waitSync = false;
        this.connectedMask = resp.connectedMask;

        const paths = this.roster.map((_, tankIndex) => resp.paths[this.seatOfTank[tankIndex]] || []);
        // Unconditional, even when p is empty (no NEW change reported for this tank this
        // round) - see tunneler.jsx's Session.netsync() for why: "nothing new" means
        // "still whatever it last was", not "released", and skipping the baseline here
        // would silently fall back to Path.Extract's empty-path default of 0.
        paths.forEach((p, i) => {
          p.unshift(this.game.paths[i].length ? this.game.paths[i][this.game.paths[i].length - 1] : [0, 0]);
        });
        // no key changes doesn't mean no time passed - keep advancing to the server's
        // ack'd frame even when every path is otherwise empty (see tunneler.jsx's netsync)
        if (paths.every((p) => p.length <= 1) && resp.frame > this.game.frame)
          paths.forEach((p) => p.push([resp.frame - 1, p.length ? p[0][1] : 0]));

        const last = Math.max(-1, ...paths.map((p) => (p.length ? p[p.length - 1][0] : -1)));
        for (let i = this.game.frame; i <= last; i++) {
          const rawStates = paths.map((p) => Path.Extract(p, i));
          if (!this.game.step(rawStates)) {
            this.running = false;
            break;
          }
        }
        this.renderFrame();
        this.renderMap();
        this.renderScore();
        this.setDisconnected(false);
      })
      .catch((e) => {
        // Net.sync() rejects outright while the websocket is down - without resetting
        // waitSync here, netsync() would early-return forever and never retry once
        // the socket reconnects.
        this.waitSync = false;
        this.setDisconnected(true);
      });
  }

  setDisconnected(disconnected) {
    const filter = disconnected ? "grayscale(1)" : "none";
    this.ctx.canvas.style.filter = filter;
    this.mapCtx.canvas.style.filter = filter;
  }

  // Lays every connected tank's own camera pane (engine-render.js renders them all
  // side by side into one W*N-wide strip - see its render()) out into a grid instead
  // of the old fixed 2-way left/right split, since there can be up to 8 now. Once the
  // match is decided, the engine switches to a single full-map reveal instead (see
  // engine.js's TunnelerEngine.render()) - shown across the whole canvas, not
  // mosaic-sliced, same treatment as tunneler.jsx's own gameOver branch.
  renderFrame() {
    const s = this.game.state();
    const gameOver = Object.values(s.teamScores).some((v) => v >= SpectatorSession.WIN_SCORE);
    if (gameOver) {
      this.game.render(this.ctx);
      return;
    }
    this.game.render(this.fullCtx);
    const paneW = this.ctx.canvas.width / this.cols, paneH = this.ctx.canvas.height / this.rows;
    this.ctx.fillStyle = "#000";
    this.ctx.fillRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
    for (let i = 0; i < this.roster.length; i++) {
      const col = i % this.cols, row = Math.floor(i / this.cols);
      const connected = !!(this.connectedMask & (1 << this.seatOfTank[i]));
      this.ctx.filter = connected ? "none" : "grayscale(1)";
      this.ctx.drawImage(this.fullCanvas, i * 320, 0, 320, 400, col * paneW, row * paneH, paneW, paneH);
    }
    this.ctx.filter = "none";
  }

  // Was reading the old WASM engine's packed-EGA map buffer (2px/byte, x-8 offset -
  // see git history if that's ever needed again). The new engine (engine.js) exposes
  // its field grid directly via Game.getField() - one byte per cell, no packing - and
  // state().tanks[i].x/y is that tank's exact world position with no offset quirk to
  // correct for, unlike the old buffer's -8px reading.
  renderMap() {
    const terrain = this.game.getField();
    if (!terrain) return;
    const { field, sizeX, sizeY } = terrain;
    if (!this._mapImg || this._mapImg.width !== sizeX || this._mapImg.height !== sizeY)
      this._mapImg = this.mapCtx.createImageData(sizeX, sizeY);
    const img = this._mapImg;
    let i = 0;
    for (let y = 0; y < sizeY; y++)
      for (let x = 0; x < sizeX; x++) {
        const [r, g, b] = EngineRender.fieldColor(field[y * sizeX + x]);
        img.data[i++] = r; img.data[i++] = g; img.data[i++] = b; img.data[i++] = 255;
      }
    this.mapCtx.putImageData(img, 0, 0);

    const s = this.game.state();
    s.tanks.forEach((tank, i) => {
      if (tank.roundOut) return;
      this.drawTank(tank.x, tank.y, this.updateHeading(i, tank.x, tank.y), tank.color);
    });
  }

  updateHeading(i, x, y) {
    const prev = this.prevPos[i];
    if (prev) {
      const dx = x - prev.x, dy = y - prev.y;
      if (dx != 0 || dy != 0) {
        // movement is 8-directional - snap to the nearest 45deg step rather than
        // trust the raw angle, which can drift off-diagonal from sampling jitter
        const step = Math.PI / 4;
        this.heading[i] = Math.round(Math.atan2(dy, dx) / step) * step;
      }
    }
    this.prevPos[i] = { x: x, y: y };
    return this.heading[i];
  }

  // A small filled triangle tinted to the tank's own chosen color (EngineRender.
  // tankPalette(), same palette the in-game tank sprite itself uses) rather than a
  // static tank-{color}.png sprite - avoids needing 6 more hand-made image assets for
  // the 6 added colors.
  drawTank(x, y, angle, color) {
    const [r, g, b] = EngineRender.tankPalette(color)[0];
    const size = 6;
    const ctx = this.mapCtx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.beginPath();
    ctx.moveTo(size, 0);
    ctx.lineTo(-size * 0.7, size * 0.7);
    ctx.lineTo(-size * 0.7, -size * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  renderScore() {
    const s = this.game.state();
    const gameOver = Object.values(s.teamScores).some((v) => v >= SpectatorSession.WIN_SCORE);
    const winningTeam = gameOver
      ? Object.keys(s.teamScores).find((team) => s.teamScores[team] >= SpectatorSession.WIN_SCORE)
      : null;
    this.formatScore(s.round, s.teamScores, gameOver, winningTeam);
  }

  // Once the match is decided, "Round N" no longer means anything (the engine's own
  // full-map reveal replaces split-camera play - mirrors tunneler.jsx's render()
  // gameOver branch), so this segment becomes "Team N wins" instead.
  formatScore(round, teamScores, gameOver = false, winningTeam = null) {
    const label = gameOver ? t("teamWins", { team: winningTeam }) : t("round", { n: round });
    const teams = Object.keys(teamScores).sort((a, b) => a - b);
    this.onScoreChange({ sessionName: this.sessionName, label, teams, teamScores });
  }
}

function Score({ score }) {
  if (!score) return null;
  return (
    <div id="score">
      {score.sessionName} — {score.label}
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

function App() {
  const canvasRef = useRef(null);
  const mapCanvasRef = useRef(null);
  const [score, setScore] = useState(null);

  useEffect(() => {
    const sessionName = document.getElementById("root").dataset.sessionName;
    const canvas = canvasRef.current;
    const mapCanvas = mapCanvasRef.current;
    // HTML's width/height attrs are just a static fallback for the pre-load paint - the
    // session doesn't know the field's actual (per-session) size until waitForPlayers()
    // reads it off /:id/status, so it resizes mapCanvas itself once that's known (see
    // waitForPlayers() below) rather than trusting a hardcoded number to stay right - a
    // canvas smaller than the field would clip putImageData's write in renderMap().
    const session = new SpectatorSession(canvas.getContext("2d"), mapCanvas.getContext("2d"), setScore, sessionName);
    session.start();
    return () => session.stop();
  }, []);

  return (
    <>
      <div className="banner">
        <a className="new-game-btn" href="/">
          {t("newGame")}
        </a>
        <Score score={score} />
      </div>
      <canvas ref={canvasRef} id="canvas1" width="640" height="400" />
      <canvas ref={mapCanvasRef} id="map" width="1024" height="512" />
    </>
  );
}

createRoot(document.getElementById("root")).render(<App />);
