"use strict";
// Local games without a browser: the vs computer slot editor / split-screen settings (home.js) build the
// right play.html links and remember their settings, play.js turns those links into the right engine
// (classic for BLUE + GREEN, extended otherwise; size, rounds to win, friendly fire, computer levels),
// and distance-attenuated sound (speaker.js / runner.js listener, docs/DESIGN-8P.md 8).
//   node test/local-check.js
const assert = require("assert");
const fs = require("fs"), path = require("path"), vm = require("vm");
const SRC = path.join(__dirname, "..", "src");
// /js/langs.js is generated: src/lang/*.js joined, as server.js serves it for src/
const { langBundle } = require("../server.js");

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
      vm.runInContext(src === "js/langs.js" ? langBundle(path.join(SRC, "lang")) : fs.readFileSync(path.join(SRC, src), "utf8"), ctx, { filename: src });
  };
  const key = code => { for (const f of listeners.keydown || []) f({ code, key: "", target: {}, preventDefault() {} }); };
  return { win, page, key, storage };
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
  const w = play("?mode=cpu&slots=" + encodeURIComponent("0:you:1,1:hard:2,2:easy:2,3:expert:2") + "&size=large&win=5&ff=1&hide=0");
  const e = w.tunnelerEngine();
  assert(e.extended && e.nPlayers === 4 && e.nTeams === 2 && e.size === "large" && e.winScore === 5 && e.friendlyFire);
  same(Array.from(e.slots, s => [s.color, s.team]), [[0, 1], [1, 2], [2, 2], [3, 2]]);
  same(w.tunnelerAIs().map(a => [a.me, a.levelName]), [[2, "hard"], [3, "easy"], [4, "expert"]]);
  ok("1 vs 3 teams: extended, large, 5 to win, friendly fire, computer levels per slot");
}
{
  // skipped slots keep their colors; friendly fire is dropped without teammates
  const w = play("?mode=cpu&slots=" + encodeURIComponent("0:you:1,3:normal:4,7:expert:8") + "&size=small&ff=1");
  const e = w.tunnelerEngine();
  assert(e.extended && e.nPlayers === 3 && e.size === "small" && !e.friendlyFire && e.winScore === 3);
  same(Array.from(e.slots, s => s.color), [0, 3, 7]);
  ok("BLUE + MAGENTA + TEAL keep their colors; small map; no friendly fire without teams");
}
{
  const w = play("?mode=cpu&slots=" + encodeURIComponent("0:you:1,1:normal:2,2:normal:3,3:normal:4,4:normal:5,5:normal:6,6:normal:7,7:normal:8") + "&size=large");
  assert(w.tunnelerEngine().nPlayers === 8 && w.tunnelerEngine().nTeams === 8);
  // garbage / everyone in one team: still a playable game (2+ teams, BLUE first)
  const g = play("?mode=cpu&slots=" + encodeURIComponent("5:you:1,0:you:3,1:bogus:2,2:hard:3,2:hard:4") + "&win=42&size=huge").tunnelerEngine();
  same(Array.from(g.slots, s => [s.color, s.team]), [[0, 3], [2, 4]]);
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
  assert.strictEqual(w.tunnelerRunner().listener, null, "split screen: full volume");
  const d = play("?mode=hotseat").tunnelerEngine();
  assert(!d.extended && d.size === "medium" && d.winScore === 3);
  ok("split screen: classic engine with size / rounds to win from the link, full-volume sound");
}

