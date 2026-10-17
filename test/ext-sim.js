"use strict";
// Headless test of the engine options beyond the original (docs/DESIGN-8P.md sections 2, 8, 10, 11, 13,
// 15, 17, 20):
//   - classic is untouched: new TunnelerEngine(seed), {players: 2}, {slots: BLUE + GREEN in different
//     teams}, {size: "medium", winScore: 3} are the same game; anything else is the extended engine
//   - options: slots (colors, arbitrary team numbers), teams helpers, sizes, winScore, friendlyFire
//   - world sizes small / medium / large: world generation deterministic, resumable, rock border all
//     around, similar amount of rock; base placement over the scaled area for 2..8 players
//   - full matches (classic and extended: free-for-all, 2 / 3 / 4 teams, uneven teams, other colors,
//     winScore, sizes, friendly fire) driven by a simple deterministic scripted driver (not the AI): two
//     engines fed the same inputs stay identical every frame (state, world, RandSeed, every view buffer,
//     sound), rounds end when at most one team is left, the round goes to that team (every member's wins
//     go up), the match ends at winScore, the round title / world map / statistics show every player,
//     Esc does nothing, per-frame time, every sound event has a source position (fire = the firing tank)
//   - friendly fire on / off in a staged duel
//   - the world map banner from strings.banner (box sized to it, centered), the original by default
//   - instructions: "{n}" follows winScore and stays inside 80 columns / 23 rows in every language
//   - the statistics and round title lay out without wrapping in every language, for many team setups
//   node test/ext-sim.js [quick]
const path = require("path");
const JS = path.join(__dirname, "..", "src", "js");
require(path.join(JS, "vgafont.js"));
require(path.join(JS, "glyphs.js"));
const Lang = require(path.join(JS, "lang.js"));
const E = require(path.join(JS, "engine.js"));

const quick = process.argv.includes("quick");
const { UP, DOWN, LEFT, RIGHT, FIRE } = E.BITS;
let bad = 0;
const fail = msg => { bad++; console.log("  FAIL " + msg); };
const check = (ok, msg) => { if (!ok) fail(msg); return ok; };
const ok = msg => console.log("  " + (bad ? "..." : "ok") + "  " + msg);

// text of row y (0..24) of a text-mode vram, as raw bytes -> string
const textRow = (vram, y) => { let s = ""; for (let x = 0; x < 80; x++) s += String.fromCharCode(vram[y * 160 + x * 2]); return s; };
const screenText = vram => { const r = []; for (let y = 0; y < 25; y++) r.push(textRow(vram, y)); return r.join("\n"); };
const slots = (colors, teams) => colors.map((c, i) => ({ color: c, team: teams[i] }));

function startEngine(seed, opts) {
  const e = new E(seed, opts);
  for (let i = 0; i < 4000 && e.worldStage !== -1; i++) e.step({});
  e.step({ keys: [[0, 59]] });                     // F1: start game
  return e;
}

// ------------------------------------------------------------------ scripted driver
// Every tank heads for the nearest enemy tank alive, fires when it is lined up on one of the 8
// directions and close, and wanders for a while when it got stuck. Deterministic (own LCG per player).
class Driver {
  constructor(seed, n) {
    this.rnd = []; this.stuck = []; this.wander = []; this.last = []; this.wdir = [];
    for (let p = 0; p <= n; p++) { this.rnd.push((seed ^ (p * 0x9E3779B1)) >>> 0); this.stuck.push(0); this.wander.push(0); this.last.push(""); this.wdir.push(0); }
  }
  rand(p, n) { this.rnd[p] = (Math.imul(this.rnd[p], 1103515245) + 12345) >>> 0; return (this.rnd[p] >>> 16) % n; }
  bits(e) {
    const N = e.nPlayers, out = [];
    for (let p = 1; p <= N; p++) {
      if (!e.alive[p] || e.screen !== "play") { out.push(0); continue; }
      const pos = e.tankX[p] + "," + e.tankY[p];
      this.stuck[p] = pos === this.last[p] ? this.stuck[p] + 1 : 0;
      this.last[p] = pos;
      if (this.wander[p] > 0) { this.wander[p]--; out.push(this.wdir[p] | FIRE); continue; }
      if (this.stuck[p] > 12) {
        this.wdir[p] = [UP, DOWN, LEFT, RIGHT, UP | LEFT, UP | RIGHT, DOWN | LEFT, DOWN | RIGHT][this.rand(p, 8)];
        this.wander[p] = 15 + this.rand(p, 30);
        this.stuck[p] = 0;
        out.push(this.wdir[p]);
        continue;
      }
      let best = 0, bd = 1e9;
      for (let q = 1; q <= N; q++)
        if (e.alive[q] && e.isEnemy(p, q)) {
          const d = Math.abs(e.tankX[q] - e.tankX[p]) + Math.abs(e.tankY[q] - e.tankY[p]);
          if (d < bd) { bd = d; best = q; }
        }
      if (!best) { out.push(0); continue; }
      const dx = e.tankX[best] - e.tankX[p], dy = e.tankY[best] - e.tankY[p];
      let b = 0;
      if (dx > 2) b |= RIGHT; else if (dx < -2) b |= LEFT;
      if (dy > 2) b |= DOWN; else if (dy < -2) b |= UP;
      const ax = Math.abs(dx), ay = Math.abs(dy);
      if (ax + ay < 90 && (ax <= 2 || ay <= 2 || Math.abs(ax - ay) <= 2)) {
        // lined up: face it exactly along one of the 8 directions and fire
        b = 0;
        if (ay > 2 || ax <= 2) b |= dy > 0 ? DOWN : UP;
        if (ax > 2 || ay <= 2) b |= dx > 0 ? RIGHT : LEFT;
        if (ax <= 2 && ay <= 2) b = dx > 0 ? RIGHT : LEFT;
        b |= FIRE;
      } else if (ax + ay > 60 && e.energy[p] > 4000) b |= FIRE;   // fast digging while far away
      out.push(b);
    }
    return out;
  }
}
// classic input: net bits of BLUE / GREEN -> the original's key table (TunnelerEngine.KEYS)
const KD = new Uint8Array(128);
function keyDown(bits) {
  KD.fill(0);
  const K = E.KEYS;
  for (let p = 1; p <= 2; p++) {
    const b = bits[p - 1] | 0;
    if (b & UP) KD[K.KeyUp[p]] = 1;
    if (b & DOWN) KD[K.KeyDown[p]] = 1;
    if (b & LEFT) KD[K.KeyLeft[p]] = 1;
    if (b & RIGHT) KD[K.KeyRight[p]] = 1;
    if (b & FIRE) KD[K.KeyFire[p]] = 1;
  }
  return KD;
}

