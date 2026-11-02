"use strict";
// Medals (1.4, src/js/game/medals.js): earned after matches by what the engine says (won, kills, losses, shots, digging,
// the opponents' levels, the mode, the kind of game), kept in localStorage tunneler.medals {id: day}, each once; the
// challenge's 7 days in a row; a map published; two devices' medals merged (cloudsave: never one over the other); the
// tracker only reads (a match with it plays exactly as without); every medal has its texts in every language.
//   node test/medals-check.js
const path = require("path");
const store = new Map();
globalThis.localStorage = { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
const H = require("./modes-harness.js");
const { Lang } = require("./src.js");
const { Medals } = require(path.join(__dirname, "..", "src", "js", "game", "medals.js"));
const check = H.check;

// a match of computer tanks with the tracker on (player 1 = "you": its computer player plays for it)
function play(o) {
  let t = null;
  const r = H.runMatch(Object.assign({ seed: 3, size: "small", winScore: 1, maxFrames: 60000, onFrame: (e, f) => { if (!f) t = Medals.track(e); } }, o));
  return { r, e: r.engine, t };
}
const reset = () => store.clear();

console.log("the tracker only reads");
{
  const a = play({ slots: H.slots([1, 2, 3]), levels: ["hard", "normal", "easy"] });
  const b = H.runMatch({ slots: H.slots([1, 2, 3]), levels: ["hard", "normal", "easy"], seed: 3, size: "small", winScore: 1, maxFrames: 60000 });
  check(a.r.bitsHash === b.bitsHash && a.r.stateHash === b.stateHash, "a match with it: the same bits and stateHash as without");
  check(a.t.kills.reduce((x, y) => x + y, 0) >= 2 && a.t.lost.reduce((x, y) => x + y, 0) >= 2, "kills and losses counted (" + a.t.kills + " / " + a.t.lost + ")");
}

console.log("after a match");
{
  reset();
  // find a seed where BLUE (hard) wins against one hard tank
  let m = null;
  for (let s = 1; s < 30 && !m; s++) { const x = play({ slots: H.slots([1, 2]), levels: ["hard", "hard"], seed: s }); if (x.e.wins[1] >= 1) m = x; }
  const got = Medals.afterMatch(m.e, m.t, { kind: "skirmish", me: 1, levels: [null, "hard"] });
  check(got.includes("first") && got.includes("hard"), "a won skirmish against a hard tank: first victory + veteran (" + got + ")");
  check(!!Medals.earned().first && /^\d{4}-\d{2}-\d{2}$/.test(Medals.earned().first), "kept with the day it was earned");
  check(!Medals.afterMatch(m.e, m.t, { kind: "skirmish", me: 1, levels: [null, "hard"] }).includes("first"), "each medal once");
  check(!Medals.afterMatch(m.e, m.t, { kind: "skirmish", me: 1, levels: [null, "easy"] }).includes("hard") || got.includes("hard"), "veteran only against hard tanks");
  const lost = Medals.afterMatch(m.e, m.t, { kind: "skirmish", me: 2, levels: ["hard", null] });
  check(!lost.includes("flawless"), "the loser: no flawless");
  reset();
  const sp = Medals.afterMatch(m.e, m.t, { kind: "split", me: 1, levels: [null, null] });
  check(sp.includes("split") && !sp.includes("first") && !sp.includes("flawless"), "split screen: its own medal, no victory medals (" + sp + ")");
  reset();
  // (1.5: a skirmish with player 2 and computer tanks - View: Split screen - earns it too)
  const sk = Medals.afterMatch(m.e, m.t, { kind: "skirmish", p2: true, me: 1, levels: [null, null] });
  check(sk.includes("split"), "a skirmish with player 2: the split screen's medal (" + sk + ")");
  reset();
  const tr = Medals.afterMatch(m.e, m.t, { kind: "training", me: 1, levels: [null, "easy"] });
  check(tr.includes("training") && !tr.includes("first") && !tr.includes("digger"), "the training ground won: recruit - not first victory");
  reset();
  const on = Medals.afterMatch(m.e, m.t, { kind: "online", me: 1, levels: [null, null] });
  check(on.includes("online") && on.includes("online.win"), "online: played and won");
}

console.log("thresholds and modes");
{
  reset();
  const fake = (o) => Object.assign({ nPlayers: 2, wins: [0, 1, 0], winScore: 1, shotsFired: [0, 0, 0], shotsHit: [0, 0, 0], metersDug: [0, 0, 0], gameMode: "standard", isEnemy: () => true }, o);
  const t0 = { kills: [0, 0, 0], lost: [0, 0, 0] };
  check(Medals.afterMatch(fake({ shotsFired: [0, 20, 0], shotsHit: [0, 12, 0] }), t0, { kind: "skirmish", me: 1 }).includes("sniper"), "sharpshooter: 12 of 20");
  check(!Medals.afterMatch(fake({ shotsFired: [0, 19, 0], shotsHit: [0, 19, 0] }), t0, { kind: "skirmish", me: 1 }).includes("sniper") || !!Medals.earned().sniper, "not with fewer than 20 shots");
  check(Medals.afterMatch(fake({ metersDug: [0, Medals.DIG, 0] }), t0, { kind: "skirmish", me: 1 }).includes("digger"), "mole: " + Medals.DIG + " dug");
  check(Medals.afterMatch(fake({}), { kills: [0, 5, 0], lost: [0, 1, 0] }, { kind: "skirmish", me: 1 }).includes("five"), "tank buster: 5 kills");
  const e8 = fake({ nPlayers: 8, wins: [0, 1, 0, 0, 0, 0, 0, 0, 0] });
  check(Medals.afterMatch(e8, t0, { kind: "skirmish", me: 1, levels: [null, "easy", "easy", "easy", "easy", "easy", "easy", "easy"] }).includes("seven"), "against all odds: 7 computer tanks");
  for (const m of Medals.MODES) Medals.afterMatch(fake({ gameMode: m }), t0, { kind: "skirmish", me: 1 });
  check(Medals.MODES.every(m => Medals.earned()["mode." + m]) && !!Medals.earned().allmodes, "a medal per mode won, and all of them: all-rounder");
}

console.log("the daily challenge");
{
  reset();
  const e = { nPlayers: 2, wins: [0, 0, 0], winScore: 3, shotsFired: [0, 0, 0], shotsHit: [0, 0, 0], metersDug: [0, 0, 0], gameMode: "standard" };
  const t0 = { kills: [0, 0, 0], lost: [0, 0, 0] };
  const days = ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"];
  let streak = false;
  for (const d of days) if (Medals.afterMatch(e, t0, { kind: "challenge", me: 1, day: d, weekly: d === "2026-11-01" }).includes("streak")) streak = true;
  check(!!Medals.earned().challenge && !!Medals.earned().weekly && !Medals.earned()["challenge.win"], "played (not won); on a Sunday's map: map of the week");
  check(!streak, "7 days with a gap: no streak");
  for (const d of ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14"]) if (Medals.afterMatch(e, t0, { kind: "challenge", me: 1, day: d }).includes("streak")) streak = true;
  check(streak, "7 days in a row: a whole week");
}

console.log("stored, merged, published");
{
  reset();
  check(Medals.earn("maker") === true && Medals.earn("maker") === false && !!Medals.earned().maker, "a map published: map maker, once");
  check(Medals.earn("nonsense") === false, "an unknown medal: nothing");
  const m = Medals.merge('{"first":"2026-11-03","maker":"2026-11-01"}', '{"first":"2026-11-02","five":"2026-11-04"}');
  check(m === '{"first":"2026-11-02","five":"2026-11-04","maker":"2026-11-01"}', "two devices merged: every medal of both, the earlier day (" + m + ")");
  check(Medals.merge(null, null) === null && Medals.merge("junk", '{"five":"2026-11-04"}') === '{"five":"2026-11-04"}', "nothing / junk on one side");
  store.set(Medals.KEY, '{"first":"2026-11-02","newer.version":"2026-11-02"}');
  check(Object.keys(Medals.earned()).join() === "first", "a newer version's medal kept in storage, not shown");
}

console.log("texts");
for (const c of Lang.codes) {
  Lang.set(c);
  const missing = Medals.LIST.filter(m => !Medals.name(m.id, Lang) || Medals.name(m.id, Lang) === m.id || !Medals.how(m.id, Lang));
  check(!missing.length, c + ": every medal named and explained (" + missing.map(m => m.id) + ")");
}
Lang.set("en");
H.done("medals-check");
