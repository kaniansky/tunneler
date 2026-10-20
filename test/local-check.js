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
// /js/langs.js is generated: src/lang/<code>/*.js joined, as server.js serves it for src/
const { langBundle, modesBundle } = require("../server.js");

let n = 0;
const ok = msg => { n++; console.log("  ok  " + msg); };
// (values made inside the page vm have other prototypes: compare as JSON)
const same = (a, b, msg) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), msg);

function makeEnv(search, store) {
  const listeners = {};
  const mkEl = id => ({ id, width: 720, height: 400, style: {}, classList: { toggle() {} },
    addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 720, height: 400 }),
    getContext: () => ({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }) });
  const elements = {};
  const storage = store || new Map();
  const win = {
    document: { title: "", getElementById: id => elements[id] || (elements[id] = mkEl(id)), createElement: mkEl },
    location: { search, pathname: "/", hash: "", href: "" },
    history: { replaceState() {} },
    localStorage: { getItem: k => storage.has(k) ? storage.get(k) : null, setItem: (k, v) => storage.set(k, String(v)) },
    addEventListener: (t, f) => (listeners[t] = listeners[t] || []).push(f),
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    performance, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, console, URLSearchParams, Math, atob, Uint8Array,
  };
  win.window = win; win.globalThis = win;
  const ctx = vm.createContext(win);
  const page = f => {
    for (const [, src] of fs.readFileSync(path.join(SRC, f), "utf8").matchAll(/<script src="\/([^"]+)"/g))
      vm.runInContext(src === "js/langs.js" ? langBundle(path.join(SRC, "lang")) : src === "js/modes.js" ? modesBundle(path.join(SRC, "js", "modes"))
        : fs.readFileSync(path.join(SRC, src), "utf8"), ctx, { filename: src });
  };
  const key = code => { for (const f of listeners.keydown || []) f({ code, key: keyOf(code), target: {}, preventDefault() {} }); };
  return { win, page, key, storage };
}

// ---------------------------------------------------------------- smooth scrolling (display only)
{
  // the same game with and without smoothScroll: identical simulation; the views differ only on frames
  // where the tank is on an odd x, then by exactly one pixel (screen byte = right pixel of one world byte +
  // left pixel of the next)
  const E = require(path.join(SRC, "js", "engine.js"));
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
  const E = require(path.join(SRC, "js", "engine.js"));
  const NP = require(path.join(SRC, "js", "netproto.js"));
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
  // settings: checked, defaults, passed to the engine
  assert.strictEqual(NP.SETTINGS.sight("walls"), "walls");
  assert.strictEqual(NP.SETTINGS.sight("x-ray"), undefined);
  assert.strictEqual(NP.roomSettings({}).sight, "full");
  assert.strictEqual(NP.readCfg({ slots: [{ color: 0 }, { color: 1 }], sight: "circle" }).sight, "circle");
  assert.strictEqual(NP.engineOptions({ slots: [{ color: 0, team: 1 }, { color: 1, team: 2 }], sight: "circle" }).sight, "circle");
  assert.strictEqual(NP.engineOptions({ slots: [{ color: 0, team: 1 }, { color: 1, team: 2 }], sight: "full" }).sight, undefined);
  ok("line of sight: the same game, views live only around the tank (classic " + classic.join(" / ") + ", extended " + ext.join(" / ") + " dimmed cells)");
}