// every sound event carries a source position; while playing, a sound has one inside the world, and
// a shot's sound (5000 Hz) is where a tank is
function soundCheck(e, label) {
  for (const s of e.soundEvents) {
    if (typeof s.x !== "number" || typeof s.y !== "number") return fail(label + ": sound event without position " + JSON.stringify(s));
    if (e.screen !== "play" || !s.hz) continue;
    if (s.x < 0 || s.y < 0 || s.x >= e.worldW || s.y >= e.worldH) return fail(label + ": sound outside the world " + JSON.stringify(s));
    if (s.hz > 4000) {
      let near = false;
      for (let p = 1; p <= e.nPlayers; p++) if (Math.abs(e.tankX[p] - s.x) <= 2 && Math.abs(e.tankY[p] - s.y) <= 2) near = true;
      if (!near) return fail(label + ": shot sound away from every tank " + JSON.stringify(s));
    }
  }
  return true;
}

// ------------------------------------------------------------------ 1. classic untouched
{
  const a = new E(77), b = new E(77, { players: 2 }), c = new E(77, { players: 2, teams: false });
  const d = new E(77, { slots: slots([0, 1], [1, 2]) }), f = new E(77, { slots: slots([0, 1], [1, 2]), size: "medium", winScore: 3 });
  const g = new E(77, { slots: slots([0, 1], [7, 3]) });         // other team numbers: same game (state() shows them)
  for (const [x, n] of [[a, "seed"], [b, "players 2"], [c, "teams false"], [d, "slots"], [f, "slots, medium, 3"], [g, "slots 7 / 3"]])
    check(!x.extended && x.nPlayers === 2 && x.worldW === 1024 && x.worldH === 512 && x.winScore === 3, "classic: " + n + " must be classic");
  check(new E(1, { players: 2, extended: true }).extended, "{players: 2, extended: true} is extended");
  check(new E(1, { players: 2, teams: true }).extended, "{players: 2, teams: true} is extended");
  check(new E(1, { slots: slots([1, 0], [1, 2]) }).extended, "GREEN + BLUE (other order) is extended");
  check(new E(1, { slots: slots([0, 2], [1, 2]) }).extended, "BLUE + CYAN is extended");
  check(new E(1, { slots: slots([0, 1], [1, 1]) }).extended, "BLUE + GREEN in one team is extended");
  check(new E(1, { players: 12 }).nPlayers === 8 && new E(1, { slots: new Array(12).fill(0).map((_, i) => ({ color: i & 7, team: i })) }).nPlayers === 8, "players capped at 8");
  check(!new E(1, { size: "small" }).extended && !new E(1, { winScore: 5 }).extended, "size / winScore keep the classic engine");
  const kd = new Uint8Array(128);
  let same = true;
  for (let i = 0; i < 900; i++) {
    kd.fill(0);
    if (i > 400) { kd[0x20] = (i >> 5) & 1; kd[0x4B] = 1; kd[0x1D] = (i >> 3) & 1; kd[0x50] = (i >> 6) & 1; }
    const inp = { keyDown: kd, keys: i === 380 ? [[0, 59]] : [] };
    for (const x of [a, b, c, d, f, g]) x.step(inp);
    for (const x of [b, c, d, f, g])
      if (a.randSeed !== x.randSeed || (x !== g && JSON.stringify(a.state()) !== JSON.stringify(x.state())) || Buffer.compare(a.vram, x.vram)
        || Buffer.compare(a.world, x.world) || JSON.stringify(a.soundEvents) !== JSON.stringify(x.soundEvents)) same = false;
    if (!same) break;
    if (a.snapshots.some(s => s.palette || s.views)) { fail("classic snapshot carries palette / views"); break; }
    soundCheck(a, "classic");
  }
  check(same, "classic engine with options diverged from new TunnelerEngine(seed)");
  check(g.team(1) === 0 && g.team(2) === 1 && g.teamNumber(1) === 7 && g.isEnemy(1, 2), "classic: BLUE is team 0, GREEN team 1");
  ok("classic: options keep the original game");
}

