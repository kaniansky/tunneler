"use strict";
// the KeyboardEvent.key a browser reports for a code (NumLock on: keypad digits are digits)
const keyOf = code => /^(Arrow|Enter|Escape|Tab|Backspace)/.test(code) ? code.replace(/^NumpadEnter$/, "Enter")
  : code === "NumpadEnter" ? "Enter" : /^(Digit|Numpad)\d$/.test(code) ? code.slice(-1) : code === "Space" ? " "
  : /^Key[A-Z]$/.test(code) ? code.slice(3).toLowerCase() : "";
// Local games without a browser: the vs computer slot editor / split-screen settings (home.js) build the
// right play.html links and remember their settings, play.js turns those links into the right engine
// (classic for BLUE + GREEN, extended otherwise; size, rounds to win, friendly fire, computer levels),
// and distance-attenuated sound (speaker.js / runner.js listener, docs/DESIGN-8P.md 8).
//   node test/local-check.js
const assert = require("assert");
const fs = require("fs"), path = require("path"), vm = require("vm");
const SRC = path.join(__dirname, "..", "src");
// the pages' modules: bundled in memory (test/page-env.js); node's own instances (test/src.js)
const { runPage } = require("./page-env.js");
const NODE = require("./src.js");

let n = 0;
const ok = msg => { n++; console.log("  ok  " + msg); };
// (values made inside the page vm have other prototypes: compare as JSON)
const same = (a, b, msg) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), msg);
// a skirmish link with its short code (cpucode.js) as the long query it stands for
const CpuCode = NODE.CpuCode;
const longLink = href => decodeURIComponent(String(href).replace(/([?&])g=([^&]+)/, (m, s, c) => s + CpuCode.decode(c)));

function makeEnv(search, store) {
  const listeners = {};
  const mkEl = id => ({ id, width: 720, height: 400, style: {}, classList: { toggle() {} }, ls: {},
    addEventListener(t, f) { (this.ls[t] = this.ls[t] || []).push(f); },
    fire(t, ev) { for (const f of this.ls[t] || []) f(Object.assign({ preventDefault() {} }, ev)); },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 720, height: 400 }),
    getContext: () => ({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }) });
  const elements = {};
  const storage = store || new Map();
  const win = {
    document: { title: "", getElementById: id => elements[id] || (elements[id] = mkEl(id)), createElement: mkEl,
      // (a browser's: the Fullscreen API there - screen.js offers the Settings row only where it exists)
      documentElement: { requestFullscreen: () => Promise.resolve(), style: { setProperty() {}, removeProperty() {} }, classList: { toggle() {} } } },
    location: { search, pathname: "/", hash: "", href: "" },
    history: { replaceState() {} },
    localStorage: { getItem: k => storage.has(k) ? storage.get(k) : null, setItem: (k, v) => storage.set(k, String(v)) },
    // (capture-phase listeners first, as in a browser; stopImmediatePropagation ends the dispatch)
    addEventListener: (t, f, o) => { const c = o === true || !!(o && o.capture); (listeners[t] = listeners[t] || []).push(Object.assign(ev => f(ev), { capture: c, f })); },
    removeEventListener: (t, f, o) => { const c = o === true || !!(o && o.capture); listeners[t] = (listeners[t] || []).filter(g => !(g.f === f && g.capture === c)); },
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    performance, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, console, URLSearchParams, Math, atob, Uint8Array, TextEncoder, TextDecoder,
  };
  win.window = win; win.globalThis = win;
  const ctx = vm.createContext(win);
  const page = f => runPage(ctx, f);
  const key = (code, type = "keydown") => {
    let stop = false;
    const ev = { code, key: keyOf(code), target: {}, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() { stop = true; } };
    const all = listeners[type] || [];
    for (const f of all.filter(g => g.capture).concat(all.filter(g => !g.capture))) {
      if (!(listeners[type] || []).includes(f)) continue;     // (removed by an earlier listener)
      f(ev); if (stop) break;
    }
  };
  return { win, page, key, storage };
}

// ---------------------------------------------------------------- smooth scrolling (display only)
{
  // the same game with and without smoothScroll: identical simulation; the views differ only on frames
  // where the tank is on an odd x, then by exactly one pixel (screen byte = right pixel of one world byte +
  // left pixel of the next)
  const E = NODE.TunnelerEngine;
  const a = new E(5, { autoStart: true, smoothScroll: true }), b = new E(5, { autoStart: true });
  let odd = 0, even = 0;
  for (let i = 0; i < 2600; i++) {
    const kd = new Uint8Array(128);
    if (i > 200) { kd[E.KEYS.KeyFire[1]] = 1; kd[(i >> 6) & 1 ? E.KEYS.KeyLeft[1] : E.KEYS.KeyRight[1]] = 1; }
    a.step({ keyDown: kd.slice(), keys: [] }); b.step({ keyDown: kd.slice(), keys: [] });
    assert.strictEqual(a.randSeed, b.randSeed, "same RNG at " + i);
    if (a.screen !== "play") continue;
    assert(a.tankX[1] === b.tankX[1] && a.tankY[1] === b.tankY[1] && a.energy[1] === b.energy[1], "same tank at " + i);
    const o = 0x143;                           // BLUE's view in the classic split screen (row 0 of it; blitView's scrOfs)
    if (b.tankX[1] & 1) {
      for (let c = 0; c < 37; c++) {
        const p = b.vram[o + c * 2], q = b.vram[o + c * 2 + 2];
        assert.strictEqual(a.vram[o + c * 2], (p >> 4) | (q & 0x0F) << 4, "shifted byte " + c + " at " + i);
      }
      odd++;
    } else { for (let c = 0; c < 38; c++) assert.strictEqual(a.vram[o + c * 2], b.vram[o + c * 2]); even++; }
  }
  same(Array.from(a.world), Array.from(b.world));
  assert(odd > 50 && even > 50, "tested odd and even x (" + odd + " / " + even + ")");
  ok("smooth scrolling: the same game, views shifted one pixel on odd x only (" + odd + " / " + even + " frames)");
}

// ---------------------------------------------------------------- line of sight (display only)
{
  // the same game with sight full / circle / walls: identical simulation; with line of sight the views
  // show the world live only within the ellipse around the tank (walls: less), the rest remembered (dim
  // plane); the snapshots carry the dim plane(s) only then
  const E = NODE.TunnelerEngine;
  const NP = NODE.NetProto;
  const run = (opts, steps, input, check) => {
    const es = ["full", "circle", "walls"].map(sight => new E(9, Object.assign({ autoStart: true, sight }, opts)));
    const dimmed = [0, 0, 0];
    for (let i = 0; i < steps; i++) {
      const inp = input(i);
      es.forEach(e => e.step({ keyDown: inp.keyDown && inp.keyDown.slice(), bits: inp.bits && inp.bits.slice(), keys: [] }));
      assert(es.every(e => e.randSeed === es[0].randSeed), "same RNG at " + i);
      assert(es.every(e => NP.stateHash(e) === NP.stateHash(es[0])), "same state at " + i);
      if (es[0].screen !== "play") continue;
      es.forEach((e, k) => {
        const s = e.snapshots[e.snapshots.length - 1];
        if (!s) return;
        if (k === 0) assert(!s.dim && !s.dims, "no dim plane without line of sight");
        else assert(opts.slots ? s.dims && s.dims.length === e.nPlayers : s.dim, "a dim plane with line of sight");
        if (k) dimmed[k] += (s.dims ? s.dims[0] : s.dim).reduce((n, v) => n + (v ? 1 : 0), 0);
      });
      if (check) check(es, i);
    }
    same(Array.from(es[1].world), Array.from(es[0].world));
    same(Array.from(es[2].world), Array.from(es[0].world));
    return dimmed;
  };
  const sightCount = { n: 0 };
  // classic: BLUE drives around firing; the cells around BLUE's tank are live (same as full)
  const classic = run({}, 2600, i => {
    const kd = new Uint8Array(128);
    if (i > 200) { kd[E.KEYS.KeyFire[1]] = 1; kd[(i >> 6) & 1 ? E.KEYS.KeyLeft[1] : E.KEYS.KeyUp[1]] = 1; }
    return { keyDown: kd };
  }, es => {
    if (!es[0].alive[1]) return;
    // the view's middle row (row 38: the tank's own), the tank's own cells 18..20: as without line of sight
    const o = 0x143 + 38 * 160;
    for (const e of es.slice(1)) for (let c = 18; c <= 20; c++) assert.strictEqual(e.vram[o + c * 2], es[0].vram[o + c * 2], "live around the tank");
    // the view's corners are remembered (outside the ellipse)
    for (const e of es.slice(1)) assert.strictEqual(e.dim[0x143 >> 1] & 1, 1, "a corner remembered");
    sightCount.n++;
  });
  assert(sightCount.n > 100, "checked during play");
  assert(classic[2] > classic[1], "walls hide more than the circle (" + classic[1] + " / " + classic[2] + ")");
  // extended, 4 tanks driven by bits: every view gets its dim plane
  const ext = run({ slots: [0, 1, 2, 3].map(c => ({ color: c, team: c + 1 })) }, 1500,
    i => ({ bits: [0, 1, 2, 3].map(p => i > 200 ? 16 | [1, 2, 4, 8][((i >> 6) + p) & 3] : 0) }));
  assert(ext[2] > ext[1] && ext[1] > 0, "extended views dimmed (" + ext[1] + " / " + ext[2] + ")");
  // 8 tanks on the large map with walls: time per step
  {
    const e = new E(3, { autoStart: true, size: "large", sight: "walls", slots: [0, 1, 2, 3, 4, 5, 6, 7].map(c => ({ color: c, team: c + 1 })) });
    let t = 0, n = 0;
    for (let i = 0; i < 1200; i++) {
      const t0 = process.hrtime.bigint();
      e.step({ bits: Array.from({ length: 8 }, (_, p) => i > 200 ? 16 | [1, 2, 4, 8][((i >> 5) + p) & 3] : 0), keys: [] });
      if (e.screen === "play") { t += Number(process.hrtime.bigint() - t0) / 1e6; n++; }
    }
    assert(n > 100 && t / n < 25, "8 views with line of sight: " + (t / n).toFixed(2) + " ms a step");
    ok("line of sight: 8 tanks, large map, walls: " + (t / n).toFixed(2) + " ms a step");
  }
  // a new round (the same world): the memory stays, only remembered tanks / shots become the world's pixels
  {
    const e = new E(4, { autoStart: true, sight: "circle" });
    for (let i = 0; i < 400; i++) e.step({ keyDown: new Uint8Array(128), keys: [] });
    const m = e.sightMem[1];
    assert(m && m.some(v => v), "BLUE remembers something");
    const k = m.findIndex((v, i) => v === 0 && e.world[i] === 0 && i > 1000);
    m[k] = 0x9E;                                   // a ghost: BLUE's tank colors where the world is tunnel
    const before = m.slice(), g = c => [0, 6, 7, 8].includes(c);
    e.sightNewRound();
    assert.strictEqual(m[k], 0, "the ghost is gone");
    for (let i = 0; i < m.length; i++) {
      if (g(before[i] & 15) && g(before[i] >> 4)) assert.strictEqual(m[i], before[i], "tunnel, dirt and rock stay remembered");
      else if (!g(m[i] & 15) || !g(m[i] >> 4)) assert.strictEqual(m[i], e.world[i], "else only what the world holds (base walls)");
    }
    assert(m.filter(v => v).length > 100, "most of it stays");
    e.sightReset();
    assert(!m.some(v => v), "a new match: nothing seen");
  }
  // settings: checked, defaults, passed to the engine
  assert.strictEqual(NP.SETTINGS.sight("walls"), "walls");
  assert.strictEqual(NP.SETTINGS.sight("x-ray"), undefined);
  assert.strictEqual(NP.roomSettings({}).sight, "full");
  assert.strictEqual(NP.readCfg({ slots: [{ color: 0 }, { color: 1 }], sight: "circle" }).sight, "circle");
  assert.strictEqual(NP.engineOptions({ slots: [{ color: 0, team: 1 }, { color: 1, team: 2 }], sight: "circle" }).sight, "circle");
  assert.strictEqual(NP.engineOptions({ slots: [{ color: 0, team: 1 }, { color: 1, team: 2 }], sight: "full" }).sight, undefined);
  ok("line of sight: the same game, views live only around the tank (classic " + classic.join(" / ") + ", extended " + ext.join(" / ") + " dimmed cells)");
  // a tank in its doorway lies on the base's wall ring: its own pixels don't hide what is behind it (they did -
  // the view showed the remembered treads there, the computer players didn't see behind it)
  for (const opts of [{}, { slots: [{ color: 0, team: 1 }, { color: 4, team: 2 }] }]) {
    const e = new E(5, Object.assign({ autoStart: true, sight: "walls" }, opts));
    for (let n = 0; n < 3000 && e.screen !== "play"; n++) e.step({ keyDown: new Uint8Array(128), keys: [], bits: [0, 0] });
    const erase = () => opts.slots ? e.eraseTankExt(1) : e.drawTank(e.tankX[1], e.tankY[1], 3, e.tankDir[1]);
    const draw = () => opts.slots ? e.drawTankExt(1) : e.drawTank(e.tankX[1], e.tankY[1], 1, e.tankDir[1]);
    for (const dy of [1, 2, 3]) {                     // (driving out of the bottom doorway: 1 - 2 px past the ring hid 49 pixels)
      erase(); e.tankX[1] = e.baseX[1]; e.tankY[1] = e.baseY[1] + 17 + dy; e.tankDir[1] = 4; draw();
      const ring = [-3, -2, -1, 0, 1, 2, 3].map(x => e.tankX[1] + x).filter(x => e.tankPixel(x, e.baseY[1] + 17));
      assert(dy === 3 || (ring.length && ring.every(x => !e.sightBlocks(x, e.baseY[1] + 17))), "the tank's own pixels on the ring don't block");
      let hidden = 0;
      for (let y = -10; y <= -4; y++) for (let x = -3; x <= 3; x++) if (!e.sightSees(1, e.tankX[1] + x, e.tankY[1] + y)) hidden++;
      assert.strictEqual(hidden, 0, "it sees into its base behind it, " + dy + " px out" + (opts.slots ? " (extended)" : ""));
    }
  }
  ok("line of sight: a tank in its doorway sees past its own pixels (they lie on the wall ring)");
}