// ---------------------------------------------------------------- sound attenuation
{
  const Speaker = require(path.join(SRC, "js", "speaker.js"));
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
  assert(!e.extended && e.nPlayers === 2 && e.size === "medium" && e.winScore === 3, "classic vs computer");
  // the classic engine with these options plays exactly like the plain classic engine
  const E = w.TunnelerEngine, a = new E(77, { slots: [{ color: 0, team: 1 }, { color: 1, team: 2 }], size: "medium", winScore: 3, escEnds: true }), b = new E(77);
  for (let i = 0; i < 400; i++) {
    const kd = new Uint8Array(128);
    if (i % 50 < 30) kd[E.KEYS.KeyUp[1]] = 1;
    const keys = i === 20 || i === 21 ? [[13, 0x1C]] : [];
    a.step({ keyDown: kd.slice(), keys: keys.slice() }); b.step({ keyDown: kd.slice(), keys: keys.slice() });
  }
  assert.strictEqual(a.randSeed, b.randSeed); same(Array.from(a.world), Array.from(b.world));
  ok("vs computer BLUE + GREEN = classic engine, identical to new TunnelerEngine(seed)");

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
  // (an old link's "easy" level becomes "normal" - the easiest one offered, shown as "easy")
  const w = play("?mode=cpu&slots=" + encodeURIComponent("0:you:1,1:hard:2,2:easy:2,3:expert:2") + "&size=large&win=5&ff=1&hide=0");
  const e = w.tunnelerEngine();
  assert(e.extended && e.nPlayers === 4 && e.nTeams === 2 && e.size === "large" && e.winScore === 5 && e.friendlyFire);
  same(Array.from(e.slots, s => [s.color, s.team]), [[0, 1], [1, 2], [2, 2], [3, 2]]);
  same(w.tunnelerAIs().map(a => [a.me, a.levelName]), [[2, "hard"], [3, "normal"], [4, "expert"]]);
  ok("1 vs 3 teams: extended, large, 5 to win, friendly fire, computer levels per slot");
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
  same(o.tunnelerAIs().map(a => a.levelName), ["hard", "hard", "hard"]);
  ok("7 computers; invalid links are cleaned up; old ?opp / teams / level links still work");
}
{
  const w = play("?mode=hotseat&size=small&win=1");
  const e = w.tunnelerEngine();
  assert(!e.extended && e.size === "small" && e.winScore === 1 && w.tunnelerAIs().length === 0);
  // split screen: full volume, panned between BLUE's tank (left) and GREEN's (right); null off play
  const hl = w.tunnelerRunner().listener;
  const hr = { screen: "play", tankX: [0, 100, 300], tankY: [0, 50, 60] };
  same(hl(hr), { left: { x: 100, y: 50 }, right: { x: 300, y: 60 } }, "split screen listener");
  assert.strictEqual(hl(Object.assign({}, hr, { screen: "map" })), null, "split screen: menus centred");
  assert.strictEqual(hl(Object.assign({}, hr, { extended: true })), null, "split screen: classic only");
  const d = play("?mode=hotseat").tunnelerEngine();
  assert(!d.extended && d.size === "medium" && d.winScore === 3 && d.roundTime === 0);
  assert.strictEqual(play("?mode=hotseat&time=5").tunnelerEngine().roundTime, 5, "&time=5: 5-minute rounds");
  assert.strictEqual(play("?mode=hotseat&time=7").tunnelerEngine().roundTime, 0, "&time=7: not a choice - no limit");
  assert.strictEqual(play("?mode=cpu&slots=0:you:1,2:easy:2&time=10").tunnelerEngine().roundTime, 10, "vs computer &time=10");
  ok("split screen: classic engine with size / rounds to win from the link, full-volume stereo sound");
}

