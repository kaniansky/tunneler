"use strict";
// Gamepads and touch controls (src/js/pads.js): they only make keys - synthesized KeyboardEvents - so
// these checks drive a mocked navigator.getGamepads() and synthesized pointer events and look at what
// input.js's Keyboard holds / queues (the PC scan codes the engine gets), what online.js sends as held
// bits and what the pre-game lobby (DosUI) does with them; and that the pages load pads.js.
//   node test/input-check.js
const assert = require("assert");
const fs = require("fs"), path = require("path"), vm = require("vm");
const SRC = path.join(__dirname, "..", "src");
const { langBundle } = require("../server.js");
const script = f => f === "js/langs.js" ? langBundle(path.join(SRC, "lang")) : fs.readFileSync(path.join(SRC, f), "utf8");

let n = 0;
const ok = msg => { n++; console.log("  ok  " + msg); };
// (values made inside the page vm have other prototypes: compare as JSON)
const same = (a, b, msg) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), msg);
const wait = ms => new Promise(r => setTimeout(r, ms));

class KeyboardEvent {
  constructor(type, init) {
    Object.assign(this, { type, target: {}, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, repeat: false }, init);
    this.isTrusted = false;
  }
  preventDefault() { this.defaultPrevented = true; }
}
// a minimal element: listeners, classList, a fixed box (the joystick base is 100 x 100 at 0, 0)
function mkEl(tag) {
  const on = {}, classes = new Set();
  return { tagName: String(tag).toUpperCase(), style: {}, hidden: false, children: [], textContent: "", width: 720, height: 400,
    classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c), toggle() {} },
    appendChild(c) { this.children.push(c); return c; }, setAttribute() {},
    addEventListener: (t, f) => (on[t] = on[t] || []).push(f),
    dispatch(t, props) { const e = Object.assign({ type: t, cancelable: true, preventDefault() {} }, props); for (const f of on[t] || []) f(e); },
    setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    getContext: () => ({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }) };
}
// a window with the page scripts' globals, gamepads = what navigator.getGamepads() returns
function makeEnv(search, opts = {}) {
  const listeners = {}, elements = {}, ls = new Map();
  const gamepads = [];
  const body = mkEl("body");
  const document = { title: "", body, getElementById: id => elements[id] || (elements[id] = mkEl("canvas")), createElement: mkEl,
    createDocumentFragment: () => mkEl("frag") };
  const sockets = [];
  class FakeWS {
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 0); }
    send(m) { this.sent.push(JSON.parse(m)); }
    close() { this.readyState = 3; }
    recv(m) { this.onmessage({ data: JSON.stringify(m) }); }
  }
  const win = {
    document, location: { search, pathname: "/", hash: "", protocol: "http:", host: "localhost:8050", origin: "http://localhost:8050", href: "" },
    localStorage: { getItem: k => ls.has(k) ? ls.get(k) : null, setItem: (k, v) => ls.set(k, String(v)), removeItem: k => ls.delete(k) },
    navigator: { getGamepads: () => gamepads.slice() },
    addEventListener: (t, f) => (listeners[t] = listeners[t] || []).push(f),
    dispatchEvent: e => { for (const f of listeners[e.type] || []) f(e); return true; },
    KeyboardEvent,
    requestAnimationFrame: opts.raf ? f => setTimeout(() => f(performance.now()), 16) : () => 0, cancelAnimationFrame() {},
    WebSocket: FakeWS, performance, setTimeout, setInterval: opts.timers ? setInterval : () => 0, clearTimeout, clearInterval,
    console, URLSearchParams, Math, atob, Buffer, Uint8Array, history: { replaceState() {} },
    fetch: async () => ({ ok: true, json: async () => [] }),
  };
  win.window = win; win.globalThis = win;
  const ctx = vm.createContext(win);
  const load = f => vm.runInContext(script(f), ctx, { filename: f });
  const page = p => { for (const [, f] of fs.readFileSync(path.join(SRC, p), "utf8").matchAll(/<script src="\/([^"]+)"/g)) load(f); };
  return { win, ctx, load, page, gamepads, sockets, listeners, body };
}
// a standard-mapping gamepad: buttons pressed by index, axes [lx, ly, rx, ry]
const pad = (index, pressed = [], axes = [0, 0, 0, 0]) => ({ index, connected: true, mapping: "standard", axes,
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })) });
const held = kb => [...kb.keyDown()].map((v, i) => v ? i : -1).filter(i => i >= 0);
const SC = { W: 0x11, A: 0x1E, X: 0x2D, D: 0x20, BLUEFIRE: 0x1D, GREENFIRE: 0x1C, UP: 0x48, DOWN: 0x50, LEFT: 0x4B, RIGHT: 0x4D, ESC: 0x01 };