// ---------------------------------------------------------------- sound attenuation
{
  const Speaker = NODE.Speaker;
  const at = (d, l = { x: 500, y: 300 }) => Speaker.attenuation({ t: 0, hz: 440, x: 500 + d, y: 300 }, l);
  assert.strictEqual(at(0), 1); assert.strictEqual(at(Speaker.NEAR), 1);
  assert.strictEqual(at(Speaker.FAR), 0); assert.strictEqual(at(5000), 0);
  let prev = 2;
  for (let d = 0; d <= Speaker.FAR + 10; d += 5) { const v = at(d); assert(v <= prev && v >= 0 && v <= 1, "monotonic at " + d); prev = v; }
  assert(at(100) > 0.2 && at(100) < 0.8, "halfway fade");
  assert.strictEqual(Speaker.attenuation({ x: 9999, y: 9999 }, null), 1, "no listener: full volume");
  assert.strictEqual(Speaker.attenuation({ x: -1, y: -1 }, { x: 0, y: 0 }), 1, "no source: full volume");
  // diagonal distance counts (not only x)
  assert(Speaker.attenuation({ x: 600, y: 400 }, { x: 500, y: 300 }) < at(100));
  ok("Speaker.attenuation: full near, silent far, monotonic, null listener / no source = full");
}

// ---------------------------------------------------------------- play.js: link -> engine
function play(search) {
  const env = makeEnv(search);
  env.page("play.html");
  return env.win;
}
{
  const w = play("?mode=cpu&slots=0:you:1,1:normal:2&size=medium&win=3&ff=0&hide=1");
  const e = w.tunnelerEngine();
  // (a skirmish always runs the extended engine - owner, 2026-10-24; the classic one is split screen's)
  assert(e.extended && e.nPlayers === 2 && e.size === "medium" && e.winScore === 3, "BLUE vs a computer GREEN: the extended engine");
  // the classic engine with these options plays exactly like the plain classic engine
  const E = w.TunnelerEngine, a = new E(77, { slots: [{ color: 0, team: 1 }, { color: 1, team: 2 }], size: "medium", winScore: 3, escEnds: true }), b = new E(77);
  for (let i = 0; i < 400; i++) {
    const kd = new Uint8Array(128);
    if (i % 50 < 30) kd[E.KEYS.KeyUp[1]] = 1;
    const keys = i === 20 || i === 21 ? [[13, 0x1C]] : [];
    a.step({ keyDown: kd.slice(), keys: keys.slice() }); b.step({ keyDown: kd.slice(), keys: keys.slice() });
  }
  assert.strictEqual(a.randSeed, b.randSeed); same(Array.from(a.world), Array.from(b.world));
  ok("skirmish: always the extended engine; the classic engine with these options = new TunnelerEngine(seed)");

  // the listener is BLUE's tank during play, null elsewhere
  const r = { screen: "play", tankX: [0, 123, 9], tankY: [0, 45, 9] };
  const listener = w.tunnelerRunner ? w.tunnelerRunner().listener : null;
  if (listener) {
    assert.strictEqual(JSON.stringify(listener(r)), JSON.stringify({ x: 123, y: 45 }));
    assert.strictEqual(listener(Object.assign({}, r, { screen: "map" })), null);
    ok("vs computer: runner.listener = BLUE's tank during play, null on other screens");
  }
}
{
  // (a link without lv=2 has the old level names: normal / hard / expert, and the old weaker easy, become
  // easy / normal / hard; with lv=2 they are today's)
  const n = play("?mode=cpu&slots=" + encodeURIComponent("0:you:1,1:hard:2,2:easy:2,3:normal:2") + "&lv=2");
  same(n.tunnelerAIs().map(a => [a.me, a.levelName]), [[2, "hard"], [3, "easy"], [4, "normal"]]);
  const w = play("?mode=cpu&slots=" + encodeURIComponent("0:you:1,1:hard:2,2:easy:2,3:expert:2") + "&size=large&win=5&ff=1&hide=0");
  const e = w.tunnelerEngine();
  assert(e.extended && e.nPlayers === 4 && e.nTeams === 2 && e.size === "large" && e.winScore === 5 && e.friendlyFire);
  same(Array.from(e.slots, s => [s.color, s.team]), [[0, 1], [1, 2], [2, 2], [3, 2]]);
  same(w.tunnelerAIs().map(a => [a.me, a.levelName]), [[2, "normal"], [3, "easy"], [4, "hard"]]);
  ok("1 vs 3 teams: extended, large, 5 to win, friendly fire, computer levels per slot");
}
{
  // the short link (?g=<13 characters>, cpucode.js): the same game as the long one
  const E = NODE.TunnelerEngine;
  const s = { slots: [{ kind: "you", team: 1 }, { kind: "normal", team: 2 }, { kind: "none", team: 3 }, { kind: "hard", team: 2 },
    { kind: "none", team: 5 }, { kind: "none", team: 6 }, { kind: "easy", team: 1 }, { kind: "none", team: 8 }],
    size: "large", win: 5, time: 3, ff: true, view: "team", watch: "killer", sight: "walls", mode: "standard" };
  const code = CpuCode.encode(s);
  assert.strictEqual(code.length, 13, "13 characters");
  const w = play("?mode=cpu&g=" + code), e = w.tunnelerEngine();
  assert(e.extended && e.size === "large" && e.winScore === 5 && e.roundTime === 3 && e.friendlyFire && e.sight === "walls");
  same(Array.from(e.slots, x => [x.color, x.team]), [[0, 1], [1, 2], [3, 2], [6, 1]]);
  same(w.tunnelerAIs().map(a => [a.me, a.levelName]), [[2, "normal"], [3, "hard"], [4, "easy"]]);
  same([w.tunnelerViews().watchOut, e.showSettings.view], ["killer", "team"]);
  // every value of every field comes back
  const back = c => new URLSearchParams(CpuCode.decode(c));
  for (const [k, vs, q] of [["size", ["small", "medium", "large"], "size"], ["win", [1, 9], "win"], ["view", ["self", "team", "everyone"], "view"],
    ["watch", ["black", "wreck", "team", "killer", "others"], "watch"], ["time", [2, 10], "time"], ["sight", ["circle", "walls"], "sight"]])
    for (const v of vs) assert.strictEqual(back(CpuCode.encode(Object.assign({}, s, { [k]: v }))).get(q), String(v), k + " " + v);
  for (const m of E.MODE_LIST.filter(m => m !== "standard"))
    for (const g of (E.GOALS[m] || { choices: [undefined] }).choices) {
      const p = back(CpuCode.encode(Object.assign({}, s, { mode: m, goal: g })));
      assert(p.get("gm") === m && (g === undefined ? !p.has("goal") : p.get("goal") === String(g)), m + " goal " + g);
    }
  // a broken code: the defaults (BLUE against a computer GREEN)
  assert.strictEqual(CpuCode.decode("1xyz"), null);
  const bogus = play("?mode=cpu&g=bogus").tunnelerEngine();
  same(Array.from(bogus.slots, x => x.color), [0, 1], "a broken code: the default game");
  // player 2 (p2) round trips
  const s2 = Object.assign({}, s, { slots: s.slots.map((x, i) => i === 3 ? { kind: "p2", team: 2 } : x) });
  assert(back(CpuCode.encode(s2)).get("slots").includes("3:p2:2"), "player 2 in the short link");
  ok("short skirmish links: " + code + " = the long query, every value round trips, a broken one = the default game");
}
{
  // skipped slots keep their colors; friendly fire is dropped without teammates
  const w = play("?mode=cpu&slots=" + encodeURIComponent("0:you:1,3:normal:4,7:expert:8") + "&size=small&ff=1");
  const e = w.tunnelerEngine();
  assert(e.extended && e.nPlayers === 3 && e.size === "small" && !e.friendlyFire && e.winScore === 3);
  same(Array.from(e.slots, s => s.color), [0, 3, 7]);
  ok("BLUE + YELLOW + TEAL keep their colors; small map; no friendly fire without teams");
}
{
  const w = play("?mode=cpu&slots=" + encodeURIComponent("0:you:1,1:normal:2,2:normal:3,3:normal:4,4:normal:5,5:normal:6,6:normal:7,7:normal:8") + "&size=large");
  assert(w.tunnelerEngine().nPlayers === 8 && w.tunnelerEngine().nTeams === 8);
  // garbage: the first "you" wins (PINK here; you may sit in any color), a second "you", a bogus kind
  // and a repeated color are dropped; still a playable game (2+ teams)
  const g = play("?mode=cpu&slots=" + encodeURIComponent("5:you:1,0:you:3,1:bogus:2,2:hard:3,2:hard:4") + "&win=42&size=huge").tunnelerEngine();
  same(Array.from(g.slots, s => [s.color, s.team]), [[2, 3], [5, 1]]);
  assert(g.winScore === 3 && g.size === "medium");
  // old links (?opp=..&teams=..&level=..) still work
  const o = play("?mode=cpu&level=hard&opp=3&teams=1&hide=0");
  assert(o.tunnelerEngine().nPlayers === 4 && o.tunnelerEngine().nTeams === 2);
  same(o.tunnelerAIs().map(a => a.levelName), ["normal", "normal", "normal"]);
  ok("7 computers; invalid links are cleaned up; old ?opp / teams / level links still work");
}
{
  const w = play("?mode=hotseat&size=small&win=1");
  const e = w.tunnelerEngine();
  assert(e.extended && e.nPlayers === 2 && e.team(1) !== e.team(2) && e.size === "small" && e.winScore === 1 && w.tunnelerAIs().length === 0,
    "split screen: a skirmish of two players");
  // split screen: full volume, panned between BLUE's tank (left) and GREEN's (right); null off play
  const hl = w.tunnelerRunner().listener;
  const hr = { screen: "play", tankX: [0, 100, 300], tankY: [0, 50, 60] };
  same(hl(hr), { left: { x: 100, y: 50 }, right: { x: 300, y: 60 } }, "split screen listener");
  assert.strictEqual(hl(Object.assign({}, hr, { screen: "map" })), null, "split screen: menus centred");
  const d = play("?mode=hotseat").tunnelerEngine();
  assert(d.extended && d.size === "medium" && d.winScore === 3 && d.roundTime === 0);
  assert.strictEqual(play("?mode=hotseat&time=5").tunnelerEngine().roundTime, 5, "&time=5: 5-minute rounds");
  assert.strictEqual(play("?mode=hotseat&time=7").tunnelerEngine().roundTime, 0, "&time=7: not a choice - no limit");
  assert.strictEqual(play("?mode=cpu&slots=0:you:1,2:easy:2&time=10").tunnelerEngine().roundTime, 10, "vs computer &time=10");
  ok("split screen: a skirmish of two players with size / rounds to win from the link, full-volume stereo sound");
}

