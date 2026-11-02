// The main menu's Mods screen (1.5, docs/MODS.md 6 - owner, 2026-11-01): the script mods kept in this browser
// (net/modstore.js; with an account on every device too - net/cloudsave.js), one mod's screen and the console.
//   - the list: name, author, the mod's own @version; a mod made for other versions of the game (its @game doesn't
//     include this one - Mods.fits) gray, with why. Open a mod file (.tmod.js: a file picker, or a file dropped on the
//     Mods screens), Console, Back.
//   - a mod: its header (name, author, version, @game, @mode, @tanks, @about); Play in a skirmish (the skirmish lobby
//     with it on the Mod row - home.js), Save as a file, Copy a share link (the file sent to the game's server, POST
//     /api/mods -> {id}; the page /mod/<id> fetches GET /api/mods/<id> and keeps it), Delete (pressed twice).
//   - the console (net/modlog.js): what the mod said (g.say) and why it stopped - its error with the line - in the last
//     local game played with a mod.
//   - the mod gallery (1.5, docs/MODS.md 6b - owner, 2026-11-01: "you can also add gallery"; like the map gallery,
//     ui/mappick.js): the list's Show row - your mods / the gallery (the mods published on the game's server,
//     net/modstore.js ModStore.gallery), its order (newest / most played online) and a Versions switch (only the mods
//     this game runs - the default -, or all of them: the others gray with why). A published mod's screen: its header
//     (name, author, version, @game, @mode, @tanks, @bases, its settings' labels in the page's language - from its file,
//     GET /api/mods/<id> -, @about, how often it was played online), Add to my mods, Play in a skirmish (added first),
//     Copy a link (/mod/<id>), Remove from the gallery (its author: pressed twice). A mod of yours: Publish to the
//     gallery (logged in / a name first, as maps; a mod this version doesn't run: gray - the server stores only
//     mods for its version) / Remove from the gallery (rec.galleryAt); publishing earns the medal "modmaker".
//   - the official mods (1.5, docs/MODS.md 6c, net/official.js): the Show row's first tab - Standard (picking only) and
//     the mods the game ships; one opens as a gallery mod does (Add, Play, Copy a link).
//   - picking a mode (opts.pick - the skirmish's and the lobby's Mode row; owner, 2026-11-02: "Mode and Mod should be a
//     single Setting ... similar to Map there should be the preinstalled mods, user mods and gallery"): the same list,
//     Official first; Enter on a row picks it (a gallery mod is added to your mods first), Back returns.
// Nothing here runs a mod: only its header is read (Mods.check), the sandbox is loaded by the game (routes/play.js).
//   ModsUI.show(ui, {back, play(id)})        the list (back: to the main menu; play: the skirmish lobby with that mod)
//   ModsUI.pick(ui, {back, pick(id), current, title, backLabel})   the Mode picker: pick("" = Standard | a mod's id)
//   ModsUI.open(ui, opts, id)                one mod's screen (not kept here: the list)
//   ModsUI.fromLink(ui, opts, id)            a share link's mod (/mod/<id>): this browser's copy, else the server's
//   ModsUI.readFile(ui, opts, file)          a .tmod.js file (a File / Blob): kept, its screen shown
import { Medals } from "../game/medals.js";
import { Mods } from "../game/mods.js";
import { ModStore } from "../net/modstore.js";
import { Official } from "../net/official.js";
import { Account } from "../net/account.js";
import { Login } from "./login.js";
import { DosUI } from "./dosui.js";
import { ModLog } from "../net/modlog.js";
import { ModFetch } from "../net/modfetch.js";
import { Endpoint } from "../net/endpoint.js";
import { GameScreen } from "../io/screen.js";
import { Lang } from "../text/lang.js";
import { UniText } from "../text/unitext.js";
const root = globalThis;

const T = (k, p) => Lang.t(k, p);
// a text with raw Unicode in it (a mod's name, author, error): its placeholders filled, then made font text
const TR = (k, p) => UniText.fromRaw(String(Lang.raw(k) || k).replace(/\{(\w+)\}/g, (m, n) => p && p[n] !== undefined ? String(p[n]) : m));
const U = s => UniText.fromRaw(String(s || ""));
const z = n => String(n).padStart(2, "0");
const dateText = d => { d = new Date(d); return z(d.getDate()) + "." + z(d.getMonth() + 1) + ". " + z(d.getHours()) + ":" + z(d.getMinutes()); };
// a record's @game as ranges -> runs on this game
const fitsRec = r => Mods.fits({ ranges: Mods.parseGame(r && r.game) });
const oldText = r => TR("mods.old", { game: Mods.gameText(Mods.parseGame(r.game)) || r.game || "?", version: Mods.GAME });
// why a file isn't a mod (Mods.check's problems: modrun.js's texts)
const problemText = (problem, header) => problem === "version" && header ? Lang.raw("modrun.p.version").replace("{game}", Mods.gameText(header.ranges)).replace("{version}", Mods.GAME)
  : Lang.raw("modrun.p." + problem) || problem;
