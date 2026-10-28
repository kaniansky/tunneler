// The Instructions and Information pages (docs/RENDERING.md: texts about the game - not the game): rows of font text
// with "{n}" colour codes, as long as their text needs, wrapped to PAGE_W columns; shown on a text screen 23 rows at a
// time from pageTop, a scroll bar in column 80 and the keys that scroll it on the bottom line when longer.
//   Pages.instructionRows(ctx) / informationRows(ctx) -> [{col, text}]
//     ctx = {strings (an engine's, Lang.apply), lang, uiMode ("hotseat" | "cpu" | "online": which controls they
//     describe), extended, winScore, pageWidth (the phone layout's narrower page)} - an engine, or what DosUI makes
//   Pages.show(host, rows)  Pages.scroll(host, what) -> moved  Pages.draw(host)
//     host = a text screen with the Crt calls (window, gotoXY, textColor, write, clearScreen, drawBottomRule, vram, uni)
//     and the page's state (pageRows, pageTop, strings): the engine (the original program's own pages) or a TextBuf
//     (dosui.js: the site's main menu)
import { STRINGS_EN } from "../../lang/en/engine.js";
import { TunnelerEngine } from "../game/engine.js";
import { Lang } from "../text/lang.js";
import { UniText } from "../text/unitext.js";

const PAGE_ROWS = 23, PAGE_W = 78;
const visLen = t => UniText.cols(t.replace(/\{\d+\}/g, ""));
const centreCol = t => 41 - (visLen(t) >> 1);

// lines of a paragraph with "{n}" replaced by the number of rounds to win (strings.instr.winRounds, e.g. "three
// rounds"); re-wrapped to 80 columns when a line no longer fits
function winScoreText(ctx, lines) {
  if (!lines.some(l => l.includes("{n}"))) return lines;
  const words = ctx.strings.instr.winRounds || STRINGS_EN.instr.winRounds;
  const w = words[ctx.winScore - 1] || String(ctx.winScore);
  const out = lines.map(l => l.split("{n}").join(w));
  if (out.every(l => visLen(l) <= 80)) return out;
  // (only real spaces separate words: encoded text has letters such as 0xA0 = "á" that \s would match)
  const wrapped = [], trim = t => t.replace(/ +$/, "");
  let line = "";
  for (const tok of out.join(" ").match(/[^ ]+ */g) || []) {
    if (line && visLen(trim(line + tok)) > 80) { wrapped.push(trim(line)); line = ""; }
    line += tok;
  }
  if (trim(line)) wrapped.push(trim(line));
  return wrapped;
}

// a paragraph (one string, or lines joined with spaces) wrapped to PAGE_W columns; every row starts with the colour it
// continues in (only real spaces separate words - see winScoreText)
function wrapPage(ctx, text, color) {
  const out = [], trim = t => t.replace(/ +$/, ""), W = ctx.pageWidth || PAGE_W;   // (pageWidth: dosui.js's phone layout)
  let line = "", lineColor = color, cur = color;
  for (const tok of [].concat(text).join(" ").match(/[^ ]+ */g) || []) {
    if (visLen(line) && visLen(trim(line + tok)) > W) { out.push("{" + lineColor + "}" + trim(line)); line = ""; lineColor = cur; }
    line += tok;
    for (const m of tok.matchAll(/\{(\d+)\}/g)) cur = +m[1];
  }
  if (visLen(line)) out.push("{" + lineColor + "}" + trim(line));
  return out;
}

// The original text (intro, display, controls, game), with the display and controls describing this version, then the
// sections about everything added since (strings.instr.sections: [head, text]) and the game modes
function instructionRows(ctx) {
  const I = ctx.strings.instr, E = STRINGS_EN.instr, rows = [];
  const add = (text, col) => rows.push({ col: col || 1, text });
  const para = (head, text) => { for (const l of wrapPage(ctx, (head ? "{11}" + head + "{3}" : "") + [].concat(text).join(" "), 3)) add(l); };
  add("{14}" + I.title, centreCol(I.title));
  add("");
  const ext = ctx.extended && I.introExt;              // (3-8 tanks / teams / computer tanks)
  para("", winScoreText(ctx, ext ? I.introExt : I.intro));
  add("");
  para(I.displayHead, ctx.uiMode === "online" ? [...I.display.slice(0, -1), I.displayOnline] : I.display);
  add("");
  if (ctx.uiMode === "hotseat") {
    const [l, r] = I.controls.hotseat, head = "{11}" + I.controlsHead + "{3}" + l;
    add(head + " ".repeat(Math.max(0, 39 - visLen(head))) + "\xFA" + r);
    for (const [l, r] of I.table) add("{3}" + l + " ".repeat(Math.max(0, 39 - visLen(l))) + "\xFA" + r);
    para("", I.hold);
  } else para(I.controlsHead, I.controls[(ctx.uiMode === "cpu" ? "cpu" : "online") + (ext ? "Ext" : "")]);
  add("");
  para(I.gameHead, I.game);
  for (const [head, text] of I.sections || E.sections) { add(""); para(head, text); }
  // the game modes (docs/DESIGN-8P.md 27): each one's name and its own explanation (GM.strings.<lang>.instr)
  for (const m of TunnelerEngine.MODE_LIST) {
    const M = TunnelerEngine.MODES[m], S = M && M.strings;
    if (!S || !S.en || !S.en.instr) continue;
    const name = ((ctx.strings.settings || {}).modes || STRINGS_EN.settings.modes)[m] || m;
    add(""); para(name.charAt(0).toUpperCase() + name.slice(1) + ":  ", Lang.enc((S[ctx.lang] && S[ctx.lang].instr) || S.en.instr));
  }
  return rows;
}

