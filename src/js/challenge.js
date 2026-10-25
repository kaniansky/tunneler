// The daily challenge (docs/v6/CHALLENGE.md): every UTC day one skirmish that is the same for everybody - its world
// (seed), map size, game mode, computer opponents, rounds to win, round time, line of sight, friendly fire - drawn
// from the day's date alone ("2026-10-25"), here, for the pages and the server alike. A result is sent as the
// match's replay (replay.js); the server plays it again with its own computer players (verify) and puts what really
// happened on the day's leaderboard.
//
//   Challenge.dayOf(Date.now()) -> "2026-10-25"    dayStart(day) / dayEnd(day) -> ms   validDay(day)
//   const cfg = Challenge.config(day)               {day, seed, mode, goal, size, winScore, roundTime, friendlyFire, sight, slots}
//   Challenge.query(cfg)                            the skirmish link's query (play.js builds the engine from it)
//   Challenge.engineOptions(cfg)                    the engine options play.js builds from that query
//   const kills = Challenge.track(engine)           kills per player, counted from outside the engine
//   Challenge.result(engine, kills, steps)          {rounds, won, kills, secs} - BLUE's (you are always BLUE)
//   Challenge.compare(a, b)                         the leaderboard's order (< 0: a is better)
//   Challenge.verify(rep, {Engine, AI, day, name})  {code: null, result, replay (cleaned)} or {code: "config" | "differs" | ...}
//
// Nothing here runs inside the engine: the day's numbers come from integer maths on its date (never the engine's
// Random()), the kill count wraps the engine object's killTankExt and only reads.
import { NetProto } from "./netproto.js";
import { Replay } from "./replay.js";

const DAY = 86400000;
const GRACE_MS = 2 * 3600 * 1000;                          // the last day's challenge still takes results this long after midnight UTC
const BOARD_DAYS = 30;                                     // the past days whose boards the server answers (server.js BOARD_DAYS)
const MAX_STEPS = Math.ceil(2 * 3600 * 1000 / NetProto.TICK_MS);   // a replay longer than 2 hours of play isn't checked
const LEVELS = ["easy", "normal", "hard"];
const z2 = n => String(n).padStart(2, "0");

// ------------------------------------------------------------------ days (UTC)
// "YYYY-MM-DD": the UTC date of a moment
function dayOf(ms) {
  const d = new Date(ms);
  return String(d.getUTCFullYear()).padStart(4, "0") + "-" + z2(d.getUTCMonth() + 1) + "-" + z2(d.getUTCDate());
}
const parse = day => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof day === "string" ? day : ""); return m ? [+m[1], +m[2], +m[3]] : null; };
// a real calendar date from 2000 on (no 2026-02-30, no 2026-13-01; an old week id "2026-W43" isn't one)
const validDay = day => { const p = parse(day); return !!p && p[0] >= 2000 && p[1] >= 1 && p[1] <= 12 && p[2] >= 1 && dayOf(Date.UTC(p[0], p[1] - 1, p[2])) === day; };
// its midnight UTC / the next one (ms; NaN for anything but a valid day)
const dayStart = day => validDay(day) ? (p => Date.UTC(p[0], p[1] - 1, p[2]))(parse(day)) : NaN;
const dayEnd = day => dayStart(day) + DAY;

// ------------------------------------------------------------------ the day's challenge
function hash(s) {                                         // FNV-1a
  let h = 0x811C9DC5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}
function mulberry32(a) {
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}
// the modes a challenge can have, as weights (infection is left out: its sides are drawn at random - you could
// start infected); a mode's round time
const MODE_WEIGHTS = [["standard", 5], ["gold", 1], ["hill", 1], ["ctf", 1], ["deathmatch", 1], ["siege", 1], ["shrink", 1], ["survival", 1]];
const MODE_TIME = { gold: 5, hill: 5, ctf: 5, deathmatch: 5, shrink: 5, siege: 10, survival: 10 };

