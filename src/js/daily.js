// The daily challenge's screen (docs/v6/CHALLENGE.md): /challenge (the desktop app: /challenge.html). Today's
// challenge (challenge.js: the same for everybody - drawn from the UTC date), the date in the language's own words,
// the time left until the next one, your place on the leaderboard; Play the challenge (the skirmish
// /skirmish?challenge=<day>, play.js), Send your result (the last challenge match's replay, POST /api/challenge/<day>:
// the server plays it again and puts it on the board), Leaderboard (the day's best; Enter watches a player's replay -
// /replay/<id>?challenge=<day>, whose Back comes here again). The leaderboard steps through today and the 30 days
// before (Left / Right, the arrows of its day row, the wheel there): each day's settings and board (fetched once per
// screen), and on a past day "Play this day again" - practice (/skirmish?challenge=<day>&practice=1: never sent,
// never remembered as the result to send; its end comes back to that day's board). /challenge?board=<day> opens the
// leaderboard on that day. The day and the board come from the game's server (Endpoint); without it the computer's
// own day (UTC) is shown and played.
// Accounts (docs/v6/ACCOUNTS.md): on a server that needs them, sending needs a session (LOG IN first, then it sends) and
// the board's entry is the account's - no name prompt then; looking at the challenge and the board needs nothing.
import { Account } from "./account.js";
import { Challenge } from "./challenge.js";
import { DosUI } from "./dosui.js";
import { Endpoint, Links } from "./endpoint.js";
import { Lang } from "./lang.js";
import { Login } from "./login.js";
import { Nav } from "./nav.js";
import { Pads } from "./pads.js";
import { Replay } from "./replay.js";
import { GameScreen } from "./screen.js";
import { UniText } from "./unitext.js";

const LAST = "tunneler.challenge.last";                  // {day, id, result, sent}: the last challenge match (play.js)

// the challenge in up to 4 lines (font text): the mode (+ its goal), the map / rounds / round time, the opponents,
// line of sight / friendly fire (only when on)
export function challengeLines(cfg) {
  const T = Lang.t, levelName = l => Lang.raw("level." + l);
  const out = [T("lc.mode") + T("gm." + cfg.mode) + (cfg.goal ? "   " + T("goal." + cfg.mode) + (cfg.mode === "infection" ? T("time.n", { n: cfg.goal }) : cfg.goal) : "")];
  out.push(T("lc.size") + T("lc.size." + cfg.size) + (cfg.winScore > 1 ? "   " + T("lc.win") + cfg.winScore : "") + "   " + T("lc.time") + T("time.n", { n: cfg.roundTime }));
  const foes = cfg.slots.filter(s => s.level !== null && s.team !== 1), mate = cfg.slots.find(s => s.level !== null && s.team === 1);
  const list = foes.map(s => levelName(s.level)).join(", ");
  out.push(cfg.mode === "survival" ? T("ch.foes.survival", { list }) : mate ? T("ch.foes.team", { level: levelName(mate.level), list }) : T("ch.foes", { list }));
  const extra = [];
  if (cfg.sight !== "full") extra.push(T("lc.sight") + T("sight." + cfg.sight));
  if (cfg.friendlyFire) extra.push(T("lc.ff") + T("lc.on"));
  if (extra.length) out.push(extra.join("   "));
  return out;
}