// About this version (the original page described the 1991 shareware offers and the author's address)
function informationRows(ctx) {
  const I = ctx.strings.info, E = STRINGS_EN.info, rows = [];
  const add = (text, col) => rows.push({ col: col || 1, text });
  const para = (head, text) => { for (const l of wrapPage(ctx, (head ? "{11}" + head + "{14}" : "") + [].concat(text).join(" "), 14)) add(l); };
  add("{10}" + I.title, centreCol(I.title));
  add("");
  para("", I.p1);
  add("");
  add("{11}" + I.waysHead);
  const w = Math.max(...I.ways.map(([n]) => visLen(n))) + 3;
  for (const [n, t] of I.ways) add("{15}  " + n + " ".repeat(w - visLen(n)) + "{14}" + t);
  add("");
  para("", I.p2);
  for (const [head, text] of I.sections || E.sections) { add(""); para(head, text); }
  add("");
  para("", I.p3);
  add("");
  const cw = Math.max(...I.credits.map(visLen)), cx = 41 - (cw >> 1);
  I.credits.forEach((l, k) => add((k ? "{3}" : "{11}") + l, cx));
  return rows;
}

function show(host, rows) {
  host.pageRows = rows;
  host.pageTop = 0;
  draw(host);
}
const maxTop = host => Math.max(0, (host.pageRows || []).length - PAGE_ROWS);
// what: "up" / "down" (a row), "pgup" / "pgdn" (a screen), "home" / "end", or a number of rows; true when the page
// moved (and was drawn again)
function scroll(host, what) {
  const d = typeof what === "number" ? what : { up: -1, down: 1, pgup: 1 - PAGE_ROWS, pgdn: PAGE_ROWS - 1,
    home: -Infinity, end: Infinity }[what];
  if (!host.pageRows || d === undefined) return false;
  const top = Math.max(0, Math.min(maxTop(host), host.pageTop + d));
  if (top === host.pageTop) return false;
  host.pageTop = top;
  draw(host);
  return true;
}
function draw(host) {
  const rows = host.pageRows, max = maxTop(host), S = host.strings;
  host.window(1, 1, 80, PAGE_ROWS);
  host.textColor(7);
  host.clearScreen();
  host.window(1, 1, 80, 25);
  for (let k = 0; k < PAGE_ROWS && host.pageTop + k < rows.length; k++) {
    const r = rows[host.pageTop + k];
    host.textColor(7);
    host.gotoXY(r.col, k + 1);
    for (const part of r.text.split(/(\{\d+\})/)) {
      const m = /^\{(\d+)\}$/.exec(part);
      if (m) host.textColor(+m[1]); else if (part) host.write(part);
    }
  }
  // the bottom line: the rule, the prompt at the right
  host.drawBottomRule();
  host.window(1, 1, 80, 25);
  host.gotoXY(80 - visLen(S.prompt) - 1, 25);
  host.textColor(15);
  host.write(" " + S.prompt);
  if (max) {
    // scroll bar (column 80): arrows white while there is more that way, the thumb where the view is
    const cell = (row, ch, attr) => { const o = (row - 1) * 160 + 79 * 2; host.vram[o] = ch; host.vram[o + 1] = attr; if (host.uniUsed) host.uni[o >> 1] = 0; };
    const track = PAGE_ROWS - 2, size = Math.max(1, Math.round(track * PAGE_ROWS / rows.length));
    const at = Math.round((track - size) * host.pageTop / max);
    cell(1, 0x18, host.pageTop > 0 ? 0x0F : 0x08);
    for (let k = 0; k < track; k++) cell(2 + k, k >= at && k < at + size ? 0xDB : 0xB0, k >= at && k < at + size ? 0x07 : 0x08);
    cell(PAGE_ROWS, 0x19, host.pageTop < max ? 0x0F : 0x08);
    // the keys that scroll it, left of the prompt
    host.gotoXY(2, 25);
    host.textColor(7);
    host.write(S.scroll || STRINGS_EN.scroll);
  }
  host.dirty = true;
}

export const Pages = { PAGE_ROWS, PAGE_W, winScoreText, wrapPage, instructionRows, informationRows, show, scroll, draw };