// font text cut into lines of at most w columns, at spaces
function wrap(ft, w, most) {
  const out = [];
  let line = "";
  for (const word of String(ft).split(" ")) {
    const cand = line ? line + " " + word : word;
    if (UniText.cols(cand) <= w) { line = cand; continue; }
    if (line) out.push(line);
    line = UniText.cols(word) > w ? UniText.slice(word, w) : word;
  }
  if (line) out.push(line);
  if (most && out.length > most) { out.length = most; out[most - 1] = UniText.slice(out[most - 1], w - 3) + "..."; }
  return out;
}
// text onto the clipboard (the Clipboard API, else the old copy command) -> it worked
async function copyText(text) {
  try { if (root.navigator && navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; } } catch (e) { /* the fallback */ }
  try {
    const d = root.document, ta = d.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); Object.assign(ta.style, { position: "fixed", left: "-9999px", top: "0" });
    d.body.appendChild(ta); ta.select();
    const ok = d.execCommand && d.execCommand("copy");
    ta.remove();
    return !!ok;
  } catch (e) { return false; }
}
// "Hot potato" -> "hot-potato.tmod.js" (another script: the mod's id)
const fileName = r => (String(r.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || r.id) + ".tmod.js";

// one state per page (the screens are drawn again from it): tab "mine" | "gallery", the gallery's order, all versions,
// its list (null: loading), why it isn't there (galCode), the published mod shown last (galAt)
const st = { fileError: "", note: null, armed: 0, shown: null, dropOn: false,
  tab: "mine", sort: "new", all: false, gal: null, galCode: "", galAt: "", galNote: null, galArmed: 0 };

// ------------------------------------------------------------ the list (your mods / the gallery)
const ROWS = 8;
const cols = ui => ui.isNarrow() ? [22, 0, 10] : [32, 26, 14];
// (the gallery: name, author, the game versions, played online)
const gcols = ui => ui.isNarrow() ? [24, 0, 0, 8] : [30, 22, 14, 6];
const cell = (C, t, k) => C[k] ? UniText.padEnd(UniText.slice(t, C[k] - 1), C[k]) : "";
function rowText(ui, r) {
  const C = cols(ui);
  return cell(C, U(Mods.nameIn(r, Lang.code) || "?"), 0) + cell(C, U(r.by), 1) + UniText.slice(U(r.version), C[2]);
}
function rowSpans(ui, r) {
  if (!fitsRec(r)) return [[0, 200, 0x08]];
  const C = cols(ui);
  return [[0, C[0], 0x0F], [C[0], C[0] + C[1], 0x0B], [C[0] + C[1], 200, 0x07]];
}
// a gallery entry's @game: its ranges, its text
const rangesOf = e => Mods.parseGame(Array.isArray(e.game) ? e.game.join(", ") : e.game) || [];
const gameOf = e => Mods.gameText(rangesOf(e)) || String(e.game || "?");
const fitsEntry = e => Mods.fits({ ranges: rangesOf(e) });
function galRowText(ui, e) {
  const C = gcols(ui);
  return cell(C, U(e.name || "?"), 0) + cell(C, U(e.by), 1) + cell(C, U(gameOf(e)), 2) + UniText.slice(String(e.plays | 0), C[3]);
}
function galRowSpans(ui, e) {
  if (!fitsEntry(e)) return [[0, 200, 0x08]];
  const C = gcols(ui), a = C[0], b = a + C[1], c = b + C[2];
  return [[0, a, e.mine ? 0x0E : 0x0F], [a, b, 0x0B], [b, c, 0x03], [c, 200, 0x0A]];
}
// (who published it - the server's publisher, a name: raw text -, how often it was played online)
const playsText = e => e.mine ? T("mg.plays.mine", { n: e.plays | 0 }) : e.publisher ? TR("mg.plays.by", { name: String(e.publisher).slice(0, 40), n: e.plays | 0 })
  : T("mg.plays", { n: e.plays | 0 });
// the list of the tab shown now
async function show(ui, opts, keep) {
  if (!opts.pick) armDrop(ui, opts);
  if (st.tab === "gallery") return st.gal || st.loading ? showGallery(ui, opts, keep) : loadGallery(ui, opts);
  if (st.tab === "official") return showOfficial(ui, opts, keep);
  let list = [];
  try { list = await ModStore.list(); } catch (e) { list = []; }
  st.shown = "list";
  const mobile = GameScreen.mobile();
  const items = list.map(r => ({ key: "m:" + r.id, label: rowText(ui, r), align: "left", spans: rowSpans(ui, r),
    go: () => opts.pick ? fitsRec(r) && opts.pick(r.id) : open(ui, opts, r.id),
    info: fitsRec(r) ? [r.about ? wrap(U(r.about), 76, 1)[0] : TR("mods.by", { name: r.by || "?" }), T(mobile ? "mods.row.i.touch" : "mods.row.i")]
      : [{ text: oldText(r), color: 12 }, T("mods.old.i")] }));
  if (!list.length) items.push({ key: "none", label: T("mods.none"), disabled: true });
  const C = cols(ui);
  listScreen(ui, opts, keep, items, opts.pick ? [] : [
    { key: "file", label: T("mods.file"), go: () => openFile(ui, opts),
      info: [st.fileError ? { text: TR("mods.file.err", { why: st.fileError }), color: 12 } : T(mobile ? "mods.file.i.touch" : "mods.file.i"), T("mods.howto")] },
    { key: "console", label: T("mods.console"), info: [T("mods.console.i")], go: () => console_(ui, opts) },
  ], C, UniText.padEnd(" " + T("mods.h.name"), C[0] + 1) + (C[1] ? UniText.padEnd(T("mods.h.by"), C[1]) : "") + T("mods.h.version"));
}
// the list's screen: its rows, then the Show row, the tab's own rows, Back (as tall on both tabs)
const TABS = ["official", "mine", "gallery"];
function listScreen(ui, opts, keep, items, own, C, header) {
  const setTab = d => { st.tab = TABS[(TABS.indexOf(st.tab) + (d || 1) + TABS.length) % TABS.length]; if (st.tab === "gallery") loadGallery(ui, opts); else show(ui, opts, true); };
  const fixed = [{ key: "sep", separator: true },
    { key: "tab", label: T("pk.show") + T("mg.tab." + st.tab), info: [T("mg.show.i3")], go: () => setTab(1), change: setTab },
    ...own,
    { key: "gap", label: "", disabled: true },
    { key: "back", label: opts.backLabel || T("back.main"), info: [opts.backInfo || T("back.main.i")], go: () => leave(opts) }];
  const all = items.concat(fixed), FIXED = fixed.length;
  const shown = Math.max(1, Math.min(items.length, ROWS)), bottom = 3 + 3 + shown + FIXED;
  const w = Math.max(1 + C.reduce((a, b) => a + b, 0) + 1, ...fixed.map(it => it.label ? UniText.cols(it.label) + 4 : 0));
  root.tunnelerModsUI = () => ui;                          // (tests)
  ui.show({
    lines: [{ row: 2, text: opts.title || T(st.tab === "gallery" ? "mg.title" : st.tab === "official" ? "ofc.title" : "mods.title"), color: 12 }],
    box: { x: 41 - ((w + 2) >> 1), y: 3, w, rows: shown }, fixed: FIXED, mods: true, header,
    items: all, infoRow: bottom + 2, back: () => leave(opts),
    sel: keep ? undefined : Math.max(0, st.tab === "gallery" && st.galAt ? all.findIndex(it => it.key === "g:" + st.galAt)
      : opts.pick && opts.current != null ? all.findIndex(it => it.key === (st.tab === "official" ? "o:" : "m:") + opts.current) : 0),
  }, keep);
}
function leave(opts) { st.shown = null; st.armed = 0; st.fileError = ""; opts.back(); }

// ------------------------------------------------------------ the official mods (1.5, docs/MODS.md 6c)
// (Standard: the game without a mod - by the original's author; only while picking)
const STANDARD_BY = "Geoffrey Silverton";
async function showOfficial(ui, opts, keep) {
  st.shown = "official";
  const list = await Official.list();
  if (st.tab !== "official" || (st.shown !== "official")) return;
  const items = [];
  for (const e of list) {
    if (!e.id) {
      if (opts.pick) items.push({ key: "o:", label: rowText(ui, { name: Lang.raw("gm.standard") || "Standard", by: STANDARD_BY, version: "", game: Mods.GAME }),
        align: "left", spans: rowSpans(ui, { game: Mods.GAME }), info: [T("gm.standard.i"), T("ofc.pick.i")], go: () => opts.pick("") });
      continue;
    }
    const ok = fitsEntry(e);
    items.push({ key: "o:" + e.id, label: rowText(ui, e), align: "left", spans: rowSpans(ui, e),
      go: () => opts.pick ? ok && opts.pick(e.id) : galleryMod(ui, opts, Object.assign({ plays: 0, official: true }, e, { settings: (e.settings || []).length })),
      info: ok ? [e.about ? wrap(U(Mods.aboutIn(e, Lang.code)), 76, 1)[0] : TR("mods.by", { name: e.by || "?" }), T(opts.pick ? "ofc.pick.i" : "ofc.row.i")]
        : [{ text: oldText(e), color: 12 }, T("mods.old.i")] });
  }
  if (!items.length) items.push({ key: "none", label: T("pk.loading"), disabled: true });
  const C = cols(ui);
  listScreen(ui, opts, keep, items, [], C, UniText.padEnd(" " + T("mods.h.name"), C[0] + 1) + (C[1] ? UniText.padEnd(T("mods.h.by"), C[1]) : "") + T("mods.h.version"));
}
// picking a gallery mod: kept in your mods first (as Add), then picked; a problem: its screen with why
async function pickGallery(ui, opts, e) {
  let r = null;
  try { r = await ModStore.save(await galFile(e.id)); } catch (err) { r = { ok: false, msg: String(err && err.message || err).slice(0, 40) }; }
  if (r.ok) return opts.pick(r.rec.id);
  st.galNote = { id: e.id, add: true, text: r.msg ? TR("mg.add.err", { msg: r.msg }) : TR("mods.file.err", { why: problemText(r.problem, r.header) }), color: 12 };
  galleryMod(ui, opts, e, true);
}
// the Mode picker (the skirmish's and the lobby's Mode row): Official first - where the current choice is
function pick(ui, opts) {
  opts = Object.assign({ play: opts.pick }, opts);
  const cur = opts.current || "";
  st.galAt = ""; st.shown = null;
  st.tab = !cur || Official.now().some(x => x.id === cur) || !Official.now().length ? "official" : "mine";
  return show(ui, opts);
}

// ------------------------------------------------------------ the mod gallery (1.5, docs/MODS.md 6b)
// (the server's list again: the tab opened, another order or versions)
async function loadGallery(ui, opts) {
  st.gal = null; st.galCode = "";
  const q = st.sort + " " + st.all;
  st.loading = q;
  showGallery(ui, opts, true);
  const r = await ModStore.gallery({ sort: st.sort, game: st.all ? "" : Mods.GAME }, DosUI.playerName());
  if (st.loading !== q) return;                            // (asked again meanwhile)
  st.loading = "";
  if (r.ok) st.gal = r.mods; else { st.gal = []; st.galCode = r.code || "error"; }
  if (st.shown === "gallery") showGallery(ui, opts, true);
}
function showGallery(ui, opts, keep) {
  st.shown = "gallery";
  const items = [];
  if (!st.gal) items.push({ key: "wait", label: T("pk.loading"), disabled: true });
  else if (st.galCode && !st.gal.length) items.push({ key: "none", label: T(st.galCode === "none" ? "mg.err.none" : "pk.err.net"), disabled: true });
  else if (!st.gal.length) items.push({ key: "none", label: st.all ? T("mg.none") : T("mg.none.ver", { version: Mods.GAME }), disabled: true });
  else for (const e of st.gal) {
    const ok = fitsEntry(e);
    items.push({ key: "g:" + e.id, label: galRowText(ui, e), align: "left", spans: galRowSpans(ui, e),
      go: () => opts.pick && ok ? pickGallery(ui, opts, e) : galleryMod(ui, opts, e),
      info: ok ? [e.about ? wrap(U(e.about), 76, 1)[0] : TR("mods.by", { name: e.by || "?" }), playsText(e)]
        : [{ text: TR("mods.old", { game: gameOf(e), version: Mods.GAME }), color: 12 }, playsText(e)] });
  }
  const setSort = () => { st.sort = st.sort === "new" ? "plays" : "new"; loadGallery(ui, opts); };
  const setAll = () => { st.all = !st.all; loadGallery(ui, opts); };
  const C = gcols(ui);
  listScreen(ui, opts, keep, items, [
    { key: "sort", label: T("pk.order") + T("pk.sort." + st.sort), info: [T("mg.order.i")], go: setSort, change: setSort },
    { key: "ver", label: T("mg.ver") + (st.all ? T("mg.ver.all") : T("mg.ver.this", { version: Mods.GAME })), info: [T("mg.ver.i1"), T("mg.ver.i2")], go: setAll, change: setAll },
  ], C, UniText.padEnd(" " + T("mods.h.name"), C[0] + 1) + (C[1] ? UniText.padEnd(T("mods.h.by"), C[1]) + UniText.padEnd(T("mg.h.game"), C[2]) : "") + T("pk.h.plays"));
}
// a published mod's file (its settings' labels; Add): this browser's copy, else the server's - its hash must be its id
const galFiles = new Map();                                // id -> the file (text)
async function galFile(id) {
  if (galFiles.has(id)) return galFiles.get(id);
  const have = await ModStore.get(id).catch(() => null);
  if (have) { galFiles.set(id, have.source); return have.source; }
  const res = await root.fetch(Endpoint.api("/api/mods/" + id));
  if (!res.ok) throw new Error(res.status === 404 ? "404" : "HTTP " + res.status);
  const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(new Uint8Array(await res.arrayBuffer()));
  if (Mods.idOf(text) !== id) throw new Error(Lang.raw("mods.link.bad"));
  galFiles.set(id, text);
  return text;
}
// the tanks / bases of a header ({min, max}): "3 to 8 tanks", "4 tanks"
const tanksText = t => t && t.min === t.max ? T("mods.tanks.n", { n: t.min }) : T("mods.tanks", { min: t ? t.min : 2, max: t ? t.max : 8 });
const basesText = b => !b ? "" : b.min === b.max ? T("mg.bases.n", { n: b.min }) : T("mg.bases", { min: b.min, max: b.max });
const modeText = mode => { const m = Lang.raw("gm." + (mode || "standard")) || mode || "standard"; return TR("mods.mode", { mode: m.charAt(0).toUpperCase() + m.slice(1) }); };
// ("Hot potato" from the gallery: still that screen - an answer that comes late redraws only its own)
const galOn = id => st.shown === "gal:" + id;
async function galleryMod(ui, opts, e, keep) {
  if (st.shown !== "gal:" + e.id) { st.galNote = null; st.galArmed = 0; }
  st.shown = "gal:" + e.id; st.galAt = e.id;
  const ok = fitsEntry(e), narrow = ui.isNarrow(), W = narrow ? 34 : 76;
  const file = galFiles.get(e.id) || null, h = file ? Mods.parseHeader(file) : null;
  const settings = h && h.ok ? h.settings.map(x => U(Mods.settingLabel(x, Lang.code))).join(", ") : "";
  const nSet = h && h.ok ? h.settings.length : e.settings | 0;
  const tanks = e.tanks && typeof e.tanks === "object" ? e.tanks : h && h.ok ? h.tanks : null;
  const bases = e.bases && typeof e.bases === "object" ? e.bases : h && h.ok ? h.bases : null;
  const lines = [{ row: 2, text: T("mg.one.title"), color: 12 }, { row: 4, text: U(e.name || "?"), color: e.mine ? 14 : 15 },
    { row: 5, text: e.version ? TR("mods.by.v", { name: e.by || "?", v: e.version }) : TR("mods.by", { name: e.by || "?" }), color: 11 },
    { row: 6, text: ok ? TR("mods.for", { game: gameOf(e) }) : TR("mods.old", { game: gameOf(e), version: Mods.GAME }), color: ok ? 3 : 12 },
    { row: 7, text: UniText.slice(modeText(e.mode) + ", " + tanksText(tanks) + (bases ? ", " + basesText(bases) : ""), 78), color: 3 }];
  if (nSet) lines.push({ row: 8, text: UniText.slice(settings ? TR("mg.settings", { list: settings }) : T("mg.settings.n", { n: nSet }), 78), color: 3 });
  lines.push({ row: nSet ? 9 : 8, text: playsText(e), color: 3 });
  wrap(U(e.about), W, narrow ? 4 : 3).forEach((l, i) => lines.push({ row: 11 + i, text: l, color: 7 }));
  const note = st.galNote && st.galNote.id === e.id ? st.galNote : null;
  const sure = st.galArmed && root.performance.now() < st.galArmed;
  const back = () => { st.galArmed = 0; st.galNote = null; if (e.official) show(ui, opts); else showGallery(ui, opts); };
  const redraw = () => { if (galOn(e.id)) galleryMod(ui, opts, e, true); };
  // (Add / Play: the file kept in this browser)
  const take = async then => {
    let text = null, r = null;
    try { text = await galFile(e.id); r = await ModStore.save(text); } catch (err) { st.galNote = { id: e.id, add: true, text: TR("mg.add.err", { msg: String(err && err.message || err).slice(0, 40) }), color: 12 }; return redraw(); }
    if (!r.ok) { st.galNote = { id: e.id, add: true, text: TR("mods.file.err", { why: problemText(r.problem, r.header) }), color: 12 }; return redraw(); }
    if (galOn(e.id)) then(r.rec);
  };
  const items = [
    { key: "add", label: T("mg.add"), info: [note && note.add ? note : T("mg.add.i")],
      go: () => take(r => { st.galNote = { id: e.id, add: true, text: TR("mg.added", { name: r.name || "?" }), color: 10 }; redraw(); }) },
    { key: "play", label: T("mods.play"), attr: ok ? 0 : 0x08, info: ok ? [T("mg.play.i")] : [{ text: T("mods.play.no"), color: 12 }],
      go: () => { if (ok) take(r => { st.shown = null; opts.play(r.id); }); } },
    { key: "share", label: T("gal.link"), info: [note && note.link ? note : T("mg.link.i")], go: async () => {
      const link = Endpoint.web("/mod/" + e.id), copied = await copyText(link);
      st.galNote = { id: e.id, link: true, text: TR(copied ? "mods.shared" : "mods.shared.nocopy", { link }), color: 10 };
      redraw();
    } },
  ].concat(e.mine ? [{ key: "unpub", label: T("gal.remove"),
    info: [sure ? { text: T("gal.remove.sure"), color: 12 } : note && note.rm ? note : T("gal.remove.i")],
    go: async () => {
      if (!sure) {
        st.galArmed = root.performance.now() + 4000; redraw();
        setTimeout(() => { if (st.galArmed) { st.galArmed = 0; redraw(); } }, 4100);
        return;
      }
      st.galArmed = 0;
      const res = await ModStore.unpublish(e.id, DosUI.playerName());
      if (!galOn(e.id)) return;
      if (res.ok || res.code === "none") { st.galAt = ""; return loadGallery(ui, opts); }
      st.galNote = { id: e.id, rm: true, text: galErr(res.code), color: 12 };
      redraw();
    } }] : [])
    .concat([{ key: "gap", label: "", disabled: true }, { key: "back", label: T("gal.back"), info: [T("mg.back.i")], go: back }]);
  ui.show({ lines, box: { y: 14 }, infoRow: 22, back, items, mods: true, sel: keep ? undefined : 0 }, keep);
  // (its settings' labels: from its file)
  if (!file && (e.settings | 0) > 0 && !keep) galFile(e.id).then(() => redraw(), () => {});
}
// why publishing / removing didn't work
const galErr = c => T({ none: "mg.err.none2", net: "pk.err.net", session: "gal.err.session", published: "mg.err.taken", full: "mg.err.full",
  busy: "gal.err.busy", author: "gal.err.author", version: "mg.err.version", game: "mg.err.version" }[c] || "gal.err.other", { version: Mods.GAME });
// a mod for this game's version or a later one (the server takes no other)
// (only a mod this game runs: the server stores only those - POST /api/mods)
const galleryFits = r => { const v = Mods.parseGame(Mods.GAME)[0][0]; return (Mods.parseGame(r && r.game) || []).some(([lo, hi]) => lo <= v && v <= hi); };
// who publishes: a server with accounts - logged in (LOG IN first), else the player's name (asked once) - as maps
function whoFirst(ui, then, back) {
  Account.config().then(on => {
    if (on === true && !Account.session()) return Login.ask(ui, { done: then, back, backKey: "back.mods" });
    if (on !== true && !DosUI.playerName()) return ui.askName(then, back);
    then();
  });
}
function publish(ui, opts, r) {
  whoFirst(ui, async () => {
    st.note = { id: r.id, pub: true, text: T("gal.publishing"), color: 7 };
    open(ui, opts, r.id, true);
    const res = await ModStore.publish(r.id, DosUI.playerName());
    st.note = { id: r.id, pub: true, text: res.ok ? T("mg.published") : galErr(res.code), color: res.ok ? 10 : 12 };
    if (res.ok) { Medals.earn("modmaker"); st.gal = null; }
    if (st.shown === "mod:" + r.id) open(ui, opts, r.id, true);
  }, () => open(ui, opts, r.id, true));
}
async function unpublish(ui, opts, r) {
  st.note = { id: r.id, pub: true, text: T("gal.removing"), color: 7 };
  open(ui, opts, r.id, true);
  const res = await ModStore.unpublish(r.id, DosUI.playerName());
  st.note = { id: r.id, pub: true, text: res.ok || res.code === "none" ? T("gal.removed") : galErr(res.code), color: res.ok || res.code === "none" ? 10 : 12 };
  if (st.shown === "mod:" + r.id) open(ui, opts, r.id, true);
}

// ------------------------------------------------------------ a mod file: picked, or dropped on the Mods screens
async function readFile(ui, opts, f) {
  let problem = "";
  if (!f || !(f.size <= Mods.MAX_BYTES)) problem = f ? "size" : "text";
  let res = null;
  if (!problem) {
    try { res = await ModStore.save(new Uint8Array(await f.arrayBuffer())); } catch (e) { res = { ok: false, problem: "text" }; }
    if (!res.ok) problem = res.problem;
  }
  if (problem) { st.fileError = problemText(problem, res && res.header); st.tab = "mine"; return show(ui, opts, true); }
  st.fileError = "";
  return open(ui, opts, res.rec.id);
}
function openFile(ui, opts) {
  const inp = root.document.createElement("input");
  inp.type = "file"; inp.accept = ".js,.tmod.js,text/javascript,application/javascript";
  inp.addEventListener("change", () => { const f = inp.files && inp.files[0]; if (f) readFile(ui, opts, f); });
  inp.click();
}
// (a file dragged over the page while a Mods screen shows: taken by it - the listeners are the route's, Scope)
function armDrop(ui, opts) {
  if (st.dropOn === ui || typeof root.addEventListener !== "function") return;
  st.dropOn = ui;
  const files = e => e && e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");
  root.addEventListener("dragover", e => { if (st.shown && ui.spec && ui.spec.mods && files(e)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } });
  root.addEventListener("drop", e => {
    if (!st.shown || !ui.spec || !ui.spec.mods || !files(e)) return;
    e.preventDefault();
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) readFile(ui, opts, f);
  });
}