// ---------------------------------------------------------------- home.js settings screens
{
  const store = new Map();
  let env = makeEnv("", store);
  env.page("index.html");
  env.key("ArrowDown"); env.key("Enter");                  // Vs computer
  env.key("Enter");                                        // Start a new game (selected first)
  assert.strictEqual(longLink(env.win.location.href), "/skirmish?slots=0:you:1,1:easy:2&size=medium&win=3&ff=0&view=self&watch=wreck&lv=2",
    "default = the classic game");
  // CYAN: computer (easy) in team 2 -> 1 vs 2 teams; large map; 5 to win; friendly fire on; view everyone
  env = makeEnv("", store);
  env.page("index.html");
  env.key("ArrowDown"); env.key("Enter");
  // (rows are chosen by their key - the screen's order changes with its options)
  const pick = (en, key) => { const ui = en.win.tunnelerHomeUI(); ui.sel = ui.spec.items.findIndex(it => it.key === key); assert(ui.sel >= 0, key); ui.draw(); };
  pick(env, "slot7"); env.key("ArrowLeft"); env.key("ArrowLeft");   // TEAL: nobody -> player 2 -> (player 1 taken) expert
  pick(env, "slot2"); env.key("ArrowRight");               // CYAN: nobody -> normal (shown as easy)
  for (let i = 0; i < 6; i++) env.key("Enter");             // team 3 -> 8, then wraps to 1
  env.key("Enter");                                        // team 2
  pick(env, "size"); env.key("ArrowRight");                // large
  pick(env, "win"); env.key("ArrowRight"); env.key("ArrowRight");   // win 5
  pick(env, "time"); env.key("ArrowRight"); env.key("Enter");       // round time: no limit -> 2 -> 3 min
  pick(env, "ff"); env.key("Enter");                       // friendly fire (a team has 2+): on
  pick(env, "view"); env.key("Enter"); env.key("Enter");   // view: self -> team -> everyone
  pick(env, "watch"); env.key("Enter");                    // after death: wreck -> team
  pick(env, "play"); env.key("Enter");                     // start
  assert.strictEqual(longLink(env.win.location.href),
    "/skirmish?slots=0:you:1,1:easy:2,2:easy:2,7:hard:8&size=large&win=5&ff=1&view=everyone&watch=team&time=3&lv=2");
  assert.strictEqual(store.get("tunneler.cpu.watch"), "team", "after death remembered");
  assert.strictEqual(store.get("tunneler.cpu.time"), "3", "round time remembered");
  // number keys (top row and the numeric keypad with NumLock on) set the team of the selected slot row
  {
    const st = new Map(), en = makeEnv("", st);
    en.page("index.html"); en.key("ArrowDown"); en.key("Enter");
    pick(en, "slot1");                                     // GREEN
    for (const [code, t] of [["Numpad2", 2], ["Numpad4", 4], ["Numpad6", 6], ["Numpad8", 8], ["Digit3", 3], ["Numpad7", 7]]) {
      en.key(code);
      const saved = JSON.parse(st.get("tunneler.cpu.slots"));
      assert.strictEqual(saved[1].team, t, code + " -> team " + t);
    }
    ok("number keys and the numeric keypad (2/4/6/8 too) set a slot's team");
  }
  // the game mode and the modifiers: in the link, remembered (docs/DESIGN-8P.md 27)
  {
    const st = new Map(), en = makeEnv("", st);
    en.page("index.html"); en.key("ArrowDown"); en.key("Enter");
    pick(en, "mode"); en.key("ArrowRight");                 // standard -> gold
    pick(en, "play"); en.key("Enter");
    assert(/&gm=gold&goal=10&lv=2$/.test(longLink(en.win.location.href)), en.win.location.href);
    assert(st.get("tunneler.cpu.mode") === "gold");
    ok("vs computer: Mode goes into the link and is remembered");
    // deathmatch: "Kills to win" instead of "Rounds to win", into the link
    const sd = new Map(), ed = makeEnv("", sd);
    ed.page("index.html"); ed.key("ArrowDown"); ed.key("Enter");
    const uid = ed.win.tunnelerHomeUI();
    sd.set("x", 1);
    pick(ed, "mode"); for (let i = 0; i < 8; i++) ed.key("ArrowRight");   // ... -> deathmatch
    assert(uid.spec.items.some(it => it.key === "goal") && !uid.spec.items.some(it => it.key === "win"), "deathmatch: Kills to win, no Rounds to win");
    pick(ed, "goal"); ed.key("ArrowRight");                              // 10 -> 15
    pick(ed, "play"); ed.key("Enter");
    assert(/&gm=deathmatch&goal=15/.test(longLink(ed.win.location.href)), ed.win.location.href);
    ok("skirmish deathmatch: Kills to win replaces Rounds to win, into the link");
  }
  // friendly fire: always listed, grayed out (not selectable) while no team has 2+ tanks
  {
    const st = new Map(), en = makeEnv("", st);
    en.page("index.html"); en.key("ArrowDown"); en.key("Enter");
    const ui = en.win.tunnelerHomeUI(), ff = () => ui.spec.items.find(it => it.key === "ff");
    assert(ff() && !ff().change && ff().valueAttr === 8 && !ff().disabled, "the classic game: Friendly fire shown, its value grayed (selectable: its info says why)");
    ui.sel = ui.spec.items.findIndex(it => it.key === "slot2"); ui.draw();
    en.key("ArrowRight"); en.key("Digit1");                  // CYAN: a computer tank in team 1 (with you)
    assert(ff() && ff().change && !ff().valueAttr, "a team of 2: Friendly fire switches");
    ok("vs computer: Friendly fire always listed, grayed out without a team of 2+");
  }
  // mouse on the slot rows (DosUI zones): a click on the who column / the team cycles it forward, a
  // right click backward, a click elsewhere on the row only selects it
  {
    const st = new Map(), en = makeEnv("", st);
    en.page("index.html"); en.key("ArrowDown"); en.key("Enter");
    const ui = en.win.tunnelerHomeUI();
    const at = (key, labelCol) => {
      const i = ui.spec.items.findIndex(it => it.key === key), b = ui.boxOf(i);
      return { clientX: (b.x + 1 + labelCol) * 9 + 4, clientY: (b.y + (i - b.start) + (ui.vshift || 0)) * 16 + 8 };   // (vshift: the screen centred)
    };
    assert(ui.vshift >= 0, "the skirmish (its boxes from row 1) centred vertically: " + ui.vshift);
    const zone = (key, z) => ui.spec.items.find(it => it.key === key).zones[z].from;
    const saved = () => JSON.parse(st.get("tunneler.cpu.slots"));
    ui.click(at("slot1", zone("slot1", 1)));
    assert.strictEqual(saved()[1].team, 3, "click on GREEN's team: 2 -> 3");
    ui.zoneClick(at("slot1", zone("slot1", 1) + 2), -1);
    assert.strictEqual(saved()[1].team, 2, "right click: back to 2");
    ui.click(at("slot1", zone("slot1", 0)));
    assert.strictEqual(saved()[1].kind, "normal", "click on GREEN's who: normal -> hard");
    ui.zoneClick(at("slot1", zone("slot1", 0) + 1), -1);
    assert.strictEqual(saved()[1].kind, "easy", "right click: back to normal");
    ui.click(at("slot2", zone("slot2", 0)));
    assert.strictEqual(saved()[2].kind, "easy", "CYAN: nobody -> normal (shown as easy; not \"you\": BLUE is yours)");
    const before = st.get("tunneler.cpu.slots");
    ui.click(at("slot3", ui.spec.items.find(it => it.key === "slot3").zones[1].to + 1));   // past the team: selects only
    assert.strictEqual(ui.spec.items[ui.sel].key, "slot3", "a click past the team selects the row");
    assert.strictEqual(st.get("tunneler.cpu.slots"), before, "... and changes nothing");
    ok("vs computer slot rows: clicks on the who / team columns cycle them (right click back), elsewhere select");
    // a switch row (Map size): a click forward, a right click back
    ui.click(at("size", 2));
    assert.strictEqual(st.get("tunneler.cpu.size"), "large", "click on Map size: medium -> large");
    assert(ui.backClick(at("size", 2)) && ui.backClick(at("size", 2)), "right click taken by the switch");
    assert.strictEqual(st.get("tunneler.cpu.size"), "small", "right click twice: large -> medium -> small");
    ok("switch rows: a click steps forward, a right click back");
  }
  // remembered
  env = makeEnv("", store);
  env.page("index.html");
  env.key("ArrowDown"); env.key("Enter"); env.key("Enter");
  assert.strictEqual(longLink(env.win.location.href),
    "/skirmish?slots=0:you:1,1:easy:2,2:easy:2,7:hard:8&size=large&win=5&ff=1&view=everyone&watch=team&time=3&lv=2");
  ok("vs computer slot editor: default classic, slots / teams / options, remembered in localStorage");

  // nobody but you: "Start a new game" does nothing
  const s2 = new Map([["tunneler.cpu.slots", JSON.stringify([{ kind: "you", team: 1 }, { kind: "none", team: 2 }])]]);
  env = makeEnv("", s2);
  env.page("index.html");
  env.key("ArrowDown"); env.key("Enter"); env.key("Enter");
  assert.strictEqual(env.win.location.href, "", "no computer tank: no game");
  const s3 = new Map([["tunneler.cpu.slots", JSON.stringify([{ kind: "you", team: 4 }, { kind: "normal", team: 4 }])]]);
  env = makeEnv("", s3);
  env.page("index.html");
  env.key("ArrowDown"); env.key("Enter"); env.key("Enter");
  assert.strictEqual(env.win.location.href, "", "one team only: no game");
  // slots stored by version 3.2 or older (no "tunneler.levels"): the old level names, renamed once
  for (const [marker, want] of [[null, "1:hard:2,2:easy:2"], ["2", "1:expert:2,2:normal:2"]]) {
    const s4 = new Map([["tunneler.cpu.slots", JSON.stringify([{ kind: "you", team: 1 }, { kind: "expert", team: 2 }, { kind: "normal", team: 2 }])]]);
    if (marker) s4.set("tunneler.levels", marker);
    env = makeEnv("", s4);
    env.page("index.html");
    env.key("ArrowDown"); env.key("Enter"); env.key("Enter");
    const href = longLink(env.win.location.href);
    if (marker) assert(!/expert/.test(href), "an unknown level is not kept: " + href);
    else assert(href.includes("slots=0:you:1," + want + "&"), href);
  }
  ok("vs computer: no game without a computer tank or with a single team; old stored levels renamed");

  // split screen: Start / Map size / Rounds to win / Instructions / Back
  env = makeEnv("", store);
  env.page("index.html");
  env.key("Enter"); env.key("Enter");
  assert.strictEqual(env.win.location.href, "/split?size=medium&win=3");
  env = makeEnv("", store);
  env.page("index.html");
  env.key("Enter");
  env.key("ArrowDown"); env.key("ArrowLeft");              // small
  env.key("ArrowDown"); env.key("ArrowLeft");              // 2
  env.key("ArrowDown"); env.key("ArrowLeft");              // round time: no limit -> 10 min (wraps back)
  env.key("ArrowUp"); env.key("ArrowUp"); env.key("ArrowUp"); env.key("Enter");
  assert.strictEqual(env.win.location.href, "/split?size=small&win=2&time=10");
  assert.strictEqual(store.get("tunneler.split.size"), "small");
  assert.strictEqual(store.get("tunneler.split.time"), "10");
  ok("split-screen settings: default classic, map size, rounds to win and round time, remembered");
}

