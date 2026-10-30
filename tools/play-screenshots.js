// The Google Play screenshots (docs/play-store/screenshots/): the same 8 screens on a phone held upright
// (360 x 720 at 3x = 1080 x 2160) and on 7" / 10" tablets held sideways (960 x 600 / 1280 x 800 at 2x =
// 1920 x 1200 / 2560 x 1600), graphics modern, touch:
//   1 the main menu, 2 the skirmish's settings, 3 a battle (your own view, the touch controls), 4 four tanks
//   (everyone's views), 5 an online game's lobby (quick play, chat), 6 the daily challenge's leaderboard, 7 the
//   map editor, 8 a replay (a leaderboard entry's, everyone's views).
//   npm run build && node tools/play-screenshots.js [out dir] [phone,tablet7,tablet10]
// Runs its own server (accounts off). It first fills today's leaderboard with bot-played results (real replays,
// checked by the server: 6 a minute from one address, so about two minutes). Needs playwright-core (not a
// dependency: npm i --no-save playwright-core) and a Chromium - CHROME = its executable (default: playwright's
// download in ~/.cache/ms-playwright). The GPU is off (software WebGL).
"use strict";
const fs = require("fs"), os = require("os"), path = require("path"), zlib = require("zlib");
const { chromium } = require("playwright-core");
const { TunnelerEngine: E, TunnelerAI } = require("../test/src.js");
const { Challenge } = require("../src/js/game/challenge.js");
const { Replay } = require("../src/js/game/replay.js");
const { createServer } = require("../server.js");
const CHROME = process.env.CHROME || (() => {
  const dir = path.join(os.homedir(), ".cache/ms-playwright");
  const d = fs.readdirSync(dir).filter(n => /^chromium-\d/.test(n)).sort().pop();
  return path.join(dir, d, "chrome-linux64/chrome");
})();
const OUT = process.argv[2] || path.join(__dirname, "..", "docs/play-store/screenshots");
const DEVICES = { phone: [360, 720, 3], tablet7: [960, 600, 2], tablet10: [1280, 800, 2] };
const WANT = (process.argv[3] || "phone,tablet7,tablet10").split(",");
const sleep = ms => new Promise(r => setTimeout(r, ms));
let B;

// ------------------------------------------------------------ today's leaderboard: bot-played challenge matches
const day = Challenge.dayOf(Date.now());
function record(level, seed) {
  const cfg = Challenge.config(day), opts = Challenge.engineOptions(cfg);
  const e = new E(cfg.seed, JSON.parse(JSON.stringify(opts)));
  const ais = cfg.slots.map((s, i) => new TunnelerAI(s.level || level, i + 1, i ? 0 : seed));
  let rep = null;
  const rec = Replay.recorder(e, { kind: "skirmish", seed: cfg.seed, opts, challenge: day }, r => { rep = r; });
  for (let n = 0; n < 200000 && !rep; n++) {
    const inp = { bits: ais.map(ai => TunnelerAI.bitsFor(ai, e)), keys: [] };
    rec.input(inp); e.step(inp); rec.stepped();
  }
  return rep;
}
const PLAYERS = [["Zuzka", "hard", 1], ["Norko", "hard", 2], ["Petr", "hard", 3], ["Kiko", "normal", 4], ["Zoë", "hard", 5],
  ["Mária", "normal", 6], ["Oleh", "normal", 9], ["Jana", "easy", 8]];
const cidOf = seed => "client-shots-" + seed;
const ME = PLAYERS[1];                                          // (the screenshots' own entry: its row in yellow)
async function fillBoard() {
  for (const [name, level, seed] of PLAYERS) {
    const body = zlib.gzipSync(Buffer.from(JSON.stringify(record(level, seed))));
    for (;;) {
      const res = await fetch(B + "/api/challenge/" + day + "?cid=" + cidOf(seed) + "&name=" + encodeURIComponent(name),
        { method: "POST", body, headers: { "Content-Type": "application/octet-stream" } });
      if (res.status !== 429) { console.log("board:", name, res.status); break; }
      await sleep(10000);                                       // (6 a minute: wait)
    }
  }
}