// ------------------------------------------------------------ one mod
async function open(ui, opts, id, keep) {
  const r = await ModStore.get(id);
  if (!r) return show(ui, opts);
  if (st.shown !== "mod:" + id) { st.note = null; st.armed = 0; }
  st.shown = "mod:" + id;
  armDrop(ui, opts);
  const ok = fitsRec(r), narrow = ui.isNarrow(), W = narrow ? 34 : 76;
  const tanks = r.tanks && r.tanks.min === r.tanks.max ? T("mods.tanks.n", { n: r.tanks.min }) : T("mods.tanks", { min: r.tanks ? r.tanks.min : 2, max: r.tanks ? r.tanks.max : 8 });
  const modeName = Lang.raw("gm." + (r.mode || "standard")) || r.mode;
  const lines = [{ row: 2, text: T("mods.one.title"), color: 12 }, { row: 4, text: U(r.name || "?"), color: 15 },
    { row: 5, text: r.version ? TR("mods.by.v", { name: r.by || "?", v: r.version }) : TR("mods.by", { name: r.by || "?" }), color: 11 },
    { row: 6, text: ok ? TR("mods.for", { game: Mods.gameText(Mods.parseGame(r.game)) }) : oldText(r), color: ok ? 3 : 12 },
    { row: 7, text: TR("mods.mode", { mode: modeName.charAt(0).toUpperCase() + modeName.slice(1) }) + ", " + tanks, color: 3 }];
  wrap(U(r.about), W, narrow ? 6 : 3).forEach((l, i) => lines.push({ row: 9 + i, text: l, color: 7 }));
  const note = st.note && st.note.id === id ? st.note : null;
  const sure = st.armed && root.performance.now() < st.armed;
  const back = () => { st.armed = 0; st.note = null; show(ui, opts); };
  const items = [
    { key: "play", label: T("mods.play"), attr: ok ? 0 : 0x08, info: ok ? [T("mods.play.i")] : [{ text: T("mods.play.no"), color: 12 }],
      go: () => { if (ok) { st.shown = null; opts.play(id); } } },
    { key: "save", label: T("mods.save"), info: [note && note.save ? note : T("mods.save.i")], go: () => saveFile(ui, opts, r) },
    { key: "share", label: T("mods.share"), info: note && note.share ? [note].concat(note.more ? [note.more] : []) : [T("mods.share.i")], go: () => share(ui, opts, r) },
    // (1.5, docs/MODS.md 6b: the mod gallery)
    ModStore.published(r) ? { key: "unpub", label: T("gal.remove"), info: [note && note.pub ? note : T("gal.remove.i")], go: () => unpublish(ui, opts, r) }
      : { key: "pub", label: T("gal.publish"), attr: galleryFits(r) ? 0 : 0x08,
        info: note && note.pub ? [note] : galleryFits(r) ? [T("mg.publish.i1"), T("mg.publish.i2")] : [{ text: T("mg.err.version", { version: Mods.GAME }), color: 12 }],
        go: () => { if (galleryFits(r)) publish(ui, opts, r); } },
    { key: "delete", label: T("mods.delete"), info: [sure ? { text: T("mods.delete.sure"), color: 12 } : T("mods.delete.i")],
      go: async () => {
        if (!sure) {
          st.armed = root.performance.now() + 4000; open(ui, opts, id, true);
          setTimeout(() => { if (st.armed && st.shown === "mod:" + id) { st.armed = 0; open(ui, opts, id, true); } }, 4100);
          return;
        }
        st.armed = 0;
        await ModStore.remove(id);
        if (opts.removed) opts.removed(id);
        show(ui, opts);
      } },
    { key: "gap", label: "", disabled: true },
    { key: "back", label: T("back.mods"), info: [T("back.mods.i")], go: back },
  ];
  ui.show({ lines, box: { y: 12 }, infoRow: 21, back, items, mods: true, sel: keep ? undefined : ok ? 0 : 1 }, keep);
}

