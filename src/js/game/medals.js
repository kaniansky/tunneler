// Medals (1.4, owner 2026-11-01): goals beyond winning, kept per player - in this browser (localStorage "tunneler.medals":
// {id: the day earned, "YYYY-MM-DD"}) and with the account (cloudsave.js: a setting, merged - a medal earned on any
// device stays). Display only: nothing here enters the engine (the tracker wraps this engine object's killTankExt and
// only reads, as challenge.js's), so it never changes a game, online or a replay.
//   const t = Medals.track(engine)           a match's kills and losses per player (from outside the engine)
//   Medals.afterMatch(engine, t, info)       -> the medals earned now (ids, in LIST order; saved)
//     info = {kind: "skirmish" | "challenge" | "training" | "split" | "online", me (1-based: your tank), levels (per
//     player: a computer tank's level, null = a human), weekly (the challenge on the map of the week), p2 (player 2 played:
//     the split screen), official (an official mod's key - its mode's medal: "hill"...)}
//   Medals.earn(id)                          -> true when new (saved) - things that aren't a match: a map published ("maker"), a mod
//                                            published ("modmaker", 1.5)
//   Medals.earned()                          {id: day}    Medals.merge(a, b) -> the union of two stored values (JSON)
//   Medals.LIST                              [{id}] - their names / how to earn them: src/lang/<code>/medals.js
//   Medals.name(id, Lang) / how(id, Lang)    raw text
const KEY = "tunneler.medals", STREAK = "tunneler.medals.days";
const MODES = ["gold", "infection", "survival", "hill", "shrink", "ctf", "siege", "deathmatch"];
const LIST = [
  { id: "training" }, { id: "first" }, { id: "split" }, { id: "five" }, { id: "flawless" }, { id: "sniper" }, { id: "digger" },
  { id: "hard" }, { id: "seven" },
  { id: "challenge" }, { id: "challenge.win" }, { id: "streak" }, { id: "weekly" },
  { id: "online" }, { id: "online.win" }, { id: "maker" }, { id: "modmaker" },
  ...MODES.map(m => ({ id: "mode." + m })), { id: "allmodes" },
];
const DIG = 300, SNIPER = 0.6, SNIPER_SHOTS = 20, KILLS = 5, STREAK_DAYS = 7;