// ---------------------------------------------------------------- home.js: split screen's keys as set in Settings, Controls
{
  const store = new Map();
  const env = makeEnv("", store), ui = () => env.win.tunnelerHomeUI();
  env.page("index.html");
  const info = () => env.win.Lang.decode(ui().spec.items.find(i => i.key === "split").info[1]);
  assert(/BLUE: W A S D \+ L Shift +GREEN: ↑ ← ↓ → \+ Enter/.test(info()), "the defaults: " + info());
  env.win.Controls.set("blue", "fire", "Space");
  env.win.Controls.set("green", "up", "KeyI");
  env.key("ArrowUp"); env.key("Enter"); env.key("Escape");  // (Settings and back: the main menu anew)
  assert(/BLUE: W A S D \+ Space +GREEN: I ← ↓ → \+ Enter/.test(info()), "as set: " + info());
  ok("home.js: split screen's info - the keys as set in Settings, Controls (" + info() + ")");
}

// ---------------------------------------------------------------- home.js Settings: categories + their settings
{
  const store = new Map([["tunneler.gfx", "original"]]);  // (chosen before: modern is the default since 5.0)
  const env = makeEnv("", store), ui = () => env.win.tunnelerHomeUI();
  env.page("index.html");
  env.key("ArrowUp"); env.key("Enter");                    // (wraps to the last item) Settings
  const keys = () => ui().spec.items.map(i => i.key), sel = () => ui().spec.items[ui().sel].key;
  const right = () => keys().slice(keys().indexOf("back") + 1);
  same(keys().filter(k => /^cat-/.test(k)), ["cat-gameplay", "cat-graphics", "cat-sound", "cat-controls", "cat-online"], "categories");
  {                                                       // (centred as the tallest category: no category moves the screen)
    const shifts = new Set();
    for (const c of ["cat-gameplay", "cat-graphics", "cat-sound", "cat-controls", "cat-online"]) { ui().sel = keys().indexOf(c); ui().draw(); shifts.add(ui().vshift); }
    assert.strictEqual(shifts.size, 1, "the same centring for every category: " + [...shifts]);
    ui().sel = keys().indexOf("cat-gameplay"); ui().draw();
  }
  // Language: no category - a centred switch below them (owner, 2026-10-25)
  {
    const it = () => ui().spec.items.find(i => i.key === "lang"), before = env.win.Lang.code;
    assert(it() && it().align !== "left" && keys().indexOf("lang") > keys().indexOf("cat-online"), "Language: a switch below the categories");
    it().change(1);
    assert(env.win.Lang.code !== before && it(), "Left / Right on it: the next language");
    it().change(-1);
    assert.strictEqual(env.win.Lang.code, before, "and back");
  }
  assert.strictEqual(sel(), "cat-gameplay", "on the first category");
  same(right(), ["fullscreen", "scale", "gap-d", "tankcolors", "teammarks", "prefer", "autosave"], "Gameplay: fullscreen, screen size, a gap, tank colors, mark teammates, preferred color, save every match");
  {
    // Save every match (replay.js autoSave): off by default (owner, 2026-10-28 - "Save the replay" after a match), switched here
    const row = () => ui().spec.items.find(i => i.key === "autosave"), dec = () => env.win.Lang.decode(row().label);
    assert(/: Off$/.test(dec()) && !env.win.Replay.autoSave(), "Save every match: Off (the default): " + dec());
    row().change(1);
    assert(/: On$/.test(dec()) && env.win.Replay.autoSave() && store.get("tunneler.replays.auto") === "1", "Save every match: On (kept)");
    row().go();
    assert(/: Off$/.test(dec()) && !env.win.Replay.autoSave(), "and Off again");
    ui().spec.items.find(i => i.key === "prefer").change(1);   // Preferred color: BLUE (online games' seat)
    assert.strictEqual(store.get("tunneler.online.color"), "blue");
  }
  env.key("Enter"); assert.strictEqual(sel(), "fullscreen", "Enter: into the settings");
  // Alt+Enter (GameScreen.toggle) while the row is on screen: it follows
  const fsRow = () => ui().spec.items.find(i => i.key === "fullscreen").label;
  assert.ok(fsRow().endsWith(env.win.Lang.t("set.ping.off")), "fullscreen off");
  env.win.GameScreen.toggle();
  assert.ok(fsRow().endsWith(env.win.Lang.t("set.ping.on")), "Alt+Enter: the row says on");
  env.win.GameScreen.toggle();
  env.key("ArrowDown"); env.key("ArrowRight");             // Screen size: whole pixels
  assert.strictEqual(store.get("tunneler.scale"), "integer");
  env.key("ArrowDown"); env.key("ArrowRight");             // Tank colors: color-blind
  assert.strictEqual(store.get("tunneler.tankcolors"), "colorblind");
  env.key("ArrowDown"); env.key("ArrowDown"); env.key("ArrowDown"); env.key("ArrowDown"); assert.strictEqual(sel(), "fullscreen", "Up / Down stay in the box (past Mark teammates, Preferred color, Save every match)");
  env.key("Escape"); assert.strictEqual(sel(), "cat-gameplay", "Esc: back to the category");
  env.key("ArrowDown"); env.key("ArrowRight");             // Graphics; Right: into its settings
  same(right(), ["gfx", "gap-g", "smooth"], "Graphics (original): graphics, a blank row, smooth scrolling");
  env.key("ArrowRight");                                   // original -> modern (no WebGL2 here: drawn as the original)
  assert.strictEqual(store.get("tunneler.gfx"), "modern");
  assert.strictEqual(env.win.Gfx.mode(), "original", "no WebGL2: drawn as the original");
  env.key("ArrowLeft");
  env.key("ArrowDown"); env.key("Enter");                  // Smooth scrolling: on (the default) -> off
  assert.strictEqual(store.get("tunneler.smooth"), "0");
  env.key("Escape"); env.key("ArrowDown");                 // Sound
  assert.ok(right()[0] === "sound", "Sound: the style first");
  env.key("Enter"); env.key("ArrowRight");                 // realistic (the default) -> recorded
  assert.strictEqual(store.get("tunneler.sound"), "recorded", "sound style remembered");
  // the mouse wheel over a switch steps it (up: forward), as Left / Right
  const u = ui(), at = key => u.spec.items.findIndex(i => i.key === key);
  u.itemAt = () => at("sound");
  u.wheel({ deltaY: -120, deltaMode: 0 });
  assert.strictEqual(store.get("tunneler.sound"), env.win.Speaker.STYLES[env.win.Speaker.STYLES.indexOf("recorded") + 1], "wheel up: the next style");
  u.wheel({ deltaY: 120, deltaMode: 0 });
  assert.strictEqual(store.get("tunneler.sound"), "recorded", "wheel down: back");
  // the volume: a meter of 10 cells; a click on a cell sets it there; it stops at 100 and 0
  const vol = ui().spec.items[at("volume")];
  assert.strictEqual((vol.label.match(/\xDB/g) || []).length, 10, "100 %: ten full cells");
  vol.zones[3].click(1);
  assert.strictEqual(store.get("tunneler.volume"), "40", "a click on the 4th cell: 40 %");
  vol.zones[9].click(1); u.itemAt = () => at("volume");
  u.wheel({ deltaY: -120, deltaMode: 0 });
  assert.strictEqual(store.get("tunneler.volume"), "100", "100 %: up stays");
  vol.zones[0].click(-1);
  u.wheel({ deltaY: 120, deltaMode: 0 });
  assert.strictEqual(store.get("tunneler.volume"), "0", "0 %: down stays");
  delete u.itemAt;
  env.key("Escape"); env.key("ArrowDown"); env.key("ArrowDown");      // Controls, Online
  same(right(), ["name", "showchat", "chatsound", "ping"], "Online: name, show chat, chat sound, show ping (preferred color: Gameplay)");
  env.key("Tab"); assert.strictEqual(sel(), "name");
  env.key("ArrowDown"); env.key("Enter");                  // Show chat: on -> off (hidden)
  assert.strictEqual(store.get("tunneler.chat.hide"), "1");
  assert.ok(ui().spec.items.find(i => i.key === "chatsound").disabled, "no chat: Chat sound grayed out");
  env.key("ArrowDown"); assert.strictEqual(sel(), "ping", "(skipped)");
  env.key("Enter");                                        // Show ping on
  assert.strictEqual(store.get("tunneler.ping"), "1");
  env.key("Escape"); env.key("ArrowDown");                 // Language (a switch below the categories)
  assert.strictEqual(sel(), "lang");
  env.key("ArrowRight");
  assert.notStrictEqual(store.get("tunneler.lang") || "en", "en", "language switched");
  env.key("ArrowLeft");
  env.key("ArrowDown"); assert.strictEqual(sel(), "back", "Language, then Back");
  // Controls: a key row takes the next key press (Esc cancels), the page doesn't see it
  if (env.win.Controls && env.win.Controls.get) {
    env.key("ArrowUp"); env.key("ArrowUp"); env.key("ArrowUp");   // Controls
    assert.strictEqual(sel(), "cat-controls");
    env.key("Enter"); assert.strictEqual(sel(), "key-blue-up");
    assert(!ui().spec.items.some(i => i.key === "touchsize"), "no touch screen: no touch controls' rows");
    env.key("Enter");
    assert.ok(ui().spec.items[ui().sel].label.includes(env.win.Lang.t("ctl.press")), "waiting for a key");
    env.key("Escape");
    assert.strictEqual(env.win.Controls.get("blue", "up"), "KeyW", "Esc: unchanged");
    assert.strictEqual(sel(), "key-blue-up", "Esc: still on the row (not back to the category)");
    env.key("Enter"); env.key("KeyI");
    assert.strictEqual(env.win.Controls.get("blue", "up"), "KeyI", "BLUE up = I");
    env.key("Escape");
  }
  env.key("Escape"); env.key("Escape");
  assert.ok(ui().spec.home, "Esc on the categories: the main menu");
  ok("homepage Settings: Display, Graphics, Sound, Controls, Online, Language and their settings - remembered");
}

// ---------------------------------------------------------------- views.js: players by their slot's color
{
  const w = play("?mode=cpu&slots=0:you:1,3:easy:2,7:hard:2,5:normal:3,6:normal:4,4:normal:5,2:normal:6&hide=0");
  const e = w.tunnelerEngine(), v = w.tunnelerViews(), E = w.TunnelerEngine;
  same(e.slots.map(s => s.color), [0, 2, 3, 4, 5, 6, 7], "slot colors");
  for (let i = 0; i < e.nPlayers; i++) {
    assert.strictEqual(v.playerColor(i), E.PLAYER_COLORS[e.slots[i].color], "map color of player " + i);
    assert.strictEqual(v.playerTextColor(i), E.PLAYER_TEXT_COLORS[e.slots[i].color], "text color of player " + i);
    assert.strictEqual(v.playerKey(i), E.PLAYER_KEYS[e.slots[i].color], "color key of player " + i);
  }
  e.setNames(["ME"]);
  assert.strictEqual(v.playerName(0), "ME", "names from the pre-game lobby");
  assert.strictEqual(v.playerName(1), e.colorName(2));
  // 6 teams: every team on the map's team lines, none wider than the screen
  const lines = v.teamLines(e);
  assert.strictEqual(lines.reduce((a, l) => a + l.length, 0), e.nTeams, "every team listed");
  for (const l of lines) assert(l.reduce((a, [t]) => a + t.length, 0) + 5 * (l.length - 1) <= 78, "team line fits");
  assert.strictEqual(lines[0][1][1], E.PLAYER_TEXT_COLORS[3], "team 2 in its first tank's color (YELLOW)");
  // split screen: BLUE / GREEN in their slot colours, as every other game (it ran the classic engine)
  const c = play("?mode=hotseat").tunnelerViews();
  same([c.playerColor(0), c.playerColor(1)], [E.PLAYER_COLORS[0], E.PLAYER_COLORS[1]], "split screen colors");
  ok("views.js: players colored / named by their slot (BLUE, YELLOW, TEAL...), all teams on the map");
}

