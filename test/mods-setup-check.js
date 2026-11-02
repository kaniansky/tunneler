"use strict";
// Script mods' game setup (1.5, docs/MODS.md 3a; game/mods.js, engine.js): the header's @bases / @setting / @hide (parsed,
// limits, problems), Mods.settingsOf / basesFor / mapFits, @hide forcing the game's defaults, bases apart from players
// (a generated world with @bases' bases whatever the tanks; a custom map's bases in its order, too few refused), setup's
// g.spawn / g.place (free spots: the floor, the doorways, then dug-out ground - never two tanks on one spot), g.bases,
// g.setOwner (walls in the owner's colour, gray for nobody's; refuel / repair only the owner's team, foeEnergy the
// others', nobody's none; baseUsable by base index), the computer tanks' refuelling (the nearest base their team owns,
// none: no retreat), g.settings (validated, frozen), a mod without @bases (one base per tank, as before); the example
// mods Race and Conquest: matches of computer tanks finish, the same in two runs.
//   node test/mods-setup-check.js [quick]
const H = require("./modes-harness.js");
const { E, check, slots, runMatch, startEngine, NetProto, TunnelerAI } = H;
const { loadMods, modFile, MapData } = require("./src.js");
const Mods = loadMods();
const quick = process.argv.includes("quick");

const head = (lines, body) => "// @name   Setup test\n// @game   1.5+\n" + lines.map(l => "// " + l + "\n").join("") + (body || "mod({});");
const engineWith = (source, o) => startEngine(o.seed || 1, Object.assign({ slots: slots(o.teams || [1, 2]), size: o.size || "small", winScore: 1,
  match: true, mod: { id: Mods.idOf(source), source } }, o.opts || {}));
const step = e => e.step({ bits: new Array(e.nPlayers).fill(0), keys: e.screen === "map" ? [[32, 0x39]] : [] });
// steps until the mod's frame f (play frames of the round)
const toFrame = (e, f) => { for (let i = 0; i < 5000 && !(e.screen === "play" && e.modF >= f); i++) step(e); };
function sandboxT(e) {
  const r = e.modBox.ctx.evalCode("JSON.stringify(globalThis.T)");
  const v = r.error ? null : JSON.parse(e.modBox.ctx.getString(r.value));
  (r.value || r.error).dispose();
  return v;
}
// every pair of tanks at least 8 px apart (the engine's distance - a tank blocks another within 6), every tank inside the
// world
function apart(e) {
  for (let p = 1; p <= e.nPlayers; p++) {
    if (e.tankX[p] < 8 || e.tankY[p] < 8 || e.tankX[p] >= e.worldW - 8 || e.tankY[p] >= e.worldH - 8) return false;
    for (let q = p + 1; q <= e.nPlayers; q++)
      if (e.distance(Math.abs(e.tankX[p] - e.tankX[q]), Math.abs(e.tankY[p] - e.tankY[q])) < 8) return false;
  }
  return true;
}
const inBase = (e, p, b) => Math.abs(e.tankX[p] - e.baseX[b]) <= 17 && Math.abs(e.tankY[p] - e.baseY[b]) <= 17;