// ---------------------------------------------------------------- home.js settings screens
{
  const store = new Map();
  let env = makeEnv("", store);
  env.page("index.html");
  env.key("ArrowDown"); env.key("Enter");                  // Vs computer
  env.key("Enter");                                        // Start a new game (selected first)
  assert.strictEqual(decodeURIComponent(env.win.location.href), "/play.html?mode=cpu&slots=0:you:1,1:normal:2&size=medium&win=3&ff=0&view=self",
    "default = the classic game");
  // CYAN: computer (easy) in team 2 -> 1 vs 2 teams; large map; 5 to win; friendly fire on; view everyone
  env = makeEnv("", store);
  env.page("index.html");
  env.key("ArrowDown"); env.key("Enter");
  // items: slot0..7, gap, size, win, view, gap, play, instr, back (play selected)
  for (let i = 0; i < 4; i++) env.key("ArrowUp");           // view, win, size, slot7
  env.key("ArrowLeft");                                    // TEAL: nobody -> expert
  for (let i = 0; i < 5; i++) env.key("ArrowUp");           // slot2 CYAN
  env.key("ArrowRight");                                   // nobody -> easy
  for (let i = 0; i < 6; i++) env.key("Enter");             // team 3 -> 8, then wraps to 1
  env.key("Enter");                                        // team 2
  for (let i = 0; i < 6; i++) env.key("ArrowDown");         // slot3..7, size
  env.key("ArrowRight");                                   // large
  env.key("ArrowDown"); env.key("ArrowRight"); env.key("ArrowRight");   // win 5
  env.key("ArrowDown"); env.key("Enter");                  // friendly fire (a team has 2+): on
  env.key("ArrowDown"); env.key("Enter"); env.key("Enter");   // view: self -> team -> everyone
  env.key("ArrowDown"); env.key("Enter");                  // start
  assert.strictEqual(decodeURIComponent(env.win.location.href),
    "/play.html?mode=cpu&slots=0:you:1,1:normal:2,2:easy:2,7:expert:8&size=large&win=5&ff=1&view=everyone");
  // remembered
  env = makeEnv("", store);
  env.page("index.html");
  env.key("ArrowDown"); env.key("Enter"); env.key("Enter");
  assert.strictEqual(decodeURIComponent(env.win.location.href),
    "/play.html?mode=cpu&slots=0:you:1,1:normal:2,2:easy:2,7:expert:8&size=large&win=5&ff=1&view=everyone");
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
  assert.strictEqual(env.win.location.href, "/play.html?mode=hotseat&size=medium&win=3");
  env = makeEnv("", store);
  env.page("index.html");
  env.key("Enter");
  env.key("ArrowDown"); env.key("ArrowLeft");              // small
  env.key("ArrowDown"); env.key("ArrowLeft");              // 2
  env.key("ArrowUp"); env.key("ArrowUp"); env.key("Enter");
  assert.strictEqual(env.win.location.href, "/play.html?mode=hotseat&size=small&win=2");
  assert.strictEqual(store.get("tunneler.split.size"), "small");
  ok("split-screen settings: default classic, map size and rounds to win, remembered");
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
  assert.strictEqual(lines[0][1][1], E.PLAYER_TEXT_COLORS[3], "team 2 in its first tank's color (MAGENTA)");
  // classic: BLUE / GREEN as the original
  const c = play("?mode=cpu&slots=0:you:1,1:normal:2").tunnelerViews();
  same([c.playerColor(0), c.playerColor(1), c.teamLines(c.engine()).length], [9, 10, 0], "classic colors");
  ok("views.js: players colored / named by their slot (BLUE, MAGENTA, TEAL...), all teams on the map");
}

// ---------------------------------------------------------------- views.js: self / team / everyone (DESIGN-8P 23)
{
  // BLUE + MAGENTA in team 1, CYAN + TEAL in team 2, GREEN alone in team 3
  const link = "?mode=cpu&slots=" + encodeURIComponent("0:you:1,1:normal:3,2:normal:2,3:normal:1,7:normal:2");
  const layoutOf = q => {
    const w = play(link + q), v = w.tunnelerViews(), e = w.tunnelerEngine();
    v.snap = { screen: "play", mode: "lores", views: e.views || [] };
    return v.layout();
  };
  const self = layoutOf("&view=self"), team = layoutOf("&view=team"), all = layoutOf("&view=everyone"), old = layoutOf("&hide=0");
  same([self.kind, self.cells, self.cols], ["grid", [0], 1], "self: own view only");
  same([team.cells, team.cols, team.rows], [[0, 3], 2, 1], "team: own, then MAGENTA (player 4)");
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
  same([cl("&view=self"), cl("&view=team"), cl("&view=everyone")].map(L => [L.kind, L.crop]),
    [["display", "blue"], ["display", "blue"], ["display", null]], "classic");
  ok("views.js: self / team / everyone - own view first, teammates / others in slot order; classic halves");
}

console.log("all " + n + " passed");