// ------------------------------------------------------------------ 2. options
{
  const e = new E(1, { slots: slots([7, 0, 3, 5, 1], [4, 2, 4, 8, 2]), friendlyFire: true, size: "large", winScore: 7 });
  check(e.extended && e.nPlayers === 5 && e.teams && e.nTeams === 3 && e.teamIds.join() === "2,4,8", "slots: teams");
  check([1, 2, 3, 4, 5].map(p => e.team(p)).join() === "1,0,1,2,0", "slots: team index per player");
  check([1, 2, 3, 4, 5].map(p => e.teamNumber(p)).join() === "4,2,4,8,2", "slots: team numbers");
  check(e.isEnemy(1, 2) && !e.isEnemy(1, 3) && !e.isEnemy(2, 5) && e.isEnemy(4, 5) && !e.isEnemy(3, 3), "isEnemy");
  check([1, 2, 3, 4, 5].map(p => e.colorName(p)).join() === "TEAL,BLUE,YELLOW,PINK,GREEN", "color names from the slots");
  check([1, 2, 3, 4, 5].map(p => e.playerColor(p)).join() === [7, 0, 3, 5, 1].map(c => E.PLAYER_COLORS[c]).join(), "playerColor from the slots");
  check(e.playerTextColor(1) === E.PLAYER_TEXT_COLORS[7], "playerTextColor from the slots");
  check(e.teamName(2) === "TEAM 8" && e.teamMembers(0).join() === "2,5" && e.teamWins.length === 3, "teamName / teamMembers / teamWins");
  check(e.friendlyFire && e.winScore === 7 && e.size === "large" && e.worldW === 2048 && e.worldH === 1024 && e.world.length === 1024 * 1024, "friendlyFire / winScore / size");
  const s = new E(1, { players: 3, size: "small" });
  check(s.worldW === 512 && s.worldH === 256 && s.world.length === 256 * 256 && !s.friendlyFire && !s.teams && s.nTeams === 3, "small world, free-for-all defaults");
  check(new E(1, { size: "huge" }).size === "medium" && new E(1, { winScore: 0 }).winScore === 1 && new E(1, { winScore: 42 }).winScore === 9
    && new E(1, { winScore: "x" }).winScore === 3, "option clamping");
  const t = new E(1, { players: 8, teams: true });
  check(t.teams && t.nTeams === 2 && [1, 2, 3, 4, 5, 6, 7, 8].map(p => t.team(p)).join() === "0,1,0,1,0,1,0,1", "{players, teams} shorthand = slot i in team i % 2 + 1");
  check(new E(1, { players: 2, teams: true }).nTeams === 2, "{players: 2, teams} = two one-tank teams");
  // section 18 hooks: new teams between matches, display names
  const u = new E(1, { players: 4 });
  check(!u.teams && u.nTeams === 4, "4 players free-for-all");
  u.setTeams([3, 3, 1, 1]);
  check(u.teams && u.nTeams === 2 && u.team(1) === 1 && u.team(3) === 0 && u.teamWins.length === 2 && u.teamName(0) === "TEAM 1", "setTeams");
  u.setNames(["Alice", null, "", "Bob"]);
  check(u.playerName(1) === "Alice" && u.playerName(2) === "GREEN" && u.playerName(3) === "CYAN" && u.playerName(4) === "Bob", "setNames / playerName");
  const c = new E(1);
  c.setTeams([1, 1]);
  check(c.nTeams === 2 && !c.teams, "setTeams leaves the classic engine alone");
  const st = e.state();
  check(st.worldW === 2048 && st.nTeams === 3 && st.winScore === 7 && st.friendlyFire && st.players[0].color === 7 && st.players[0].teamNo === 4 && st.players[0].team === 1, "state() carries the options");
  ok("options: slots, teams, size, winScore, friendlyFire, setTeams / setNames");
}

// ------------------------------------------------------------------ 3. world sizes
function genWorld(seed, opts, keyEvery) {
  const e = new E(seed, opts);
  for (let i = 0; i < 4000 && e.worldStage !== -1; i++) e.step(keyEvery && i % keyEvery === 0 ? { keys: [[32, 0x39]] } : {});
  return e;
}
{
  const frac = { small: [], medium: [], large: [] };
  for (const size of ["small", "medium", "large"])
    for (let s = 1; s <= (quick ? 4 : 12); s++) {
      const e = genWorld(s * 104729, { size }), e2 = genWorld(s * 104729, { size, players: 3 }, 3);
      check(e.worldStage === -1, size + ": world not generated");
      check(!Buffer.compare(e.world, e2.world) && e.randSeed === e2.randSeed, size + ": world generation not deterministic / not resumable (seed " + s + ")");
      const W = e.worldW, H = e.worldH;
      let rock = 0, dirt = 0, free = 0, edge = true;
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const c = e.getPixel(x, y);
          if (c === 7) rock++; else if (c === 6 || c === 8) dirt++; else if (c === 0) free++;
          if ((x < 2 || y < 2 || x >= W - 2 || y >= H - 2) && c !== 7) edge = false;
        }
      check(edge, size + ": world not closed by rock (seed " + s + ")");
      check(rock + dirt + free === W * H && free * 10000 < W * H, size + ": world has other pixels than dirt and rock (and a few free ones as the original)");
      frac[size].push(rock / (W * H));
    }
  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  const m = avg(frac.medium);
  for (const size of ["small", "large"]) check(Math.abs(avg(frac[size]) - m) < 0.08, size + ": rock share " + avg(frac[size]).toFixed(3) + " far from medium " + m.toFixed(3));
  ok("world sizes: rock share small " + avg(frac.small).toFixed(3) + ", medium " + m.toFixed(3) + ", large " + avg(frac.large).toFixed(3));
}

// ------------------------------------------------------------------ 4. base placement
{
  let relaxed = 0, n = 0;
  const seeds = quick ? 40 : 200;
  for (const size of ["small", "medium", "large"])
    for (let N = 2; N <= 8; N++)
      for (let s = 1; s <= seeds; s++) {
        const e = new E(s * 7919, { players: N, extended: true, size });
        const sc = v => Math.trunc(v * e.worldW / 1024);
        e.initTables();
        e.newMatchExt();
        n++;
        if (e.baseMinDist < sc(100)) relaxed++;
        check(e.baseMinDist >= 40, size + ": bases may overlap");
        for (let i = 1; i <= N; i++) {
          if (e.baseX[i] < sc(160) || e.baseX[i] > sc(160) + sc(704) - 1 || e.baseY[i] < sc(160) || e.baseY[i] > sc(160) + sc(192) - 1)
            fail(size + ": base outside the area N=" + N + " seed " + s);
          for (let j = 1; j < i; j++)
            if (!(e.distance(Math.abs(e.baseX[i] - e.baseX[j]), Math.abs(e.baseY[i] - e.baseY[j])) > e.baseMinDist))
              fail(size + ": bases " + i + "," + j + " too close N=" + N + " seed " + s);
        }
      }
  // classic: scaled area and distance too
  for (const size of ["small", "large"]) for (let s = 1; s <= seeds; s++) {
    const e = new E(s * 31, { size }), sc = v => Math.trunc(v * e.worldW / 1024);
    e.initTables(); e.newMatch();
    check(e.distance(Math.abs(e.baseX[1] - e.baseX[2]), Math.abs(e.baseY[1] - e.baseY[2])) > sc(100)
      && [1, 2].every(i => e.baseX[i] >= sc(160) && e.baseX[i] < sc(864) && e.baseY[i] >= sc(160) && e.baseY[i] < sc(352)), "classic " + size + ": bases");
  }
  ok("base placement: " + n + " matches over 3 sizes, distance relaxed in " + relaxed);
}