(async () => {
  // ---------------------------------------------------------------- the header
  {
    const P = l => Mods.parseHeader(head(l));
    const a = P(["@bases 2"]), b = P(["@bases 3 - 8"]), c = P([]);
    check(a.ok && a.bases.min === 2 && a.bases.max === 2 && b.ok && b.bases.min === 3 && b.bases.max === 8 && c.ok && c.bases === null,
      "@bases: a number, a range; none: null (one base per tank)");
    check(["@bases 0", "@bases 9", "@bases 5 - 3", "@bases many", "@bases 1 - 9"].every(l => P([l]).problem === "bases"), "@bases: 1..8, else refused");
    check(P(["@bases 3", "@mode gold"]).problem === "mode" && P(["@bases 3", "@mode standard"]).ok, "@bases with @mode standard: fine (1.5: any other @mode is refused - \"mode\")");
    const s = P(['@setting laps "Laps" 1, 2, 3, 5 = 3   sk "Kolá" cs "Kola" uk "Кола" ru "Круги" de "Runden"', '@setting shots "Shots" 0,1', '@setting t "Time" -5, 10']);
    const L = s.settings && s.settings[0];
    check(s.ok && s.settings.length === 3 && L.key === "laps" && JSON.stringify(L.choices) === "[1,2,3,5]" && L.def === 3 && !L.onOff &&
      JSON.stringify(L.label) === JSON.stringify({ en: "Laps", sk: "Kolá", cs: "Kola", uk: "Кола", ru: "Круги" }),
      "@setting: key, English label, choices, default, the game's languages' labels (others ignored)");
    check(s.settings[1].def === 0 && s.settings[1].onOff && JSON.stringify(s.settings[2].choices) === "[-5,10]" && s.settings[2].def === -5,
      "@setting: no default - the first choice; 0, 1 - on / off; negative choices");
    check(Mods.settingLabel(L, "sk") === "Kolá" && Mods.settingLabel(L, "xx") === "Laps" && Mods.settingLabel(s.settings[1], "uk") === "Shots", "Mods.settingLabel: its language, else English");
    const bad = ['@setting laps Laps 1, 2', '@setting laps "Laps" 1, 2 = 4', '@setting laps "Laps" 1, 1', '@setting laps "Laps" ' + Array.from({ length: 13 }, (_, i) => i).join(", "),
      '@setting 9x "X" 1', '@setting constructor "X" 1', '@setting laps "" 1', '@setting laps "Laps" 1, 2 sk Kolá', '@setting laps "Laps" 1.5, 2', '@setting laps "Laps" 1, 9999999'];
    check(bad.every(l => P([l]).problem === "setting"), "@setting: a broken line is refused (" + bad.map(l => P([l]).problem).join() + ")");
    check(P(['@setting a "A" 1', '@setting a "B" 2']).problem === "setting", "@setting: two of one key refused");
    check(P(Array.from({ length: 8 }, (_, i) => '@setting k' + i + ' "K" 1, 2')).ok && P(Array.from({ length: 9 }, (_, i) => '@setting k' + i + ' "K" 1, 2')).problem === "setting",
      "@setting: at most 8");
    check(P(['@setting k "K" ' + Array.from({ length: 12 }, (_, i) => i).join(", ")]).ok, "@setting: 12 choices");
    const h = P(["@hide winScore, roundTime", "@hide friendlyFire winScore"]);
    check(h.ok && h.hide.join() === "winScore,roundTime,friendlyFire" && P(["@hide colors"]).problem === "hide", "@hide: built-in settings (" + Mods.HIDE.join(" ") + "); anything else refused");
    check(Mods.check(head(["@bases 0"])).problem === "bases" && Mods.check(head(['@setting x "X"'])).problem === "setting" && Mods.check(head(["@hide x"])).problem === "hide",
      "Mods.check: the new problems");
    // the values
    const so = (v) => JSON.stringify(Mods.settingsOf(s, v));
    check(so({ laps: 5, shots: 1, t: 10 }) === '{"laps":5,"shots":1,"t":10}' && so({ laps: 4, shots: "1", t: "x" }) === '{"laps":3,"shots":1,"t":-5}' &&
      so(null) === '{"laps":3,"shots":0,"t":-5}' && so({ laps: 2.5, constructor: 1 }) === '{"laps":3,"shots":0,"t":-5}' && so({ __proto__: { laps: 5 } }) === '{"laps":3,"shots":0,"t":-5}',
      "Mods.settingsOf: a choice (or its text) kept; anything else - the default");
    // bases
    const B = b;
    check(Mods.basesFor(c, { size: "small" }) === 0 && Mods.basesFor(B, { size: "small" }) === 4 && Mods.basesFor(B, { size: "medium" }) === 6 &&
      Mods.basesFor(B, { size: "large" }) === 8 && Mods.basesFor(B, { size: "small", bases: 2 }) === 3 && Mods.basesFor(B, { bases: 7 }) === 7 &&
      Mods.basesFor(a, { size: "large" }) === 2, "Mods.basesFor: by the world's size, or as asked - within @bases");
    const map = n => ({ bases: new Array(n).fill({ x: 1, y: 1 }) });
    check(Mods.basesFor(B, { map: map(2) }) === -1 && Mods.basesFor(B, { map: map(5) }) === 5 && Mods.basesFor(P(["@bases 2 - 3"]), { map: map(5) }) === 3 &&
      !Mods.mapFits(B, map(2)) && Mods.mapFits(B, map(3)) && Mods.mapFits(c, map(2)), "Mods.basesFor / mapFits: a map's bases (at most @bases' most; too few: -1)");
  }

  await Mods.load();

  // ---------------------------------------------------------------- @hide: the game's defaults whatever was asked
  {
    const src = head(["@hide winScore, roundTime, friendlyFire, size, sight"]);
    const e = new E(1, { slots: slots([1, 2, 1, 2]), winScore: 7, roundTime: 5, friendlyFire: true, size: "large", sight: "walls", mod: { source: src } });
    check(e.winScore === 3 && e.roundTime === 0 && e.friendlyFire === false && e.size === "medium" && e.sight === "full",
      "@hide: those options are the game's defaults (" + [e.winScore, e.roundTime, e.friendlyFire, e.size, e.sight].join() + ")");
    const f = new E(1, { slots: slots([1, 2, 1, 2]), winScore: 7, roundTime: 5, friendlyFire: true, size: "large", mod: { source: head([]) } });
    check(f.winScore === 7 && f.roundTime === 5 && f.friendlyFire === true && f.size === "large", "  without @hide: as asked");
    e.dispose(); f.dispose();
  }

  // ---------------------------------------------------------------- settings reach the mod
  {
    const src = head(['@setting laps "Laps" 1, 2, 3 = 2', '@setting shots "Shots" 0, 1 = 1'],
      `globalThis.T = {};
mod({ init(g) { T.s = g.settings; T.frozen = Object.isFrozen(g.settings); try { g.settings.laps = 9; } catch (x) { T.threw = true; } T.after = g.settings.laps; } });`);
    const a = engineWith(src, { opts: { modSettings: { laps: 3, shots: 0 } } }), b = engineWith(src, { opts: { modSettings: { laps: 7, other: 1 } } });
    const Ta = sandboxT(a), Tb = sandboxT(b);
    check(JSON.stringify(Ta.s) === '{"laps":3,"shots":0}' && Ta.frozen && Ta.after === 3 && JSON.stringify(a.modInfo.settings) === '{"laps":3,"shots":0}',
      "g.settings: the values asked (engine option modSettings; engine.modInfo.settings), frozen");
    check(JSON.stringify(Tb.s) === '{"laps":2,"shots":1}', "g.settings: a value that isn't a choice, a missing one - the defaults");
    a.dispose(); b.dispose();
  }

  // ---------------------------------------------------------------- a generated world with @bases
  {
    const src = head(["@bases 2 - 8"], `globalThis.T = {};
mod({ round(g) { T.bases = g.bases(); T.t = []; for (let p = 1; p <= g.players; p++) T.t.push(g.tank(p).base); } });`);
    for (const [teams, size, nb, want] of [[[1, 2], "small", 5, 5], [[1, 2, 3, 4, 5, 6, 7, 8], "small", 2, 2], [[1, 2, 1, 2], "medium", undefined, 6], [[1, 2, 3], "large", undefined, 8]]) {
      const e = engineWith(src, { teams, size, opts: { modBases: nb } });
      toFrame(e, 1);
      const T = sandboxT(e), N = e.nPlayers;
      let far = true;
      for (let i = 1; i <= e.nBases; i++) for (let j = i + 1; j <= e.nBases; j++)
        if (e.distance(Math.abs(e.baseX[i] - e.baseX[j]), Math.abs(e.baseY[i] - e.baseY[j])) < 40) far = false;
      let walls = true;
      for (let b = 1; b <= e.nBases; b++) {
        const own = b <= N ? e.playerColor(e.teamMembers(e.team(b))[0]) : 13;
        if (e.getPixel(e.baseX[b] - 17, e.baseY[b]) !== own || e.getPixel(e.baseX[b] + 10, e.baseY[b] + 17) !== own || e.baseOwnerOf(b) !== (b <= N ? e.team(b) : -1)) walls = false;
      }
      let homes = true;
      for (let p = 1; p <= N; p++) if (e.home[p] !== (p - 1) % e.nBases + 1 || !inBase(e, p, e.home[p]) || T.t[p - 1].i !== e.home[p] - 1) homes = false;
      check(e.nBases === want && T.bases.length === want && T.bases.every((b, i) => b.i === i && b.x === e.baseX[i + 1] && b.y === e.baseY[i + 1] && b.owner === e.baseOwnerOf(i + 1)) && far,
        N + " tanks, " + size + (nb ? ", modBases " + nb : "") + ": " + e.nBases + " bases (g.bases), apart");
      check(walls, "  every base's walls: its first owner's colour (base b: player b's team - its first tank's), past the tanks nobody's - gray (13)");
      check(homes && apart(e), "  no setup: tank p in base (p - 1) % bases, free spots (" + Array.from({ length: N }, (_, i) => e.tankX[i + 1] - e.baseX[e.home[i + 1]] + "," + (e.tankY[i + 1] - e.baseY[e.home[i + 1]])).join(" ") + ")");
      const s = e.state();
      check(s.bases.length === want && s.players[0].baseX === e.baseX[e.home[1]], "  engine.state(): bases, a tank's home");
      e.dispose();
    }
    // the same seed, the same world and play: deterministic
    const run = () => { const r = runMatch({ slots: slots([1, 2, 3]), levels: ["normal", "hard", "easy"], seed: 9, size: "small", winScore: 1, maxFrames: 40000,
      mods: { mod: { source: src }, modBases: 5 } }); r.engine.dispose(); return r; };
    const r1 = run(), r2 = run();
    check(r1.finished && r1.stateHash === r2.stateHash && r1.bitsHash === r2.bitsHash && r1.frames === r2.frames, "@bases: a match of computer tanks finishes, the same in two runs (" + r1.frames + " frames)");
    // a mod without @bases: one base per tank, as ever
    const e = engineWith(head([]), { teams: [1, 2, 3] });
    check(e.nBases === 3 && e.baseOwner === null && e.home === null && e.homeOf(2) === 2 && e.baseOwnerOf(2) === e.team(2) && e.baseColor(3) === e.playerColor(3),
      "no @bases: a base per tank, base p is player p's");
    e.dispose();
  }

  // ---------------------------------------------------------------- a custom map with @bases
  {
    const m = MapData.blank("small");
    for (let y = 30; y < 34; y++) for (let x = 12; x < m.w - 12; x++) m.cells[y * m.w + x] = MapData.TUNNEL;
    for (const [x, y] of [[26, 32], [100, 32], [63, 16], [63, 48]]) m.bases.push({ x, y });
    MapData.frame(m);
    const code = MapData.code(m), px = m.bases.map(MapData.basePx);
    const e = engineWith(head(["@bases 3 - 8"]), { teams: [1, 2], opts: { map: code } });
    check(e.nBases === 4 && px.every((b, i) => e.baseX[i + 1] === b.x && e.baseY[i + 1] === b.y), "a map: its bases in its order, as many as @bases allows (4)");
    e.dispose();
    const f = engineWith(head(["@bases 2 - 3"]), { teams: [1, 2, 3, 4, 5], opts: { map: code } });
    check(f.nBases === 3 && f.baseX[3] === px[2].x && apart(f), "a map with more bases than @bases' most: the first ones (3); 5 tanks in them");
    f.dispose();
    let problem = null;
    try { new E(1, { slots: slots([1, 2]), map: code, mod: { source: head(["@bases 5 - 8"]) } }); } catch (x) { problem = x.problem; }
    check(problem === "mapbases", "a map with fewer bases than @bases' least: refused (problem mapbases)");
  }

  // ---------------------------------------------------------------- setup: g.spawn, g.place - free spots
  {
    const src = head(["@bases 3"], `globalThis.T = { calls: 0 };
mod({
  setup(g) {
    T.calls++; T.frame = g.frame;
    for (let p = 1; p <= g.players; p++) g.spawn(p, 0);
  },
  frame(g) {
    if (g.frame === 2) { const b = g.bases()[1]; for (let p = 1; p <= g.players; p++) g.place(p, b.x, b.y); }
    if (g.frame === 3) { const b = g.bases()[2]; for (let p = 1; p <= g.players; p++) g.place(p, b.x + 60, b.y); }
    if (g.frame === 4) { g.destroy(3); g.spawn(3, 2); }
    if (g.frame === 5) { try { g.spawn(1, 3); } catch (x) { T.err = x.message; } try { g.place(1, 2, 2); } catch (x) { T.err2 = x.message; } }
  },
});`);
    const e = engineWith(src, { teams: [1, 2, 3, 4, 5, 6, 7, 8], size: "small" });
    toFrame(e, 1);
    const floor = p => Math.abs(e.tankX[p] - e.baseX[1]) <= 13 && Math.abs(e.tankY[p] - e.baseY[1]) <= 13;
    check([1, 2, 3, 4, 5, 6, 7, 8].every(p => floor(p) && e.home[p] === 1) && apart(e) && e.tankX[1] === e.baseX[1] && e.tankY[1] === e.baseY[1],
      "setup: g.spawn(p, 0) x 8 - all on base 0's floor, the middle first, none on another (" + [1, 2, 3, 4, 5, 6, 7, 8].map(p => (e.tankX[p] - e.baseX[1]) + "," + (e.tankY[p] - e.baseY[1])).join(" ") + ")");
    toFrame(e, 2);
    check([1, 2, 3, 4, 5, 6, 7, 8].every(p => inBase(e, p, 2) || Math.max(Math.abs(e.tankX[p] - e.baseX[2]), Math.abs(e.tankY[p] - e.baseY[2])) < 40) && apart(e) &&
      e.tankX[1] === e.baseX[2] && e.home[1] === 1, "g.place x 8 at one spot: there, then the nearest free spots (its home unchanged)");
    toFrame(e, 3);
    check(apart(e) && e.tankX[1] === e.baseX[3] + 60, "g.place x 8 out in the dirt: the first there, the others on dug-out spots near it, apart");
    toFrame(e, 4);
    check(e.alive[3] && e.home[3] === 3 && inBase(e, 3, 3) && apart(e), "g.spawn of a destroyed tank: back in that base, its home now");
    toFrame(e, 6);
    const T = sandboxT(e);
    check(T.calls === 1 && T.frame === 0 && /g.spawn: no base 3/.test(T.err) && /g.place: outside the world/.test(T.err2) && !e.modStopped, "g.spawn / g.place: wrong ones throw (" + T.err + "; " + T.err2 + ")");
    e.dispose();
    // without @bases: setup moves tanks between the players' own bases
    const src2 = head([], "mod({ setup(g) { g.spawn(2, 0); g.spawn(3, 0); } });");
    const f = engineWith(src2, { teams: [1, 2, 3, 4] });
    toFrame(f, 1);
    check(inBase(f, 1, 1) && f.tankX[2] === f.baseX[1] && inBase(f, 3, 1) && f.tankX[4] === f.baseX[4] && f.tankY[4] === f.baseY[4] && apart(f),
      "no @bases: setup's g.spawn into another's base - free spots; the tanks it didn't put anywhere in their own base");
    f.dispose();
  }

  // ---------------------------------------------------------------- g.setOwner: walls, refuel, repair
  {
    const src = head(["@bases 3"], `globalThis.T = {};
mod({
  rules: { idleCost: 0, foeEnergy: 25 },
  setup(g) { g.setOwner(0, 0); g.setOwner(1, 1); g.setOwner(2, -1); g.spawn(1, 0); g.spawn(2, 0); g.spawn(3, 2); },
  frame(g) {
    const f = g.frame;
    if (f === 2 || f === 5 || f === 8) for (let p = 1; p <= 3; p++) { g.setEnergy(p, 1000); g.setShield(p, 1000); }
    if (f === 4) { g.setOwner(2, 1); g.setOwner(0, 1); }
    if (f === 7) g.setOwner(0, 0);
    if (f === 9) { try { g.setOwner(0, 5); } catch (x) { T.err = x.message; } }
  },
  baseUsable(g, base, p) { return !(g.frame >= 7 && base === 2 && p === 3); },
});`);
    // tanks 1 + 3 team 1 (index 0), tank 2 team 2 (index 1)
    const e = engineWith(src, { teams: [1, 2, 1] });
    const wall = b => e.getPixel(e.baseX[b] - 17, e.baseY[b]);
    toFrame(e, 1);
    check(wall(1) === e.playerColor(1) && wall(2) === e.playerColor(2) && wall(3) === 13 && e.baseOwnerOf(3) === -1, "g.setOwner in setup: the walls in the owner team's colour, nobody's gray");
    toFrame(e, 3);
    check(e.energy[1] === 1080 && e.shield[1] === 1040, "the owner's tank refuels and repairs (baseEnergy, baseShield): " + e.energy[1] + " / " + e.shield[1]);
    check(e.energy[2] === 1025 && e.shield[2] === 1000, "another team's tank in it: refuels foeEnergy, no repair: " + e.energy[2] + " / " + e.shield[2]);
    check(e.energy[3] === 1000 && e.shield[3] === 1000, "nobody's base: nothing");
    toFrame(e, 4);
    check(wall(3) === e.playerColor(2) && wall(1) === e.playerColor(2) && e.baseOwnerOf(1) === 1, "g.setOwner during the round: the walls redrawn");
    toFrame(e, 6);
    check(e.energy[1] === 1025 && e.shield[1] === 1000 && e.energy[2] === 1080 && e.shield[2] === 1040 && e.energy[3] === 1025, "the base taken: its new owner's tanks refuel as in their own, the others as in an enemy's");
    toFrame(e, 9);
    check(e.energy[3] === 1000 && e.energy[1] === 1080, "baseUsable(g, base, p): base = its index in g.bases() - false: no refuel");
    toFrame(e, 10);
    check(/g.setOwner: team -1..1/.test(sandboxT(e).err), "g.setOwner: a team that isn't - throws");
    // the computer tanks: the nearest base their team owns
    const ai = new TunnelerAI("normal", 1, { seed: 1 });
    const near = ai.refuelBase(e, e.baseX[1], e.baseY[1], true), any = ai.refuelBase(e, e.baseX[1], e.baseY[1], false);
    check(near && near.x === e.baseX[1] && near.repair && any.x === e.baseX[1], "a computer tank refuels at the nearest base its team owns");
    e.setBaseOwner(1, 1);
    const far = ai.refuelBase(e, e.baseX[1], e.baseY[1], true), foe = ai.refuelBase(e, e.baseX[1], e.baseY[1], false);
    check(far === null && foe && !foe.repair, "  none of its team's: no retreat for repairs (null); for energy an enemy's base (foeEnergy > 0)");
    e.dispose();
    const g = engineWith(head([], "mod({ frame(g) { if (g.frame === 2) g.setOwner(0, 1); } });"), {});
    toFrame(g, 3);
    check(g.modStopped === "error" && /only a mod with/.test(g.modNote.detail), "g.setOwner without @bases: throws (the mod stops)");
    g.dispose();
  }

  // ---------------------------------------------------------------- the example mods: Race, Conquest
  {
    const runs = [
      ["race", { laps: 1 }, [1, 2, 3, 4], "small", 1],
      ["race", { laps: 2, shots: 0 }, [1, 2, 3, 4, 5, 6, 7, 8], "small", 2],
      ["race", { laps: 1, shots: 1 }, [1, 2, 1, 2], "medium", 3],
      ["conquest", { points: 20 }, [1, 2, 1, 2], "small", 1],
      ["conquest", { points: 20, capture: 3 }, [1, 2, 3], "small", 2],
      ["conquest", { points: 20 }, [1, 2, 1, 2, 1, 2], "medium", 3],
    ];
    let worst = 0;
    for (const [name, settings, teams, size, seed] of quick ? runs.filter((r, i) => i % 3 !== 2) : runs) {
      const src = modFile(name), hd = Mods.check(src);
      let stop = null, captured = 0, walls = -1;
      Mods.onEvent(ev => { if (ev.kind === "stop") stop = ev; });
      const o = { slots: slots(teams), levels: teams.map((t, i) => ["normal", "hard", "easy"][i % 3]), seed, size, winScore: 1, maxFrames: 40000,
        mods: { mod: { source: src }, modSettings: settings },
        onFrame: e => {
          worst = Math.max(worst, Mods.ticks(e));
          if (name === "conquest" && e.baseOwner && e.screen === "play") captured = Math.max(captured, e.baseOwner.filter((n, b) => b && n).length);
          // (Race: no walls round the bases - owner, 2026-11-02 - counted on the wall lines, tanks aside, once in play)
          if (name === "race" && e.screen === "play" && e.modF === 2) {
            walls = 0;
            const tank = (x, y) => { for (let p = 1; p <= e.nPlayers; p++) if (e.alive[p] && Math.abs(x - e.tankX[p]) <= 4 && Math.abs(y - e.tankY[p]) <= 4) return true; return false; };
            for (let q = 1; q <= e.nBases; q++) for (let d = -17; d <= 17; d++)
              for (const [x, y] of [[e.baseX[q] + d, e.baseY[q] - 17], [e.baseX[q] + d, e.baseY[q] + 17], [e.baseX[q] - 17, e.baseY[q] + d], [e.baseX[q] + 17, e.baseY[q] + d]])
                if (E.PixelClassExt[e.getPixel(x, y)] === 3 && !tank(x, y)) walls++;
          }
        } };
      const a = runMatch(o), b = runMatch(Object.assign({}, o, { onFrame: null }));
      const e = a.engine;
      check(hd.ok && a.finished && !stop && a.rounds.length >= 1, name + " " + JSON.stringify(settings) + ", " + teams.length + " computer tanks, " + size + ": the match finishes (" +
        a.frames + " frames, " + e.nBases + " bases, rounds " + JSON.stringify(a.rounds.map(r => r.winnerTeam)) + ")");
      check(a.stateHash === b.stateHash && a.bitsHash === b.bitsHash && a.frames === b.frames, "  the same in a second run");
      if (name === "race") check(a.rounds.some(r => r.winnerTeam >= 0) && walls === 0, "  a tank drove every lap: its team won; the bases without walls (" + walls + " wall pixels)");
      // (shots off: nobody shoots at all - rules maxShots 0; owner, 2026-11-02)
      if (name === "race" && settings.shots === 0) { const fired = Array.from(e.shotsFired).reduce((x, y) => x + y, 0); check(fired === 0 && e.R.maxShots === 0, "  shots off: no tank fired (" + fired + ")"); }
      if (name === "conquest") check(captured > Math.min(e.nTeams, e.nBases - 1), "  bases taken (" + captured + " owned at most)");
      a.engine.dispose(); b.engine.dispose();
    }
    check(Mods.BUDGET >= 10 * (worst + 1), "the budget (" + Mods.BUDGET + ") keeps 10x room above Race's and Conquest's worst call (" + worst + ", up to " + (worst + 1) + ")");
  }
  // Race: a checkpoint counts only with the tank over the base (owner, 2026-11-02: "not around it") - 20 px below its
  // middle: not yet; on it: the next one
  {
    const src = modFile("race");
    const e = startEngine(1, { slots: slots([1, 2]), size: "small", winScore: 1, extended: true, match: true, mod: { id: Mods.idOf(src), source: src } });
    // (the base tank 1 heads for: its aiGoal - the next checkpoint's middle; base index 1 = the engine's base 2)
    const at = q => e.baseX[q] + "," + e.baseY[q], next = () => { const a = e.modC.ai[1]; return a ? a.x + "," + a.y : ""; }, b = 2;
    const stay = (x, y) => { for (let i = 0; i < 4; i++) { e.putTank(1, x, y, 0); e.step({ bits: [0, 0], keys: [] }); } };
    const n0 = next();
    stay(e.baseX[b], e.baseY[b] + 20);
    const near = next();
    stay(e.baseX[b] + 15, e.baseY[b] + 15);              // (its corner - owner, 2026-11-02: "not hit in the base corner")
    check(n0 === at(2) && near === at(2) && next() === at(3), "Race: a checkpoint 20 px away doesn't count, over the base's corner it does (" + [n0, near, next()].join(" -> ") + ")");
    e.dispose();
  }
  // Race: the hud shows the tank's place (owner, 2026-11-02) - the tank on the next base first, the one far away second
  {
    const src = modFile("race");
    const e = startEngine(1, { slots: slots([1, 2]), size: "small", winScore: 1, extended: true, match: true, mod: { id: Mods.idOf(src), source: src } });
    const step = () => e.step({ bits: [0, 0], keys: [] });
    for (let i = 0; i < 4; i++) { e.putTank(1, e.baseX[2] + 30, e.baseY[2] + 30, 0); e.putTank(2, e.baseX[2], e.baseY[2] - 20, 0); step(); }
    const before = [e.GM.hud(e, 1).value, e.GM.hud(e, 2).value];
    for (let i = 0; i < 4; i++) { e.putTank(1, e.baseX[2], e.baseY[2], 0); step(); }
    const after = [e.GM.hud(e, 1).value, e.GM.hud(e, 2).value], text = require("./src.js").Lang.decode(e.GM.scoreText(e, 1));
    check(before.join() === "2,1" && after.join() === "1,2" && /^place 1, lap 1\/\d$/.test(text), "Race: the hud shows the place - nearer the next base ahead, a checkpoint reached first (" + before + " -> " + after + ", \"" + text + "\")");
    e.dispose();
  }
  // Race with shots off: computer tanks never wait for each other for ever - at a checkpoint's doorway (it counts from
  // there: seed 5 jammed three tanks in front of one gap), or behind a tank that doesn't move put in front of a doorway
  // of the start (the floor spots in line with the doorways last: seeds 22 / 27 / 29 / 30 shut a doorway)
  {
    const src = modFile("race"), lv = ["hard", "hard", "normal"];
    for (const [seed, idle] of quick ? [[5, false], [22, true]] : [[5, false], [22, true], [27, true], [29, true], [30, true]]) {
      const levels = idle ? lv.concat([null]) : lv;
      const a = runMatch({ slots: slots(levels.map((l, i) => i + 1)), levels, seed, size: "small", winScore: 1, maxFrames: 12000,
        mods: { mod: { source: src }, modSettings: { laps: 1, shots: 0 } } });
      check(a.finished && a.rounds.some(r => r.winnerTeam >= 0), "Race, shots off, seed " + seed + (idle ? ", a tank that never moves in the start base" : "") +
        ": a computer tank finishes (" + a.frames + " frames)");
      a.engine.dispose();
    }
  }

  H.done("mods-setup-check");
})().catch(e => { console.log(e && e.stack || e); process.exitCode = 1; });