const ls = {
  get(k) { try { return globalThis.localStorage ? localStorage.getItem(k) : null; } catch (e) { return null; } },
  set(k, v) { try { if (globalThis.localStorage) localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
};
const today = () => new Date().toISOString().slice(0, 10);
const parse = s => { try { const o = JSON.parse(s || "{}"); return o && typeof o === "object" && !Array.isArray(o) ? o : {}; } catch (e) { return {}; } };
const known = new Set(LIST.map(m => m.id));
function earned() {
  const o = parse(ls.get(KEY)), out = {};
  for (const k of Object.keys(o)) if (known.has(k) && /^\d{4}-\d{2}-\d{2}$/.test(o[k])) out[k] = o[k];
  return out;
}
// two stored values together: every medal of either, the earlier day (JSON; unknown ids kept - a newer version's)
function merge(a, b) {
  const x = parse(a), y = parse(b), out = Object.assign({}, x);
  for (const k of Object.keys(y)) if (typeof y[k] === "string" && (!out[k] || y[k] < out[k])) out[k] = y[k];
  const keys = Object.keys(out).sort();
  return keys.length ? JSON.stringify(Object.fromEntries(keys.map(k => [k, out[k]]))) : null;
}
function save(ids) {
  if (!ids.length) return;
  const o = parse(ls.get(KEY)), d = today();
  for (const id of ids) if (!o[id]) o[id] = d;
  ls.set(KEY, merge(JSON.stringify(o), null));
}
function earn(id) {
  if (!known.has(id) || earned()[id]) return false;
  save([id]);
  return true;
}

// kills / losses per player (1-based): a tank destroyed while alive (its killer an enemy: a kill for it)
function track(e) {
  const t = { kills: new Array((e.nPlayers || 2) + 1).fill(0), lost: new Array((e.nPlayers || 2) + 1).fill(0) };
  const kill = e.killTankExt;
  if (typeof kill !== "function") return t;
  e.killTankExt = function (p, x, y) {
    const alive = !!this.alive[p], k = this.killedBy ? this.killedBy[p] | 0 : 0;
    const ret = kill.call(this, p, x, y);
    if (alive) { t.lost[p]++; if (k > 0 && k !== p && (!this.isEnemy || this.isEnemy(k, p))) t.kills[k]++; }
    return ret;
  };
  return t;
}

function afterMatch(e, t, info) {
  const me = info.me | 0, kind = info.kind, levels = info.levels || [];
  if (!e || me < 1) return [];
  const have = earned(), got = [];
  const add = id => { if (!have[id] && !got.includes(id)) got.push(id); };
  const won = (e.wins[me] | 0) >= (e.winScore || 1);
  const vsComputer = kind === "skirmish" || kind === "challenge";
  const foes = [];
  for (let p = 1; p <= e.nPlayers; p++) if (p !== me && (!e.isEnemy || e.isEnemy(me, p))) foes.push(p);
  if (kind === "training" && won) add("training");
  // (a match with player 2 - the split screen, 1.5 the skirmish's View: Split screen - computer tanks or not)
  if (kind === "split" || (kind === "skirmish" && info.p2)) add("split");
  if (won && kind !== "split" && kind !== "training") add("first");   // (owner, 2026-11-01: not the training ground)
  if (kind !== "training") {
    if (t && t.kills[me] >= KILLS) add("five");
    if (won && t && !t.lost[me] && kind !== "split") add("flawless");
    if (e.shotsFired[me] >= SNIPER_SHOTS && e.shotsHit[me] >= SNIPER * e.shotsFired[me]) add("sniper");
    if (e.metersDug[me] >= DIG) add("digger");
  }
  if (won && vsComputer && foes.length && foes.every(p => levels[p - 1] === "hard")) add("hard");
  if (won && vsComputer && e.nPlayers === 8 && foes.length === 7 && foes.every(p => levels[p - 1])) add("seven");
  if (kind === "challenge") {
    add("challenge");
    if (won) add("challenge.win");
    if (info.weekly) add("weekly");
    // (7 days in a row: the days a challenge was played, the last 7 kept)
    const days = (ls.get(STREAK) || "").split(",").filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
    const d = info.day || today();
    if (!days.includes(d)) days.push(d);
    days.sort();
    const last = days.slice(-STREAK_DAYS);
    ls.set(STREAK, last.join(","));
    const DAY = 86400000, at = s => Date.parse(s + "T00:00:00Z");
    if (last.length === STREAK_DAYS && at(last[STREAK_DAYS - 1]) - at(last[0]) === (STREAK_DAYS - 1) * DAY) add("streak");
  }
  if (kind === "online") { add("online"); if (won) add("online.win"); }
  // (1.5: the game's modes are official mods - info.official: the official mod's key, net/official.js)
  const mode = info.official || e.gameMode;
  if (won && kind !== "split" && MODES.includes(mode)) add("mode." + mode);
  if (MODES.every(m => have["mode." + m] || got.includes("mode." + m))) add("allmodes");
  const out = LIST.map(m => m.id).filter(id => got.includes(id));
  save(out);
  return out;
}

// a medal's name / how to earn it (raw text; L = Lang): the game modes' share one, with the mode's name
const name = (id, L) => id.startsWith("mode.") ? (L.raw("medal.mode") || "").replace("{mode}", L.raw("gm." + id.slice(5)) || id.slice(5)) : L.raw("medal." + id) || id;
const how = (id, L) => L.raw(id.startsWith("mode.") ? "medal.mode.i" : "medal." + id + ".i") || "";

export const Medals = { KEY, LIST, MODES, DIG, SNIPER, SNIPER_SHOTS, KILLS, STREAK_DAYS, track, afterMatch, earn, earned, merge, name, how };