// ------------------------------------------------------------------ 5. matches
const FRAME_CAP = quick ? 80000 : 160000;
function match(seed, opts, label) {
  const a = startEngine(seed, opts), b = startEngine(seed, opts);
  const N = a.nPlayers, drv = new Driver(seed, N), ws = a.winScore;
  const res = { rounds: 0, frames: 0, playFrames: 0, ms: 0, worst: 0, deaths: 0, nobody: 0, friendly: 0 };
  let lastAlive = null, wins = a.wins.slice(), teamWins = a.teamWins.slice(), round = a.round;
  let sawTitle = false, sawMap = false, sawStats = false;
  let prevAliveCount = N;
  // who hurt whom: shield drops of a player in a frame without a hit by one of its enemies
  const moveShots = a.moveShotsExt.bind(a);
  a.moveShotsExt = () => {
    const sh = a.shield.slice(), hits = a.shotsHit.slice();
    moveShots();
    for (let q = 1; q <= N; q++) if (a.shield[q] < sh[q]) {
      let enemy = false;
      for (let p = 1; p <= N; p++) if (a.shotsHit[p] !== hits[p] && a.isEnemy(p, q)) enemy = true;
      if (!enemy) res.friendly++;
    }
  };
  for (let f = 0; f < FRAME_CAP; f++) {
    const bits = drv.bits(a);
    if (a.screen === "play" && f % 97 === 0) bits[f % N] |= 32;   // Esc must be ignored
    const keys = [];
    if (a.screen === "map" && f % 20 === 0) { keys.push([13, 0x1C]); }
    const t0 = process.hrtime.bigint();
    a.step({ bits, keys });
    const dt = Number(process.hrtime.bigint() - t0) / 1e6;
    b.step({ bits, keys });
    res.frames++;
    if (a.screen === "play") { res.playFrames++; res.ms += dt; if (dt > res.worst) res.worst = dt; }
    // identical engines
    if (a.randSeed !== b.randSeed || JSON.stringify(a.state()) !== JSON.stringify(b.state()) || Buffer.compare(a.world, b.world)
      || Buffer.compare(a.vram, b.vram) || a.views.some((v, i) => Buffer.compare(v, b.views[i]))
      || JSON.stringify(a.soundEvents) !== JSON.stringify(b.soundEvents)) {
      fail(label + ": engines diverged at frame " + f); return res;
    }
    if (!soundCheck(a, label)) return res;
    // snapshots
    for (const s of a.snapshots) {
      if (s.palette !== "extended") { fail(label + ": snapshot without palette"); return res; }
      if (s.screen === "play" && !(s.views && s.views.length === N && s.vram === s.views[0] && s.views.every(v => v.length === 16000))) {
        fail(label + ": play snapshot without views"); return res;
      }
    }
    const st = a.state();
    if (st.players.length !== N) { fail(label + ": state().players length"); return res; }
    if (a.screen === "play") {
      const alive = st.players.map(p => p.alive);
      const cnt = alive.filter(Boolean).length;
      if (cnt < prevAliveCount) res.deaths += prevAliveCount - cnt;
      prevAliveCount = cnt;
      lastAlive = alive;
      // the border of every view is in its player's (slot's) color
      if (f % 50 === 0) for (let p = 1; p <= N; p++) {
        const v = a.views[p - 1];
        if ((v[1] & 0x0F) !== a.playerColor(p)) { fail(label + ": view " + p + " border color"); return res; }
      }
    }
    if (a.round !== round) {
      // a round ended: it goes to the only team left; every member's wins go up with the team's
      res.rounds++;
      const left = []; lastAlive.forEach((al, i) => { if (al) left.push(i + 1); });
      const ts = new Set(left.map(p => a.team(p)));
      const t = ts.size === 1 ? [...ts][0] : -1;
      check(ts.size <= 1, label + ": round ended with " + ts.size + " teams alive");
      const dw = a.wins.map((w, i) => w - wins[i]), dt2 = a.teamWins.map((w, i) => w - teamWins[i]);
      for (let k = 0; k < a.nTeams; k++) check(dt2[k] === (k === t ? 1 : 0), label + ": team wins of " + k);
      for (let p = 1; p <= N; p++) check(dw[p] === (a.team(p) === t ? 1 : 0), label + ": wins of " + p);
      check(a.roundWinnerTeam === t, label + ": roundWinnerTeam");
      const mem = t >= 0 ? a.teamMembers(t) : [];
      check(a.roundWinner === (mem.length === 1 ? mem[0] : 0), label + ": roundWinner");
      for (let p = 1; p <= N; p++) check(a.wins[p] === a.teamWins[a.team(p)], label + ": wins of " + p + " differ from its team's");
      if (t < 0) res.nobody++;
      wins = a.wins.slice(); teamWins = a.teamWins.slice(); round = a.round; prevAliveCount = N;
    }
    if (a.screen === "text" && a.round >= 1 && a.kbdInstalled && !sawTitle) {
      const txt = screenText(a.vram);
      const names = [];
      for (let p = 1; p <= N; p++) names.push(a.playerName(p));
      if (a.teams) for (let t = 0; t < a.nTeams; t++) names.push(a.teamName(t));
      sawTitle = names.every(n => txt.includes(n)) && txt.includes(a.strings.round);
      if (!sawTitle) { fail(label + ": round title misses names\n" + txt); return res; }
    }
    if (a.screen === "map") sawMap = true;
    if (sawMap && a.screen === "text" && !a.kbdInstalled && a.menuShift === -20) {
      const txt = screenText(a.vram);
      for (let p = 1; p <= N; p++) if (!txt.includes(a.playerName(p).slice(0, 9))) { fail(label + ": statistics miss " + a.colorName(p) + "\n" + txt); return res; }
      check(txt.includes(a.strings.stats.winner.trim()), label + ": statistics without winner line\n" + txt);
      sawStats = true;
      res.text = txt;
      break;
    }
  }
  check(sawTitle, label + ": no round title");
  check(sawMap, label + ": match did not end (" + res.frames + " frames, wins " + a.teamWins + ")");
  check(sawStats, label + ": no statistics screen");
  check(Math.max(...a.teamWins) === ws && a.teamWins.filter(w => w >= ws).length === 1, label + ": match ended without " + ws + " wins: " + a.teamWins);
  if (!a.friendlyFire) check(res.friendly === 0, label + ": " + res.friendly + " teammate hit(s) with friendly fire off");
  res.wins = a.teamWins.join(":");
  res.hits = a.shotsHit.reduce((x, y) => x + y, 0);
  return res;
}