// the mod's file: the Android app has its own way into the Downloads folder (MainActivity.kt); a browser, the desktop
// app: a download
function saveFile(ui, opts, r) {
  const bytes = new TextEncoder().encode(r.source), A = root.TunnelerAndroid;
  if (A && A.saveFile) {
    let bin = "", where = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    try { where = A.saveFile(fileName(r), root.btoa(bin)); } catch (e) { where = ""; }
    st.note = { id: r.id, save: true, text: where ? TR("mods.saved", { where }) : T("mods.save.err"), color: where ? 10 : 12 };
    return open(ui, opts, r.id, true);
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: "text/javascript" }));
  const a = root.document.createElement("a");
  a.href = url; a.download = fileName(r);
  root.document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// a link to it: the file sent to the game's server (net/modfetch.js: POST /api/mods - the server checks its size and
// header, never runs it), the link (/mod/<id> - the id is the file's hash, the same everywhere) copied and shown
async function share(ui, opts, r) {
  st.note = { id: r.id, share: true, text: T("mods.sharing"), color: 7 };
  open(ui, opts, r.id, true);
  try {
    const id = await ModFetch.share(r.source);
    if (r.shared !== id) await ModStore.putRecord(Object.assign({}, r, { shared: id })).catch(() => null);
    const link = Endpoint.web("/mod/" + id);
    const copied = await copyText(link);
    st.note = { id: r.id, share: true, text: TR(copied ? "mods.shared" : "mods.shared.nocopy", { link }), color: 10 };
  } catch (e) {
    const msg = e && e.why ? (e.why === "net" ? e.msg || "net" : e.msg ? e.why + ": " + e.msg : e.why) : String(e && e.message || e);
    st.note = { id: r.id, share: true, text: TR("mods.share.err", { msg: String(msg).slice(0, 50) }), color: 12 };
  }
  if (st.shown === "mod:" + r.id) open(ui, opts, r.id, true);
}

