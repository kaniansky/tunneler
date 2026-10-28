"use strict";
// Gamepads and touch controls (src/js/io/pads.js): they only make keys - synthesized KeyboardEvents - so
// these checks drive a mocked navigator.getGamepads() and synthesized pointer events and look at what
// input.js's Keyboard holds / queues (the PC scan codes the engine gets), what online.js sends as held
// bits and what the pre-game lobby (DosUI) does with them; and that the pages load pads.js.
//   node test/input-check.js
const assert = require("assert");
const fs = require("fs"), path = require("path"), vm = require("vm");
const SRC = path.join(__dirname, "..", "src");
const { run, runPage, modulesOf, ROUTES, APP } = require("./page-env.js");
// what every key gave before key remapping (controls.js) existed - recorded from that version: the keyboard's
// held scan codes / keystrokes and play.html's engine input; the default mapping must give exactly these
const BEFORE = require("./fixtures/keys-before-controls.json");

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
  stopPropagation() { this.stopped = true; }
  stopImmediatePropagation() { this.stopped = true; }
}
// a minimal element: listeners, classList, a fixed box (the joystick base is 100 x 100 at 0, 0)
function mkEl(tag) {
  const on = {}, classes = new Set();
  return { tagName: String(tag).toUpperCase(), style: {}, hidden: false, children: [], textContent: "", width: 720, height: 400,
    classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c), toggle: (c, on) => (on === undefined ? !classes.has(c) : on) ? (classes.add(c), true) : (classes.delete(c), false) },
    appendChild(c) { this.children.push(c); return c; }, setAttribute() {},
    addEventListener: (t, f) => (on[t] = on[t] || []).push(f),
    dispatch(t, props) { const e = Object.assign({ type: t, cancelable: true, preventDefault() {} }, props); for (const f of on[t] || []) f(e); },
    setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    getContext: () => ({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }) };
}
// a window with the page scripts' globals, gamepads = what navigator.getGamepads() returns
function makeEnv(search, opts = {}) {
  const listeners = {}, elements = {}, ls = new Map([["tunneler.name", "Pad"]]);   // (online play needs a name)
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
    // (window capture listeners run first, as when a real key event comes down to the focused element)
    addEventListener: (t, f, o) => (listeners[t] = listeners[t] || []).push(Object.assign(f, { capture: o === true || !!(o && o.capture) })),
    removeEventListener: (t, f) => { const l = listeners[t] || [], i = l.indexOf(f); if (i >= 0) l.splice(i, 1); },
    dispatchEvent: e => {
      const l = listeners[e.type] || [];
      for (const f of [...l.filter(f => f.capture), ...l.filter(f => !f.capture)]) { if (e.stopped) break; if (l.includes(f)) f(e); }
      return true;
    },
    KeyboardEvent,
    requestAnimationFrame: opts.raf ? f => setTimeout(() => f(performance.now()), 16) : () => 0, cancelAnimationFrame() {},
    WebSocket: FakeWS, performance, setTimeout, setInterval: opts.timers ? setInterval : () => 0, clearTimeout, clearInterval,
    console, URLSearchParams, Math, atob, Buffer, Uint8Array, history: { replaceState() {} },
    fetch: async () => ({ ok: true, json: async () => [] }),
  };
  win.window = win; win.globalThis = win;
  const ctx = vm.createContext(win);
  // (modules loaded together share one instance each: one load per environment)
  const load = (...files) => run(ctx, files);
  const page = p => runPage(ctx, p);
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
    env.load("js/io/pads.js");
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

  // ------------------------------------------------------------ "Gamepad 1 connected" (+ its tank in split screen)
  {
    const env = makeEnv("");
    env.load("js/io/input.js", "js/io/pads.js");
    const ctl = env.win.Pads.start({ raf: false, menu: () => false, namedSets: true, gamepadSet: i => ["blue", "green"][i] || null });
    const toast = () => env.win.document.body.children.find(c => c.className === "pad-toast");
    ctl.poll(100);
    assert(!toast(), "no gamepad: no message");
    env.gamepads[0] = pad(0, [0]);
    ctl.poll(200);
    assert(toast() && !toast().hidden && /^Gamepad 1 connected: BLUE$/i.test(toast().textContent), "connected: " + (toast() && toast().textContent));
    env.gamepads[1] = pad(1, [0]);
    ctl.poll(300);
    assert(/^Gamepad 2 connected: GREEN$/i.test(toast().textContent), "the second: " + toast().textContent);
    env.gamepads.length = 1;
    ctl.poll(400);
    assert.strictEqual(toast().textContent, "Gamepad 2 disconnected");
    const env2 = makeEnv("");                              // (vs computer / online: no tank name)
    env2.load("js/io/input.js", "js/io/pads.js");
    const c2 = env2.win.Pads.start({ raf: false, menu: () => false, gamepadSet: () => "blue" });
    env2.gamepads[0] = pad(0); c2.poll(100);
    assert.strictEqual(env2.win.document.body.children.find(c => c.className === "pad-toast").textContent, "Gamepad 1 connected");
    ok("a gamepad appearing / going away: \"Gamepad 1 connected (: BLUE)\" / \"... disconnected\"");
  }

  // ------------------------------------------------------------ gamepads -> keyboard keys (split screen)
  {
    const env = makeEnv("");
    env.load("js/io/input.js", "js/io/pads.js");
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
    // Y = Tab, LB / RB = [ ], LT / RT = - + (the map editor's tool, brush, zoom)
    const sent = [], ctl2 = env.win.Pads.start({ raf: false, menu: () => true, emit: (type, code) => { if (type === "keydown") sent.push(code); } });
    gp[0] = pad(0); ctl2.poll(t + 3000);
    for (const [b, k] of [[3, 9], [4, 10], [5, 11], [6, 12], [7, 13]]) { gp[0] = pad(0, [b]); ctl2.poll(t + 3000 + k * 400); gp[0] = pad(0); ctl2.poll(t + 3000 + k * 400 + 200); }
    same(sent, ["Tab", "BracketLeft", "BracketRight", "Minus", "Equal"], "Y, LB, RB, LT, RT: " + sent);
    ok("gamepad in menus: arrows (repeat), A = Enter, B = Esc, Y = Tab, LB / RB = [ ], LT / RT = - +; a button held across play -> menu acts only after release");
  }

  // ------------------------------------------------------------ SCORE (touch) / Back (gamepad) = Tab during play
  {
    const env = makeEnv("");
    env.load("lang/index.js", "js/io/input.js", "js/io/pads.js");
    const kb = new env.win.Keyboard(env.win);
    let menu = false;
    const ctl = env.win.Pads.start({ raf: false, menu: () => menu, touchSet: "blue", statsLabel: "touch.stats" });
    const tc = ctl.touch, now = () => performance.now();
    assert(tc.statsBtn && tc.statsBtn.textContent === "SCORE" && tc.statsBtn.className === "tpad-stats", "a SCORE button");
    tc.statsBtn.dispatch("pointerdown", { pointerId: 5, pointerType: "touch" });
    same(held(kb), [0x0F], "held SCORE = Tab held (the statistics - never fire): " + held(kb));
    tc.statsBtn.dispatch("pointerup", { pointerId: 5 }); ctl.poll(now() + 500);
    same(held(kb), [], "let go: Tab let go");
    kb.takeKeys();
    const sent = [], pad = new env.win.Pads.VirtualPad((type, code) => sent.push(type + " " + code));
    const st = Object.assign(env.win.Pads.readGamepad({ mapping: "standard", buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: i === 8 })), axes: [0, 0] }));
    assert(st.stats && !st.fire, "gamepad Back / Select: stats, not fire");
    pad.update(st, false, "blue", 0);
    same(sent, ["keydown Tab"], "gamepad Back during play = Tab");
    ok("SCORE (touch, held) and a gamepad's Back / Select = Tab held during play (the statistics), never fire");
  }

  // ------------------------------------------------------------ touch: joystick + FIRE -> keys
  {
    const env = makeEnv("");
    env.load("lang/index.js", "js/io/input.js", "js/io/pads.js");
    const kb = new env.win.Keyboard(env.win);
    let menu = false;
    // (the tank look: a fake tankview.js provider - the game's tank faces down; its paintings counted)
    const paints = [], pic = { key: "tank", dir: 4, paint: (cv, d) => paints.push(d) };
    let dead = false;
    const ctl = env.win.Pads.start({ raf: false, menu: () => menu, touchSet: "blue", touchTank: () => pic, touchDead: () => dead });
    const tc = ctl.touch;
    assert(tc && env.body.children.includes(tc.root) && tc.root.hidden, "controls added, hidden until touched");
    for (const f of env.listeners.pointerdown) f({ pointerType: "touch" });
    assert(!tc.root.hidden && env.body.classList.contains("touch"), "first touch shows them");
    assert.strictEqual(tc.fireBtn.children[0].textContent, "FIRE");
    assert(/^<svg/.test(tc.fireBtn.children[2].innerHTML), "the modern graphics' shell (SVG)");
    const now = () => performance.now();
    const stick = (type, x, y, id = 1) => tc.base.dispatch(type, { pointerId: id, pointerType: "touch", clientX: x, clientY: y });
    stick("pointerdown", 100, 50);                                  // base 100 x 100: right edge
    same(held(kb), [SC.D], "right: " + held(kb));
    assert(tc.base.classList.contains("go") && tc.dir === 2 && tc.painted[1] === 2, "right: the ring's sector 2 lit, the tank faces right");
    stick("pointermove", 85, 15);                                   // up-right
    ctl.poll(now() + 200);
    same(held(kb), [SC.W, SC.D].sort((a, b) => a - b), "up-right: " + held(kb));
    assert(tc.dir === 1 && tc.painted[0] === "tank" && tc.painted[1] === 1 && paints[paints.length - 1] === 1, "up-right: sector 1, the tank turned");
    stick("pointermove", 10, 90); ctl.poll(now() + 400);            // down-left: S = the original's X key
    same(held(kb), [SC.A, SC.X].sort((a, b) => a - b), "down-left: " + held(kb));
    stick("pointermove", 55, 52); ctl.poll(now() + 600);            // back in the dead zone
    same(held(kb), [], "dead zone");
    assert(!tc.base.classList.contains("go") && tc.dir === -1 && tc.painted[1] === 2, "dead zone: nothing lit, the tank already faces the push (right)");
    stick("pointermove", 50, -400); ctl.poll(now() + 800);          // far outside the base: clamped, still up
    same(held(kb), [SC.W]);
    assert(/translate\(0\.0px, -30\.0px\)/.test(tc.knob.style.transform), "knob drawn at the edge: " + tc.knob.style.transform);
    tc.fireBtn.dispatch("pointerdown", { pointerId: 2, pointerType: "touch" });      // second finger: FIRE
    same(held(kb), [SC.W, SC.BLUEFIRE].sort((a, b) => a - b), "move + fire: " + held(kb));
    dead = true; ctl.poll(now() + 900);                             // the tank destroyed: nothing held, no joystick / FIRE
    same(held(kb), [], "destroyed: released");
    assert(tc.root.classList.contains("dead") && tc.state().fire === false && tc.state().up === false, "destroyed: class dead, no input");
    tc.fireBtn.dispatch("pointerdown", { pointerId: 9, pointerType: "touch" }); ctl.poll(now() + 950);
    same(held(kb), [], "destroyed: FIRE does nothing");
    tc.fireBtn.dispatch("pointerup", { pointerId: 9 });
    dead = false; ctl.poll(now() + 980);
    assert(!tc.root.classList.contains("dead"), "alive again (a new round): back");
    stick("pointerdown", 50, -400);
    tc.fireBtn.dispatch("pointerdown", { pointerId: 2, pointerType: "touch" });
    stick("pointerup", 50, -400);
    tc.fireBtn.dispatch("pointerup", { pointerId: 2 });
    ctl.poll(now() + 1000);
    same(held(kb), [], "all released");
    assert.strictEqual(tc.painted[1], 4, "let go: the tank faces as the game's (down)");
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
      for (const k of ["touch.fire", "touch.esc", "touch.quit", "touch.leave", "touch.stats"]) assert(env.win.Lang.data[code][k], code + " " + k);
    }
    assert(!tc.statsBtn && !env.body.children.some(c => c !== tc.root && /tpad-stats/.test(c.className || "")), "no SCORE button unless asked for");
    ok("touch: joystick (8 directions, dead zone, clamped) + FIRE + ESC -> BLUE's keys; menus: arrows / Enter; shown on the first touch; labels in every language");
  }

  // ------------------------------------------------------------ controls.js: remappable tank keys
  const kev = (win, type, code, init = {}) => win.dispatchEvent(new KeyboardEvent(type, Object.assign({ code, key: code }, init)));
  const press = (win, code) => kev(win, "keydown", code);
  const release = (win, code) => kev(win, "keyup", code);
  {
    const env = makeEnv("");
    env.load("js/io/controls.js", "js/io/input.js");
    const C = env.win.Controls, SCAN = env.win.SCAN;
    same(C.SETS, ["blue", "green"]); same(C.ACTIONS, ["up", "down", "left", "right", "fire"]);
    same(C.SETS.map(s => C.ACTIONS.map(a => C.get(s, a))),
      [["KeyW", "KeyS", "KeyA", "KeyD", "ShiftLeft"], ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter"]], "defaults");
    assert(C.isDefault());
    // what can be assigned: input.js's keys without Escape and the lock keys; never F keys / Meta
    for (const code of Object.keys(SCAN))
      assert.strictEqual(C.assignable(code), !["Escape", "Tab", "CapsLock", "NumLock", "ScrollLock"].includes(code), code);
    for (const code of ["Escape", "F1", "F5", "F12", "MetaLeft", "OSLeft", "ContextMenu", "", null, undefined, "Bogus"])
      assert(!C.assignable(code), "not assignable: " + code);
    for (const code of ["KeyQ", "Digit5", "Space", "Enter", "ArrowUp", "Numpad5", "NumpadEnter", "ShiftRight", "ControlLeft", "ControlRight", "AltLeft", "AltRight"])
      assert(C.assignable(code), "assignable: " + code);
    assert(!C.assignable("Tab"), "Tab: the statistics, never a tank's key");
    // labels: short, plain
    const L = { KeyW: "W", Digit5: "5", Space: "Space", Enter: "Enter", Tab: "Tab", ShiftLeft: "L Shift", ShiftRight: "R Shift",
      ControlLeft: "L Ctrl", ControlRight: "R Ctrl", AltLeft: "L Alt", AltRight: "R Alt", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←",
      ArrowRight: "→", Numpad8: "Num 8", NumpadEnter: "Num Enter", PageUp: "PgUp", Escape: "Esc", F1: "F1" };
    for (const c in L) assert.strictEqual(C.label(c), L[c], c);
    for (const code of Object.keys(SCAN)) assert(C.label(code) && [...C.label(code)].length <= 10, "label of " + code + ": " + C.label(code));
    // refused: nothing changes, nothing stored
    let changes = 0;
    C.onChange(() => changes++);
    for (const code of ["Escape", "F1", "MetaLeft", "CapsLock"]) assert.strictEqual(C.set("blue", "up", code), false, code);
    assert.strictEqual(C.set("red", "up", "KeyQ"), false); assert.strictEqual(C.set("blue", "jump", "KeyQ"), false);
    assert(C.isDefault() && !changes && env.win.localStorage.getItem("tunneler.keys") === null, "refused: no change");
    // assigned: stored (only what differs), swaps with the action that had the key
    assert.strictEqual(C.set("blue", "up", "KeyI"), true);
    assert.strictEqual(C.get("blue", "up"), "KeyI"); assert.strictEqual(changes, 1);
    same(JSON.parse(env.win.localStorage.getItem("tunneler.keys")), { blue: { up: "KeyI" } });
    assert.strictEqual(C.set("blue", "up", "KeyI"), true); assert.strictEqual(changes, 1, "the same key again: no change");
    C.set("green", "fire", "KeyA");                                  // BLUE left had A: it gets GREEN's Enter
    assert.strictEqual(C.get("green", "fire"), "KeyA"); assert.strictEqual(C.get("blue", "left"), "Enter");
    const all = C.SETS.flatMap(s => C.ACTIONS.map(a => C.get(s, a)));
    assert.strictEqual(new Set(all).size, 10, "no two actions share a key: " + all);
    // read back by another page (a new load), with junk in the storage ignored
    const env2 = makeEnv("");
    env2.win.localStorage.setItem("tunneler.keys", env.win.localStorage.getItem("tunneler.keys"));
    env2.load("js/io/controls.js");
    same(env2.win.Controls.SETS.flatMap(s => env2.win.Controls.ACTIONS.map(a => env2.win.Controls.get(s, a))), all, "stored mapping read back");
    const env3 = makeEnv("");
    env3.win.localStorage.setItem("tunneler.keys", JSON.stringify({ blue: { up: "Escape", down: "KeyW", fire: 7 }, green: "x" }));
    env3.load("js/io/controls.js");
    same(env3.win.Controls.ACTIONS.map(a => env3.win.Controls.get("blue", a)), ["KeyS", "KeyW", "KeyA", "KeyD", "ShiftLeft"],
      "bad entries = defaults, a duplicate swaps");
    const env4 = makeEnv("");
    env4.win.localStorage.setItem("tunneler.keys", "{nope");
    env4.load("js/io/controls.js");
    assert(env4.win.Controls.isDefault(), "broken JSON = defaults");
    C.reset();
    assert(C.isDefault() && env.win.localStorage.getItem("tunneler.keys") === null && changes === 3, "reset: defaults, nothing stored");
    ok("controls.js: defaults, assignable keys (no Esc / F keys / Meta / lock keys), labels, refused keys, swaps, storage (only changes), reset, onChange");
  }
  {
    // the default mapping gives exactly the keys of before (input.js without controls.js, BEFORE): every
    // key's held scan codes and keystrokes; so the engine's input is unchanged
    const b = makeEnv("");
    b.load("js/io/input.js");
    const kb = new b.win.Keyboard(b.win);
    assert.deepStrictEqual(Object.keys(b.win.SCAN), Object.keys(BEFORE.keyboard), "the same keys");
    for (const code of Object.keys(b.win.SCAN)) {
      press(b.win, code);
      // (but Tab: BLUE's extra fire key before, the statistics now - ui/livestats.js; owner, 2026-10-28)
      if (code === "Tab") assert(!held(kb).includes(0x1D), "Tab doesn't fire: " + held(kb));
      else same(held(kb), BEFORE.keyboard[code].held, "held " + code);
      same(kb.takeKeys(), BEFORE.keyboard[code].keys, "keystroke " + code);
      release(b.win, code);
    }
    for (const code of ["KeyW", "Space", "ArrowLeft", "Numpad6", "Tab"]) press(b.win, code);
    same(held(kb).filter(x => x !== 0x0F), BEFORE.several, "several at once");
    ok("default mapping = the original held keys for every key (W A S/X D, L Shift / Space, arrows, Enter / R Shift / keypad, no Ctrl, no X; Tab no longer fires)");
  }
  {
    const env = makeEnv("");
    env.load("js/io/controls.js", "js/io/input.js");
    const C = env.win.Controls, kb = new env.win.Keyboard(env.win);
    // (the tank keys' scan codes held; any other key's own scan code means nothing to the game)
    const TANK = new Set([SC.W, SC.X, SC.A, SC.D, SC.BLUEFIRE, SC.UP, SC.DOWN, SC.LEFT, SC.RIGHT, SC.GREENFIRE]);
    const scanOf = code => { press(env.win, code); const h = held(kb).filter(x => TANK.has(x)); release(env.win, code); kb.takeKeys(); return h; };
    C.set("blue", "up", "KeyI");
    same(scanOf("KeyI"), [SC.W], "I = BLUE up"); same(scanOf("KeyW"), [], "W: its old meaning is gone");
    same(C.codesOf("blue", "up"), ["KeyI"]);
    // the extra fire keys: only while the fire key is the default
    same(scanOf("Space"), [SC.BLUEFIRE]); same(scanOf("Tab"), [], "Tab never fires (the statistics)");
    same(C.codesOf("blue", "fire"), ["ShiftLeft", "Space"]);
    same(C.codesOf("green", "fire"), ["Enter", "ShiftRight", "NumpadEnter"]);
    same(C.codesOf("green", "up"), ["ArrowUp", "Numpad8"]);
    C.set("blue", "fire", "KeyK");
    same(scanOf("KeyK"), [SC.BLUEFIRE]);
    same(scanOf("Space"), [], "Space no longer fires"); same(scanOf("Tab"), [], "Tab neither");
    same(scanOf("ShiftLeft"), [], "Left Shift neither");
    same(C.codesOf("blue", "fire"), ["KeyK"]);
    C.reset();
    C.set("green", "up", "Space");                                   // an extra assigned elsewhere: that is its meaning
    same(scanOf("Space"), [SC.UP]); same(scanOf("ShiftLeft"), [SC.BLUEFIRE], "Left Shift still fires (BLUE's fire key is the default)");
    same(scanOf("ArrowUp"), [], "the old GREEN up key does nothing"); same(scanOf("Numpad8"), [], "nor keypad 8 (GREEN up isn't the default)");
    same(scanOf("Numpad2"), [SC.DOWN], "keypad 2 still GREEN down");
    C.reset();
    C.set("blue", "up", "ArrowUp");                                  // swap across the tanks
    assert.strictEqual(C.get("green", "up"), "KeyW");
    same(scanOf("ArrowUp"), [SC.W]); same(scanOf("KeyW"), [SC.UP]);
    C.set("green", "fire", "ControlRight");                          // a Ctrl key, if somebody wants it
    same(scanOf("ControlRight"), [SC.GREENFIRE]); same(scanOf("Enter"), [], "Enter no longer fires"); same(scanOf("ShiftRight"), []);
    same(scanOf("ControlLeft"), [], "the other Ctrl still nothing");
    C.reset();
    ok("remapped keys -> that action's scan code; old keys dead; extra fire keys only with the default fire key; swaps across the tanks; Ctrl if chosen");
  }
  {
    // capturing the next key (the Settings screen): nothing else sees it
    const env = makeEnv("");
    env.load("js/io/controls.js", "js/io/input.js");
    const C = env.win.Controls, kb = new env.win.Keyboard(env.win);
    const seen = [];
    env.win.addEventListener("keydown", e => seen.push(e.code));     // (like DosUI: a window listener)
    const got = [];
    C.capture(code => got.push(code));
    kev(env.win, "keydown", "KeyK", { ctrlKey: true });              // a combination: skipped
    kev(env.win, "keydown", "F2");                                   // not assignable: skipped
    kev(env.win, "keydown", "CapsLock");
    same(got, [], "still waiting");
    kev(env.win, "keydown", "ShiftRight", { shiftKey: true });      // a modifier by itself: taken
    same(got, ["ShiftRight"]);
    release(env.win, "ShiftRight");
    same(seen, [], "the page saw none of them"); same(held(kb), []); same(kb.takeKeys(), []);
    press(env.win, "KeyQ");
    same(seen, ["KeyQ"], "the next key goes to the page again");
    release(env.win, "KeyQ");
    C.capture(code => got.push(code));
    press(env.win, "Escape");
    same(got, ["ShiftRight", null], "Escape cancels: fn(null)");
    const stop = C.capture(code => got.push(code));
    stop();
    press(env.win, "KeyZ");
    same(got, ["ShiftRight", null], "cancelled: no call");
    ok("Controls.capture: the next assignable key (a modifier by itself too) goes to fn only; combos / F keys skipped; Escape = null; cancel");
  }
  {
    // pads.js synthesizes the remapped keys (read when a session starts and on every change)
    const env = makeEnv("");
    env.load("js/io/controls.js", "js/io/input.js", "js/io/pads.js");
    const C = env.win.Controls, kb = new env.win.Keyboard(env.win);
    C.set("blue", "up", "KeyI"); C.set("blue", "fire", "KeyK");
    const ctl = env.win.Pads.start({ raf: false, menu: () => false, gamepadSet: i => ["blue", "green"][i] || null });
    same(env.win.Pads.SETS.blue, { up: "KeyI", down: "KeyS", left: "KeyA", right: "KeyD", fire: "KeyK" });
    env.gamepads[0] = pad(0, [0], [0, -1, 0, 0]);                  // stick up + A
    ctl.poll(1000);
    same(held(kb), [SC.W, SC.BLUEFIRE], "BLUE up + fire through I / K: " + held(kb));
    assert(kb.isDown("KeyI") && kb.isDown("KeyK"));
    env.gamepads[0] = pad(0); ctl.poll(1200);
    C.set("green", "right", "KeyL");                                 // changed during the session
    env.gamepads[1] = pad(1, [15, 0]);                               // pad 2: d-pad right + A
    ctl.poll(1400);
    assert(kb.isDown("KeyL") && kb.isDown("Enter"), "GREEN right through L");
    same(held(kb), [SC.GREENFIRE, SC.RIGHT]);
    env.gamepads.length = 0; ctl.poll(1600);
    same(held(kb), []);
    C.reset();
    same(env.win.Pads.SETS.blue, { up: "KeyW", down: "KeyS", left: "KeyA", right: "KeyD", fire: "ShiftLeft" }, "reset: the defaults");
    ok("pads.js: gamepads press the remapped keys (at the start and after a change)");
  }
  {
    // touch controls: size and sides
    const env = makeEnv("");
    env.load("js/io/controls.js", "js/io/input.js", "js/io/pads.js");
    const P = env.win.Pads, cl = env.body.classList;
    same(P.TOUCH, { size: ["small", "medium", "large"], left: ["off", "on"], look: ["plain", "tank"] });
    assert.strictEqual(P.getTouch("look"), "plain");
    assert.strictEqual(P.getTouch("size"), "medium"); assert.strictEqual(P.getTouch("left"), "off");
    assert.strictEqual(P.getTouch("nope"), null);
    assert.strictEqual(P.setTouch("size", "huge"), false); assert.strictEqual(P.setTouch("left", "maybe"), false);
    const ctl = P.start({ raf: false, menu: () => false, touchSet: "blue" });
    assert(ctl.touch && !cl.contains("tpad-small") && !cl.contains("tpad-large") && !cl.contains("tpad-left"), "medium, right-handed: no class");
    assert.strictEqual(P.setTouch("size", "large"), true);
    assert(cl.contains("tpad-large") && !cl.contains("tpad-small"), "large applied live");
    assert.strictEqual(env.win.localStorage.getItem("tunneler.touch.size"), "large");
    P.setTouch("size", "small");
    assert(cl.contains("tpad-small") && !cl.contains("tpad-large"));
    assert.strictEqual(P.setTouch("left", "on"), true);
    assert(cl.contains("tpad-left") && env.win.localStorage.getItem("tunneler.touch.left") === "1" && P.getTouch("left") === "on");
    P.setTouch("left", "off");
    assert(!cl.contains("tpad-left") && env.win.localStorage.getItem("tunneler.touch.left") === "0");
    assert.strictEqual(P.setTouch("look", "tank"), true);
    assert(cl.contains("tpad-tank") && env.win.localStorage.getItem("tunneler.touch.look") === "tank" && P.getTouch("look") === "tank", "the tank look");
    P.setTouch("look", "plain");
    assert(!cl.contains("tpad-tank") && P.setTouch("look", "fancy") === false, "plain again; no other look");
    // a page opened with them stored
    const env2 = makeEnv("");
    env2.win.localStorage.setItem("tunneler.touch.size", "large"); env2.win.localStorage.setItem("tunneler.touch.left", "1");
    env2.load("js/io/controls.js", "js/io/input.js", "js/io/pads.js");
    env2.win.Pads.start({ raf: false, menu: () => false, touchSet: "blue" });
    assert(env2.body.classList.contains("tpad-large") && env2.body.classList.contains("tpad-left"), "stored options applied at the start");
    const css = fs.readFileSync(path.join(SRC, "css", "style.css"), "utf8");
    for (const re of [/body\.tpad-small\s*\{\s*--tpad-k:/, /body\.tpad-large\s*\{\s*--tpad-k:/, /\.tpad-stick\s*\{[^}]*var\(--tpad-k/,
      /\.tpad-fire\s*\{[^}]*var\(--tpad-k/, /body\.tpad-left \.tpad-stick\s*\{[^}]*right:/, /body\.tpad-left \.tpad-fire\s*\{[^}]*left:/,
      /body\.tpad-tank \.tpad-tankpic\s*\{[^}]*display: block/, /body\.tpad-tank \.tpad-shell\s*\{[^}]*display: block/, /html\.modern body\.tpad-tank \.tpad-shellm\s*\{[^}]*display: block/, /\.tpad-stick\.go::after\s*\{[^}]*opacity: 1/])
      assert(re.test(css), "style.css: " + re);
    ok("touch controls: size small / medium / large, the sides and the look stored (tunneler.touch.size / .left / .look), applied live and at the start");
  }

  // ------------------------------------------------------------ the pages
  {
    const html = fs.readFileSync(path.join(SRC, "index.html"), "utf8");
    assert(/user-scalable=no/.test(html), "the page: no zoom");
    for (const [p, route] of Object.entries(ROUTES)) {
      const mods = modulesOf(APP.concat(route));
      assert(mods.includes("js/io/pads.js") && mods.includes("js/io/controls.js"), p + ": pads.js and controls.js");
      if (p === "play.html" || p === "online.html") assert(mods.includes("js/io/input.js"), p + ": input.js");
    }
  }
  // the menus' pages: a gamepad steers the menus
  for (const f of ["routes/home.js", "routes/lobby.js"]) assert(fs.readFileSync(path.join(SRC, "js", f), "utf8").includes("Pads.start({ menu: () => true })"), f + ": menu pads");
  {
    // play.html: split screen - a skirmish of player 1 (BLUE) against player 2 (GREEN), the extended engine
    const env = makeEnv("?mode=hotseat");
    env.page("play.html");
    const e = env.win.tunnelerEngine();
    assert(e && e.extended && e.nPlayers === 2, "play.html loads (hotseat: two players)");
    ok("pages load pads.js (play / online: the tank; index / lobby: menus), no zoom on the game pages");
  }
  {
    // play.html with the default mapping: the engine's input (LocalClock's input function) for every key is
    // what it was without controls.js - split screen (both key sets) and vs computer (extended: bits)
    const inputs = search => {
      const env = makeEnv(search);
      env.page("play.html");
      return { env, fn: () => env.win.tunnelerInput() };   // (play.js: what its clock gives the engine)
    };
    for (const search of Object.keys(BEFORE.play)) {
      const b = inputs(search);
      const out = r => { const o = r.fn(); return { kd: o.keyDown ? [...o.keyDown] : null, bits: o.bits ? o.bits[0] : null, keys: o.keys }; };
      // (split screen ran the classic engine when these were recorded - its keys held; now two players' bits: BLUE's
      // keys player 1's, GREEN's player 2's - the same keys)
      const asBits = kd => {
        const set = (u, d, l, r, f) => (kd[u] ? 1 : 0) | (kd[d] ? 2 : 0) | (kd[l] ? 4 : 0) | (kd[r] ? 8 : 0) | (kd[f] ? 16 : 0);
        return [set(0x11, 0x2D, 0x1E, 0x20, 0x1D) | (kd[1] ? 32 : 0), set(0x48, 0x50, 0x4B, 0x4D, 0x1C)];
      };
      out(b);
      for (const code of Object.keys(BEFORE.play[search])) {
        press(b.env.win, code);
        let want = BEFORE.play[search][code];
        // (Tab: BLUE's extra fire key before, the statistics now - its keystroke stays, its fire bit goes)
        if (code === "Tab") want = want.kd ? Object.assign({}, want, { kd: want.kd.map((v, i) => i === 0x1D ? 0 : v) })
          : Object.assign({}, want, { bits: want.bits & ~16 });
        if (want.kd) { const o = b.fn(); same({ bits: [o.bits[0] | 0, o.bits[1] | 0], keys: o.keys }, { bits: asBits(want.kd), keys: want.keys }, search + " " + code); }
        else same(out(b), want, search + " " + code);
        release(b.env.win, code);
      }
    }
    ok("play.html: with the default mapping the engine gets the same input for every key (split screen, vs computer)");
  }

  // ------------------------------------------------------------ online.html: a gamepad -> held bits, lobby keys
  {
    const env = makeEnv("?room=test", { raf: true, timers: true });
    env.page("online.html");
    await wait(20);
    const ws = env.sockets[0];
    ws.recv({ t: "hello", id: "test", name: "Test", created: 1, you: { k: 1, host: false, name: "Pad" }, chat: [],
      match: { no: 1, seed: 1234, cfg: { ext: false, players: 2, slots: [{ color: 0, team: 1 }, { color: 1, team: 2 }], names: ["Pad", "B"] },
        you: 0, n: 500, from: 0, f: [[0, 0, 500]] } });
    ws.recv({ t: "st", name: "Test", public: true, spectators: true, settings: { size: "medium", winScore: 3, friendlyFire: false, roundTime: 0, visible: "self", watchOut: "wreck" },
      seats: [0, 1, 2, 3, 4, 5, 6, 7].map(i => ({ kind: i < 2 ? "open" : "closed", team: i + 1, k: i < 2 ? i + 1 : null, name: i ? "B" : "Pad", ready: false, host: !i, ping: null })),
      specs: [], cant: "match", match: { no: 1, running: true, conn: [true, true], names: ["Pad", "B"] } });
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
    // remapped keys: the held bits follow them (the keyboard and a gamepad)
    const lastBits = () => ws.sent.filter(m => m.t === "b").pop().v;
    const C = env.win.Controls;
    press(env.win, "Space"); assert.strictEqual(lastBits(), 16, "Space fires by default"); release(env.win, "Space");
    press(env.win, "Tab"); assert.strictEqual(lastBits(), 0, "Tab doesn't fire online unless assigned"); release(env.win, "Tab");
    C.set("blue", "fire", "KeyK"); C.set("green", "up", "KeyI");
    press(env.win, "Space"); press(env.win, "ArrowUp");
    assert.strictEqual(lastBits(), 0, "Space / ArrowUp: nothing any more");
    press(env.win, "KeyK"); press(env.win, "KeyI");
    assert.strictEqual(lastBits(), 1 | 16, "K = FIRE, I = UP");
    for (const c of ["Space", "ArrowUp", "KeyK", "KeyI"]) release(env.win, c);
    assert.strictEqual(lastBits(), 0);
    env.gamepads[0] = pad(0, [0], [0, -1, 0, 0]); await wait(80);
    assert.strictEqual(lastBits(), 1 | 16, "a gamepad through the remapped BLUE keys (W, K)");
    env.gamepads[0] = pad(0); await wait(200);
    env.gamepads.length = 0;
    C.reset();
    ok("online.html: a gamepad sends the keyboard's held bits (UP | RIGHT | FIRE), Start = Esc (leave notice); remapped keys -> the same bits");
  }
  {
    // the pre-game lobby (DosUI): d-pad moves the selection
    const env = makeEnv("?room=lob", { raf: true, timers: true });
    env.page("online.html");
    await wait(20);
    const ws = env.sockets[0];
    ws.recv({ t: "hello", id: "lob", name: "Lobby", created: 1, you: { k: 2, host: false, name: "Pad" }, chat: [], match: null });
    ws.recv({ t: "st", name: "Lobby", public: true, spectators: true, settings: { size: "small", winScore: 2, friendlyFire: false, roundTime: 0, visible: "self", watchOut: "wreck" },
      seats: [0, 1, 2, 3, 4, 5, 6, 7].map(i => ({ kind: i < 2 ? "open" : "closed", team: i + 1, k: i < 2 ? i + 1 : null, name: i ? "Pad" : "A",
        ready: false, host: i === 0, ping: i < 2 ? 20 : null })), specs: [], cant: "ready", match: null });
    await wait(300);
    const lui = env.win.tunnelerLobbyUI();
    const key = () => lui.spec.items[lui.sel].key;
    assert.strictEqual(key(), "ready");
    env.gamepads[0] = pad(0, [12]); await wait(60);                 // d-pad up
    env.gamepads[0] = pad(0); await wait(200);
    assert.notStrictEqual(key(), "start", "d-pad up moved the selection: " + key());
    env.gamepads[0] = pad(0, [13]); await wait(60);
    env.gamepads[0] = pad(0); await wait(200);
    assert.strictEqual(key(), "ready");
    env.gamepads[0] = pad(0, [0]); await wait(60);                  // A = Enter: ready
    env.gamepads[0] = pad(0); await wait(200);
    assert(ws.sent.some(m => m.t === "ready" && m.v === 1), "A = Enter: ready sent");
    assert(!ws.sent.some(m => m.t === "b" && m.v), "no held bits in the lobby");
    env.gamepads.length = 0;
    ok("online room lobby (DosUI): d-pad moves, A selects, no held bits");
  }

  console.log(n + " input checks passed");
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
