// The screenshots of 6.0's new screens (README and homepage), in both looks: quickplay.png, challenge.png,
// map-editor.png (graphics "original") and modern-quickplay.png, modern-challenge.png, modern-map-editor.png
// (graphics "modern"), 1000x820 like readme-screenshots.js. Against a fresh local server without accounts:
//   REPLAY_DIR=$(mktemp -d) ACCOUNTS=off PORT=8117 node server.js &
//   node tools/v6-screenshots.js 8117 screenshots
// It first fills today's daily-challenge leaderboard with bot-played results (real replays, checked by the server;
// the server takes 6 a minute from one address, so this takes about two minutes). Needs playwright-core and a
// Chromium (see readme-screenshots.js; CHROME = its executable).
const zlib = require("zlib");
const { chromium } = require("playwright-core");
const { TunnelerEngine: E, TunnelerAI } = require("../test/src.js");
const { Challenge } = require("../src/js/challenge.js");
const { Replay } = require("../src/js/replay.js");
const CHROME = process.env.CHROME || (() => {
  const dir = require("path").join(require("os").homedir(), ".cache/ms-playwright");
  const d = require("fs").readdirSync(dir).filter(n => n.startsWith("chromium-")).sort().pop();
  return dir + "/" + d + "/chrome-linux64/chrome";
})();
const PORT = process.argv[2], OUT = process.argv[3], B = "http://localhost:" + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ------------------------------------------------------------ today's leaderboard: bot-played challenge matches
// (BLUE is a computer player too, at the level given; its seed makes every match different)
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
const PLAYERS = [["Zuzka", "hard", 1], ["Норко", "hard", 2], ["Petr", "hard", 3], ["Kiko", "normal", 4], ["Zoë", "hard", 5],
  ["Mária", "normal", 6], ["王小明", "easy", 7], ["Jana", "easy", 8], ["Oleh", "normal", 9]];
const cidOf = seed => "client-shots-" + seed;
const ME = PLAYERS[1];                                          // (the screenshots' own entry: its row in yellow)
async function fillBoard() {
  const now = await (await fetch(B + "/api/challenge")).json();
  if (now.total >= PLAYERS.length) return;
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

// ------------------------------------------------------------ a map drawn by hand (small: 128 x 64 cells, all of it at 1:1)
function drawMap() {
  const ed = tunnelerMapEditor(), api = tunnelerMapsApi, m = ed.map, W = m.w, H = m.h, F = 5;
  const set = (x, y, v) => { x = Math.round(x); y = Math.round(y); if (x >= F && y >= F && x < W - F && y < H - F) m.cells[y * W + x] = v; };
  const disc = (cx, cy, r, v, ry = r) => { if (!r) return set(cx, cy, v); for (let y = -ry; y <= ry; y++) for (let x = -r; x <= r; x++) if ((x * x) / (r * r) + (y * y) / (ry * ry) <= 1) set(cx + x, cy + y, v); };
  const line = (x0, y0, x1, y1, r, v) => { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); for (let i = 0; i <= n; i++) disc(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, r, v); };
  let s = 7;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  // rock: a ring in the middle with four gaps, ridges, scattered boulders
  disc(64, 32, 15, 2, 12); disc(64, 32, 11, 1, 8);
  for (const [x, y] of [[64, 20], [64, 44], [49, 32], [79, 32]]) disc(x, y, 3, 1);
  line(30, 26, 40, 38, 2, 2); line(98, 26, 88, 38, 2, 2);
  line(40, 8, 52, 16, 1, 2); line(88, 8, 76, 16, 1, 2); line(40, 56, 52, 48, 1, 2); line(88, 56, 76, 48, 1, 2);
  for (let i = 0; i < 26; i++) { const x = 8 + rnd() * 112, y = 8 + rnd() * 48; if (Math.abs(x - 64) > 20 || Math.abs(y - 32) > 16) disc(x, y, 1 + Math.floor(rnd() * 2), 2); }
  // tunnels: from every base towards the middle, a passage round the ring
  line(16, 14, 46, 24, 1, 0); line(112, 14, 82, 24, 1, 0); line(16, 50, 46, 40, 1, 0); line(112, 50, 82, 40, 1, 0);
  line(64, 12, 64, 19, 1, 0); line(64, 52, 64, 45, 1, 0);
  line(46, 24, 46, 40, 0, 0); line(82, 24, 82, 40, 0, 0); line(46, 32, 49, 32, 0, 0); line(79, 32, 82, 32, 0, 0);
  disc(64, 32, 4, 0, 3);
  ed.changed = true;
  // the bases: the base tool, as a player places them
  api.setTool("base");
  for (const [x, y] of [[16, 14], [112, 14], [16, 50], [112, 50], [64, 12], [64, 52]]) api.stamp(x, y);
  api.setTool("tunnel"); api.setBrush(1);
  ed.cx = 58; ed.cy = 32; api.render();
}