// classic engine (keyDown input) with size / winScore
function classicMatch(seed, opts, label) {
  const a = startEngine(seed, opts), b = startEngine(seed, opts), drv = new Driver(seed, 2);
  const res = { rounds: 0, frames: 0 };
  let sawMap = false, round = a.round;
  for (let f = 0; f < FRAME_CAP; f++) {
    const kd = keyDown(drv.bits(a)), keys = a.screen === "map" && f % 20 === 0 ? [[13, 0x1C]] : [];
    a.step({ keyDown: kd, keys }); b.step({ keyDown: kd, keys });
    res.frames++;
    if (a.extended || a.snapshots.some(s => s.palette || s.views)) { fail(label + ": not classic"); return res; }
    if (a.randSeed !== b.randSeed || JSON.stringify(a.state()) !== JSON.stringify(b.state()) || Buffer.compare(a.world, b.world)
      || Buffer.compare(a.vram, b.vram) || JSON.stringify(a.soundEvents) !== JSON.stringify(b.soundEvents)) { fail(label + ": engines diverged at frame " + f); return res; }
    if (!soundCheck(a, label)) return res;
    if (a.round !== round) { res.rounds++; round = a.round; }
    if (a.screen === "map") sawMap = true;
    if (sawMap && a.screen === "text" && a.menuShift === -20) break;
  }
  check(sawMap, label + ": match did not end");
  check(Math.max(a.wins[1], a.wins[2]) === a.winScore, label + ": match ended at " + a.wins.slice(1) + ", not " + a.winScore);
  res.wins = a.wins.slice(1).join(":");
  return res;
}

const CASES = [
  [{ players: 3 }, 1003, "ffa 3"],
  [{ players: 8 }, 1008, "ffa 8"],
  [{ players: 2, teams: true }, 2002, "teams 1v1"],
  [{ players: 8, teams: true }, 2008, "teams 4v4"],
  [{ slots: slots([7, 0, 3, 5, 1, 2, 4, 6], [1, 2, 3, 1, 2, 3, 1, 2]) }, 2108, "3 teams 3/3/2"],
  [{ slots: slots([0, 1, 2, 3], [1, 1, 1, 2]) }, 2204, "uneven 3v1"],
  [{ slots: slots([0, 2, 7, 4], [5, 5, 2, 8]) }, 2304, "teams 2/1/1"],
  [{ slots: slots([0, 1, 2, 3, 4, 5, 6, 7], [1, 1, 2, 2, 3, 3, 4, 4]) }, 2408, "4 teams of 2"],
  [{ slots: slots([0, 3], [1, 2]) }, 2502, "BLUE v YELLOW"],
  [{ players: 4, winScore: 1 }, 3004, "ffa 4 win 1"],
  [{ slots: slots([0, 1, 2, 3], [1, 2, 1, 2]), winScore: 4 }, 3104, "2v2 win 4"],
  [{ players: 4, size: "small" }, 4004, "ffa 4 small"],
  [{ slots: slots([0, 1, 2], [1, 2, 2]), size: "large" }, 4103, "1v2 large"],
  [{ players: 6, teams: true, friendlyFire: true }, 5006, "3v3 friendly fire"],
  [{ players: 2, extended: true }, 3002, "ffa 2 extended"],
];
if (!quick) {
  for (let N = 3; N <= 8; N++) CASES.push([{ players: N }, 6000 + N, "ffa " + N], [{ players: N, teams: true }, 7000 + N, "teams " + N]);
  for (const size of ["small", "large"]) CASES.push([{ players: 5, size, winScore: 2 }, 8005, "ffa 5 " + size], [{ players: 8, teams: true, size }, 8008, "4v4 " + size]);
  CASES.push([{ slots: slots([0, 1, 2, 3, 4, 5, 6, 7], [1, 2, 3, 4, 5, 6, 7, 7]) }, 9008, "7 teams"], [{ players: 8, teams: true, winScore: 9 }, 9108, "4v4 win 9"]);
}
let worstAvg = 0, worst = 0;
for (const [opts, seed, name] of CASES) {
  const label = name + " seed " + seed;
  const r = match(seed, opts, label);
  const avg = r.ms / Math.max(1, r.playFrames);
  worstAvg = Math.max(worstAvg, avg); worst = Math.max(worst, r.worst);
  ok(label.padEnd(30) + " rounds " + String(r.rounds).padStart(2) + ", team wins " + r.wins + ", hits " + r.hits + ", deaths " + r.deaths
    + ", no-winner rounds " + r.nobody + (opts.friendlyFire ? ", teammate hits " + r.friendly : "") + ", " + r.frames + " frames, " + avg.toFixed(3) + " ms/frame (worst " + r.worst.toFixed(1) + ")");
}
check(worstAvg < 5, "extended step too slow: " + worstAvg.toFixed(2) + " ms per frame on average");
for (const [opts, seed, name] of [[{ winScore: 1 }, 101, "win 1"], [{ size: "small" }, 102, "small"], [{ size: "large", winScore: 2 }, 103, "large, win 2"]]
  .concat(quick ? [] : [[{ size: "small", winScore: 5 }, 104, "small, win 5"], [{ size: "large" }, 105, "large"]])) {
  const r = classicMatch(seed, opts, "classic " + name);
  ok(("classic " + name + " seed " + seed).padEnd(30) + " rounds " + String(r.rounds).padStart(2) + ", wins " + r.wins + ", " + r.frames + " frames");
}