// ---------------------------------------------------------------- views.js: self / team / everyone (DESIGN-8P 23)
{
  // BLUE + YELLOW in team 1, CYAN + TEAL in team 2, GREEN alone in team 3
  const link = "?mode=cpu&slots=" + encodeURIComponent("0:you:1,1:normal:3,2:normal:2,3:normal:1,7:normal:2");
  const layoutOf = q => {
    const w = play(link + q), v = w.tunnelerViews(), e = w.tunnelerEngine();
    v.snap = { screen: "play", mode: "lores", views: e.views || [] };
    return v.layout();
  };
  const self = layoutOf("&view=self"), team = layoutOf("&view=team"), all = layoutOf("&view=everyone"), old = layoutOf("&hide=0");
  same([self.kind, self.cells, self.cols], ["grid", [0], 1], "self: own view only");
  same([team.cells, team.cols, team.rows], [[0, 3], 2, 1], "team: own, then YELLOW (player 4)");
  same([all.cells, all.cols, all.rows], [[0, 1, 2, 3, 4], 3, 2], "everyone: own first, then slot order, 3 + 2");
  same(old.cells, [0, 1, 2, 3, 4], "old hide=0 links: everyone");
  same(layoutOf("").cells, [0], "default: self");
  // a player in the middle comes first, then the others in slot order
  const w = play(link + "&view=everyone"), v = w.tunnelerViews();
  v.setScope(3, "everyone"); v.snap = { screen: "play", mode: "lores", views: w.tunnelerEngine().views || [] };
  same(v.layout().cells, [3, 0, 1, 2, 4], "own view first");
  v.setScope(2, "team");
  same(v.layout().cells, [2, 4], "team of player 3 (CYAN + TEAL)");
  // classic (vs computer: BLUE against GREEN): self = BLUE's half, team = the same, everyone = the full split screen
  const cl = q => { const x = play("?mode=cpu&slots=0:you:1,1:normal:2" + q).tunnelerViews(); x.snap = { screen: "play", mode: "lores" }; return x.layout(); };
  // (everyone: the two halves as two labeled views - the same picture plus the names on the top borders)
  same([cl("&view=self"), cl("&view=team"), cl("&view=everyone")].map(L => [L.kind, L.crop || L.cells, !!L.labels]),
    [["display", "blue", false], ["display", "blue", false], ["grid", [0, 1], true]], "classic");
  same([self.labels, team.labels, all.labels], [false, true, true], "labels only when more than one view");
  // the label: name (any letters) + team when teams are shared, at most 38 columns
  const lw = play(link + "&view=everyone"), lv = lw.tunnelerViews(), le = lw.tunnelerEngine();
  le.setNames(["王小明王小明", "Дмитро"]);
  assert.strictEqual(lv.viewLabel(0), lw.UniText.fromRaw("王小明王小明") + "  " + le.teamName(le.team(1)));
  assert.strictEqual(lv.viewLabel(2), le.colorName(3) + "  " + le.teamName(le.team(3)), "no name: the color");
  // split screen: both players' own views side by side (BLUE's first), as any game of two players
  const hs = play("?mode=hotseat").tunnelerViews(); hs.snap = { screen: "play", mode: "lores", views: [new Uint8Array(16000), new Uint8Array(16000)] };
  same([hs.layout().kind, hs.layout().cells], ["grid", [0, 1]], "split screen: both own views");
  ok("views.js: self / team / everyone - own view first, teammates / others in slot order; classic halves");
}

// ---------------------------------------------------------------- Settings: Graphics - the original's or the modern's settings
{
  const keys = modern => {
    const env = makeEnv("", new Map([["tunneler.gfx", "modern"]]));
    env.page("index.html");
    if (modern) { env.win.Gfx.mode = () => "modern"; env.win.Gfx.supported = () => true; }   // (no WebGL2 in the test: pretend)
    env.key("ArrowUp"); env.key("Enter"); env.key("ArrowDown");          // Settings, Graphics
    return env.win.tunnelerHomeUI().spec.items.map(i => i.key);
  };
  const orig = keys(false), mod = keys(true);
  assert(orig.includes("smooth") && !orig.includes("style"), "original: Smooth scrolling, no modern settings");
  assert(!mod.includes("smooth") && ["style", "quality", "terrain", "edges", "light", "particles", "glow", "shake", "camera", "panel", "fog"]
    .every(k => mod.includes(k)), "modern: the modern settings (no Smooth scrolling: always on)");
  ok("Settings: Graphics shows the original's (Smooth scrolling) or the modern's settings");
}

// ---------------------------------------------------------------- play.js: Rematch / Esc after a match -> the lobby
// (the engine plays the match only - option match: no menu; the page's own screen after it, docs/RENDERING.md)
{
  const over = env => { const e = env.win.tunnelerEngine(); e.over = true; env.win.tunnelerRunner().onStep(e); return env.win.tunnelerAfter(); };
  // the game's settings are stored where home.js reads them (a game from a link comes back as it was)
  const st = new Map(), env = makeEnv("?mode=cpu&slots=" + encodeURIComponent("0:normal:1,2:you:2,5:hard:1") +
    "&size=small&win=5&time=3&ff=1&view=team&watch=killer&sight=circle&lv=2", st);
  env.page("play.html");
  const e = env.win.tunnelerEngine();
  assert(e.matchOnly && !e.menuShown, "the engine plays the match only");
  const ui = over(env);
  assert(ui && ui.spec.items.map(it => it.key).join() === "rematch,gap,back", "after the match: Rematch, Back (no replay kept yet)");
  assert(ui.spec.backdrop && ui.spec.wide, "the statistics under the menu, the 80 x 25 screen on a phone too");
  ui.spec.items.find(it => it.key === "rematch").go();
  assert.strictEqual(env.win.location.href, "/#cpu", "Rematch: the skirmish lobby");
  same(JSON.parse(st.get("tunneler.cpu.slots")).map(s => s.kind + s.team),
    ["normal1", "none2", "you2", "none4", "none5", "hard1", "none7", "none8"], "the slots");
  same(["size", "win", "time", "ff", "view", "watch", "sight", "mode"].map(k => st.get("tunneler.cpu." + k)),
    ["small", "5", "3", "1", "team", "killer", "circle", "standard"], "the settings");
  // Back to main menu: the homepage
  const env4 = makeEnv("?mode=cpu&slots=" + encodeURIComponent("0:you:1,1:easy:2") + "&lv=2", new Map());
  env4.page("play.html");
  over(env4).spec.items.find(it => it.key === "back").go();
  assert.strictEqual(env4.win.location.href, "/", "Back: the main menu");
  // two players: player 2 comes back as player 2
  const s3 = new Map(), p2 = makeEnv("?mode=cpu&slots=" + encodeURIComponent("0:you:1,1:p2:2,2:easy:1") + "&lv=2", s3);
  p2.page("play.html");
  over(p2).spec.items[0].go();
  same(JSON.parse(s3.get("tunneler.cpu.slots")).slice(0, 3).map(x => x.kind + x.team), ["you1", "p22", "easy1"], "player 2 kept");
  // split screen: its settings, its screen; Esc after the match does the same
  const s2 = new Map(), sp = makeEnv("?mode=hotseat&size=large&win=2&time=5", s2);
  sp.page("play.html");
  assert(sp.win.tunnelerEngine().matchOnly, "split screen: the match only too");
  const ui2 = over(sp);
  assert(ui2.spec.items.some(it => it.key === "rematch"), "split screen: the same screen after the match as a skirmish's");
  sp.key("Escape");
  assert.strictEqual(sp.win.location.href, "/#split");
  same(["size", "win", "time"].map(k => s2.get("tunneler.split." + k)), ["large", "2", "5"]);
  ok("play.js: after the match its own screen - Rematch / Esc go to the lobby with the game's settings (skirmish, split screen), Back home");
}

// ---------------------------------------------------------------- play.js: held Tab = the score over the game
{
  const env = makeEnv("?mode=cpu&slots=" + encodeURIComponent("0:you:1,1:easy:2,2:easy:1,3:easy:2") + "&gm=gold&size=small&lv=2", new Map());
  env.page("play.html");
  const e = env.win.tunnelerEngine(), runner = env.win.tunnelerRunner();
  for (let i = 0; i < 3000 && e.screen !== "play"; i++) e.step({ bits: [0, 0, 0, 0], keys: [] });
  const hash = NODE.NetProto.stateHash(e);
  env.key("Tab");
  const v = runner.overlay ? runner.overlay.vram : [];
  let text = "";
  for (let k = 0; k < v.length; k += 2) text += String.fromCharCode(v[k]);
  assert(runner.overlay && /ROUND 1/.test(text) && /TEAM 1/.test(text) && /gold 0\/10/.test(text) && /gold rush/.test(text),
    "Tab: the round, the teams' score, the settings: " + text);
  assert(!(env.win.tunnelerInput().bits[0] & 16), "Tab never fires");
  assert.strictEqual(NODE.NetProto.stateHash(e), hash, "display only");
  env.key("Tab", "keyup");
  assert(!runner.overlay, "let go: the game again");
  ok("play.js: held Tab = the score, the teams and the settings over the game (display only, no fire)");
}

// ---------------------------------------------------------------- teammates marked in the views (Settings, Gameplay)
{
  const store = new Map();
  const env = makeEnv("?mode=cpu&slots=" + encodeURIComponent("0:you:1,1:easy:1,2:easy:2,3:easy:2") + "&lv=2", store);
  env.page("play.html");
  const e = env.win.tunnelerEngine(), views = env.win.tunnelerViews();
  for (let i = 0; i < 3000 && e.screen !== "play"; i++) e.step({ bits: [0, 0, 0, 0], keys: [] });
  same(views.teamMarks(e, 1), [2], "BLUE's teammate RED marked, not the enemies");
  same(views.teamMarks(e, 3), [4], "as GOLD sees it: PINK");
  e.alive[2] = false;
  same(views.teamMarks(e, 1), [], "a destroyed teammate: no mark");
  e.alive[2] = true;
  store.set("tunneler.teammarks", "0");
  same(views.teamMarks(e, 1), [], "Mark teammates: Off");
  store.delete("tunneler.teammarks");
  // the original look: the snapshot keeps each view's origin and the tanks (views.js paintMarks draws from them)
  const snap = e.out.snapshots[e.out.snapshots.length - 1] || {};
  assert(snap.cams && snap.cams[1] && snap.tanks && snap.tanks[2] && snap.tanks[2][0] === e.tankX[2], "snapshot: cams, tanks");
  // a teammate 8 pixels right of BLUE in its view: the triangle's pixels in RED's colour above it
  const s = { cams: [null, [e.tankX[1] - 38, e.tankY[1] - 35]], tanks: [null, null, [e.tankX[1] + 8, e.tankY[1], 1]] };
  const W = 360, px = new Uint32Array(W * 400), pal = Array.from({ length: 16 }, (_, i) => i + 100);
  views.paintMarks(px, W, 0, 0, s, 0, e, pal);
  const at = (wx, wy) => px[(8 + wy * 4 + 1) * W + 9 + Math.round(wx * 4.5) + 1];
  assert(at(38 + 8, 35 - 9) === pal[e.playerColor(2) & 15] && at(38 + 8, 35 - 6) === pal[0] && at(38, 35) === 0, "the mark: colour, edge; nothing elsewhere");
  ok("teammates marked (Settings, Gameplay, Mark teammates): the viewer's team but itself, alive; off: none; the original look's triangle");
}