function config(day) {
  const r = mulberry32(hash("tunneler-challenge:" + day));
  const pick = list => {                                   // [[value, weight], ...]
    let n = r() % list.reduce((s, x) => s + x[1], 0);
    for (const [v, w] of list) { if (n < w) return v; n -= w; }
    return list[0][0];
  };
  const mode = pick(MODE_WEIGHTS);
  const size = pick([["small", 3], ["medium", 5], ["large", 2]]);
  const goalMode = !!NetProto.GOALS[mode];
  const level = () => pick([["easy", 1], ["normal", 2], ["hard", 2]]);
  const slots = [{ color: 0, team: 1, level: null }];      // (you: BLUE)
  let foes, teamGame = false;
  if (mode === "survival") {                               // you against the waves: 3 computer seats
    foes = 3;
    for (let i = 1; i <= foes; i++) slots.push({ color: i, team: 2, level: level() });
  } else {
    foes = 1 + r() % (size === "large" ? 3 : 4);
    teamGame = foes >= 3 && r() % 3 === 0;                 // you and a medium teammate against the rest
    for (let i = 1; i <= foes; i++) slots.push(teamGame ? { color: i, team: i === 1 ? 1 : 2, level: i === 1 ? "normal" : level() }
      : { color: i, team: i + 1, level: level() });
  }
  const winScore = goalMode ? 1 : foes >= 4 || size === "large" ? 2 : 3;
  const roundTime = MODE_TIME[mode] || (r() % 2 ? 5 : 3);
  const sight = pick([["full", 7], ["circle", 2], ["walls", 1]]);
  const friendlyFire = teamGame && r() % 3 === 0;
  const seed = r() >>> 0;
  return { day, seed, mode, goal: goalMode ? NetProto.GOALS[mode].def : 0, size, winScore, roundTime, friendlyFire, sight, slots };
}

// the skirmish link's query for it (play.js reads it like any skirmish link): view = your own, after death = the wreck
function query(cfg) {
  const who = s => s.level === null ? "you" : s.level;
  return "slots=" + cfg.slots.map(s => s.color + ":" + who(s) + ":" + s.team).join(",") + "&lv=2&size=" + cfg.size + "&win=" + cfg.winScore +
    "&time=" + cfg.roundTime + "&ff=" + (cfg.friendlyFire ? 1 : 0) + "&view=self&watch=wreck" + (cfg.sight !== "full" ? "&sight=" + cfg.sight : "") +
    (cfg.mode !== "standard" ? "&gm=" + cfg.mode : "") + (cfg.goal ? "&goal=" + cfg.goal : "") + "&challenge=" + cfg.day;
}
// the engine options play.js builds from that query (a skirmish: always the extended engine; you = player 1)
function engineOptions(cfg) {
  return { slots: cfg.slots.map(s => ({ color: s.color, team: s.team })), size: cfg.size, winScore: cfg.winScore, roundTime: cfg.roundTime,
    friendlyFire: !!cfg.friendlyFire, escEnds: true, escPlayer: 0, autoStart: true, noInstructions: true,
    sight: cfg.sight, extended: true, mode: cfg.mode, goal: cfg.goal };
}
// the same options (key order doesn't matter)
const canon = v => Array.isArray(v) ? "[" + v.map(canon).join(",") + "]" : v && typeof v === "object"
  ? "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}" : JSON.stringify(v);
const sameOptions = (a, b) => canon(a) === canon(b);

// ------------------------------------------------------------------ the result
// kills per player (1-based): a tank destroyed while alive by an enemy's shot (engine.killedBy) counts for that
// enemy. Wraps this engine object's killTankExt (only reads; the engine plays exactly as without it).
function track(e) {
  const kills = new Array((e.nPlayers || 2) + 1).fill(0);
  const kill = e.killTankExt;
  if (typeof kill !== "function") return kills;
  e.killTankExt = function (p, x, y) {
    const k = this.killedBy ? this.killedBy[p] | 0 : 0;
    const counts = !!this.alive[p] && k > 0 && k !== p && (!this.isEnemy || this.isEnemy(k, p));
    const ret = kill.call(this, p, x, y);
    if (counts) kills[k]++;
    return ret;
  };
  return kills;
}
// BLUE's (player 1's) result: rounds won (a team: its rounds), the match won, enemies destroyed, seconds played
function result(e, kills, steps) {
  const rounds = e.wins ? e.wins[1] | 0 : 0, win = e.winScore || 3;
  return { rounds, won: rounds >= win, kills: kills ? kills[1] | 0 : 0, secs: Math.round((steps | 0) * NetProto.TICK_MS / 1000) };
}
// the board's order: won first, more rounds, more kills, (both won) the faster, then the earlier entry
function compare(a, b) {
  return (b.won ? 1 : 0) - (a.won ? 1 : 0) || b.rounds - a.rounds || b.kills - a.kills ||
    (a.won && b.won ? a.secs - b.secs : 0) || (a.date || 0) - (b.date || 0);
}
// "m:ss"
const clock = secs => Math.floor(secs / 60) + ":" + z2(secs % 60);