// ------------------------------------------------------------------ 6. friendly fire
// BLUE and GREEN (team 1) and CYAN (team 2); BLUE fires at GREEN, then at CYAN.
function duel(ff, target) {
  const e = startEngine(11, { slots: slots([0, 1, 2], [1, 1, 2]), friendlyFire: ff });
  for (let i = 0; i < 600 && e.screen !== "play"; i++) e.step({ bits: [] });
  // a free corridor away from the bases
  let y = 200;
  const farFromBases = (x, yy) => [1, 2, 3].every(p => Math.abs(e.baseX[p] - x) > 40 || Math.abs(e.baseY[p] - yy) > 40);
  while (!(farFromBases(300, y) && farFromBases(340, y) && farFromBases(330, y + 40))) y += 7;
  for (let x = 290; x <= 370; x++) for (let yy = y - 5; yy <= y + 45; yy++) e.setPixel(x, yy, 0);
  const other = target === 2 ? 3 : 2;
  e.tankX[1] = 300; e.tankY[1] = y; e.tankDir[1] = 2;
  e.tankX[target] = 340; e.tankY[target] = y; e.tankDir[target] = 6;
  e.tankX[other] = 330; e.tankY[other] = y + 40;
  const shield = e.shield[target], sounds = [];
  for (let i = 0; i < 12; i++) {
    e.step({ bits: [i < 2 ? FIRE : 0, 0, 0] });
    sounds.push(...e.soundEvents);
  }
  const at = s => Math.abs(s.x - 340) <= 5 && Math.abs(s.y - y) <= 2;   // sound 0 (wall): 70 90 110 130 Hz; sound 2 (shield hit): 1000 Hz
  return { hurt: e.shield[target] < shield, hits: e.shotsHit[1], wall: sounds.some(s => [70, 90, 110, 130].some(f => Math.abs(s.hz - f) < 1) && at(s)),
    hitSound: sounds.some(s => Math.abs(s.hz - 1000) < 5 && at(s)),
    shot: sounds.some(s => s.hz > 4000 && s.x === 300 && s.y === y) };
}
{
  const off = duel(false, 2), on = duel(true, 2), offEnemy = duel(false, 3), onEnemy = duel(true, 3);
  check(off.shot && on.shot, "friendly fire: the shot sound comes from BLUE");
  check(!off.hurt && off.hits === 0 && off.wall && !off.hitSound, "friendly fire off: a teammate must not be hurt (shot hits it like a wall) " + JSON.stringify(off));
  check(on.hurt && on.hits === 1 && on.hitSound, "friendly fire on: a teammate is hit " + JSON.stringify(on));
  check(offEnemy.hurt && offEnemy.hits === 1 && onEnemy.hurt && onEnemy.hits === 1, "an enemy is always hit");
  ok("friendly fire: off = the shot explodes on a teammate like on a wall, on = it hits");
}

// ------------------------------------------------------------------ 7. world map banner
{
  const boxCols = e => { const r = []; for (let x = 0; x < 80; x++) if (e.vram[85 * 160 + x * 2 + 1] === 0x11) r.push(x); return [r[0], r[r.length - 1]]; };
  const mapOf = (banner, opts) => {
    const e = new E(5, opts);
    if (banner) e.strings = Object.assign({}, e.strings, { banner });
    e.initTables(); e.newMatch();
    e.showWorldMap().next();
    return e;
  };
  const e0 = mapOf(null);
  check(boxCols(e0).join() === "22,57", "original banner box at cells 22..57: " + boxCols(e0));
  const B = ["***", "* *", "***", "*  ", "*  "].map(r => r + " ".repeat(27));   // 30 wide
  const e1 = mapOf(B);
  const [l, r] = boxCols(e1);
  check(l === 28 && r === 51, "banner box sized to a 30-pixel banner: " + l + ".." + r);
  check(e1.getLores(65, 87) === 14 && e1.getLores(66, 88) === 1 && e1.getLores(65, 91) === 14, "custom banner pixels");
  check(boxCols(mapOf(["**", "*", "**", "**", "**"])).join() === "22,57", "a bad banner falls back to the original");
  // 6 rows: a row of diacritics on lores row 86, the capitals on the original rows 87..91
  const e6 = mapOf([" * " + " ".repeat(27), ...B]);
  check(e6.getLores(66, 86) === 14 && e6.getLores(65, 86) === 1 && e6.getLores(65, 87) === 14 && e6.getLores(65, 91) === 14
    && boxCols(e6).join() === "28,51", "6-row banner: diacritics row above the capitals");
  check(boxCols(mapOf(new Array(7).fill("**"))).join() === "22,57", "a 7-row banner falls back to the original");
  const wide = mapOf(new Array(5).fill("* ".repeat(70)));
  check(boxCols(wide)[0] >= 1 && boxCols(wide)[1] <= 78, "a wide banner stays inside the frame");
  // the map of other world sizes: bases inside the map box
  for (const size of ["small", "large"]) {
    const e = new E(5, { size, players: 8 });
    e.initTables(); e.initTablesExt(); e.newMatchExt(); e.showWorldMap().next();
    for (let p = 1; p <= 8; p++) {
      const x = Math.trunc((e.unsc(e.baseX[p]) + 3) / 7) + 7, y = Math.trunc((e.unsc(e.baseY[p]) + 3) / 7) + 5;
      const r = Math.max(1, Math.trunc(2.5 * e.scD / e.scN));   // the marker covers the whole base
      check(x > 9 && x < 150 && y > 6 && y < 76 && e.getLores(x - r, y) === e.playerColor(p), size + ": base " + p + " not on the world map");
    }
  }
  ok("world map: banner from strings.banner (5 or 6 rows), box sized and centered; scaled map");
}