// a share link's mod (/mod/<id>): kept here already, else fetched (its bytes must hash to the id) and kept
async function fromLink(ui, opts, id) {
  if (await ModStore.get(id)) return open(ui, opts, id);
  st.shown = "list";
  let err = "";
  try {
    const res = await root.fetch(Endpoint.api("/api/mods/" + encodeURIComponent(id)));
    if (!res.ok) throw new Error(res.status === 404 ? "404" : "HTTP " + res.status);
    let bytes = new Uint8Array(await res.arrayBuffer());
    // (a JSON answer {source}: its file)
    if (bytes[0] === 0x7B) try { const j = JSON.parse(new TextDecoder().decode(bytes)); if (j && typeof j.source === "string") bytes = new TextEncoder().encode(j.source); } catch (e) { /* the file */ }
    if (Mods.idOf(bytes) !== id) err = Lang.raw("mods.link.bad");
    else {
      const r = await ModStore.save(bytes);
      if (r.ok) return open(ui, opts, r.rec.id);
      err = problemText(r.problem, r.header);
    }
  } catch (e) { err = TR("mods.link.err", { msg: String(e && e.message || e).slice(0, 40) }); }
  st.fileError = err; st.tab = "mine";
  return show(ui, opts);
}

// ------------------------------------------------------------ the console (net/modlog.js)
function console_(ui, opts, keep) {
  st.shown = "console";
  const log = ModLog.last(), narrow = ui.isNarrow(), W = narrow ? 32 : 72;
  const lineText = l => l.kind === "say" ? TR("mods.con.say", { text: l.text })
    : TR("mods.con.stop", { why: (Lang.raw("modrun.why." + l.why) || l.why).replace("{detail}", l.detail || "?") });
  const items = (log ? log.lines : []).map((l, i) => {
    const head = T("mods.con.frame", { n: l.frame }) + "  ", text = lineText(l);
    return { key: "l" + i, align: "left", label: UniText.slice(head + text, W), spans: [[0, UniText.cols(head), 0x07], [UniText.cols(head), 200, l.kind === "stop" ? 0x0C : 0x0B]],
      info: wrap(text, 76, 3).map(t => ({ text: t, color: l.kind === "stop" ? 12 : 11 })).concat(T("mods.con.row.i")), go: () => {} };
  });
  const head = !log ? T("mods.con.never") : TR("mods.con.game", { name: log.name || log.id || "?", date: dateText(log.date) });
  if (log && !log.lines.length) items.push({ key: "quiet", label: T("mods.con.quiet"), disabled: true });
  const back = () => show(ui, opts);
  items.push({ key: "gap", label: "", disabled: true },
    { key: "clear", label: T("mods.con.clear"), info: [T("mods.con.clear.i")], disabled: !log, go: () => { ModLog.clear(); console_(ui, opts, true); } },
    { key: "back", label: T("back.mods"), info: [T("back.mods.i")], go: back });
  const FIXED = 3, shown = Math.max(1, Math.min(items.length - FIXED, 12));
  ui.show({ lines: [{ row: 2, text: T("mods.con.title"), color: 12 }, { row: 4, text: head, color: 15 }],
    box: { x: 41 - ((W + 4) >> 1), y: 6, w: W + 2, rows: shown }, fixed: FIXED, items, infoRow: 6 + shown + FIXED + 3, back, mods: true,
    sel: keep ? undefined : items.length - 1 }, keep);
}

export const ModsUI = {
  show, open, pick, fromLink, readFile, gallery: (ui, opts) => { st.tab = "gallery"; return loadGallery(ui, opts); }, galleryMod,
  console: console_,
  fitsRec, fileName,
  state: st,
};