// ------------------------------------------------------------------ checking a replay (the server, in a worker thread)
// Plays it on a new engine with its own computer players (as play.js creates them): every computer tank's bits must
// be the recorded ones and the recorded state hashes must match; only BLUE's bits and the keystrokes come from the
// replay. The result is the engine's own. deps: {Engine, AI, day, name? (BLUE's on the kept replay), maxSteps?}
function verify(rep, deps) {
  const { Engine, AI, day } = deps, maxSteps = deps.maxSteps || MAX_STEPS;
  if (!Replay.valid(rep)) return { code: "bad" };
  if (rep.challenge !== day || !validDay(day)) return { code: "config" };
  const cfg = config(day), opts = engineOptions(cfg);
  if ((rep.seed >>> 0) !== cfg.seed || !sameOptions(rep.opts, opts)) return { code: "config" };
  if (rep.steps < 1 || rep.steps > maxSteps) return { code: "long" };
  const e = new Engine(cfg.seed, JSON.parse(JSON.stringify(opts)));
  const kills = track(e), N = e.nPlayers;
  const ais = [];
  for (let p = 2; p <= N; p++) ais.push(new AI(cfg.slots[p - 1].level, p));
  const player = Replay.player(rep), checks = [];
  for (;;) {
    const rec = player.next();
    if (!rec) return { code: "unfinished" };
    if (!rec.bits || rec.bits.length !== N) return { code: "differs", step: player.n };
    const bits = new Array(N).fill(0);
    bits[0] = (rec.bits[0] | 0) & 63;
    for (const ai of ais) {
      const b = AI.bitsFor(ai, e);
      if ((rec.bits[ai.me - 1] | 0) !== b) return { code: "differs", step: player.n };
      bits[ai.me - 1] = b;
    }
    if (rec.keys.length > 16 || !rec.keys.every(k => k.length === 2 && k.every(v => Number.isInteger(v) && v >= 0 && v <= 0xFFFF))) return { code: "bad" };
    e.step({ bits, keys: rec.keys });
    if (player.check(e) === false) return { code: "differs", step: player.n };
    if (player.n % Replay.CHECK_EVERY === 0) checks.push([player.n, NetProto.stateHash(e)]);
    if (e.screen === "map") return player.n === rep.steps ? { code: null, result: result(e, kills, player.n), replay: clean(rep, e, player, checks, deps.name) }
      : { code: "differs", step: player.n };
    if (player.n >= rep.steps) return { code: "unfinished" };
  }
}

// the checked replay as the server keeps it for the board: only the fields a replay has, its frames up to the last
// step, the state checks and the summary of the server's own play, the player's name on BLUE
function clean(rep, e, player, checks, name) {
  const frames = rep.frames.slice(0, player.i).map(f => [f[0], f[1]]);
  if (player.left && frames.length) frames[frames.length - 1][0] -= player.left;
  const N = e.nPlayers, names = new Array(N).fill(null);
  if (name) names[0] = String(name);
  const meta = Replay.summary(e);
  if (name && meta.players[0]) meta.players[0].name = names[0];
  return {
    format: rep.format, id: String(rep.id).slice(0, 40), version: typeof rep.version === "string" ? rep.version.slice(0, 40) : "dev",
    date: Number.isFinite(rep.date) ? rep.date : 0, kind: "skirmish", room: null, seed: rep.seed >>> 0, opts: rep.opts,
    names: name ? names : null, you: 1, showSettings: { view: "self", visible: false, watchOut: "wreck" },
    aiDriven: e.aiDriven ? Array.from(e.aiDriven, v => !!v) : null,
    steps: player.n, frames, checks, end: [player.n, NetProto.stateHash(e)], meta, challenge: rep.challenge,
  };
}

export const Challenge = {
  MAX_STEPS, GRACE_MS, BOARD_DAYS, LEVELS, MODE_WEIGHTS, DAY, dayOf, dayStart, dayEnd, validDay, config, query, engineOptions, sameOptions,
  track, result, compare, clock, verify,
};
