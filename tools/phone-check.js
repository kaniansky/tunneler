// A phone check in a real browser (not part of npm test / CI - it needs a Chromium): a phone held upright and
// sideways, in both graphics settings, checking what the vm tests can't see -
//   a skirmish:
//   - the touch controls appear on the first touch, the game canvas stays on the screen and off the joystick /
//     FIRE / ESC, the page doesn't scroll,
//   - the joystick drives the tank,
//   - the end-of-match world map and the menu after it: the touch controls hidden, the canvas on the screen,
//     a tap (upright: beside the map) goes on,
//   an online game (a desktop host + the phone as GREEN):
//   - the room lobby without the touch controls, "I am ready!", the match: the same checks as above,
//   - the end (both pages destroy GREEN's tank at the same step - no desync): the world map without the touch
//     controls, a tap -> the statistics / the lobby,
//   - no page errors.
//   npm run check:phone                       (builds public/ first; screenshots in <tmp>/tunneler-phone-check)
//   node tools/phone-check.js [out dir]       (public/ as it is)
// Needs playwright-core (not a dependency: npm i --no-save playwright-core) and a Chromium - set CHROME to its
// executable (default: playwright's download in ~/.cache/ms-playwright). The GPU is off (software WebGL), so the
// pixel ratio is 2 (PHONE_DPR=3 like most phones: Quality auto then takes a few seconds to step down).
"use strict";
const fs = require("fs"), os = require("os"), path = require("path");
let chromium;
try { ({ chromium } = require("playwright-core")); } catch (e) {
  console.error("phone-check needs playwright-core: npm i --no-save playwright-core"); process.exit(2);
}
const CHROME = process.env.CHROME || (() => {
  const dir = path.join(os.homedir(), ".cache/ms-playwright");
  const d = fs.existsSync(dir) && fs.readdirSync(dir).filter(n => /^chromium-\d/.test(n)).sort().pop();
  return d ? path.join(dir, d, "chrome-linux64/chrome") : "";
})();
if (!CHROME || !fs.existsSync(CHROME)) { console.error("phone-check: no Chromium found - set CHROME to its executable"); process.exit(2); }
if (!fs.existsSync(path.join(__dirname, "..", "public", "index.html"))) { console.error("phone-check: no public/ - run npm run build"); process.exit(2); }
const { createServer } = require("../server.js");
const VERSION = require("../package.json").version;

const OUT = process.argv[2] || path.join(os.tmpdir(), "tunneler-phone-check");
const PHONES = [["upright", 390, 844], ["sideways", 844, 390]];
const GFX = ["original", "modern"];
const DPR = +process.env.PHONE_DPR || 2;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
const ok = (cond, msg) => { if (cond) console.log("  ok  " + msg); else { failures++; console.log("  FAIL: " + msg); } };

// (polled from here: the route scope takes the page's own timers along when the route changes)
async function until(p, fn, ms = 30000, arg) {
  const t = Date.now();
  while (Date.now() - t < ms) { if (await p.evaluate(fn, arg).catch(() => false)) return true; await sleep(150); }
  return false;
}
// the canvas, the touch controls, the page's size
const layout = p => p.evaluate(() => {
  const r = el => { if (!el) return null; const b = el.getBoundingClientRect(); return b.width && b.height ? { x: b.left, y: b.top, w: b.width, h: b.height } : null; };
  const root = document.querySelector(".tpad-stick") && document.querySelector(".tpad-stick").parentElement;
  return {
    canvas: r(document.getElementById("screen")), stick: r(document.querySelector(".tpad-stick")),
    fire: r(document.querySelector(".tpad-fire")), esc: r(document.querySelector(".tpad-esc")),
    shown: !!root && !root.hidden && getComputedStyle(root).display !== "none",
    vw: innerWidth, vh: innerHeight,
    sw: document.scrollingElement.scrollWidth, sh: document.scrollingElement.scrollHeight
  };
});
const overlap = (a, b) => !!a && !!b && a.x + a.w > b.x + 1 && b.x + b.w > a.x + 1 && a.y + a.h > b.y + 1 && b.y + b.h > a.y + 1;
const inside = (a, L) => !!a && a.x >= -1 && a.y >= -1 && a.x + a.w <= L.vw + 1 && a.y + a.h <= L.vh + 1;
const fits = L => inside(L.canvas, L) && L.sw <= L.vw && L.sh <= L.vh;
const fmt = a => a ? Math.round(a.w) + "x" + Math.round(a.h) + " at " + Math.round(a.x) + "," + Math.round(a.y) : "none";