// ------------------------------------------------------------------ 8. instructions follow winScore
{
  const rowsOf = e => {
    e.window(1, 1, 80, 24); e.clearScreen();
    const rows = [], write = e.write.bind(e), rule = e.drawBottomRule.bind(e);
    let last = 0;
    e.write = (...a) => { const y = e.cy; write(...a); if (e.cy > y + 1 || (e.cy === y + 1 && e.cx !== e.wx1)) rows.push(y); };
    e.drawBottomRule = () => { last = e.cy; rule(); };
    e.showInstructions();
    e.write = write; e.drawBottomRule = rule;
    return { wraps: rows, last, text: screenText(e.vram) };
  };
  for (const c of Lang.codes) {
    Lang.set(c);
    for (let ws = 1; ws <= 9; ws++)
      for (const [opts, mode] of [[{ winScore: ws }, "hotseat"], [{ winScore: ws }, "cpu"], [{ players: 4, winScore: ws }, "online"]]) {
        const e = new E(1, opts);
        Lang.apply(e); e.initTables(); e.uiMode = mode;
        const r = rowsOf(e);
        if (r.wraps.length || r.last > 23) fail(c + ": instructions (winScore " + ws + ", " + mode + ") wrap / too long");
        if (r.text.includes("{n}")) fail(c + ": instructions show {n}");
        const words = e.strings.instr.winRounds;
        const intro = (e.extended ? e.strings.instr.introExt : e.strings.instr.intro).join(" ");
        if (intro.includes("{n}") && !r.text.replace(/[ \n]+/g, " ").includes(words[ws - 1])) fail(c + ": instructions miss \"" + words[ws - 1] + "\"");
      }
  }
  Lang.set("en");
  const e = new E(1, { winScore: 1 });
  check(e.winScoreText(e.strings.instr.intro)[1].startsWith("win one round."), "English: \"win one round\"");
  e.strings = JSON.parse(JSON.stringify(e.strings));
  e.strings.instr.winRounds[0] = "a really, really long number of r\xA0unds";   // (0xA0 = an encoded letter, not a space)
  const w = e.winScoreText(e.strings.instr.intro);
  check(w.every(l => l.length <= 80) && w.join(" ").replace(/ +/g, " ") === e.strings.instr.intro.join(" ").replace("{n}", e.strings.instr.winRounds[0]).replace(/ +/g, " "), "re-wrapped intro: " + JSON.stringify(w));
  ok("instructions: \"{n}\" follows winScore in every language");
}

// ------------------------------------------------------------------ 9. layout in every language
const LAYOUTS = [
  [{ players: 8 }, "ffa 8"], [{ players: 3 }, "ffa 3"], [{ players: 8, teams: true }, "4v4"],
  [{ slots: slots([7, 0, 3, 5, 1, 2, 4, 6], [1, 2, 3, 1, 2, 3, 1, 2]) }, "3 teams"],
  [{ slots: slots([0, 1, 2, 3, 4, 5, 6, 7], [1, 1, 2, 2, 3, 3, 4, 4]) }, "4 teams"],
  [{ slots: slots([0, 1, 2, 3, 4, 5, 6, 7], [1, 2, 3, 4, 5, 6, 7, 7]) }, "7 teams"],
  [{ slots: slots([0, 1, 2, 3, 4, 5, 6, 7], [2, 2, 2, 2, 2, 2, 2, 5]) }, "7v1"],
  [{ slots: slots([0, 1, 2, 3, 4, 5], [1, 1, 2, 2, 3, 4]) }, "2/2/1/1"],
];
for (const c of Lang.codes) {
  Lang.set(c);
  for (const [opts, name] of LAYOUTS)
    for (const names of [false, true]) {
      const e = new E(1, opts);
      Lang.apply(e);
      e.initTables(); e.initTablesExt();
      if (names) e.setNames(["Alexandra 12", "Bob", "x".repeat(12), null, "Wolfgang Max", "", "Zoe", "Twelve chars"]);
      const S = e.strings, N = e.nPlayers, what = c + " " + name + (names ? " (names)" : "");
      check(S.colors && S.colors.length === 8 && S.team && S.team.includes("{n}") && S.stats.head.length === 5, c + ": extended strings missing");
      S.colors.forEach(n => check(n.length <= 9, c + ": color name longer than 9: " + n));
      S.stats.head.forEach((h, i) => check(h.length <= [4, 4, 4, 5, 5][i], c + ": stats heading too long: " + h));
      check(S.team.replace("{n}", "8").length <= 18, c + ": team label too long: " + S.team);
      const write = e.write.bind(e), goto = e.gotoXY.bind(e), rows = [];
      let badGoto = 0;
      e.write = (...a) => { const y = e.cy; write(...a); if (e.cy > y + 1 || (e.cy === y + 1 && e.cx !== e.wx1)) rows.push(y); };
      e.gotoXY = (x, y) => { if (x < 1 || y < 1 || e.wx1 + x - 1 > e.wx2 || e.wy1 + y - 1 > e.wy2) badGoto++; goto(x, y); };
      // statistics: no line may wrap in the 37-column panel
      for (let p = 1; p <= N; p++) { e.shotsFired[p] = 9999; e.shotsHit[p] = 999; e.metersDug[p] = 32767; e.metersMoved[p] = 32767; }
      e.teamWins = e.teamWins.map((w, t) => t === e.nTeams - 1 ? e.winScore : 1);
      for (let p = 1; p <= N; p++) e.wins[p] = e.teamWins[e.team(p)];
      e.menuShift = -20;
      e.textBackground(0);
      e.showMainMenu();
      const stats = screenText(e.vram);
      if (rows.length || badGoto) fail(what + ": statistics wrap at row(s) " + rows.join(",") + "\n" + stats);
      for (let p = 1; p <= N; p++) check(stats.includes(e.playerName(p).slice(0, 9)), what + ": statistics miss player " + p);
      const winner = e.teamMembers(e.nTeams - 1).length === 1 ? e.playerName(e.teamMembers(e.nTeams - 1)[0]) : e.teamName(e.nTeams - 1);
      check(stats.includes(S.stats.winner + winner + "."), what + ": statistics winner line\n" + stats);
      // round title: everything inside the screen, no wrapping, every player and team
      rows.length = 0; badGoto = 0;
      e.window(1, 1, 80, 25); e.clearScreen(); e.round = 3;
      e.roundTitleExt();
      const txt = screenText(e.vram);
      if (rows.length || badGoto) fail(what + ": round title wraps / leaves the screen\n" + txt);
      for (let p = 1; p <= N; p++) check(txt.includes(e.playerName(p)), what + ": round title misses " + e.playerName(p) + "\n" + txt);
      if (e.teams) for (let t = 0; t < e.nTeams; t++) check(txt.includes(e.teamName(t)), what + ": round title misses " + e.teamName(t) + "\n" + txt);
      e.write = write; e.gotoXY = goto;
    }
}
Lang.set("en");
ok("extended texts lay out in every language (" + LAYOUTS.length + " team setups, with and without names)");