// ------------------------------------------------------------ a map drawn by hand (as tools/v6-screenshots.js)
function drawMap() {
  const ed = tunnelerMapEditor(), api = tunnelerMapsApi, m = ed.map, W = m.w, H = m.h, F = 5;
  const set = (x, y, v) => { x = Math.round(x); y = Math.round(y); if (x >= F && y >= F && x < W - F && y < H - F) m.cells[y * W + x] = v; };
  const disc = (cx, cy, r, v, ry = r) => { if (!r) return set(cx, cy, v); for (let y = -ry; y <= ry; y++) for (let x = -r; x <= r; x++) if ((x * x) / (r * r) + (y * y) / (ry * ry) <= 1) set(cx + x, cy + y, v); };
  const line = (x0, y0, x1, y1, r, v) => { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); for (let i = 0; i <= n; i++) disc(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, r, v); };
  let s = 7;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  disc(64, 32, 15, 2, 12); disc(64, 32, 11, 1, 8);
  for (const [x, y] of [[64, 20], [64, 44], [49, 32], [79, 32]]) disc(x, y, 3, 1);
  line(30, 26, 40, 38, 2, 2); line(98, 26, 88, 38, 2, 2);
  line(40, 8, 52, 16, 1, 2); line(88, 8, 76, 16, 1, 2); line(40, 56, 52, 48, 1, 2); line(88, 56, 76, 48, 1, 2);
  for (let i = 0; i < 26; i++) { const x = 8 + rnd() * 112, y = 8 + rnd() * 48; if (Math.abs(x - 64) > 20 || Math.abs(y - 32) > 16) disc(x, y, 1 + Math.floor(rnd() * 2), 2); }
  line(16, 14, 46, 24, 1, 0); line(112, 14, 82, 24, 1, 0); line(16, 50, 46, 40, 1, 0); line(112, 50, 82, 40, 1, 0);
  line(64, 12, 64, 19, 1, 0); line(64, 52, 64, 45, 1, 0);
  line(46, 24, 46, 40, 0, 0); line(82, 24, 82, 40, 0, 0); line(46, 32, 49, 32, 0, 0); line(79, 32, 82, 32, 0, 0);
  disc(64, 32, 4, 0, 3);
  ed.changed = true;
  api.setTool("base");
  for (const [x, y] of [[16, 14], [112, 14], [16, 50], [112, 50], [64, 12], [64, 52]]) api.stamp(x, y);
  api.setTool("tunnel"); api.setBrush(1);
  ed.cx = 58; ed.cy = 32; api.render();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  // (its own empty store: never the local server's data/ - an old board there holds replays an older engine recorded)
  const store = fs.mkdtempSync(path.join(os.tmpdir(), "tunneler-play-shots-"));
  const srv = createServer({ quiet: true, dataDir: store });
  B = "http://127.0.0.1:" + await new Promise(r => srv.listen(0, r));
  await fillBoard();
  const board = await (await fetch(B + "/api/challenge/" + day)).json();
  const replayId = (board.top || []).map(e => e.replay).find(Boolean);
  const b = await chromium.launch({ args: ["--disable-gpu", "--use-angle=swiftshader", "--use-gl=angle", "--disable-gpu-compositing"], executablePath: CHROME });
  const errs = [];
  const until = async (p, fn, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await p.evaluate(fn).catch(() => false)) return true; await sleep(200); } return false; };
  // keys held for ms of game time (the engine's steps of 54.9 ms; wall time off a play screen): software rendering
  // (3D) is slow, and the engine steps fewer times than the clock says
  const tick = p => p.evaluate(() => window.tunnelerEngine && tunnelerEngine() ? tunnelerEngine().tick : null).catch(() => null);
  const hold = async (p, keys, ms) => {
    const t0 = await tick(p);
    for (const k of keys) await p.keyboard.down(k);
    if (t0 == null) await sleep(ms);
    else for (const end = t0 + Math.round(ms / 54.925), t = Date.now(); Date.now() - t < 60000 && (await tick(p)) < end;) await sleep(30);
    for (const k of keys) await p.keyboard.up(k);
  };
  let chatted = false;
  const LS = { "tunneler.gfx": "modern", "tunneler.sound": "muted", "tunneler.name": ME[0], "tunneler.client": cidOf(ME[2]) };
  try {
    for (const dev of WANT) {
      const [w, h, dpr] = DEVICES[dev];
      const page = async (url, ls, touch = true) => {
        const ctx = await b.newContext(touch ? { viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true }
          : { viewport: { width: 1000, height: 820 } });
        await ctx.addInitScript(o => { for (const k in o) localStorage.setItem(k, o[k]); }, Object.assign({}, LS, ls));
        const p = await ctx.newPage(); p.on("pageerror", e => errs.push(dev + " " + url + ": " + e.message));
        await p.goto(B + url); return p;
      };
      const shot = (p, n) => { console.log(dev, n); return p.screenshot({ path: path.join(OUT, dev + "-" + n + ".png") }); };
      const tap = p => p.touchscreen.tap(w >> 1, h >> 1);
      const close = p => p.context().close();
      // 1 the main menu
      let p = await page("/");
      await sleep(2000); await shot(p, "1-menu"); await close(p);
      // 2 the skirmish's settings: you and a teammate against two computer tanks, gold rush
      const S = (kind, team) => ({ kind, team });
      p = await page("/#cpu", { "tunneler.cpu.slots": JSON.stringify([S("you", 1), S("hard", 2), S("normal", 1), S("hard", 2),
        S("none", 5), S("none", 6), S("none", 7), S("none", 8)]), "tunneler.cpu.view": "team", "tunneler.cpu.time": "3", "tunneler.levels": "2" });
      await sleep(2000); await shot(p, "2-skirmish"); await close(p);
      // 3 a battle: your own view, the touch controls
      p = await page("/skirmish?mode=cpu&slots=" + encodeURIComponent("0:you:1,1:hard:2") + "&size=small&view=self");
      await tap(p);
      await until(p, () => window.tunnelerEngine && tunnelerEngine().screen === "play");
      await hold(p, ["KeyS"], 4000); await hold(p, ["KeyD"], 1500); await hold(p, ["KeyS", "KeyD", "Space"], 800);
      await sleep(1500); await shot(p, "3-battle"); await close(p);
      // 4 four tanks: everyone's views
      p = await page("/skirmish?mode=cpu&slots=" + encodeURIComponent("0:you:1,1:hard:2,2:hard:3,3:hard:4") + "&size=small&view=everyone");
      await tap(p);
      await until(p, () => window.tunnelerEngine && tunnelerEngine().screen === "play");
      await hold(p, ["KeyW"], 2500); await hold(p, ["KeyW", "Space"], 800); await hold(p, ["KeyA"], 1500);
      await sleep(3000); await shot(p, "4-four-tanks"); await close(p);
      // 5 an online game's lobby: quick play, another player already there, a chat line
      const host = await page("/games?quick=1", { "tunneler.name": "Zuzka", "tunneler.client": "client-shots-host-" + dev }, false);
      await until(host, () => /^\/game\//.test(location.pathname) && window.tunnelerLobbyUI && tunnelerLobbyUI());
      const id = await host.evaluate(() => location.pathname.split("/")[2]);
      p = await page("/game/" + id);
      await until(p, () => window.tunnelerLobbyUI && tunnelerLobbyUI());
      if (!chatted) {                                             // (quick play: every device joins the same room)
        await host.evaluate(() => { const u = tunnelerLobbyUI(); u.sel = u.spec.items.findIndex(i => i.key === "say"); u.draw(); });
        await host.evaluate(m => { for (const ch of m) window.dispatchEvent(new KeyboardEvent("keydown", { key: ch, code: "KeyQ", bubbles: true })); }, "gl hf!");
        await host.keyboard.press("Enter"); chatted = true;
      }
      await sleep(2500); await shot(p, "5-online"); await close(p); await close(host);
      // 6 the daily challenge's leaderboard, as one of its players
      p = await page("/challenge");
      await until(p, () => window.tunnelerChallenge && tunnelerChallenge().board);
      await p.evaluate(() => tunnelerChallenge().showBoard());
      await sleep(1500); await shot(p, "6-challenge"); await close(p);
      // 7 the map editor: a new small map, drawn
      p = await page("/maps");
      const pick = key => p.evaluate(k => { const u = tunnelerMapsUI(); u.sel = u.spec.items.findIndex(i => i.key === k); u.draw(); }, key);
      await until(p, () => window.tunnelerMapsUI && tunnelerMapsUI() && tunnelerMapsUI().spec);
      await pick("new"); await p.keyboard.press("Enter"); await sleep(300);
      await p.keyboard.type("Crossroads"); await sleep(100);
      await pick("size"); await p.keyboard.press("ArrowLeft"); await sleep(100);
      await pick("create"); await p.keyboard.press("Enter");
      await until(p, () => window.tunnelerMapEditor && tunnelerMapEditor());
      await p.evaluate(drawMap);
      await sleep(2000); await shot(p, "7-map-editor"); await close(p);
      // 8 a replay: a leaderboard entry's match, everyone's views, a bit into it
      p = await page("/replay/" + replayId + "?challenge=" + day);
      await until(p, () => window.tunnelerReplay && tunnelerReplay().watching);
      await p.keyboard.press("Equal"); await p.keyboard.press("Equal");
      if (dev !== "phone") await p.keyboard.press("Digit1");    // (everyone's views; a phone follows one tank)
      await until(p, () => tunnelerReplay().steps > 700, 60000);
      await p.keyboard.press("Space");                            // (paused)
      await sleep(1500); await shot(p, "8-replay"); await close(p);
    }
  } finally { console.log("errors", JSON.stringify(errs)); await b.close(); srv.close(); process.exit(0); }
})();