export function mount() {
  const ui = new DosUI(document.getElementById("screen"));
  Pads.start({ menu: () => true });                      // (a gamepad steers the menus)
  window.tunnelerChallengeUI = () => ui;                 // tests / debugging
  const T = Lang.t;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };
  const home = () => Nav.go("/");
  // this browser's random id (the online one: the board's entries go by it, nobody else sees it)
  let cid = store.get("tunneler.client");
  if (!cid || !/^[A-Za-z0-9_-]{8,64}$/.test(cid)) {
    const a = new Uint8Array(12);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(a);
    else for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);   // (an id, not the game)
    cid = Array.from(a, b => b.toString(16).padStart(2, "0")).join("");
    store.set("tunneler.client", cid);
  }
  // (one remembered from the weekly challenge - {week: "2026-W43", ...} - is no day's: ignored)
  const last = () => { try { const v = JSON.parse(store.get(LAST) || "null"); return v && typeof v === "object" && v.result && Challenge.validDay(v.day) ? v : null; } catch (e) { return null; } };

  // what the server says (null: no answer yet / none): {day, current, ends, now, total, top, you}
  let board = null, offline = false, skew = 0;
  let day = Challenge.dayOf(Date.now());
  let view = null, note = null;                          // view: "main" | "board" | "name"; note: {text, color} after sending

  // ------------------------------------------------------------ texts
  // the day in the language's words (its locale, "ch.locale"; the date is UTC's): "Sunday, October 25, 2026" - raw
  // Unicode (a parameter: Lang.t puts what the font lacks through the Unicode plane)
  function dateText(d, o) {
    // (a year's short word - "2026 г." - stays with the year when a phone re-wraps the line)
    try { return new Intl.DateTimeFormat(Lang.raw("ch.locale") || "en-US", Object.assign({ timeZone: "UTC" }, o)).format(new Date(Challenge.dayStart(d))).replace(/ (\S{1,2}\.)$/, "\u00A0$1"); }
    catch (e) { return d; }
  }
  const longDate = d => dateText(d, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const end = () => board && board.ends && board.day === day ? board.ends : Challenge.dayEnd(day);
  function timeLeft() {
    const ms = Math.max(0, end() - (Date.now() + skew));
    const m = Math.ceil(ms / 60000), h = Math.floor(m / 60);
    // (raw: a parameter; no-break spaces - "3 h 57 min" stays on one line when a phone re-wraps it)
    return (h ? Lang.raw("ch.hm").replace("{h}", h).replace("{m}", m % 60) : Lang.raw("ch.m").replace("{m}", m)).replace(/ /g, "\u00A0");
  }
  const dayLine = () => offline ? T("ch.day.off", { date: longDate(day) }) : T("ch.day", { date: longDate(day), t: timeLeft() });
  // the result in words: "won, rounds 3/3, kills 5, 4:12"
  const scoreText = (r, cfg) => [Lang.raw(r.won ? "ch.won" : "ch.lost"), Lang.raw("ch.rounds").replace("{n}", r.rounds).replace("{w}", cfg.winScore),
    Lang.raw("ch.kills").replace("{n}", r.kills), Challenge.clock(r.secs)].join(", ");
  // ------------------------------------------------------------ the challenge
  function main(keep) {
    view = "main";
    if (/[?&]board=/.test(location.search)) try { history.replaceState(history.state, "", Links.challenge()); } catch (e) { /* no history */ }
    const cfg = Challenge.config(day), L = last();
    // a result not sent yet: today's, or yesterday's while the server still takes it (a match begun just before midnight UTC)
    const pending = L && !L.sent &&
      (L.day === day || Challenge.dayEnd(L.day) <= Challenge.dayStart(day) && Date.now() + skew < Challenge.dayEnd(L.day) + Challenge.GRACE_MS);
    const lines = [{ row: 2, text: T("ch.title"), color: 12 }, { row: 4, text: dayLine(), color: 15 }];
    challengeLines(cfg).forEach((t, i) => lines.push({ row: 6 + i, text: t, color: 3 }));
    const you = board && board.day === day ? board.you : null;
    lines.push({ row: 11, color: 14, text: offline ? T("ch.best.off") : !board ? T("ch.best.wait")
      : you ? UniText.fromRaw(Lang.raw("ch.best").replace("{rank}", you.rank).replace("{total}", board.total).replace("{score}", scoreText(you, cfg))) : T("ch.best.none") });
    if (note) lines.push({ row: 12, text: note.text, color: note.color });
    const items = [{ key: "play", label: T("ch.play"), info: [T("ch.play.i"), T("ch.play.i2")], go: () => Nav.go(Links.cpu("challenge=" + day)) }];
    if (pending) items.push({ key: "send", label: T("ch.send"), go: () => send(),   // (yesterday's: said so)
      info: [UniText.fromRaw(Lang.raw(L.day === day ? "ch.send.i" : "ch.send.prev").replace("{score}", scoreText(L.result, Challenge.config(L.day)))), T("ch.send.i2")] });
    items.push({ key: "board", label: T("ch.board"), info: [T("ch.board.i")], go: () => showBoard() },
      { key: "gap", label: "", disabled: true },
      { key: "back", label: T("back.main"), info: [T("back.main.i")], go: home });
    // (a result not sent yet: "Send your result" chosen - what comes next after a match)
    ui.show({ lines, box: { y: 14 }, infoRow: 22, back: home, items, sel: !keep && pending ? 1 : undefined }, keep);
  }

  // ------------------------------------------------------------ the leaderboard: today and the 30 days before
  // (Left / Right anywhere on it, the day row's arrows / the wheel over it; docs/v6/CHALLENGE.md 2)
  const WIDE = [5, 15, 10, 10], NARROW = [4, 12, 5, 4];    // (place, name, rounds, kills; the time takes the rest)
  const cols = () => ui.isNarrow() ? NARROW : WIDE;
  const BOX_X = 15, BOX_W = 50, BOX_BOTTOM = 21;           // (desktop: the box's bottom border stays on its row - the day row too)
  const past = new Map(), fetching = new Set(), failed = new Set();   // past days' boards (GET /api/challenge/<day>), for the screen's life
  let bday = null;                                       // the board's day (null: today)
  let selWant = null;                                    // (the row chosen when the day changed: chosen again once that day's board is there)
  const oldest = () => Challenge.dayOf(Challenge.dayStart(day) - Challenge.BOARD_DAYS * Challenge.DAY);
  const clampDay = d => !Challenge.validDay(d) || d > day ? day : d < oldest() ? oldest() : d;
  // (bday stays what was asked for - /challenge?board=<day> before the server said which day it is today)
  const shownDay = () => clampDay(bday || day);
  function rowText(x, cfg) {
    const C = cols(), cell = (t, k) => UniText.padEnd(UniText.slice(t, C[k] - 1), C[k]);
    return cell(x.rank + ".", 0) + cell(UniText.fromRaw(x.name), 1) + cell(x.rounds + "/" + cfg.winScore, 2) + cell(String(x.kills), 3) + Challenge.clock(x.secs);
  }
  function rowSpans(mine) {
    const C = cols(), at = [0]; for (const w of C) at.push(at[at.length - 1] + w);
    return [0x07, mine ? 0x0E : 0x0F, 0x0A, 0x0C, 0x0B].map((a, i) => [at[i], i < C.length ? at[i + 1] : 200, a]);
  }
  // a day's board: {j} (the server's answer), "wait" or "off" (offline / refused: Enter on its row tries again)
  function boardState(d) {
    if (d === day) return board && board.day === day ? { j: board } : offline ? "off" : "wait";
    if (past.has(d)) return { j: past.get(d) };
    if (failed.has(d)) return "off";
    fetchDay(d);
    return "wait";
  }
  async function fetchDay(d) {
    if (past.has(d) || fetching.has(d)) return;
    fetching.add(d); failed.delete(d);
    try {
      const res = await fetch(Endpoint.api("/api/challenge/" + d + "?cid=" + encodeURIComponent(cid)));
      if (!res.ok) throw new Error("HTTP " + res.status);
      const j = await res.json();
      if (!j || j.day !== d || !Array.isArray(j.top)) throw new Error("no board");
      past.set(d, j);
    } catch (e) { failed.add(d); }
    fetching.delete(d);
    if (view === "board" && shownDay() === d) showBoard(true);
  }
  function retry(d) {
    if (d === day) { offline = false; board = null; showBoard(true); load(); return; }
    failed.delete(d);
    showBoard(true);
  }
  // another day (dir -1: the day before, +1: the day after) - not past today nor before the 30 days the server keeps
  function stepDay(dir) {
    const cur = shownDay(), d = clampDay(Challenge.dayOf(Challenge.dayStart(cur) + dir * Challenge.DAY));
    if (d === cur) return false;
    const it = ui.spec && ui.spec.items[ui.sel];
    selWant = it && /^e:/.test(it.key) ? it.key : null;
    bday = d;
    failed.delete(d);                                    // (a day that couldn't be loaded: tried again)
    showBoard(true);
    return true;
  }
  // the day row: "◄  Saturday, October 24, 2026  ►" (an arrow only where there is a day to go to); the date as long as
  // the box allows
  const DATES = [{ weekday: "long", year: "numeric", month: "long", day: "numeric" }, { year: "numeric", month: "long", day: "numeric" },
    { year: "numeric", month: "short", day: "numeric" }, { year: "numeric", month: "2-digit", day: "2-digit" }];
  function dayItem(d) {
    const room = (ui.isNarrow() ? DosUI.NARROW_W : BOX_W) - 4 - 6;
    let date = d;
    for (const o of DATES) { const t = dateText(d, o); if (UniText.rawCols(t) <= room) { date = t; break; } }
    const label = (d > oldest() ? "\x11" : " ") + "  " + UniText.fromRaw(date) + "  " + (d < day ? "\x10" : " "), w = UniText.cols(label);
    const touch = GameScreen.mobile();
    return { key: "day", label, change: dir => stepDay(dir), go: () => { if (!stepDay(-1)) { bday = day; showBoard(true); } },   // (Enter: the day before; the oldest: today again)
      zones: [{ from: -80, to: w >> 1, click: () => stepDay(-1) }, { from: w >> 1, to: w + 80, click: () => stepDay(1) }],
      info: [T(touch ? "ch.days.i.touch" : "ch.days.i"), ...(d < day ? [T("ch.practice")] : [])] };
  }
  function showBoard(keep) {
    view = "board";
    const d = shownDay(), today = d === day, narrow = ui.isNarrow();
    try { history.replaceState(history.state, "", Links.challenge(today ? null : d)); } catch (e) { /* no history (tests) */ }
    const cfg = Challenge.config(d), C = cols(), st = boardState(d), touch = GameScreen.mobile();
    const j = typeof st === "object" ? st.j : null, top = j ? j.top || [] : [], you = j ? j.you : null;
    // the rows: the best (up to 50), your own entry below them when it isn't one of them; a row with a replay watches it
    // (its Back comes to this day's board again), one without isn't choosable
    const list = top.slice();
    if (you && !top.some(x => x.rank === you.rank)) list.push(you);
    const entries = list.map(x => Object.assign({ key: "e:" + x.rank, label: rowText(x, cfg), align: "left", spans: rowSpans(you && you.rank === x.rank) },
      x.replay ? { info: [UniText.fromRaw(scoreText(x, cfg)), T(touch ? "ch.row.i.touch" : "ch.row.i")], go: () => Nav.go(Links.sharedReplay(x.replay, d)) }
        : { static: true }));
    if (!entries.length) entries.push(st === "off" ? { key: "off", label: T("ch.board.off"), attr: 0x0C, info: [T("ch.board.off.i"), T(touch ? "ch.retry.i.touch" : "ch.retry.i")], go: () => retry(d) }
      : { key: "none", label: T(st === "wait" ? "ch.board.wait" : today ? "ch.board.none" : "ch.board.none.past"), disabled: true });
    const play = today ? { key: "play", label: T("ch.play"), info: [T("ch.play.i"), T("ch.play.i2")], go: () => Nav.go(Links.cpu("challenge=" + d)) }
      : { key: "play", label: T("ch.again"), info: [T("ch.practice"), T("ch.again.i")], go: () => Nav.go(Links.cpu("challenge=" + d + "&practice=1")) };
    const back = { key: "back", label: T("ch.back"), info: [T("ch.back.i")], go: () => main() };
    const lines = [{ row: 2, text: T("ch.board.title", { date: dateText(d, { month: "long", day: "numeric" }).toLocaleUpperCase() }), color: 12 }];
    const desc = challengeLines(cfg);
    desc.forEach((t, i) => lines.push({ row: 4 + i, text: t, color: 3 }));
    // (today: the time left; a past day: practice)
    const status = today ? offline ? null : { text: T("ch.board.today", { t: timeLeft() }), color: 15 } : { text: T("ch.practice"), color: 10 };
    if (status) lines.push(Object.assign({ row: 4 + desc.length }, status));
    if (narrow) {
      // (a phone: every row shown - the day row first, where a thumb finds it)
      ui.show({ lines, box: { y: 3 }, items: [dayItem(d)].concat(entries, [{ key: "gap", label: "", disabled: true }, play, back]), back: () => main() }, keep);
      return reselect(j);
    }
    // desktop: the box ends on BOX_BOTTOM whatever the day's description takes - the day row stays under the mouse; the
    // rows the description leaves show the board (it scrolls), empty ones fill the rest
    const y = 5 + desc.length, shown = BOX_BOTTOM - y - 6;
    while (entries.length < shown) entries.push({ key: "pad" + entries.length, label: "", disabled: true });
    const head = (k, i) => UniText.padEnd(UniText.slice(T(k), C[i] - 1), C[i]);
    ui.show({
      lines, box: { x: BOX_X, y, w: BOX_W, rows: shown }, fixed: 3,
      header: " " + UniText.padEnd("#", C[0]) + head("ch.h.name", 1) + head("ch.h.rounds", 2) + head("ch.h.kills", 3) + T("ch.h.time"),
      items: entries.concat([dayItem(d), play, back]), infoRow: BOX_BOTTOM + 1, back: () => main(),
    }, keep);
    reselect(j);
  }
  // (a row was chosen when the day changed - "#3": the same place on this day's board, once it has come)
  function reselect(j) {
    if (!selWant || !j) return;
    const i = ui.spec.items.findIndex(x => x.key === selWant);
    selWant = null;
    if (i >= 0 && ui.enabled(i) && i !== ui.sel) { ui.sel = i; ui.draw(); }
  }
  // Left / Right on any row of the board (the day row steps by its own change())
  window.addEventListener("keydown", e => {
    if (view !== "board" || e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const it = ui.spec && ui.spec.items[ui.sel];
    if (it && it.change) return;
    e.preventDefault();
    stepDay(e.key === "ArrowLeft" ? -1 : 1);
  });

  // ------------------------------------------------------------ the server: the day and the board, sending a result
  let loading = false;
  async function load() {
    if (loading) return;
    loading = true;
    let fresh = false;
    try {
      const res = await fetch(Endpoint.api("/api/challenge?cid=" + encodeURIComponent(cid)), { headers: Account.auth() });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const j = await res.json();
      if (!j || !Challenge.validDay(j.day)) throw new Error("no day");
      fresh = day !== j.day;                             // (the server's day isn't this computer's: its screen anew)
      if (board && board.day !== j.day && Challenge.validDay(board.day)) past.set(board.day, board);   // (midnight: today's board is a past day's now)
      board = j; offline = false; day = j.day;
      if (Number.isFinite(j.now)) skew = j.now - Date.now();
    } catch (e) { offline = true; }
    loading = false;
    redraw(fresh);
  }
  const redraw = fresh => { if (view === "main") main(!fresh); else if (view === "board") showBoard(!fresh); };
  const errText = (code, msg) => {
    if (code === "taken") return UniText.fromRaw(Lang.raw("ch.err.taken").replace("{name}", DosUI.playerName()));
    if (["day", "name", "version", "differs", "config", "unfinished", "long", "busy", "gone"].includes(code)) return T("ch.err." + code);
    return T("ch.err.bad", { msg: String(msg || code || "?").slice(0, 50) });
  };
  let sending = false;
  async function send(needLogin) {
    const L = last();
    if (sending || !L) return;
    // (accounts: a session first - LOG IN, then this again; Back: the challenge)
    if ((needLogin || Account.required() === true) && !Account.session()) {
      view = "login";
      return Login.ask(ui, { done: () => { main(); send(); }, back: () => main(), backKey: "ch.back" });
    }
    sending = true;
    note = { text: T("ch.sending"), color: 7 };
    main(true);
    try {
      const rep = await Replay.get(L.id);
      if (!rep) { note = { text: errText("gone"), color: 12 }; return; }
      const body = new Uint8Array(await (await Replay.toBlob(rep)).arrayBuffer());
      let res;
      try {
        res = await fetch(Endpoint.api("/api/challenge/" + L.day + "?cid=" + encodeURIComponent(cid) + "&name=" + encodeURIComponent(DosUI.playerName())),
          { method: "POST", headers: Object.assign({ "Content-Type": "application/octet-stream" }, Account.auth()), body });
      } catch (e) { note = { text: T("ch.err.net", { msg: String(e.message || e).slice(0, 50) }), color: 12 }; return; }
      const j = await res.json().catch(() => ({}));
      // (accounts: no session / not any more - log in, then send it)
      if (res.status === 401 && j.code === "session") { Account.logout(); Account.config(true); note = null; sending = false; return send(true); }
      if (!res.ok || !j.ok) {
        note = { text: errText(j.code || (res.status === 429 ? "busy" : ""), j.error || "HTTP " + res.status), color: 12 };
        if (["day", "differs", "config", "unfinished", "long", "gone"].includes(j.code)) store.set(LAST, JSON.stringify(Object.assign(L, { sent: true })));   // (it never will be accepted)
        return;
      }
      store.set(LAST, JSON.stringify(Object.assign(L, { sent: true })));
      const cfg = Challenge.config(L.day);
      note = j.improved ? { text: T("ch.sent", { rank: j.rank, total: j.total }), color: 10 }
        : { text: UniText.fromRaw(Lang.raw("ch.sent.same").replace("{score}", scoreText(j.best, cfg))), color: 14 };
      await load();
    } finally {
      sending = false;
      if (view === "main") main(true);
    }
  }

  // the time left: once a minute (at midnight UTC: the next day - the server's, else this computer's); the board:
  // every 2 minutes
  setInterval(() => {
    if (Date.now() + skew >= end()) {
      if (offline || !board) { const d = Challenge.dayOf(Date.now() + skew); if (d !== day) { day = d; redraw(true); } }
      load();
    }
    if (view === "main") main(true);
    else if (view === "board" && shownDay() === day) showBoard(true);   // (today's: the time left)
  }, 60000);
  setInterval(load, 120000);
  window.tunnelerChallenge = () => ({ day, board, offline, note, view, cid, send, load, bday: view === "board" ? shownDay() : bday, past, stepDay, showBoard: d => { bday = d || null; showBoard(); } });

  // /challenge?board=<day>: the leaderboard on that day (a replay's Back, a practice match's end)
  const boardDay = new URLSearchParams(location.search).get("board");
  const start = () => {
    if (Challenge.validDay(boardDay)) { bday = boardDay; showBoard(); } else main();
    load();
  };
  // (a name only for a server without accounts - asked as before; with them, sending asks to log in)
  if (Account.required() !== true && !DosUI.playerName()) { view = "name"; ui.askName(start, home); }
  else start();
  Account.config().then(on => { if (on && view === "name") start(); });
}