// ------------------------------------------------------------------ 10. Esc
// The extended engine ignores Esc (bit 32), except with {escEnds: true} (local games): then player 1's
// Esc ends the match like in the original (world map, then the statistics); other players' Esc never.
{
  const run = (opts, who) => {
    const e = startEngine(77, opts);
    for (let i = 0; i < 400 && e.screen !== "play"; i++) e.step({ bits: [] });
    const bits = new Array(e.nPlayers).fill(0); bits[who] = 32;
    for (let i = 0; i < 60; i++) e.step({ bits });
    return e;
  };
  check(run({ players: 4 }, 0).screen === "play", "Esc ended an extended match without escEnds");
  check(run({ players: 4, escEnds: true }, 1).screen === "play", "escEnds: another player's Esc ended the match");
  const e = run({ players: 4, escEnds: true }, 0);
  check(e.screen === "map" && e.wins.every(w => w === 0), "escEnds: player 1's Esc did not end the match (" + e.screen + ")");
  check(!new E(1, { escEnds: true }).escEnds, "escEnds must not touch the classic engine");
  ok("Esc: ignored online, escEnds ends the match locally");
}

// display only (docs/DESIGN-8P.md 25): the you marker ("►" / "◄", CP437 0x10 / 0x11) next to the local
// player's own tank only, the game's settings on the round title (rows 3..) and above the statistics;
// none of it without the options (the classic screens stay the original's)
{
  const title = e => { e.window(1, 1, 80, 25); e.textMode(); e.showRoundTitle().next(); return screenText(e.vram).split("\n"); };
  const stats = e => { e.menuShift = -20; e.textMode(); e.showMainMenu(); return screenText(e.vram).split("\n"); };
  const marks = rows => rows.join("").replace(/[^\x10\x11]/g, "").length;
  // classic, defaults: no marker, no settings
  {
    const e = new E(5); e.initTables(); e.round = 1;
    const t = title(e), st = stats(e);
    check(marks(t) === 0 && marks(st) === 0, "classic default: no you marker");
    check(!/rounds to win/.test(t.join("\n") + st.join("\n")), "classic default: no settings lines");
  }
  // classic, you = GREEN (online), settings listed
  {
    const e = new E(5); e.initTables(); e.round = 1;
    e.youPlayer = 2; e.showSettings = { view: "self", visible: true, watchOut: "others" };
    const t = title(e);
    check(/\x10 GREEN \x11/.test(t[15]) && !/\x10 BLUE|BLUE \x11/.test(t[15]), "classic round title: the marker around GREEN only: " + t[15]);
    const bottom = t.slice(18, 25).map(l => l.trim()).join(" ");
    check(bottom.includes("map size: medium, rounds to win: 3, view limit: self, after death: watch all") && !/friendly/.test(t.join("")),
      "classic round title settings at the bottom (no friendly fire without teams): " + bottom);
    const st = stats(e);
    check(/GREEN\x11/.test(st[8]) && !/\x10/.test(st[8]), "classic statistics: GREEN\u25c4 only: " + st[8]);
    const stBottom = st.slice(19, 24).map(l => l.slice(40).trim()).join(" ");
    check(stBottom.includes("rounds to win: 3") && !st.slice(0, 4).join("").slice(40).includes("rounds"),
      "classic statistics: settings at the bottom: " + stBottom);
    e.youPlayer = 1;
    check(/\x10BLUE/.test(stats(e)[8]), "classic statistics: \u25baBLUE");
  }
  // extended 2 v 2 (player 3 = you), friendly fire on, large, 5 to win
  {
    const e = new E(5, { slots: slots([0, 1, 2, 3], [1, 2, 1, 2]), friendlyFire: true, size: "large", winScore: 5 });
    e.initTables(); e.initTablesExt(); e.round = 2;
    e.youPlayer = 3; e.showSettings = { view: "team", visible: false, watchOut: "black" };
    const t = title(e), cyanRow = t.findIndex(r => r.includes("CYAN"));
    check(marks(t) === 2 && /\x10 CYAN \x11/.test(t[cyanRow]), "extended round title: marker around CYAN only");
    const bottom = t.slice(18, 25).map(l => l.trim()).join(" ");
    check(bottom.includes("map size: large, rounds to win: 5, friendly fire: on, view: team, after death: black screen"), "extended settings at the bottom: " + bottom);
    const st = stats(e), r = st.findIndex(l => /CYAN/.test(l) && /\d/.test(l));
    check(marks(st) === 1 && /CYAN\x11/.test(st[r]), "extended statistics: CYAN\u25c4 only");
    check(st.slice(19, 24).map(l => l.slice(40).trim()).join(" ").includes("friendly fire: on"), "extended statistics settings at the bottom");
    // free-for-all list, 6 players, you = 6
    const f = new E(5, { players: 6 }); f.initTables(); f.initTablesExt(); f.round = 1; f.youPlayer = 6;
    const ft = title(f);
    check(marks(ft) === 2 && ft.some(l => /\x10 PINK +0 \x11/.test(l)), "free-for-all round title: PINK's row marked: " + JSON.stringify(ft.filter(l => /PINK/.test(l))));
    f.showSettings = { view: "self", visible: false, watchOut: "wreck" };
    check(!/friendly fire/.test(title(f).join("")), "free-for-all: no friendly fire line");
  }
  ok("you marker on the local player's tank only; settings on the round title / statistics (display only)");
}

console.log(bad ? bad + " problem(s)" : "extended mode ok (worst average " + worstAvg.toFixed(3) + " ms/frame, worst frame " + worst.toFixed(1) + " ms)");
process.exit(bad ? 1 : 0);