// ---------------------------------------------------------------- after death, one view: a tank's side keys switch it
{
  const env = makeEnv("?mode=cpu&slots=" + encodeURIComponent("0:you:1,1:easy:1,2:easy:1,3:easy:2") + "&view=self&watch=team&lv=2", new Map());
  env.page("play.html");
  const e = env.win.tunnelerEngine(), views = env.win.tunnelerViews();
  for (let i = 0; i < 3000 && e.screen !== "play"; i++) e.step({ bits: [0, 0, 0, 0], keys: [] });
  e.alive[1] = false;                                    // (your tank destroyed)
  const shown = () => views.outCells();
  const first = shown();
  assert(first.length === 1 && [1, 2].includes(first[0]), "one teammate's view: " + first);
  env.key("ArrowRight");                                 // (GREEN's right key: the default arrows)
  const second = shown();
  assert(second.length === 1 && [1, 2].includes(second[0]) && second[0] !== first[0], "the other teammate: " + second);
  env.key("KeyA");                                       // (BLUE's left key: back)
  same(shown(), first, "back to the first");
  env.win.Controls.set("blue", "right", "KeyL");         // (remapped: that key does it now)
  env.key("KeyL");
  same(shown(), second, "a remapped key");
  ok("after death, one view (View self, watch team): a tank's left / right keys (Settings, Controls) switch the teammate watched");
}

// ---------------------------------------------------------------- an auto start's "(creating world)"
{
  // a key cuts the world creation short, the auto start runs early - its "(creating world)" line stays steady
  // (no clearing, no blinking: that is the original's "started before the world is ready" for its menu); the text is
  // the steps the engine announces, drawn by matchtext.js
  const E = NODE.TunnelerEngine;
  const f = new E(3, { autoStart: true, slots: [{ color: 0, team: 1 }, { color: 1, team: 2 }], extended: true });
  const attr = () => { const v = NODE.screenOf(f).vram; for (let r = 0; r < 25; r++) { let t = ""; for (let c = 0; c < 80; c++) t += String.fromCharCode(v[r * 160 + c * 2]); const c0 = t.indexOf("(creating"); if (c0 >= 0) return v[r * 160 + c0 * 2 + 1]; } return -1; };
  for (let i = 0; i < 10; i++) { f.step({ bits: [0, 0], keys: i === 1 ? [[0, 0x48]] : [] }); assert.strictEqual(attr(), 1, "steady at step " + i); }
  ok("an auto start's \"(creating world)\" stays steady");
}

// ---------------------------------------------------------------- skirmish: two players
{
  // player 1 = BLUE's keys, player 2 = GREEN's keys; computer tanks for the rest; both views first; the
  // sound split like the split screen (panned by the nearer of the two tanks)
  const w = play("?mode=cpu&slots=" + encodeURIComponent("0:easy:1,2:you:1,4:p2:2,6:hard:2") + "&view=self&lv=2");
  const e = w.tunnelerEngine(), v = w.tunnelerViews();
  assert(e.extended && e.nPlayers === 4, "the extended engine, 4 tanks");
  same(w.tunnelerAIs().map(a => [a.me, a.levelName]), [[1, "easy"], [4, "hard"]], "computer tanks only for the others");
  v.snap = { screen: "play", mode: "lores", views: e.views || [] };
  same(v.layout().cells, [1, 2], "view self: player 1's and player 2's views");
  assert.strictEqual(v.viewerOf(2), 3, "player 2's view: seen as player 2's");
  const L = w.tunnelerRunner().listener({ screen: "play", tankX: [0, 1, 20, 40, 3], tankY: [0, 1, 21, 41, 3] });   // (players in colour order: 2 = you, 3 = player 2)
  same(L, { left: { x: 20, y: 21 }, right: { x: 40, y: 41 } }, "sound: between the two players' tanks");
  // without a computer tank: two players in different teams are a game
  const w2 = play("?mode=cpu&slots=" + encodeURIComponent("0:you:1,1:p2:2") + "&lv=2");
  assert(w2.tunnelerEngine().extended && w2.tunnelerAIs().length === 0, "player 1 vs player 2: no computer tank");
  ok("skirmish: two players (BLUE's / GREEN's keys), computer tanks for the rest, both views, split sound");
}

// ---------------------------------------------------------------- views.js: the scene for graphics "modern"
{
  const link = "?mode=cpu&slots=" + encodeURIComponent("0:you:1,1:normal:3,2:normal:2,3:normal:1,7:normal:2");
  const w = play(link + "&view=everyone"), v = w.tunnelerViews(), e = w.tunnelerEngine();
  e.setNames(["Žofia"]);
  v.snap = { screen: "play", mode: "lores", views: e.views || [] };
  const sc = v.sceneOf(v.layout());
  same(sc.cells.map(c => [c.x, c.y, c.p]), [[0, 0, 1], [360, 0, 2], [720, 0, 3], [0, 400, 4], [360, 400, 5]], "grid cells, players 1..N");
  assert.strictEqual(sc.engine, e);
  assert.strictEqual(sc.cells[0].name, "Žofia", "names as Unicode");
  assert.ok(sc.cells[1].team.length > 0, "team names when teams are shared");
  same(sc.cells.map(c => c.color), [0, 1, 2, 3, 4].map(i => v.playerTextColor(i) & 15));
  assert.strictEqual(sc.labels, true);
  assert.strictEqual(sc.windows.length, 5, "every window drawn");
  v.setNotice(w.Lang.t("on.escagain"));
  const n = v.sceneOf(v.layout());
  assert.ok(n.notice.length > 0 && n.cut[1] - n.cut[0] === 32, "the notice band, cut out of the windows");
  // classic: the display's halves; the end-of-match world map; text screens: none
  const c = play("?mode=hotseat").tunnelerViews();
  c.snap = { screen: "play", mode: "lores" };
  same(c.sceneOf(c.layout()).cells.map(x => [x.x, x.p]), [[0, 1], [360, 2]], "hotseat halves");
  c.snap = { screen: "map", mode: "lores" };
  same(c.sceneOf(c.layout()).map, { kind: "end", x: 36, y: 20, w: 648, h: 292 }, "the end-of-match map");
  c.snap = { screen: "text", mode: "text" };
  assert.strictEqual(c.sceneOf(c.layout()), null, "text screens: the Display reports them");
  ok("views.js sceneOf (graphics modern): cells, names, labels, notice cut, classic halves, the world map");
}

// ---------------------------------------------------------------- ghost mode, you marker, settings (DESIGN-8P 25)
{
  // BLUE (you) + YELLOW in team 1, CYAN + TEAL in team 2, GREEN alone in team 3
  const link = "?mode=cpu&slots=" + encodeURIComponent("0:you:1,1:normal:3,2:normal:2,3:normal:1,7:normal:2");
  const w = play(link + "&watch=others&view=team"), v = w.tunnelerViews(), e = w.tunnelerEngine();
  assert.strictEqual(v.watchOut, "others", "watch=others: views.watchOut");
  assert.strictEqual(play(link + "&watch=1").tunnelerViews().watchOut, "others", "old links: watch=1 = others");
  assert.strictEqual(e.youPlayer, 1, "you marker on player 1");
  same(e.showSettings, { view: "team", visible: false, watchOut: "others" }, "settings listed");
  v.snap = { screen: "play", mode: "lores", views: e.views || [] };
  e.killedBy = [0, 0, 0, 0, 0, 0];
  e.tankX = [0, 100, 200, 300, 400, 500]; e.tankY = [0, 10, 20, 30, 40, 50];
  const alive = (...on) => { e.alive = [false, ...on]; return v.layout(); };
  same(alive(true, true, true, true, true).cells, [0, 3], "alive: the scope's views (own team)");
  // "others" (watch all): the player's own views still alive (view team: YELLOW) stay - the destroyed own one
  // goes - plus every other tank still alive, own team's first - whatever the view limit
  e.killedBy[1] = 3;                                        // CYAN shot you
  let L = alive(false, true, true, true, true);
  same([L.cells, !!L.labels], [[3, 1, 2, 4], true], "watch all: your living views first (YELLOW), then everyone alive, labeled");
  assert.strictEqual(v.listenTo(0), 2, "sounds from the tank that destroyed you (CYAN)");
  same(v.hearAt(0, e), { x: 300, y: 30 }, "heard at CYAN");
  e.killedBy[3] = 5;                                        // TEAL shot CYAN
  same(alive(false, true, false, true, true).cells, [3, 1, 4], "CYAN destroyed too: YELLOW and the rest");
  assert.strictEqual(v.listenTo(0), 4, "sounds from CYAN's killer (TEAL)");
  same(alive(false, false, false, false, false).cells, [0, 3], "nobody left: your own views...");
  assert(v.blackedOut(0, e), "... black (DESTROYED)");
  same(alive(true, false, false, false, false).cells, [0, 3], "next round (own tank alive): back to normal");
  assert.strictEqual(v.listenTo(0), 0, "own tank alive: sounds fade from it again");
  // "killer" (watch killer): one view - the tank that destroyed you, then its killer, ...; else the
  // first alive (own team's first); it stays on that tank while it lives
  {
    const wk = play(link + "&watch=killer&view=team"), vk = wk.tunnelerViews(), ek = wk.tunnelerEngine();
    vk.snap = { screen: "play", mode: "lores", views: ek.views || [] };
    ek.killedBy = [0, 0, 0, 0, 0, 0];
    const al = (...on) => { ek.alive = [false, ...on]; return vk.layout(); };
    same(al(false, true, true, true, true).cells, [3], "watch killer, no killer (energy): the first alive (YELLOW, also in your views)");
    al(true, true, true, true, true);
    ek.killedBy[1] = 3;
    const K = al(false, true, true, true, true);
    same([K.cells, !!K.labels], [[3, 2], true], "watch killer: your living views (YELLOW) + the tank that destroyed you (CYAN), labeled");
    ek.killedBy[3] = 5;
    same(al(false, true, false, true, true).cells, [3, 4], "CYAN destroyed: its killer (TEAL)");
    ek.killedBy[4] = 2;
    same(al(false, true, false, true, true).cells, [3, 4], "stays on the watched tank while it lives");
    // view self + watch killer: only the killer's view (not your black one beside it)
    const ws = play(link + "&watch=killer&view=self"), vs = ws.tunnelerViews(), es = ws.tunnelerEngine();
    vs.snap = { screen: "play", mode: "lores", views: es.views || [] };
    es.killedBy = [0, 3, 0, 0, 0, 0]; es.alive = [false, false, true, true, true, true];
    same(vs.layout().cells, [2], "view self, watch killer: only the killer (CYAN)");
    assert.strictEqual(vk.listenTo(0), 4, "sounds from the watched tank");
  }
  // "team" (watch team): all teammates still alive, black once none is left
  const wt = play(link + "&watch=team&view=self"), vt = wt.tunnelerViews(), et = wt.tunnelerEngine();
  vt.snap = { screen: "play", mode: "lores", views: et.views || [] };
  et.killedBy = [0, 3, 0, 0, 0, 0]; et.tankX = e.tankX; et.tankY = e.tankY;
  et.alive = [false, false, true, true, true, true];
  same(vt.layout().cells, [3], "watch team: your teammate (YELLOW) - not your killer, whatever the view limit");
  {   // while you live: a destroyed teammate's view is black (every setting but "wreck")
    const tv = play(link + "&watch=team&view=team"), tvv = tv.tunnelerViews(), tve = tv.tunnelerEngine();
    tvv.snap = { screen: "play", mode: "lores", views: tve.views || [] };
    tve.alive = [false, true, true, true, false, true];
    same(tvv.layout().cells, [0, 3], "view team, alive: you and YELLOW...");
    assert(tvv.blackedOut(3, tve) && !tvv.blackedOut(0, tve), "... YELLOW destroyed: its view black (DESTROYED)");
    const wr = play(link + "&view=team"), wrv = wr.tunnelerViews(), wre = wr.tunnelerEngine();
    wre.alive = [false, true, true, true, false, true];
    assert(!wrv.blackedOut(3, wre), "wreck: a destroyed teammate's view stays");
  }
  assert.strictEqual(vt.listenTo(0), 3, "sounds from the teammate shown (the killer isn't)");
  et.alive = [false, false, true, true, false, true];
  same(vt.layout().cells, [0], "watch team, no teammate left: only your own view...");
  assert(vt.blackedOut(0, et), "... black (DESTROYED)");
  same(vt.hearAt(0, et), { mute: true }, "... and silent");
  const off = play(link + "&view=team"), vo = off.tunnelerViews(), eo = off.tunnelerEngine();
  vo.snap = { screen: "play", mode: "lores", views: eo.views || [] };
  eo.alive = [false, false, true, true, true, true];
  assert.strictEqual(vo.watchOut, "wreck", "default: wreck");
  same(vo.layout().cells, [0, 3], "wreck: the scope's views stay");
  assert(!vo.blackedOut(0, eo), "wreck: not black");
  assert.strictEqual(eo.showSettings.watchOut, "wreck");
  const bl = play(link + "&view=team&watch=black"), vb = bl.tunnelerViews(), eb = bl.tunnelerEngine();
  eb.alive = [false, false, true, true, true, true];
  assert(vb.blackedOut(0, eb) && !vb.blackedOut(3, eb), "black: the destroyed tank's view is black (DESTROYED), the living one's not");
  eb.tankX = [0, 100, 200, 300, 400, 500]; eb.tankY = [0, 10, 20, 30, 40, 50];
  same(vb.hearAt(0, eb), { mute: true }, "black: nothing heard");
  eo.tankX = eb.tankX; eo.tankY = eb.tankY; eo.killedBy = [0, 3, 0, 0, 0, 0];
  same(vo.hearAt(0, eo), { x: 100, y: 10 }, "wreck: heard at the wreck, not at the killer");
  assert(!v.blackedOut(0, e), "others: never black");
  // classic (you BLUE against GREEN): out -> GREEN's half, labeled
  {   // (watch all ignores the view limit: GREEN's half once you're out)
    const cs = play("?mode=cpu&slots=0:you:1,1:normal:2&watch=1"), csv = cs.tunnelerViews(), cse = cs.tunnelerEngine();
    csv.snap = { screen: "play", mode: "lores" }; cse.alive = [false, false, true];
    same([csv.layout().kind, csv.layout().cells], ["grid", [1]], "classic out, view self, watch all: GREEN's half");
  }
  const c = play("?mode=cpu&slots=0:you:1,1:normal:2&watch=1&view=everyone"), cv = c.tunnelerViews(), ce = c.tunnelerEngine();
  cv.snap = { screen: "play", mode: "lores" };
  ce.alive = [false, true, true];
  same(cv.layout().cells, [0, 1], "classic alive, everyone: both halves");
  ce.alive = [false, false, true];
  same([cv.layout().kind, cv.layout().cells, !!cv.layout().labels], ["grid", [1], true], "classic out, view everyone, watch all: GREEN's half");
  // you in another color: the marker follows "you"
  assert.strictEqual(play("?mode=cpu&slots=" + encodeURIComponent("0:hard:1,4:you:2")).tunnelerEngine().youPlayer, 2, "you = WHITE (player 2)");
  // split screen: two humans - no marker, no watching; the settings (size / rounds) still listed
  const h = play("?mode=hotseat&size=small"), he = h.tunnelerEngine();
  assert(he.youPlayer === null && h.tunnelerViews().watchOut === "wreck" && he.showSettings && he.showSettings.view === "self", "split screen");
  ok("after death: black = DESTROYED, wreck, others = the killer (chained, else the first alive), back next round; you marker / settings set by play.js");
}