(async () => {
  // ------------------------------------------------------------ the 8 directions
  {
    const env = makeEnv("");
    env.load("js/pads.js");
    const P = env.win.Pads;
    const dir = (x, y, dead = 0.3) => { const d = P.dirOf(x, y, dead); return ["up", "down", "left", "right"].filter(k => d[k]).join("+"); };
    assert.strictEqual(dir(1, 0), "right"); assert.strictEqual(dir(-1, 0), "left");
    assert.strictEqual(dir(0, -1), "up"); assert.strictEqual(dir(0, 1), "down");
    assert.strictEqual(dir(0.7, -0.7), "up+right"); assert.strictEqual(dir(-0.7, -0.7), "up+left");
    assert.strictEqual(dir(0.7, 0.7), "down+right"); assert.strictEqual(dir(-0.7, 0.7), "down+left");
    assert.strictEqual(dir(0.9, -0.3), "right", "22 degrees off: still straight");
    assert.strictEqual(dir(0.2, 0.1), "", "inside the dead zone"); assert.strictEqual(dir(0, 0, 0), "");
    ok("8 directions from a vector, dead zone");
  }

  // ------------------------------------------------------------ gamepads -> keyboard keys (split screen)
  {
    const env = makeEnv("");
    env.load("js/input.js"); env.load("js/pads.js");
    const kb = new env.win.Keyboard(env.win);
    let menu = false;
    const ctl = env.win.Pads.start({ raf: false, menu: () => menu, gamepadSet: i => ["blue", "green"][i] || null });
    const gp = env.gamepads;
    gp[0] = pad(0, [0], [-0.8, -0.8, 0, 0]);            // pad 1: stick up-left + A
    gp[1] = pad(3, [15, 7]);                              // pad 2 (another index): d-pad right + right trigger
    let t = 1000;
    ctl.poll(t);
    same(held(kb), [SC.W, SC.GREENFIRE, SC.BLUEFIRE, SC.A, SC.RIGHT],
      "pad 1 = BLUE (W A + fire), pad 2 = GREEN (right + fire): " + held(kb));
    gp[0] = pad(0, [], [0.1, 0.2, 0, 0]);                  // inside the dead zone, released
    ctl.poll(t + 50);
    assert(held(kb).includes(SC.W), "a release waits until the key was held for MIN_HOLD");
    ctl.poll(t + 200);
    same(held(kb), [SC.GREENFIRE, SC.RIGHT], "BLUE released: " + held(kb));
    gp[1] = pad(3, [13]);                                   // d-pad down
    ctl.poll(t + 400);
    same(held(kb), [SC.DOWN]);
    gp[0] = pad(0, [9]); gp[1] = pad(3);                    // Start: Esc (held: the engine ends a local match)
    ctl.poll(t + 600);
    same(held(kb), [SC.ESC]);
    gp[0] = pad(0); ctl.poll(t + 800);
    same(held(kb), []);
    gp[0] = pad(0, [], [0, 0, 0, 0]);
    gp[0].mapping = ""; gp[0].buttons.length = 12; gp[0].axes = [0, 0, 0, 0, 0, 0, 1, -1];   // non-standard: d-pad on axes 6 / 7
    ctl.poll(t + 1000);
    same(held(kb), [SC.W, SC.D].sort((a, b) => a - b), "d-pad axes: " + held(kb));
    gp[0] = pad(0); ctl.poll(t + 1200);
    gp[1] = pad(3, [5]); ctl.poll(t + 1300);                // RB fires too
    same(held(kb), [SC.GREENFIRE]);
    gp.length = 1; ctl.poll(t + 1310);                      // pad 2 unplugged: its keys are let go
    same(held(kb), [], "disconnect releases");
    kb.takeKeys();
    ok("gamepads: 1 = BLUE (W A S D + fire), 2 = GREEN (arrows + Enter), stick dead zone, triggers, Start = Esc, taps held 2+ ticks, d-pad axes, unplug");

    // menus: d-pad = arrows (held: repeat), A = Enter, B = Esc
    menu = true; t = 5000; ctl.poll(t - 100);         // (switching to a menu with nothing held)
    gp[0] = pad(0, [13]); ctl.poll(t);
    same(kb.takeKeys(), [[0, SC.DOWN, false]], "menu: d-pad down = ArrowDown");
    ctl.poll(t + 300); same(kb.takeKeys(), [], "no repeat before 400 ms");
    ctl.poll(t + 420); ctl.poll(t + 600);
    same(kb.takeKeys(), [[0, SC.DOWN, true], [0, SC.DOWN, true]], "held: auto-repeat (flagged)");
    gp[0] = pad(0); ctl.poll(t + 700);
    gp[0] = pad(0, [0]); ctl.poll(t + 900);
    gp[0] = pad(0); ctl.poll(t + 1100);
    gp[0] = pad(0, [1]); ctl.poll(t + 1200);
    gp[0] = pad(0); ctl.poll(t + 1400);
    gp[0] = pad(0, [], [0, -1, 0, 0]); ctl.poll(t + 1500);
    same(kb.takeKeys(), [[13, SC.GREENFIRE, false], [27, SC.ESC, false], [0, SC.UP, false]], "A = Enter, B = Esc, stick = arrows");
    gp[0] = pad(0); ctl.poll(t + 1700);
    // fire held while the round ends: no Enter on the next screen until it is released
    menu = false; gp[0] = pad(0, [0]); ctl.poll(t + 2000);
    same(held(kb), [SC.BLUEFIRE]);
    menu = true; ctl.poll(t + 2200);
    same(held(kb), [], "fire let go");
    ctl.poll(t + 2400);
    assert(!kb.takeKeys().some(k => k[1] === SC.GREENFIRE), "held A does not press Enter on the menu");
    gp[0] = pad(0); ctl.poll(t + 2500); gp[0] = pad(0, [0]); ctl.poll(t + 2600);
    assert(kb.takeKeys().some(k => k[0] === 13), "pressed again: Enter");
    ok("gamepad in menus: arrows (repeat), A = Enter, B = Esc; a button held across play -> menu acts only after release");
  }

  // ------------------------------------------------------------ touch: joystick + FIRE -> keys
  {
    const env = makeEnv("");
    env.load("js/lang.js"); env.load("js/langs.js"); env.load("js/input.js"); env.load("js/pads.js");
    const kb = new env.win.Keyboard(env.win);
    let menu = false;
    const ctl = env.win.Pads.start({ raf: false, menu: () => menu, touchSet: "blue" });
    const tc = ctl.touch;
    assert(tc && env.body.children.includes(tc.root) && tc.root.hidden, "controls added, hidden until touched");
    for (const f of env.listeners.pointerdown) f({ pointerType: "touch" });
    assert(!tc.root.hidden && env.body.classList.contains("touch"), "first touch shows them");
    assert.strictEqual(tc.fireBtn.textContent, "FIRE");
    const now = () => performance.now();
    const stick = (type, x, y, id = 1) => tc.base.dispatch(type, { pointerId: id, pointerType: "touch", clientX: x, clientY: y });
    stick("pointerdown", 100, 50);                                  // base 100 x 100: right edge
    same(held(kb), [SC.D], "right: " + held(kb));
    stick("pointermove", 85, 15);                                   // up-right
    ctl.poll(now() + 200);
    same(held(kb), [SC.W, SC.D].sort((a, b) => a - b), "up-right: " + held(kb));
    stick("pointermove", 10, 90); ctl.poll(now() + 400);            // down-left: S = the original's X key
    same(held(kb), [SC.A, SC.X].sort((a, b) => a - b), "down-left: " + held(kb));
    stick("pointermove", 55, 52); ctl.poll(now() + 600);            // back in the dead zone
    same(held(kb), [], "dead zone");
    stick("pointermove", 50, -400); ctl.poll(now() + 800);          // far outside the base: clamped, still up
    same(held(kb), [SC.W]);
    assert(/translate\(0\.0px, -30\.0px\)/.test(tc.knob.style.transform), "knob drawn at the edge: " + tc.knob.style.transform);
    tc.fireBtn.dispatch("pointerdown", { pointerId: 2, pointerType: "touch" });      // second finger: FIRE
    same(held(kb), [SC.W, SC.BLUEFIRE].sort((a, b) => a - b), "move + fire: " + held(kb));
    stick("pointerup", 50, -400);
    tc.fireBtn.dispatch("pointerup", { pointerId: 2 });
    ctl.poll(now() + 1000);
    same(held(kb), [], "all released");
    tc.escBtn.dispatch("pointerdown", { pointerId: 3 });
    same(held(kb), [SC.ESC], "ESC");
    tc.escBtn.dispatch("pointerup", { pointerId: 3 }); ctl.poll(now() + 1200);
    kb.takeKeys();
    menu = true; ctl.poll(now() + 1300);
    stick("pointerdown", 50, 100);                                  // menu: down = ArrowDown
    stick("pointerup", 50, 100); ctl.poll(now() + 200);
    tc.fireBtn.dispatch("pointerdown", { pointerId: 4 });           // FIRE = Enter on a menu
    tc.fireBtn.dispatch("pointerup", { pointerId: 4 }); ctl.poll(now() + 200);
    same(kb.takeKeys(), [[0, SC.DOWN, false], [13, SC.GREENFIRE, false]], "menu: joystick = arrows, FIRE = Enter");
    // labels in every language
    for (const code of env.win.Lang.codes) {
      for (const k of ["touch.fire", "touch.esc"]) assert(env.win.Lang.data[code][k], code + " " + k);
    }
    ok("touch: joystick (8 directions, dead zone, clamped) + FIRE + ESC -> BLUE's keys; menus: arrows / Enter; shown on the first touch; labels in every language");
  }

  // ------------------------------------------------------------ the pages
  for (const p of ["play.html", "online.html"]) {
    const html = fs.readFileSync(path.join(SRC, p), "utf8");
    assert(/<script src="\/js\/input\.js"><\/script>\s*<script src="\/js\/pads\.js"><\/script>/.test(html), p + " loads pads.js");
    assert(/user-scalable=no/.test(html), p + ": no zoom");
  }
  for (const p of ["index.html", "lobby.html"]) assert(/<script src="\/js\/pads\.js" data-menu><\/script>/.test(fs.readFileSync(path.join(SRC, p), "utf8")), p);
  {
    // play.html: split screen - gamepad 1 drives BLUE, 2 GREEN, in the engine's own input (classicInput)
    const env = makeEnv("?mode=hotseat");
    env.page("play.html");
    const e = env.win.tunnelerEngine();
    assert(e && !e.extended, "play.html loads (hotseat)");
    ok("pages load pads.js (play / online: the tank; index / lobby: menus), no zoom on the game pages");
  }

  // ------------------------------------------------------------ online.html: a gamepad -> held bits, lobby keys
  {
    const env = makeEnv("?room=test&role=blue", { raf: true, timers: true });
    env.page("online.html");
    await wait(20);
    const ws = env.sockets[0];
    ws.recv({ t: "hello", id: "test", name: "Test", role: "blue", seed: 1234, created: 1, n: 500, from: 0, f: [[0, 0, 5], [0, 0, 1, [[0, 0, 0x3B]]], [0, 0, 494]] });
    ws.recv({ t: "st", blue: true, green: true, spec: 0, running: true, n: 500 });
    await wait(400);
    assert.strictEqual(env.win.tunnelerEngine().screen, "play", "in play");
    env.gamepads[0] = pad(0, [7], [0.9, -0.9, 0, 0]);             // up-right + right trigger
    await wait(80);
    assert(ws.sent.some(m => m.t === "b" && m.v === (1 | 8 | 16)), "held bits UP | RIGHT | FIRE: " + JSON.stringify(ws.sent.filter(m => m.t === "b")));
    env.gamepads[0] = pad(0);
    await wait(200);
    assert.strictEqual(ws.sent.filter(m => m.t === "b").pop().v, 0, "released");
    assert(!ws.sent.some(m => m.t === "k"), "no keystrokes during play");
    env.gamepads[0] = pad(0, [9]); await wait(80);                 // Start = Esc: the "Esc again" notice, no bit
    assert(!ws.sent.some(m => m.t === "b" && (m.v & 32)), "Esc is not a held bit online");
    assert(env.win.tunnelerViews().noticeText, "Esc once: the leave notice");
    env.gamepads.length = 0; await wait(200);
    ok("online.html: a gamepad sends the keyboard's held bits (UP | RIGHT | FIRE), Start = Esc (leave notice)");
  }
  {
    // the pre-game lobby (DosUI): d-pad moves the selection
    const env = makeEnv("?room=lob&role=cyan", { raf: true, timers: true });
    env.page("online.html");
    await wait(20);
    const ws = env.sockets[0];
    const slots = [{ color: 0, bot: false, level: null, team: 1 }, { color: 2, bot: false, level: null, team: 2 }];
    ws.recv({ t: "hello", id: "lob", name: "Lobby", role: "cyan", seed: 99, created: 1, n: 3, from: 0, f: [[[0, 0], 3]],
      cfg: { ext: true, players: 2, slots, size: "small", winScore: 2, friendlyFire: false }, you: { slot: 1, host: false, k: 2 } });
    ws.recv({ t: "st", running: true, n: 3, spec: 0, conn: [true, true], ready: [false, false],
      slots: slots.map((s, i) => ({ color: s.color, kind: "human", level: null, name: "", team: s.team, ready: false, connected: true, joined: true, ping: 20, host: false })), specs: [] });
    await wait(300);
    const lui = env.win.tunnelerLobbyUI();
    const key = () => lui.spec.items[lui.sel].key;
    assert.strictEqual(key(), "start");
    env.gamepads[0] = pad(0, [12]); await wait(60);                 // d-pad up
    env.gamepads[0] = pad(0); await wait(200);
    assert.notStrictEqual(key(), "start", "d-pad up moved the selection: " + key());
    env.gamepads[0] = pad(0, [13]); await wait(60);
    env.gamepads[0] = pad(0); await wait(200);
    assert.strictEqual(key(), "start");
    env.gamepads[0] = pad(0, [0]); await wait(60);                  // A = Enter: ready
    env.gamepads[0] = pad(0); await wait(200);
    assert(ws.sent.some(m => m.t === "ready" && m.v === 1), "A = Enter: ready sent");
    assert(!ws.sent.some(m => m.t === "b" && m.v), "no held bits in the lobby");
    env.gamepads.length = 0;
    ok("online pre-game lobby (DosUI): d-pad moves, A selects, no held bits");
  }

  console.log(n + " input checks passed");
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
