// The weekly challenge's screen (docs/v6/CHALLENGE.md): /challenge (the desktop app: /challenge.html). This week's
// challenge (challenge.js: the same for everybody - drawn from the week's name), the time left, your place on the
// leaderboard; Play the challenge (the skirmish /skirmish?challenge=<week>, play.js), Send your result (the last
// challenge match's replay, POST /api/challenge/<week>: the server plays it again and puts it on the board),
// Leaderboard (the week's best; Enter watches a player's replay - /replay/<id>). The week and the board come from
// the game's server (Endpoint); without it the computer's own week is shown and played.
import { Challenge } from "./challenge.js";
import { DosUI } from "./dosui.js";
import { Endpoint, Links } from "./endpoint.js";
import { Lang } from "./lang.js";
import { Nav } from "./nav.js";
import { Pads } from "./pads.js";
import { Replay } from "./replay.js";
import { GameScreen } from "./screen.js";
import { UniText } from "./unitext.js";

const LAST = "tunneler.challenge.last";                  // {week, id, result, sent}: the last challenge match (play.js)

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
  const last = () => { try { const v = JSON.parse(store.get(LAST) || "null"); return v && typeof v === "object" && v.result ? v : null; } catch (e) { return null; } };

  // what the server says (null: no answer yet / none): {week, current, ends, now, total, top, you}
  let board = null, offline = false, skew = 0;
  let week = Challenge.weekOf(Date.now());
  let view = null, note = null;                          // view: "main" | "board" | "name"; note: {text, color} after sending

  // ------------------------------------------------------------ texts
  const parts = w => Challenge.weekParts(w) || { year: 0, n: 0 };
  function timeLeft() {
    const ms = Math.max(0, (board && board.ends ? board.ends : Challenge.weekEnd(week)) - (Date.now() + skew));
    const m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
    return d ? Lang.raw("ch.dh").replace("{d}", d).replace("{h}", h % 24) : Lang.raw("ch.hm").replace("{h}", h).replace("{m}", m % 60);   // (raw: a parameter)
  }
  const weekLine = () => offline ? T("ch.week.off", { w: parts(week).n, y: parts(week).year }) : T("ch.week", { w: parts(week).n, y: parts(week).year, t: timeLeft() });
  // the result in words: "won, rounds 3/3, kills 5, 4:12"
  const scoreText = (r, cfg) => [Lang.raw(r.won ? "ch.won" : "ch.lost"), Lang.raw("ch.rounds").replace("{n}", r.rounds).replace("{w}", cfg.winScore),
    Lang.raw("ch.kills").replace("{n}", r.kills), Challenge.clock(r.secs)].join(", ");
  // ------------------------------------------------------------ the challenge
  function main(keep) {
    view = "main";
    const cfg = Challenge.config(week), L = last();
    // a result not sent yet: this week's, or last week's while the server still takes it (a match begun on Sunday night)
    const pending = L && !L.sent && Challenge.validWeek(L.week) &&
      (L.week === week || Challenge.weekEnd(L.week) <= Challenge.weekStart(week) && Date.now() + skew < Challenge.weekEnd(L.week) + Challenge.GRACE_MS);
    const lines = [{ row: 2, text: T("ch.title"), color: 12 }, { row: 4, text: weekLine(), color: 15 }];
    challengeLines(cfg).forEach((t, i) => lines.push({ row: 6 + i, text: t, color: 3 }));
    const you = board && board.week === week ? board.you : null;
    lines.push({ row: 11, color: 14, text: offline ? T("ch.best.off") : !board ? T("ch.best.wait")
      : you ? UniText.fromRaw(Lang.raw("ch.best").replace("{rank}", you.rank).replace("{total}", board.total).replace("{score}", scoreText(you, cfg))) : T("ch.best.none") });
    if (note) lines.push({ row: 12, text: note.text, color: note.color });
    const items = [{ key: "play", label: T("ch.play"), info: [T("ch.play.i"), T("ch.play.i2")], go: () => Nav.go(Links.cpu("challenge=" + week)) }];
    if (pending) items.push({ key: "send", label: T("ch.send"), go: send,
      info: [UniText.fromRaw(Lang.raw("ch.send.i").replace("{score}", scoreText(L.result, Challenge.config(L.week)))), T("ch.send.i2")] });
    items.push({ key: "board", label: T("ch.board"), info: [T("ch.board.i")], go: () => showBoard() },
      { key: "gap", label: "", disabled: true },
      { key: "back", label: T("back.main"), info: [T("back.main.i")], go: home });
    // (a result not sent yet: "Send your result" chosen - what comes next after a match)
    ui.show({ lines, box: { y: 14 }, infoRow: 22, back: home, items, sel: !keep && pending ? 1 : undefined }, keep);
  }

  // ------------------------------------------------------------ the leaderboard
  const WIDE = [5, 15, 10, 10], NARROW = [4, 12, 5, 4];    // (place, name, rounds, kills; the time takes the rest)
  const cols = () => ui.isNarrow() ? NARROW : WIDE;
  const ROWS = 12;
  function rowText(x, cfg) {
    const C = cols(), cell = (t, k) => UniText.padEnd(UniText.slice(t, C[k] - 1), C[k]);
    return cell(x.rank + ".", 0) + cell(UniText.fromRaw(x.name), 1) + cell(x.rounds + "/" + cfg.winScore, 2) + cell(String(x.kills), 3) + Challenge.clock(x.secs);
  }
  function rowSpans(mine) {
    const C = cols(), at = [0]; for (const w of C) at.push(at[at.length - 1] + w);
    return [0x07, mine ? 0x0E : 0x0F, 0x0A, 0x0C, 0x0B].map((a, i) => [at[i], i < C.length ? at[i + 1] : 200, a]);
  }
  function showBoard(keep) {
    view = "board";
    const cfg = Challenge.config(week), C = cols();
    const top = board && board.week === week ? board.top || [] : [];
    const you = board && board.week === week ? board.you : null;
    const touch = GameScreen.mobile();
    const items = top.map(x => ({ key: "e:" + x.rank, label: rowText(x, cfg), align: "left", spans: rowSpans(you && you.rank === x.rank),
      info: [UniText.fromRaw(scoreText(x, cfg)), T(touch ? "ch.row.i.touch" : "ch.row.i")], go: () => { if (x.replay) Nav.go(Links.sharedReplay(x.replay)); } }));
    if (!items.length) items.push({ key: "none", label: T(board ? "ch.board.none" : "ch.board.wait"), disabled: true });
    items.push({ key: "gap", label: "", disabled: true });
    items.push({ key: "back", label: T("ch.back"), info: [T("ch.back.i")], go: () => main() });
    const shown = Math.max(1, Math.min(items.length - 2, ROWS)), bottom = 3 + 3 + shown + 2;
    const head = (k, i) => UniText.padEnd(UniText.slice(T(k), C[i] - 1), C[i]);
    ui.show({
      lines: [{ row: 2, text: T("ch.board.title", { w: parts(week).n, y: parts(week).year }), color: 12 }],
      box: ui.isNarrow() ? { y: 3, rows: shown } : { x: 15, y: 3, w: 50, rows: shown }, fixed: 2,
      // (a phone: no room for the other headings - the selected row's info says it in words)
      header: " " + UniText.padEnd("#", C[0]) + head("ch.h.name", 1) + (ui.isNarrow() ? "" : head("ch.h.rounds", 2) + head("ch.h.kills", 3) + T("ch.h.time")),
      items, infoRow: bottom + 2, back: () => main(),
    }, keep);
  }

  // ------------------------------------------------------------ the server: the week and the board, sending a result
  let loading = false;
  async function load() {
    if (loading) return;
    loading = true;
    let fresh = false;
    try {
      const res = await fetch(Endpoint.api("/api/challenge?cid=" + encodeURIComponent(cid)));
      if (!res.ok) throw new Error("HTTP " + res.status);
      const j = await res.json();
      if (!j || !Challenge.validWeek(j.week)) throw new Error("no week");
      fresh = week !== j.week;                           // (the server's week isn't this computer's: its screen anew)
      board = j; offline = false; week = j.week;
      if (Number.isFinite(j.now)) skew = j.now - Date.now();
    } catch (e) { offline = true; }
    loading = false;
    redraw(fresh);
  }
  const redraw = fresh => { if (view === "main") main(!fresh); else if (view === "board") showBoard(!fresh); };
  const errText = (code, msg) => {
    if (code === "taken") return UniText.fromRaw(Lang.raw("ch.err.taken").replace("{name}", DosUI.playerName()));
    if (["week", "name", "version", "differs", "config", "unfinished", "long", "busy", "gone"].includes(code)) return T("ch.err." + code);
    return T("ch.err.bad", { msg: String(msg || code || "?").slice(0, 50) });
  };
  let sending = false;
  async function send() {
    const L = last();
    if (sending || !L) return;
    sending = true;
    note = { text: T("ch.sending"), color: 7 };
    main(true);
    try {
      const rep = await Replay.get(L.id);
      if (!rep) { note = { text: errText("gone"), color: 12 }; return; }
      const body = new Uint8Array(await (await Replay.toBlob(rep)).arrayBuffer());
      let res;
      try {
        res = await fetch(Endpoint.api("/api/challenge/" + L.week + "?cid=" + encodeURIComponent(cid) + "&name=" + encodeURIComponent(DosUI.playerName())),
          { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body });
      } catch (e) { note = { text: T("ch.err.net", { msg: String(e.message || e).slice(0, 50) }), color: 12 }; return; }
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) {
        note = { text: errText(j.code || (res.status === 429 ? "busy" : ""), j.error || "HTTP " + res.status), color: 12 };
        if (["week", "differs", "config", "unfinished", "long", "gone"].includes(j.code)) store.set(LAST, JSON.stringify(Object.assign(L, { sent: true })));   // (it never will be accepted)
        return;
      }
      store.set(LAST, JSON.stringify(Object.assign(L, { sent: true })));
      const cfg = Challenge.config(L.week);
      note = j.improved ? { text: T("ch.sent", { rank: j.rank, total: j.total }), color: 10 }
        : { text: UniText.fromRaw(Lang.raw("ch.sent.same").replace("{score}", scoreText(j.best, cfg))), color: 14 };
      await load();
    } finally {
      sending = false;
      if (view === "main") main(true);
    }
  }

  // the time left: once a minute; the board: every 2 minutes
  setInterval(() => { if (view === "main") main(true); }, 60000);
  setInterval(load, 120000);
  window.tunnelerChallenge = () => ({ week, board, offline, note, view, cid, send, load });

  const start = () => { main(); load(); };
  if (!DosUI.playerName()) { view = "name"; ui.askName(start, home); }
  else start();
}