// ---------------------------------------------------------------- a phone / tablet (touch screen without a mouse)
{
  // no split screen, no skirmish player 2 (your slot: "you"), no rule / hint at the bottom; a link's player 2 = a computer tank
  const touch = q => ({ matches: /coarse/.test(q) });          // (pointer: coarse, no fine pointer)
  const env = makeEnv("");
  Object.assign(env.win, { matchMedia: touch, innerWidth: 390, innerHeight: 844 });   // (held upright)
  env.page("index.html");
  const ui = env.win.tunnelerHomeUI(), keys = () => ui.spec.items.map(i => i.key);
  assert(!keys().includes("split") && keys().includes("cpu"), "no split screen: " + keys());
  // no highlight bar on a phone - until arrow keys (a keyboard / gamepad) move the selection
  const bars = () => { const v = ui.display.snap.vram; let n = 0; for (let k = 1; k < v.length; k += 2) if (v[k] === 0x5F) n++; return n; };
  const screenText = () => { const v = ui.display.snap.vram; let t = ""; for (let k = 0; k < v.length; k += 2) t += String.fromCharCode(v[k]); return t; };
  const desc = ui.spec.items[ui.sel].info[0];
  assert(bars() === 0, "no highlight bar on a phone: " + bars());
  // (held upright: the description wrapped - its first words; nothing below the menu without it: no empty strip)
  const start = d => d.slice(0, 12);
  assert(typeof desc === "string" && !screenText().includes(start(desc)), "no description without the bar: " + desc);
  assert.strictEqual(ui.display.snap.view.rows, ui.display.snap.rows, "no strip for the info below the menu");
  env.key("ArrowDown");
  assert(bars() > 0, "arrow keys show the highlight bar");
  assert(screenText().includes(start(ui.spec.items[ui.sel].info[0])), "and the description");
  ui.sel = keys().indexOf("cpu"); env.key("Enter");
  const row = () => ui.spec.items.find(i => i.key === "slot1");
  const seen = new Set();
  for (let i = 0; i < 8; i++) { seen.add(row().label); row().change(1); }
  const L = env.win.Lang;
  assert(![...seen].some(l => l.includes(L.t("lc.p2"))), "no player 2: " + [...seen].join(" | "));
  assert(ui.spec.items.find(i => i.key === "slot0").label.includes(L.t("lc.me")), "your slot: you");
  const snap = ui.display.snap, bottom = Array.from({ length: 80 }, (_, c) => String.fromCharCode(snap.vram[24 * 160 + c * 2])).join("");
  assert(!bottom.includes(L.t("ui.hint.touch")) && !bottom.includes("\x5F\x5F\x5F"), "no rule / hint at the bottom on a phone: " + bottom);
  // the settings on the skirmish's screen itself, between the slots and the Game box (owner, 2026-10-28)
  assert(keys().includes("mode") && keys().includes("watch") && keys().includes("slot0") && keys().includes("play") && !keys().includes("settings"),
    "the skirmish's settings on its screen: " + keys());
  assert(ui.spec.tight && ui.spec.fit && ui.narrow && ui.narrow.maxTop <= ui.narrow.minTop + 0.01, "it fits the phone (no scrolling)");
  const sizeBefore = ui.spec.items.find(i => i.key === "size").label;
  ui.sel = keys().indexOf("size"); env.key("ArrowRight");
  assert(ui.spec.items.find(i => i.key === "size").label !== sizeBefore && keys().includes("slot0"), "a setting changes, the screen stays");
  const pe = makeEnv("?mode=cpu&slots=0:you:1,1:p2:2,2:easy:2");
  pe.win.matchMedia = touch;
  pe.page("play.html");
  const e = pe.win.tunnelerEngine();
  assert(e.nPlayers === 3 && pe.win.tunnelerAIs().filter(Boolean).length === 2, "player 2 in a link: a computer tank");
  ok("a phone / tablet: no split screen, no player 2, no footer, the skirmish's settings on its screen; a link's player 2 plays as a computer tank");
}