(async () => {
  await fillBoard();
  const b = await chromium.launch({ args: ["--disable-gpu", "--use-angle=swiftshader", "--use-gl=angle", "--disable-gpu-compositing"], executablePath: CHROME });
  const errs = [];
  const page = async (look, ls, url) => {
    const ctx = await b.newContext({ viewport: { width: 1000, height: 820 } });
    await ctx.addInitScript(o => { for (const k in o) localStorage.setItem(k, o[k]); }, Object.assign({ "tunneler.gfx": look }, ls));
    const p = await ctx.newPage(); p.on("pageerror", e => errs.push(url + ": " + e.message));
    await p.goto(B + url); return p;
  };
  const shot = (p, look, f) => p.screenshot({ path: OUT + "/" + (look === "modern" ? "modern-" : "") + f });
  const until = async (p, fn, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await p.evaluate(fn).catch(() => false)) return true; await sleep(200); } return false; };
  const pick = (p, key) => p.evaluate(k => { const u = tunnelerMapsUI(); u.sel = u.spec.items.findIndex(i => i.key === k); u.draw(); }, key);
  try {
    // quick play: Norko (the original look) finds a game, Zuzka (modern) joins it - two computer tanks stay
    const o = await page("original", { "tunneler.name": "Norko" }, "/games?quick=1");
    await until(o, () => /^\/game\//.test(location.pathname) && window.tunnelerLobbyUI && tunnelerLobbyUI());
    const id = await o.evaluate(() => location.pathname.split("/")[2]);
    const m = await page("modern", { "tunneler.name": "Zuzka" }, "/game/" + id);
    await until(m, () => window.tunnelerLobbyUI && tunnelerLobbyUI());
    await sleep(2500);
    await shot(o, "original", "quickplay.png"); await shot(m, "modern", "quickplay.png");
    await o.close(); await m.close();
    for (const look of ["original", "modern"]) {
      // the daily challenge's leaderboard, as one of its players
      let p = await page(look, { "tunneler.name": ME[0], "tunneler.client": cidOf(ME[2]) }, "/challenge");
      await until(p, () => window.tunnelerChallenge && tunnelerChallenge().board);
      await p.evaluate(() => tunnelerChallenge().showBoard());
      await sleep(1200); await shot(p, look, "challenge.png"); await p.close();
      // the map editor: a new small map, drawn
      p = await page(look, {}, "/maps");
      await until(p, () => window.tunnelerMapsUI && tunnelerMapsUI() && tunnelerMapsUI().spec);
      await pick(p, "new"); await p.keyboard.press("Enter"); await sleep(300);
      await p.keyboard.type("Crossroads"); await sleep(100);
      await pick(p, "size"); await p.keyboard.press("ArrowLeft"); await sleep(100);   // (small)
      await pick(p, "create"); await p.keyboard.press("Enter");
      await until(p, () => window.tunnelerMapEditor && tunnelerMapEditor());
      await p.evaluate(drawMap);
      await sleep(1500); await shot(p, look, "map-editor.png"); await p.close();
    }
  } finally { console.log("errors", JSON.stringify(errs)); await b.close(); }
})();
