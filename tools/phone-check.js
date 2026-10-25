// A phone check in a real browser (not part of npm test / CI - it needs a Chromium): a skirmish on a phone held
// upright and sideways, in both graphics settings, checking what the vm tests can't see:
//   - the touch controls appear on the first touch, the game canvas stays on the screen and off the joystick /
//     FIRE / ESC, the page doesn't scroll,
//   - the joystick drives the tank,
//   - the end-of-match world map and the menu after it: the touch controls hidden, the canvas on the screen,
//   - no page errors.
//   npm run check:phone                       (builds public/ first; screenshots in <tmp>/tunneler-phone-check)
//   node tools/phone-check.js [out dir]       (public/ as it is)
// Needs playwright-core (not a dependency: npm i --no-save playwright-core) and a Chromium - set CHROME to its
// executable (default: playwright's download in ~/.cache/ms-playwright). The GPU is off (software WebGL), so the
// pixel ratio is 2 (PHONE_DPR=3 like most phones: the modern graphics then run at a few frames a second).
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

const OUT = process.argv[2] || path.join(os.tmpdir(), "tunneler-phone-check");
const PHONES = [["upright", 390, 844], ["sideways", 844, 390]];
const GFX = ["original", "modern"];
const DPR = +process.env.PHONE_DPR || 2;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
const ok = (cond, msg) => { if (cond) console.log("  ok  " + msg); else { failures++; console.log("  FAIL: " + msg); } };

// (polled from here: the route scope takes the page's own timers along when the route changes)
async function until(p, fn, ms = 30000) {
  const t = Date.now();
  while (Date.now() - t < ms) { if (await p.evaluate(fn).catch(() => false)) return true; await sleep(150); }
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
const fmt = a => a ? Math.round(a.w) + "x" + Math.round(a.h) + " at " + Math.round(a.x) + "," + Math.round(a.y) : "none";

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = createServer({ quiet: true });
  const port = await new Promise(r => srv.listen(0, r)), B = "http://127.0.0.1:" + port;
  const b = await chromium.launch({ executablePath: CHROME, args: ["--disable-gpu", "--use-angle=swiftshader", "--use-gl=angle", "--disable-gpu-compositing"] });
  try {
    for (const [hold, w, h] of PHONES) for (const gfx of GFX) {
      const where = hold + ", " + gfx, file = n => path.join(OUT, hold + "-" + gfx + "-" + n + ".png");
      console.log(where + ":");
      const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: DPR, isMobile: true, hasTouch: true });
      await ctx.addInitScript(g => { localStorage.setItem("tunneler.gfx", g); localStorage.setItem("tunneler.sound", "muted"); }, gfx);
      const p = await ctx.newPage(), errs = [];
      p.on("pageerror", e => errs.push(e.message));
      // you (BLUE) against an easy computer tank, the small map, one round
      await p.goto(B + "/skirmish?slots=0:you:1,1:easy:2&size=small&win=1");
      await p.touchscreen.tap(w >> 1, h >> 1);
      ok(await until(p, () => tunnelerEngine().screen === "play"), "the game starts");
      await sleep(800);
      let L = await layout(p);
      await p.screenshot({ path: file("play") });
      ok(L.shown && L.stick && L.fire, "touch controls shown (joystick " + fmt(L.stick) + ", FIRE " + fmt(L.fire) + ")");
      ok(inside(L.canvas, L), "the canvas on the screen (" + fmt(L.canvas) + " in " + L.vw + "x" + L.vh + ")");
      ok(!overlap(L.canvas, L.stick) && !overlap(L.canvas, L.fire) && !overlap(L.canvas, L.esc), "the canvas off the joystick, FIRE and ESC");
      ok(L.sw <= L.vw && L.sh <= L.vh, "no page scroll (" + L.sw + "x" + L.sh + ")");

      // the joystick: a held drag (touch events through the DevTools protocol)
      if (L.stick) {
        const cdp = await ctx.newCDPSession(p), cx = L.stick.x + L.stick.w / 2, cy = L.stick.y + L.stick.h / 2;
        const before = await p.evaluate(() => { const e = tunnelerEngine(); return [e.tankX[1], e.tankY[1]]; });
        const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
        await touch("touchStart", cx, cy);
        for (let k = 1; k <= 5; k++) { await touch("touchMove", cx, cy - k * L.stick.h / 10); await sleep(20); }
        await sleep(900);
        await touch("touchEnd");
        const after = await p.evaluate(() => { const e = tunnelerEngine(); return [e.tankX[1], e.tankY[1]]; });
        ok(after[1] < before[1], "the joystick drives the tank (y " + before[1] + " -> " + after[1] + ")");
      }

      // the end: your tank goes, the computer's wins the match -> the world map, then the menu
      await p.evaluate(() => { const e = tunnelerEngine(); e.killTankExt(1, e.tankX[1], e.tankY[1]); });
      ok(await until(p, () => tunnelerEngine().screen === "map", 20000), "the match ends on the world map");
      await sleep(600);
      L = await layout(p);
      await p.screenshot({ path: file("map") });
      ok(!L.shown, "the world map: touch controls hidden");
      ok(inside(L.canvas, L) && L.sw <= L.vw && L.sh <= L.vh, "the world map: the canvas on the screen (" + fmt(L.canvas) + "), no page scroll");
      await sleep(500);
      await p.touchscreen.tap(w >> 1, h >> 1);
      ok(await until(p, () => tunnelerEngine().menuShown, 10000), "a tap (in the middle of the screen - upright: beside the map): the menu after the match");
      await sleep(500);
      L = await layout(p);
      await p.screenshot({ path: file("menu") });
      ok(!L.shown && inside(L.canvas, L) && L.sw <= L.vw && L.sh <= L.vh, "the menu: touch controls hidden, the canvas on the screen (" + fmt(L.canvas) + ")");
      ok(!errs.length, "no page errors" + (errs.length ? ": " + errs.join("; ") : ""));
      await ctx.close();
    }
  } finally {
    await b.close();
    await new Promise(r => srv.close(r));
  }
  console.log("screenshots: " + OUT);
  console.log(failures ? "phone-check: " + failures + " FAILED" : "phone-check: all passed");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