// ---------------------------------------------------------------- the phone layout (DosUI narrow, Display zoom)
{
  const touch = q => ({ matches: /coarse/.test(q) });
  const phone = () => { const env = makeEnv(""); Object.assign(env.win, { matchMedia: touch, innerWidth: 390, innerHeight: 844 }); return env; };
  const env = phone();
  env.page("index.html");
  const ui = env.win.tunnelerHomeUI(), snap = () => ui.display.snap;
  assert(snap().view && snap().view.rows === snap().rows, "the content in a window (no info strip without info): " + JSON.stringify(snap().view));
  {                                                   // (it fits: the title through the last box in the window's middle)
    const v = snap().view, h = snap().rowH, used = r => { for (let c = 0; c < 36; c++) { const ch = snap().vram[r * 160 + c * 2]; if (ch !== 0x20 && ch !== 0) return true; } return false; };
    let first = 0;
    while (!used(first)) first++;
    const above = h.slice(0, first).reduce((a, b) => a + b, 0) - v.top, end = h.slice(0, v.rows).reduce((a, b) => a + b, 0) - v.top;
    const below = v.units + h.slice(v.rows).reduce((a, b) => a + b, 0) - end;   // (to the screen's bottom)
    assert(v.top < 0 && end <= v.units + 0.01 && (Math.abs(above - below) < 0.01 || Math.abs(end - v.units) < 0.01),
      "a screen that fits: centred on the screen (its title too), above the info: " + above + " / " + below);
  }
  assert(snap().cols === 36 && snap().rowH && snap().rowH.length === snap().rows && snap().rowH.some(m => m > 1) && snap().rowH.some(m => m === 1) && snap().rows >= 16 && snap().rows < 60, "a narrow, tall screen: " + snap().cols + " x " + snap().rows);
  const rowOf = key => +Object.keys(ui.narrow.items).find(r => ui.spec.items[ui.narrow.items[r]].key === key);
  // a tap on a row (the canvas 720 x 400 here): that item
  const tap = key => {                                // (rows of their own heights: snap.rowH; the content in a window: snap.view)
    const r = rowOf(key), h = snap().rowH, v = snap().view, total = v.units + h.slice(v.rows).reduce((a, b) => a + b, 0);
    const above = h.slice(0, r - 1).reduce((a, b) => a + b, 0) - v.top;
    return { clientX: 360, clientY: (above + h[r - 1] / 2) / total * 400 };
  };
  assert.strictEqual(ui.spec.items[ui.itemAt(tap("settings"))].key, "settings", "a tap on a row = its item");
  // a finger on an item: highlighted; a drag scrolls and that item stays highlighted, let go = nothing; let go
  // without moving = a tap (the browser's click). Put down beside the items: a drag scrolls (owner, 2026-10-27)
  {
    const cv = ui.canvas, finger = p => ({ touches: [p] }), keyAt = () => ui.spec.items[ui.sel].key;
    const bars = () => { const v = snap().vram; let n = 0; for (let k = 1; k < v.length; k += 2) if (v[k] === 0x5F) n++; return n; };
    const at = tap("settings");
    cv.fire("touchstart", finger(at));
    assert(ui.tpick && keyAt() === "settings" && ui.ndrag && bars() > 0, "a finger on Settings: highlighted, a drag may scroll");
    const top0 = ui.ntopU || 0, over = { clientX: at.clientX, clientY: at.clientY - 150 };
    cv.fire("touchmove", finger(over));
    assert(keyAt() === "settings" && bars() > 0 && ui.dragged, "dragged: Settings stays highlighted");
    assert(ui.narrow.maxTop <= ui.narrow.minTop || (ui.ntopU || 0) > top0, "the drag scrolls: " + top0 + " -> " + ui.ntopU);
    cv.fire("touchend", {});
    ui.click({ clientX: over.clientX, clientY: over.clientY });
    assert(!ui.spec.page && keyAt() === "settings" && bars() === 0, "let go after a drag: nothing chosen, no bar");
    env.key("Escape");
    ui.ntopU = 0; ui.draw();
    cv.fire("touchstart", finger(tap("info")));
    cv.fire("touchend", {});
    assert(ui.spec.page, "let go without moving (however long held - no browser click needed): Information opens");
    ui.click(tap("info"));
    assert(ui.spec.page, "the browser's click after it doesn't count again (the page stays)");
    env.key("Escape");
    cv.fire("touchstart", finger({ clientX: 2, clientY: tap("settings").clientY }));
    assert(!ui.tpick && ui.ndrag, "put down beside the items: a drag scrolls");
    cv.fire("touchend", {});
  }
  // Settings: one column of categories; one opens its own screen with Back
  // (by taps - go(): a key press here would be a keyboard's)
  const go = key => ui.spec.items.find(i => i.key === key).go(), ctlRows = () => ui.spec.items.map(i => i.key).filter(k => /^touch|^key-/.test(k));
  go("settings");
  same(ui.spec.items.map(i => i.key), ["cat-gameplay", "cat-graphics", "cat-sound", "cat-controls", "cat-online", "gap", "lang", "gap2", "back"], "the categories, Language, Back");
  assert.strictEqual(ui.spec.items[3].info[0], env.win.Lang.t("set.cat.controls.it"), "Controls: the touch controls only");
  go("cat-gameplay");
  same(ctlRows(), [], "Display: no touch controls' rows");
  go("back-cat"); go("cat-controls");
  same(ctlRows(), ["touchsize", "touchleft", "touchlook"], "Controls without a keyboard: only the touch controls");
  env.key("ArrowDown");
  assert(ctlRows().filter(k => /^key-/.test(k)).length === 10 && ctlRows().includes("touchsize"), "a keyboard's key: the keys' rows too: " + ctlRows());
  {                                                   // (a screen taller than a short phone: a drag on a row scrolls it)
    const cv = ui.canvas, finger = p => ({ touches: [p] }), keyAt = () => ui.spec.items[ui.sel].key;
    const bars = () => { const v = snap().vram; let n = 0; for (let k = 1; k < v.length; k += 2) if (v[k] === 0x5F) n++; return n; };
    env.win.innerHeight = 600; ui.draw();
    assert(ui.narrow.maxTop > 0, "Controls scrolls on a short phone");
    const at2 = tap("key-blue-left");
    cv.fire("touchstart", finger(at2));
    cv.fire("touchmove", finger({ clientX: at2.clientX, clientY: at2.clientY - 100 }));
    assert((ui.ntopU || 0) > 0 && keyAt() === "key-blue-left" && bars() > 0, "dragged on a row: scrolled " + ui.ntopU + ", the row stays highlighted");
    cv.fire("touchend", {});
    env.win.innerHeight = 844; ui.ntopU = 0; ui.draw();
  }

  env.key("Escape");
  assert.strictEqual(ui.spec.items[3].info[0], env.win.Lang.t("set.cat.controls.i"), "Controls: the keys and the touch controls");
  ui.sel = 2; env.key("Enter");
  assert(!ui.spec.items.some(i => i.key === "volume") && ui.spec.items.some(i => i.key === "stereo"), "Sound: no Volume (the phone's buttons), Stereo stays");
  env.win.localStorage.setItem("tunneler.volume", "30");
  assert.strictEqual(env.win.Speaker.getOption("volume"), 100, "the volume is always 100 on a phone");
  env.key("Escape");
  ui.sel = 1; env.key("Enter");
  assert(ui.spec.items.some(i => i.key === "gfx") && ui.spec.items[ui.spec.items.length - 1].key === "back-cat", "Graphics, with Back");
  env.key("Escape");
  assert(ui.spec.items[0].key === "cat-gameplay" && ui.spec.items[ui.sel].key === "cat-graphics", "Esc: back to the categories, on Graphics");
  // the Instructions: re-wrapped to 38 columns, scrolled by a drag (scrollPage)
  ui.sel = ui.spec.items.findIndex(i => i.key === "back"); env.key("Enter");
  ui.sel = ui.spec.items.findIndex(i => i.key === "instr"); env.key("Enter");
  assert(ui.spec.nlines && ui.spec.nlines.length > 60, "the page's rows");
  assert(ui.spec.nlines.every(l => l.t.replace(/\{\d+\}/g, "").length <= 38), "every row fits 38 columns");
  const pv = () => ui.display.snap.view;
  assert(pv() && pv().rows === ui.spec.nlines.length && pv().top === 0, "every row in a scroll window: " + JSON.stringify(pv()));
  ui.scrollPage(5);
  assert(ui.nanim && ui.nanim.to === 5, "scrolls: glides 5 rows on");
  ui.presentNarrowAt(ui.nanim.to + 0.5);
  assert.strictEqual(pv().top, 5.5, "any fraction of a row: smooth");
  env.key("Escape");
  // a selected row wider than its box: a marquee (DosUI marq / marqOff) - the row slides on, a narrower one doesn't
  {
    const long = "Long label: " + "abcdefghij".repeat(5), rowText = () => {
      const sn = ui.display.snap, r = sn.rowH ? Object.keys(ui.narrow.items).find(k => ui.narrow.items[k] === 0) - 1 : 0;
      return String.fromCharCode(...Array.from({ length: 36 }, (_, c) => sn.vram[r * 160 + c * 2]));
    };
    ui.show({ items: [{ key: "a", label: long, align: "left", go() {} }, { key: "b", label: "Short", align: "left", go() {} }], back() {} });
    assert(ui.marq && ui.marq.i === 0 && ui.marq.over === long.length - 31, "the long row selected: a marquee over " + (ui.marq && ui.marq.over) + " columns");
    const start = rowText();
    ui.marqOff = 7; ui.draw();
    assert(rowText().includes(long.slice(7, 30)) && rowText() !== start, "it slides: " + rowText());
    ui.sel = 1; ui.draw();
    assert(!ui.marq && !ui.marqTimer, "a row that fits: no marquee");
    env.key("Escape");
  }
  // the Display's zoom: an engine screen's left and right halves (a divider between) stacked 40 wide; taps map back
  const D = env.win.Display, d = new D(env.win.document.createElement("canvas"));
  const vram = new Uint8Array(16000);
  for (let i = 0; i < 4000; i++) { vram[i * 2] = 0x20; vram[i * 2 + 1] = 7; }
  const put = (c, r, t) => { for (let k = 0; k < t.length; k++) vram[r * 160 + (c + k) * 2] = t.charCodeAt(k); };
  put(4, 3, "Rematch"); put(60, 10, "Statistics");
  for (let r = 0; r < 25; r++) vram[r * 160 + 39 * 2] = 0xB3;
  d.setSnapshot({ mode: "text", screen: "text", vram });
  const z = d.zoom();
  assert(z && z.c1 - z.c0 === 40 && z.rows === 6, "stacked: " + JSON.stringify(z && { c0: z.c0, c1: z.c1, rows: z.rows }));
  same(z.at(4, 1), [4, 3], "the left half's cell"); same(z.at(20, 4), [60, 10], "the right half's cell");
  // the end of a match: the rounds, then the statistics, then the menu box (a block with a box corner) below them
  put(4, 1, "Rounds"); put(3, 5, "\xC9\xCD\xCD\xBB"); put(3, 6, "\xBAGo\xBA"); put(3, 7, "\xC8\xCD\xCD\xBC");
  d.setSnapshot({ mode: "text", screen: "text", vram: vram.slice() });
  const m = d.zoom(), zRow = txt => { for (let r = 0; r < m.rows; r++) if (String.fromCharCode(...Array.from({ length: 40 }, (_, k) => m.vram[r * 160 + k * 2])).includes(txt)) return r; return -1; };
  assert(zRow("Rounds") >= 0 && zRow("Rounds") < zRow("Statistics") && zRow("Statistics") < zRow("Go"),
    "rounds, statistics, menu: " + ["Rounds", "Statistics", "Go"].map(zRow));
  same(m.at(4, zRow("Go")), [4, 6], "a tap on the menu");
  // a centred screen (a line across the middle, no gutter): cropped to its rows, not stacked
  const w = new Uint8Array(16000);
  for (let i = 0; i < 4000; i++) { w[i * 2] = 0x20; w[i * 2 + 1] = 7; }
  const t = "ROUND 1 - a settings line across the middle of the whole screen";
  for (let k = 0; k < t.length; k++) w[12 * 160 + (8 + k) * 2] = t.charCodeAt(k);
  d.setSnapshot({ mode: "text", screen: "text", vram: w });
  const c = d.zoom();
  assert(c && c.rows === 3 && c.c0 === 7 && c.c1 === 8 + t.length + 1, "a centred screen: cropped - " + JSON.stringify(c && { c0: c.c0, c1: c.c1, rows: c.rows }));
  ok("the phone layout: a narrow tall screen, taps on its rows, Settings one column + Back, the Instructions re-wrapped, engine screens zoomed (crop / halves stacked)");
}

// ---------------------------------------------------------------- play.js: "Watch the replay" after a match
// (owner, 2026-10-28: replays not saved by themselves - "Save the replay" after the match, or Replays' "Save every match")
(async () => {
  const after = async auto => {
    const st = new Map(auto ? [["tunneler.replays.auto", "1"]] : []);
    const env = makeEnv("?mode=cpu&slots=" + encodeURIComponent("0:you:1,1:normal:2") + "&size=small&lv=2", st);
    env.page("play.html");
    const e = env.win.tunnelerEngine();
    e.screen = "map";
    env.win.tunnelerRunner().recorder.stepped();             // (the match reached its world map: its replay is done)
    e.screen = "text"; e.over = true;
    env.win.tunnelerRunner().onStep(e);
    await new Promise(r => setTimeout(r, 20));
    return { env, st, ui: env.win.tunnelerAfter() };
  };
  {
    const { env, ui } = await after(true);
    assert.strictEqual(ui.spec.items.map(it => it.key).join(), "rematch,replay,gap,back", "Rematch, Watch the replay, Back");
    assert.strictEqual((await env.win.Replay.list()).length, 1, "saved by itself");
    ok("play.js: \"Save every match\" on - the replay saved by itself, the menu: Rematch, Watch the replay, Back");
  }
  {
    const { env, ui } = await after(false);
    assert.strictEqual(ui.spec.items.map(it => it.key).join(), "rematch,replay,save,gap,back", "Rematch, Watch the replay, Save the replay, Back");
    assert.strictEqual((await env.win.Replay.list()).length, 0, "not saved yet");
    const save = () => ui.spec.items.find(it => it.key === "save");
    assert.strictEqual(save().label, "Save the replay");
    save().go();
    await new Promise(r => setTimeout(r, 20));
    assert.strictEqual(save().label, "Replay saved");
    assert.strictEqual((await env.win.Replay.list()).length, 1, "saved");
    ok("play.js: off (the default) - \"Save the replay\" saves it, then says \"Replay saved\"");
  }
  const { env, st, ui } = await after(false);
  const id = env.win.tunnelerAfter() && (await env.win.Replay.list()).length === 0 && ui.spec.items.find(it => it.key === "replay");
  assert(id, "unsaved");
  ui.spec.items.find(it => it.key === "replay").go();
  await new Promise(r => setTimeout(r, 20));
  assert(/^\/replays\/[a-z0-9]+\?from=cpu$/.test(env.win.location.href), "its replay, from the skirmish: " + env.win.location.href);
  assert(await env.win.Replay.get(env.win.location.href.split("/")[2].split("?")[0]), "watched unsaved: from the page's memory");
  assert.strictEqual(st.get("tunneler.cpu.size"), "small", "the game's settings kept (Back comes back to them)");
  ok("play.js: after a match \"Watch the replay\" opens its replay (Back: the skirmish)");
  console.log("all " + n + " passed");
})().catch(err => { console.error(err); process.exit(1); });