// the play screen: touch controls, the canvas, the joystick moving tank `tank` (engine player number)
async function playChecks(ctx, p, file, tank) {
  await sleep(800);
  const L = await layout(p);
  await p.screenshot({ path: file("play") });
  ok(L.shown && L.stick && L.fire, "touch controls shown (joystick " + fmt(L.stick) + ", FIRE " + fmt(L.fire) + ")");
  ok(inside(L.canvas, L), "the canvas on the screen (" + fmt(L.canvas) + " in " + L.vw + "x" + L.vh + ")");
  ok(!overlap(L.canvas, L.stick) && !overlap(L.canvas, L.fire) && !overlap(L.canvas, L.esc), "the canvas off the joystick, FIRE and ESC");
  ok(L.sw <= L.vw && L.sh <= L.vh, "no page scroll (" + L.sw + "x" + L.sh + ")");
  if (!L.stick) return;
  // a held drag up (touch events through the DevTools protocol)
  const cdp = await ctx.newCDPSession(p), cx = L.stick.x + L.stick.w / 2, cy = L.stick.y + L.stick.h / 2;
  const pos = () => p.evaluate(t => { const e = tunnelerEngine(); return [e.tankX[t], e.tankY[t]]; }, tank);
  const before = await pos();
  const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
  await touch("touchStart", cx, cy);
  for (let k = 1; k <= 5; k++) { await touch("touchMove", cx, cy - k * L.stick.h / 10); await sleep(20); }
  await sleep(900);
  await touch("touchEnd");
  await sleep(300);
  const after = await pos();
  ok(after[1] < before[1], "the joystick drives the tank (y " + before[1] + " -> " + after[1] + ")");
}
// the end-of-match world map: no touch controls, the canvas on the screen
async function mapChecks(p, file) {
  await sleep(600);
  const L = await layout(p);
  await p.screenshot({ path: file("map") });
  ok(!L.shown, "the world map: touch controls hidden");
  ok(fits(L), "the world map: the canvas on the screen (" + fmt(L.canvas) + "), no page scroll");
}
// a DosUI item chosen like a key press would (the narrow layout's taps are layout-check's business)
const choose = async (p, key) => {
  const found = await p.evaluate(k => { const u = tunnelerLobbyUI(), i = u.spec.items.findIndex(it => it.key === k); if (i < 0) return false; u.sel = i; u.draw(); return true; }, key);
  if (found) await p.keyboard.press("Enter");
  return found;
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = createServer({ quiet: true });
  const port = await new Promise(r => srv.listen(0, r)), B = "http://127.0.0.1:" + port;
  const b = await chromium.launch({ executablePath: CHROME, args: ["--disable-gpu", "--use-angle=swiftshader", "--use-gl=angle", "--disable-gpu-compositing"] });
  const phone = async (w, h, ls) => {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: DPR, isMobile: true, hasTouch: true });
    await ctx.addInitScript(o => { for (const k in o) localStorage.setItem(k, o[k]); }, Object.assign({ "tunneler.sound": "muted" }, ls));
    const p = await ctx.newPage(), errs = [];
    p.on("pageerror", e => errs.push(e.message));
    return { ctx, p, errs };
  };
  try {
    for (const [hold, w, h] of PHONES) for (const gfx of GFX) {
      const file = n => path.join(OUT, hold + "-" + gfx + "-" + n + ".png");
      console.log("skirmish, " + hold + ", " + gfx + ":");
      const { ctx, p, errs } = await phone(w, h, { "tunneler.gfx": gfx });
      // you (BLUE) against an easy computer tank, the small map, one round
      await p.goto(B + "/skirmish?slots=0:you:1,1:easy:2&size=small&win=1");
      await p.touchscreen.tap(w >> 1, h >> 1);
      ok(await until(p, () => tunnelerEngine().screen === "play"), "the game starts");
      await playChecks(ctx, p, file, 1);
      // the end: your tank goes, the computer's wins the match -> the world map, then the menu
      await p.evaluate(() => { const e = tunnelerEngine(); e.killTankExt(1, e.tankX[1], e.tankY[1]); });
      ok(await until(p, () => tunnelerEngine().screen === "map", 20000), "the match ends on the world map");
      await mapChecks(p, file);
      await sleep(500);
      await p.touchscreen.tap(w >> 1, h >> 1);
      ok(await until(p, () => !!(window.tunnelerAfter && window.tunnelerAfter()), 10000), "a tap (in the middle of the screen - upright: beside the map): the menu after the match");
      await sleep(500);
      const L = await layout(p);
      await p.screenshot({ path: file("menu") });
      ok(!L.shown && fits(L), "the menu: touch controls hidden, the canvas on the screen (" + fmt(L.canvas) + ")");
      ok(!errs.length, "no page errors" + (errs.length ? ": " + errs.join("; ") : ""));
      await ctx.close();
    }

    for (const [hold, w, h] of PHONES) for (const gfx of GFX) {
      const file = n => path.join(OUT, "online-" + hold + "-" + gfx + "-" + n + ".png");
      console.log("online, " + hold + ", " + gfx + ":");
      // a private game: BLUE (the host, on a desktop) against GREEN (the phone), the small map, one round
      const seats = [{ kind: "open", team: 1 }, { kind: "open", team: 2 }];
      while (seats.length < 8) seats.push({ kind: "closed", team: seats.length + 1 });
      const room = await (await fetch(B + "/api/rooms", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: VERSION, name: "Phone check", public: false, spectators: true, size: "small", winScore: 1, seats }) })).json();
      const hctx = await b.newContext({ viewport: { width: 1000, height: 820 } });
      await hctx.addInitScript(o => { for (const k in o) localStorage.setItem(k, o[k]); },
        { ["tunneler.host." + room.id]: room.hostKey, "tunneler.name": "Host", "tunneler.gfx": "original", "tunneler.sound": "muted" });
      const host = await hctx.newPage(), herrs = [];
      host.on("pageerror", e => herrs.push(e.message));
      await host.goto(B + "/game/" + room.id + "/blue");
      const { ctx, p, errs } = await phone(w, h, { "tunneler.gfx": gfx, "tunneler.name": "Phone" });
      await p.goto(B + "/game/" + room.id + "/green");
      ok(await until(p, () => { const u = tunnelerLobbyUI(); return u.active() && u.spec.items.some(it => it.key === "ready"); }), "the phone in the room lobby");
      let L = await layout(p);
      await p.screenshot({ path: file("lobby") });
      ok(!L.shown && fits(L), "the lobby: no touch controls, the canvas on the screen (" + fmt(L.canvas) + ")");
      ok(await choose(p, "ready"), "I am ready!");
      ok(await until(host, () => { const u = tunnelerLobbyUI(); const s = u.spec.items.find(it => it.key === "start"); return s && !JSON.stringify(s.info).includes("color\":14"); }, 10000)
        && await choose(host, "start"), "the host starts the match");
      ok(await until(p, () => tunnelerEngine() && tunnelerEngine().screen === "play", 40000), "the match runs on the phone");
      await playChecks(ctx, p, file, 2);
      // the end: both pages destroy GREEN's tank at the same step (the same state everywhere - no desync)
      const at = Math.max(...await Promise.all([p, host].map(q => q.evaluate(() => tunnelerEngine().tick)))) + 40;
      for (const q of [p, host]) await q.evaluate(at => {
        const e = tunnelerEngine(), step = e.step.bind(e);
        e.step = inp => { if (e.tick === at && e.alive[2]) e.killTankExt(2, e.tankX[2], e.tankY[2]); return step(inp); };
      }, at);
      ok(await until(p, () => tunnelerEngine() && tunnelerEngine().screen === "map", 30000), "the match ends on the world map");
      await mapChecks(p, file);
      const desync = await Promise.all([p, host].map(q => q.evaluate(() => tunnelerFrames().desync)));
      ok(desync.every(d => d < 0), "no desync (" + desync + ")");
      await sleep(500);
      await p.touchscreen.tap(w >> 1, h >> 1);
      ok(await until(p, () => { const u = tunnelerLobbyUI(); return u.active(); }, 15000), "a tap: the statistics / the lobby again");
      await sleep(500);
      L = await layout(p);
      await p.screenshot({ path: file("after") });
      ok(!L.shown && fits(L), "after the match: no touch controls, the canvas on the screen (" + fmt(L.canvas) + ")");
      ok(!errs.length && !herrs.length, "no page errors" + (errs.length + herrs.length ? ": " + errs.concat(herrs).join("; ") : ""));
      await ctx.close(); await hctx.close();
    }
  } finally {
    await b.close();
    await new Promise(r => srv.close(r));
  }
  console.log("screenshots: " + OUT);
  console.log(failures ? "phone-check: " + failures + " FAILED" : "phone-check: all passed");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