// ---------------------------------------------------------------- home.js settings screens
{
  const store = new Map();
  let env = makeEnv("", store);
  env.page("index.html");
  env.key("ArrowDown"); env.key("Enter");                  // Vs computer
  env.key("Enter");                                        // Start a new game (selected first)
  assert.strictEqual(decodeURIComponent(env.win.location.href), "/skirmish?slots=0:you:1,1:normal:2&size=medium&win=3&ff=0&view=self&watch=wreck",
    "default = the classic game");
  // CYAN: computer (easy) in team 2 -> 1 vs 2 teams; large map; 5 to win; friendly fire on; view everyone
  env = makeEnv("", store);
  env.page("index.html");
  env.key("ArrowDown"); env.key("Enter");
  // (rows are chosen by their key - the screen's order changes with its options)
  const pick = (en, key) => { const ui = en.win.tunnelerHomeUI(); ui.sel = ui.spec.items.findIndex(it => it.key === key); assert(ui.sel >= 0, key); ui.draw(); };
  pick(env, "slot7"); env.key("ArrowLeft");                // TEAL: nobody -> expert
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
  assert.strictEqual(decodeURIComponent(env.win.location.href),
    "/skirmish?slots=0:you:1,1:normal:2,2:normal:2,7:expert:8&size=large&win=5&ff=1&view=everyone&watch=team&time=3");
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
    pick(en, "noRepair"); en.key("Enter");
    pick(en, "play"); en.key("Enter");
    assert(/&gm=gold&goal=10&norepair=1$/.test(decodeURIComponent(en.win.location.href)), en.win.location.href);
    assert(st.get("tunneler.cpu.mode") === "gold" && st.get("tunneler.cpu.noRepair") === "1");
    ok("vs computer: Mode and the modifier go into the link and are remembered");
    // deathmatch: "Kills to win" instead of "Rounds to win", into the link
    const sd = new Map(), ed = makeEnv("", sd);
    ed.page("index.html"); ed.key("ArrowDown"); ed.key("Enter");
    const uid = ed.win.tunnelerHomeUI();
    sd.set("x", 1);
    pick(ed, "mode"); for (let i = 0; i < 8; i++) ed.key("ArrowRight");   // ... -> deathmatch
    assert(uid.spec.items.some(it => it.key === "goal") && !uid.spec.items.some(it => it.key === "win"), "deathmatch: Kills to win, no Rounds to win");
    pick(ed, "goal"); ed.key("ArrowRight");                              // 10 -> 15
    pick(ed, "play"); ed.key("Enter");
    assert(/&gm=deathmatch&goal=15/.test(decodeURIComponent(ed.win.location.href)), ed.win.location.href);
    ok("skirmish deathmatch: Kills to win replaces Rounds to win, into the link");
  }
  // friendly fire: always listed, grayed out (not selectable) while no team has 2+ tanks
  {
    const st = new Map(), en = makeEnv("", st);
    en.page("index.html"); en.key("ArrowDown"); en.key("Enter");
    const ui = en.win.tunnelerHomeUI(), ff = () => ui.spec.items.find(it => it.key === "ff");
    assert(ff() && ff().disabled, "the classic game: Friendly fire shown, grayed out");
    ui.sel = ui.spec.items.findIndex(it => it.key === "slot2"); ui.draw();
    en.key("ArrowRight"); en.key("Digit1");                  // CYAN: a computer tank in team 1 (with you)
    assert(ff() && !ff().disabled, "a team of 2: Friendly fire selectable");
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
      return { clientX: (b.x + 1 + labelCol) * 9 + 4, clientY: (b.y + (i - b.start)) * 16 + 8 };
    };
    const zone = (key, z) => ui.spec.items.find(it => it.key === key).zones[z].from;
    const saved = () => JSON.parse(st.get("tunneler.cpu.slots"));
    ui.click(at("slot1", zone("slot1", 1)));
    assert.strictEqual(saved()[1].team, 3, "click on GREEN's team: 2 -> 3");
    ui.zoneClick(at("slot1", zone("slot1", 1) + 2), -1);
    assert.strictEqual(saved()[1].team, 2, "right click: back to 2");
    ui.click(at("slot1", zone("slot1", 0)));
    assert.strictEqual(saved()[1].kind, "hard", "click on GREEN's who: normal -> hard");
    ui.zoneClick(at("slot1", zone("slot1", 0) + 1), -1);
    assert.strictEqual(saved()[1].kind, "normal", "right click: back to normal");
    ui.click(at("slot2", zone("slot2", 0)));
    assert.strictEqual(saved()[2].kind, "normal", "CYAN: nobody -> normal (shown as easy; not \"you\": BLUE is yours)");
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
  assert.strictEqual(decodeURIComponent(env.win.location.href),
    "/skirmish?slots=0:you:1,1:normal:2,2:normal:2,7:expert:8&size=large&win=5&ff=1&view=everyone&watch=team&time=3");
  ok("vs computer slot editor: default classic, slots / teams / options, remembered in localStorage");

  // nobody but you: "Start a new game" does nothing
  const s2 = new Map([["tunneler.cpu.slots", JSON.stringify([{ kind: "you", team: 1 }, { kind: "none", team: 2 }])]]);
  env = makeEnv("", s2);
  env.page("index.html");
  env.key("ArrowDown"); env.key("Enter"); env.key("Enter");
  assert.strictEqual(env.win.location.href, "", "no computer tank: no game");
  const s3 = new Map([["tunneler.cpu.slots", JSON.stringify([{ kind: "you", team: 4 }, { kind: "hard", team: 4 }])]]);
  env = makeEnv("", s3);
  env.page("index.html");
  env.key("ArrowDown"); env.key("Enter"); env.key("Enter");
  assert.strictEqual(env.win.location.href, "", "one team only: no game");
  ok("vs computer: no game without a computer tank or with a single team");

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

// ---------------------------------------------------------------- home.js Settings: language, sound
{
  const store = new Map();
  const env = makeEnv("", store);
  env.page("index.html");
  env.key("ArrowUp"); env.key("Enter");                    // (wraps to the last item) Settings
  env.key("ArrowDown"); env.key("ArrowRight");             // Sound: original -> realistic
  assert.strictEqual(store.get("tunneler.sound"), "realistic", "sound style remembered");
  env.key("ArrowLeft"); env.key("ArrowLeft");              // -> muted
  assert.strictEqual(store.get("tunneler.sound"), "muted");
  env.key("ArrowDown"); env.key("Enter");                  // Smooth scrolling: off -> on
  assert.strictEqual(store.get("tunneler.smooth"), "1", "smooth scrolling remembered");
  env.key("ArrowDown"); env.key("Enter");                  // Show ping: off -> on
  assert.strictEqual(store.get("tunneler.ping"), "1", "show ping remembered");
  env.key("ArrowUp"); env.key("ArrowUp");
  env.key("ArrowUp"); env.key("ArrowRight");               // Language: the next one
  assert.notStrictEqual(store.get("tunneler.lang") || "en", "en", "language switched");
  env.key("ArrowLeft");
  env.key("Escape"); env.key("ArrowDown"); env.key("Enter");   // back on the main menu: split screen ...
  ok("homepage Settings: language, sound style (muted / original / realistic / cartoony), show ping - remembered");
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
  // classic: BLUE / GREEN as the original
  const c = play("?mode=cpu&slots=0:you:1,1:normal:2").tunnelerViews();
  same([c.playerColor(0), c.playerColor(1), c.teamLines(c.engine()).length], [9, 10, 0], "classic colors");
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
  // hotseat: the original split screen, no labels
  const hs = play("?mode=hotseat").tunnelerViews(); hs.snap = { screen: "play", mode: "lores" };
  same([hs.layout().kind, hs.layout().crop], ["display", null], "hotseat: the original screen");
  ok("views.js: self / team / everyone - own view first, teammates / others in slot order; classic halves");
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
  // "others" (watch all): the player's own views (view team: you + YELLOW) stay - a destroyed one black with
  // DESTROYED - plus every other tank still alive, own team's first - whatever the view limit
  e.killedBy[1] = 3;                                        // CYAN shot you
  let L = alive(false, true, true, true, true);
  same([L.cells, !!L.labels], [[0, 3, 1, 2, 4], true], "watch all: your views first (you, YELLOW), then everyone alive, labeled");
  assert.strictEqual(v.listenTo(0), 2, "sounds from the tank that destroyed you (CYAN)");
  same(v.hearAt(0, e), { x: 300, y: 30 }, "heard at CYAN");
  e.killedBy[3] = 5;                                        // TEAL shot CYAN
  same(alive(false, true, false, true, true).cells, [0, 3, 1, 4], "CYAN destroyed too: your views and the rest");
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
    same(al(false, true, true, true, true).cells, [0, 3], "watch killer, no killer (energy): your views (the first alive, YELLOW, is one)");
    al(true, true, true, true, true);
    ek.killedBy[1] = 3;
    const K = al(false, true, true, true, true);
    same([K.cells, !!K.labels], [[0, 3, 2], true], "watch killer: your views + the tank that destroyed you (CYAN), labeled");
    ek.killedBy[3] = 5;
    same(al(false, true, false, true, true).cells, [0, 3, 4], "CYAN destroyed: its killer (TEAL)");
    ek.killedBy[4] = 2;
    same(al(false, true, false, true, true).cells, [0, 3, 4], "stays on the watched tank while it lives");
    assert.strictEqual(vk.listenTo(0), 4, "sounds from the watched tank");
  }
  // "team" (watch team): all teammates still alive, black once none is left
  const wt = play(link + "&watch=team&view=self"), vt = wt.tunnelerViews(), et = wt.tunnelerEngine();
  vt.snap = { screen: "play", mode: "lores", views: et.views || [] };
  et.killedBy = [0, 3, 0, 0, 0, 0]; et.tankX = e.tankX; et.tankY = e.tankY;
  et.alive = [false, false, true, true, true, true];
  same(vt.layout().cells, [0, 3], "watch team: your view (DESTROYED) + your teammate (YELLOW) - not your killer, whatever the view limit");
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
  {   // (watch all ignores the view limit: your own half stays, GREEN's half is added once you're out)
    const cs = play("?mode=cpu&slots=0:you:1,1:normal:2&watch=1"), csv = cs.tunnelerViews(), cse = cs.tunnelerEngine();
    csv.snap = { screen: "play", mode: "lores" }; cse.alive = [false, false, true];
    same([csv.layout().kind, csv.layout().cells], ["grid", [0, 1]], "classic out, view self, watch all: your half (DESTROYED) + GREEN's");
  }
  const c = play("?mode=cpu&slots=0:you:1,1:normal:2&watch=1&view=everyone"), cv = c.tunnelerViews(), ce = c.tunnelerEngine();
  cv.snap = { screen: "play", mode: "lores" };
  ce.alive = [false, true, true];
  same(cv.layout().cells, [0, 1], "classic alive, everyone: both halves");
  ce.alive = [false, false, true];
  same([cv.layout().kind, cv.layout().cells, !!cv.layout().labels], ["grid", [0, 1], true], "classic out, view everyone: still both halves (yours DESTROYED)");
  // you in another color: the marker follows "you"
  assert.strictEqual(play("?mode=cpu&slots=" + encodeURIComponent("0:hard:1,4:you:2")).tunnelerEngine().youPlayer, 2, "you = WHITE (player 2)");
  // split screen: two humans - no marker, no watching; the settings (size / rounds) still listed
  const h = play("?mode=hotseat&size=small"), he = h.tunnelerEngine();
  assert(he.youPlayer === null && h.tunnelerViews().watchOut === "wreck" && he.showSettings && he.showSettings.watchOut === undefined, "split screen");
  ok("after death: black = DESTROYED, wreck, others = the killer (chained, else the first alive), back next round; you marker / settings set by play.js");
}

console.log("all " + n + " passed");
