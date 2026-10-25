// Menu screens in the look of TUNNELER's own main menu: an 80x25 DOS text screen (VGA font and
// colours, drawn by Display from the engine's emulated text buffer) with a magenta box of items and a
// white-on-magenta highlight bar. Arrow keys + Enter or the mouse choose, Esc goes back.
//
// ui.show(spec) draws a screen:
//   spec.lines:  [{row, text, color, col}]        free text (col omitted = centred), rows 1-based
//   Centred text and boxes are centred on the screen (boxes of even width exactly; text of odd
//   length half a column to the right), like the game's own menu.
//   spec.box:    {x, y, w, rows}                   left border column / top border row (1-based),
//                                                  interior width, max visible item rows (scrolls);
//                                                  without w the box fits its longest item (boxWidth),
//                                                  centred unless x is given
//   spec.boxes:  [{x, y, w, title, items, joinTop, wrap}]  instead of box / items: boxes side by side (each
//                                                  sized to its items, centred together, the title in
//                                                  the top border), one selection over all of them:
//                                                  Up / Down continue into the next / previous box
//                                                  (wrap: stay in this box, round and round),
//                                                  Tab jumps to the other box (in a text input: as Down)
//   spec.onSel:  (i) => ...                        called when the selection moved to item i (keys,
//                                                  mouse; e.g. a list of categories showing the chosen one)
//   spec.fixed:  the last N items always stay visible below the scrolling ones
//   spec.header: "text"                            non-selectable heading row inside the box (yellow)
//   spec.text:   [{row, col, text, color}]         raw Unicode text (any language, not encoded for the
//                                                  font; drawn through the Unicode plane), rows / cols 1-based
//   All other texts are font text (Lang.t / Lang.enc - unitext.js: other characters, e.g. a player's
//   name inside a translated line, go through the Unicode plane); widths are display columns
//   (UniText.cols: CJK / emoji take 2).
//   spec.items:  [{label, go, info: [..], disabled, attr, align: "left", input: {value, max, placeholder,
//                width}}]   input.value: raw Unicode, any printable characters may be typed / pasted;
//                input.max / input.width: display columns (the end of a value wider than width is shown);
//                input.secret: shown as one "*" per character (a password)
//                {separator: true} draws a horizontal line across the box
//                change(dir): a switch - Left / Right step its value back (-1) / forward (+1); with
//                the mouse a click goes forward (go), a right click back, the wheel up / down forward / back
//                digit(n): number keys 1..8 on this row (e.g. a slot's team)
//                zones: [{from, to, click(dir)}] - parts of the label (display columns from..to-1 of the
//                label text) a mouse click acts on: left button dir +1, right button -1 (no browser menu
//                then); a click elsewhere on a row with zones only selects it (clickGo: true - it goes, as Enter);
//                slide: true - press and slide across the zones (a meter)
//                info lines may be {text, color, onClick} - clickable (e.g. the invite link)
//                static: a read-only text row (never selected; attr, default light gray)
//                dim: [from, to] - label columns from..to-1 drawn gray (a part that doesn't apply now)
//                Colors: labels magenta, a switch's value (after its first ": ") white, valueAttr = a
//                read-only value's color (light gray), typed input text white, disabled dark gray;
//                spans: [[from, to, attr], ...] label columns in their own colors (e.g. a table row)
//
// ui.showPage(kind, uiMode, back[, engineOpts]) shows the game's own Instructions / Information page full screen
// (drawn by an engine instance, like in the game); Enter, Esc or a click calls back(). A page longer
// than the screen scrolls: Up / Down, PgUp / PgDn, Home / End, the mouse wheel, or dragging it on a
// touch screen (engine.pageScroll; the engine draws the scroll bar).
//   spec.infoRow: row of the selected item's info lines (cyan, centred)
//   spec.hint:   bottom line text;  spec.back: Esc handler;  spec.sel: initially selected item
//   spec.footer: a short text at the bottom left (the main menu: the version)
//
// new DosUI(canvas) owns the canvas. new DosUI(canvas, {display, present, active}) draws over another
// page's Display instead: present(snapshot) receives each drawn screen, and input is only handled
// while active() returns true.
import { Display } from "./display.js";
import { TunnelerEngine } from "./engine.js";
import { Gfx } from "./gfx.js";
import { Lang } from "./lang.js";
import { UniText } from "./unitext.js";
import { GameScreen } from "./screen.js";
import { TextBuf } from "./textbuf.js";
const root = globalThis;

const ATTR = 0x05, SEL = 0x5F, DISABLED = 0x08;
// graphics "modern", style clean (gfx.js / gfx-text.js): item labels warm gray instead of magenta, frames
// thin dark gray, box titles light gray - the highlight bar (SEL) stays: gfx-text.js draws it in its one
// accent colour. Retro keeps the DOS colours.
const modernUI = () => !!(Gfx && Gfx.mode && Gfx.mode() === "modern" && Gfx.menuStyle() !== "retro");
const labelAttr = () => modernUI() ? 0x07 : ATTR;
const frameColor = () => modernUI() ? 8 : 5;
const titleColor = () => modernUI() ? 7 : 13;
// keys that scroll an Instructions / Information page (KeyboardEvent.key; the numeric keypad with
// NumLock off gives the same) -> engine.pageScroll
const PAGE_KEYS = { ArrowUp: "up", ArrowDown: "down", PageUp: "pgup", PageDown: "pgdn", Home: "home", End: "end" };
const U = UniText;
// characters an input never takes: control, bidi, zero-width, private use (see NetProto's cleaning)
const BAD_INPUT = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ue000-\uf8ff\ufe00-\ufe0f]/;
// the phone layout (drawNarrow): the screen's columns, and every box's place (left border column, interior width)
// the phone layout: NC columns; the rows one can tap (menu items) LINE_H times as tall as the others (the text
// centred, the highlight bar as tall as the row), titles, borders, info lines and pages at the DOS screen's
// height (owner, 2026-10-25: "the font should be little larger and the highlighted row taller", "the text below
// has too tall line height"); NB = its boxes (x, width)
const NC = 36, LINE_H = 1.5, NB = { x: 2, w: NC - 4 };
// a page row's text without its {n} colour switches
const visible = t => String(t).replace(/\{\d+\}/g, "");
// font text wrapped to w display columns, at spaces where it can (a longer word is cut)
function wrapCols(text, w) {
  const out = [];
  let line = "";
  for (const word of String(text).split(" ")) {
    const cand = line ? line + " " + word : word;
    if (U.cols(cand) <= w) { line = cand; continue; }
    if (line) out.push(line);
    line = word;
    // (a word wider than the line - a link - goes on over the next lines, after a "/" when there is one)
    for (let head; U.cols(line) > w && (head = U.slice(line, w)); line = line.slice(head.length)) {
      const k = head.lastIndexOf("/") + 1;
      if (k > head.length >> 1) head = head.slice(0, k);
      out.push(head);
    }
  }
  if (line || !out.length) out.push(line);
  return out;
}
// Touch screens have no keyboard until a real text field has the focus: a tap on an input row focuses this
// hidden <input> (one for the page; docs/DESIGN-8P.md 32), whose text goes into the canvas input
// (its "input" events; the canvas shows it). Keys it gets that DosUI would type itself are left to it.
let soft = null;
function softInput() {
  if (soft || !root.document || !root.document.body || !root.document.createElement) return soft;
  soft = root.document.createElement("input");
  soft.className = "soft-input";
  for (const [k, v] of [["autocomplete", "off"], ["autocorrect", "off"], ["autocapitalize", "off"], ["spellcheck", "false"],
    ["enterkeyhint", "done"], ["aria-hidden", "true"], ["tabindex", "-1"]]) soft.setAttribute(k, v);
  // (16 px: no zoom on iOS; transparent, in the page's top left corner - the canvas shows the text)
  Object.assign(soft.style, { position: "fixed", left: "0", top: "0", width: "1px", height: "1px", opacity: "0", fontSize: "16px",
    border: "0", padding: "0", pointerEvents: "none" });
  root.document.body.appendChild(soft);
  return soft;
}
const touchScreen = ev => (ev && ev.pointerType === "touch") || !!(root.document && root.document.body && root.document.body.classList &&
  root.document.body.classList.contains("touch"));

class DosUI {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.display = opts.display || new Display(canvas);
    this.present = opts.present || (snap => this.display.setSnapshot(snap));
    this.active = opts.active || (() => true);
    this.t = new TextBuf();                  // the screen's text buffer (the engine's Crt calls, any number of rows)
    this.spec = null; this.sel = 0; this.top = 0;
    window.addEventListener("keydown", e => { if (this.active()) this.key(e); });
    const si = softInput();
    if (si) si.addEventListener("input", () => { if (this.active()) this.softTyped(); });
    window.addEventListener("paste", e => { if (this.active()) this.paste(e); });
    canvas.addEventListener("mousemove", e => { if (this.active()) this.hover(e); });
    canvas.addEventListener("click", e => { if (this.active()) this.click(e); });
    // a row with zones and slide: true (the Settings' volume meter): press on it and slide - every zone the pointer
    // passes is clicked, past its ends the first one's back / the last one's forward (owner, 2026-10-25)
    canvas.addEventListener("pointerdown", e => {
      if (!this.active() || e.button > 0 || !this.spec || this.spec.page) return;
      const i = this.itemAt(e), it = i >= 0 ? this.spec.items[i] : null;
      if (!it || !it.slide || !it.zones) return;
      this.slide = { key: it.key, at: null };
      this.sel = i;
      this.slideTo(e);
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* old browser */ }
    });
    canvas.addEventListener("pointermove", e => { if (this.slide && this.active()) this.slideTo(e); });
    for (const t of ["pointerup", "pointercancel"]) canvas.addEventListener(t, () => { this.slide = null; });
    canvas.addEventListener("contextmenu", e => { if (this.active() && (this.zoneClick(e, -1) || this.backClick(e))) e.preventDefault(); });
    canvas.addEventListener("wheel", e => { if (this.active() && this.wheel(e)) e.preventDefault(); }, { passive: false });
    // touch screens: dragging a page scrolls it (a tap still goes back) - the engine's 80 x 25 page by rows; the
    // phone layout's pages scroll smoothly like its menus (below)
    canvas.addEventListener("touchstart", e => {
      if (this.active() && this.spec && this.spec.engine && e.touches.length === 1) { this.touchY = e.touches[0].clientY; this.dragged = false; }
    }, { passive: true });
    canvas.addEventListener("touchmove", e => {
      if (this.touchY == null || !this.active() || !this.spec || !this.spec.engine || e.touches.length !== 1) return;
      const h = (canvas.getBoundingClientRect().height || 400) / 25, d = Math.trunc((this.touchY - e.touches[0].clientY) / h);
      if (d) { this.touchY -= d * h; this.dragged = true; this.scrollPage(d); }
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener("touchend", () => { this.touchY = null; });
    // the phone layout (narrow): turning the phone or resizing lays the screen out again; a drag scrolls it
    window.addEventListener("resize", () => { if (this.active() && this.spec && !this.spec.page) this.draw(); });
    // (a drag moves the content with the finger - fractions of a row: smooth; let go while moving: it glides on)
    canvas.addEventListener("touchstart", e => {
      if (!this.active() || !this.narrow || e.touches.length !== 1 || (this.spec && this.spec.page && !this.spec.nlines)) return;
      this.ndrag = { y0: e.touches[0].clientY, top0: this.ntopU || 0, y: e.touches[0].clientY, t: performance.now(), v: 0 };
      this.nanim = null; this.dragged = false;
    }, { passive: true });
    canvas.addEventListener("touchmove", e => {
      const d = this.ndrag;
      if (this.slide) { e.preventDefault(); return; }    // (sliding a meter: no scrolling)
      if (!d || !this.active() || !this.narrow || e.touches.length !== 1) return;
      const y = e.touches[0].clientY, now = performance.now(), upp = this.narrow.units / (canvas.getBoundingClientRect().height || 400);
      if (Math.abs(y - d.y0) > 6) this.dragged = true;
      if (this.dragged) {
        if (now > d.t) d.v = 0.6 * d.v + 0.4 * ((d.y - y) * upp / (now - d.t));   // (units per ms)
        this.nfollow = false;
        this.presentNarrowAt(d.top0 + (d.y0 - y) * upp);
      }
      d.y = y; d.t = now;
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener("touchend", () => {
      const d = this.ndrag;
      this.ndrag = null;
      if (!d || !this.dragged || Math.abs(d.v) < 0.003 || performance.now() - d.t > 80) return;
      const a = this.nanim = { fling: true };
      let v = d.v, last = performance.now();
      const step = now => {
        if (this.nanim !== a || !this.active() || !this.narrow) return;
        const dt = Math.min(40, now - last);
        last = now;
        const top = (this.ntopU || 0) + v * dt;
        this.presentNarrowAt(top);
        v *= Math.pow(0.994, dt);
        if (Math.abs(v) > 0.0015 && top > 0 && top < this.narrow.maxTop) requestAnimationFrame(step); else this.nanim = null;
      };
      requestAnimationFrame(step);
    });
    if (!opts.display) {
      const loop = now => { this.display.draw(now); requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    }
  }

  // keepSel: keep the selected item (matched by its key, or label) when redrawing the same screen
  // with fresh data
  showPage(kind, uiMode, back, engineOpts) {
    const e = new TunnelerEngine(0, engineOpts);      // (engineOpts: extended games' instructions)
    Lang.apply(e);
    e.strings = Object.assign({}, e.strings, { prompt: Lang.t("page.back") });
    e.uiMode = uiMode || "hotseat";
    if (this.isNarrow()) {                             // (the phone layout: the page's rows wrapped narrow, drawn here)
      e.pageWidth = NC - 2;
      if (e.uiMode === "hotseat") e.uiMode = "cpu";   // (no split screen on a phone: its keys table means nothing)
      e.initTables();
      const rows = kind === "instructions" ? e.instructionRows() : e.informationRows(), lines = [];
      for (const r of rows) {
        if (visible(r.text).length > NC - 2) for (const l of e.wrapPage(r.text, 7)) lines.push({ c: false, t: l });
        else lines.push({ c: r.col > 1, t: r.text });
      }
      this.spec = { page: true, back, items: [], nlines: lines, ntop: 0 };
      this.wheelAcc = 0; this.dragged = false;
      this.presentPage();
      return;
    }
    e.initTables();
    e.textMode();
    e.window(1, 1, 80, 24);
    e.clearScreen();
    if (kind === "instructions") e.showInstructions();
    else { const g = e.showInformation(); while (!g.next().done); }
    this.spec = { page: true, back, items: [], engine: e };
    this.wheelAcc = 0; this.dragged = false;
    this.presentPage();
  }
  presentPage() {
    if (this.spec.nlines) return this.presentNarrowPage();
    const e = this.spec.engine, snap = { t: 0, mode: "text", screen: "text", vram: e.vram.slice(0, 16000) };
    e.snapUni(snap);
    this.present(snap);
  }
  // scroll the page shown by showPage: "up" / "down" / "pgup" / "pgdn" / "home" / "end" or a number of rows
  scrollPage(what) {
    const s = this.spec;
    if (s && s.nlines) {                                 // (the phone layout: glides there)
      if (!this.narrow) return;
      const view = this.narrow.view, from = this.nanim && this.nanim.to != null ? this.nanim.to : this.ntopU || 0;
      const d = typeof what === "number" ? what : { up: -1, down: 1, pgup: 1 - view, pgdn: view - 1, home: -1e6, end: 1e6 }[what];
      this.scrollNarrow(Math.max(0, Math.min(this.narrow.maxTop, from + (d || 0))), true);
      return;
    }
    if (s && s.engine && s.engine.pageScroll(what)) this.presentPage();
  }

  show(spec, keepSel) {
    const keyOf = it => it && (it.key != null ? it.key : it.label);
    const prev = this.spec && keyOf(this.spec.items[this.sel]);
    this.spec = spec;
    this.nkeep = !!keepSel;                    // (the same screen with fresh data: the phone layout keeps its scroll)
    if (spec.boxes) spec.items = [].concat(...spec.boxes.map(b => b.items));   // one selection over all boxes
    const n = spec.items.length;
    if (!keepSel) { this.sel = spec.sel || 0; this.top = 0; }
    else { const i = spec.items.findIndex(it => keyOf(it) === prev); if (i >= 0) this.sel = i; }
    this.sel = Math.min(Math.max(this.sel, 0), n - 1);
    if (!this.enabled(this.sel)) this.move(1, true);
    this.draw();
  }

  enabled(i) { const it = this.spec.items[i]; return it && !it.disabled && !it.separator && !it.static; }
  move(d, quiet) {
    const n = this.spec.items.length;
    const b = this.spec.boxes ? this.boxOf(this.sel) : null;
    if (b && b.wrap) {                                   // (a box of its own: round and round within it)
      const m = b.end - b.start;
      for (let k = 1; k <= m; k++) {
        const i = b.start + (this.sel - b.start + d * k + m * k) % m;
        if (this.enabled(i)) { this.sel = i; break; }
      }
      if (!quiet) this.draw();
      return;
    }
    for (let k = 1; k <= n; k++) {
      const i = (this.sel + d * k + n * k) % n;
      if (this.enabled(i)) { this.sel = i; break; }
    }
    if (!quiet) this.draw();
  }

  // mouse wheel over a box that scrolls (more items than rows): the selection moves through its list -
  // and the list scrolls with it - one row per notch (trackpads: per ~50 pixels), not wrapping around
  wheel(ev) {
    const s = this.spec;
    if (s && s.page) {                                   // a page: 3 rows per notch (trackpads: a row per ~33 pixels)
      if (!s.engine && !s.nlines) return false;
      this.wheelAcc = (this.wheelAcc || 0) + ev.deltaY * (ev.deltaMode === 1 ? 33 : ev.deltaMode === 2 ? 700 : 1);
      const d = Math.trunc(this.wheelAcc / 33);
      if (d) { this.wheelAcc -= d * 33; this.scrollPage(d); }
      return true;
    }
    // a switch under the mouse: the wheel steps its value - up forward, down back - one step a notch
    // (trackpads: per ~50 pixels), like Left / Right
    const wi = s ? this.itemAt(ev) : -1, wit = wi >= 0 ? s.items[wi] : null;
    if (wit && wit.change && !wit.disabled && !wit.input) {
      this.wheelAcc = (this.wheelAcc || 0) + ev.deltaY * (ev.deltaMode === 1 ? 40 : ev.deltaMode === 2 ? 400 : 1);
      if (Math.abs(this.wheelAcc) >= 50) {
        const d = Math.sign(this.wheelAcc);
        this.wheelAcc = 0;
        this.sel = wi;
        wit.change(-d);
        if (this.spec === s && s.items[this.sel] === wit) this.draw();
      }
      return true;
    }
    if (!s || s.page || s.boxes || !s.box || !(this.scrollRows < this.scrollN)) return false;
    this.wheelAcc = (this.wheelAcc || 0) + ev.deltaY * (ev.deltaMode === 1 ? 40 : ev.deltaMode === 2 ? 400 : 1);
    while (Math.abs(this.wheelAcc) >= 50) {
      const d = Math.sign(this.wheelAcc);
      this.wheelAcc -= d * 50;
      for (let i = this.sel + d; i >= 0 && i < this.scrollN; i += d) if (this.enabled(i)) { this.sel = i; break; }
    }
    this.draw();
    return true;
  }

  // Tab with spec.boxes: the first selectable item of the next (d = -1: previous) box
  nextBox(d) {
    const g = this.boxesGeom(), cur = g.findIndex(b => this.sel >= b.start && this.sel < b.end);
    for (let k = 1; k <= g.length; k++) {
      const b = g[(cur + d * k + g.length * k) % g.length];
      for (let i = b.start; i < b.end; i++) if (this.enabled(i)) { this.sel = i; this.draw(); return; }
    }
  }

  // the box, sized to its items when no width is given
  geom() {
    const s = this.spec, b = s.box;
    if (b.w) return b;
    const w = DosUI.boxWidth(s.items);
    return { x: b.x || 41 - ((w + 2) >> 1), y: b.y, w, rows: b.rows };
  }

  // item index shown on each box row: a scrolling window over the items, then the fixed ones
  rowItems() {
    const s = this.spec, n = s.items.length, fixed = s.fixed || 0, scrollN = n - fixed;
    const rows = Math.min(scrollN, this.geom().rows || scrollN);
    if (this.sel < scrollN) {
      if (this.sel < this.top) this.top = this.sel;
      if (this.sel >= this.top + rows) this.top = this.sel - rows + 1;
    }
    this.top = Math.max(0, Math.min(this.top, scrollN - rows));
    const out = [];
    for (let k = 0; k < rows; k++) out.push(this.top + k);
    for (let i = scrollN; i < n; i++) out.push(i);
    this.scrollRows = rows; this.scrollN = scrollN;
    return out;
  }
  firstItemRow() { return this.spec.box.y + 1 + (this.spec.header ? 2 : 0); }   // 1-based

  // item i on screen row `row` of box b (label, input value, colors, cursor)
  drawItem(i, row, b) {
    const t = this.t, it = this.spec.items[i];
    // an empty input shows its placeholder (dimmed; the first key typed replaces it); a value wider
    // than the input's width shows its end
    const inp = it.input;
    let value = !inp ? "" : inp.value ? (inp.secret ? "*".repeat(Array.from(inp.value).length) : U.fromRaw(inp.value)) : inp.placeholder || "";
    // (the room left of the box's edge after the label: the phone layout's narrow boxes have less than
    // input.width - a placeholder that doesn't fit ends in "..")
    const room = b.w - 1 - U.cols(it.label), width = inp ? Math.min(inp.width || room, room) : 0;
    if (inp && inp.value && U.cols(value) >= width) {
      const ch = [];
      U.each(value, (bt, cp, w, a, z) => { ch.push([a, z, w]); });
      let n = 0, k = ch.length;
      while (k > 0 && n + ch[k - 1][2] <= width - 1) n += ch[--k][2];
      value = value.slice(k < ch.length ? ch[k][0] : value.length);
    } else if (inp && !inp.value && room > 3 && U.cols(value) > room - 1) value = U.slice(value, room - 3) + "..";
    const labelW = U.cols(it.label), valueW = U.cols(value);
    let text = it.label + value;
    // the selected row wider than its box: a marquee - it slides through to its end and back (this.marq, draw())
    if (i === this.sel && !inp && it.align === "left" && U.cols(text) > b.w - 1) {
      const over = U.cols(text) - (b.w - 1);
      this.marq = { i, over };
      const off = Math.min(this.marqOff || 0, over);
      if (off > 0) { let k = 0, cut = 0; U.each(text, (bt, cp, w, a, z) => { if (k < off) { k += w; cut = z; } }); text = text.slice(cut); }
    }
    if (it.align !== "left" && this.centres) this.centres.push([row - 1, b.x, b.x + b.w]);
    text = it.align === "left" ? U.padEnd(" " + text, b.w) : U.padEnd(" ".repeat(this.centreStart(i, b, U.cols(text))) + text, b.w);
    text = U.padEnd(U.slice(text, b.w), b.w);
    t.gotoXY(b.x, row); t.write("\xB3" + text + "\xB3");
    const o = (row - 1) * 160 + b.x * 2;
    const attr = it.static ? it.attr || 0x07 : i === this.sel ? SEL : it.disabled ? DISABLED : it.attr || labelAttr();
    for (let c = 0; c < b.w; c++) t.vram[o + c * 2 + 1] = attr;
    const x0 = (it.align === "left" ? 1 : this.centreStart(i, b, labelW + valueW)) + labelW;
    // values in their own colors (not on the highlight bar, not when disabled): it.spans = [[from, to,
    // attr], ...] label columns; a switch's value (the label after its first ": ") white, a read-only
    // one (valueAttr, e.g. 7) light gray; an input's typed text white
    if (i !== this.sel && !it.disabled) {
      const L = x0 - labelW;
      const paint = (from, to, a) => { for (let c = Math.max(0, L + from); c < Math.min(b.w, L + to); c++) t.vram[o + c * 2 + 1] = a; };
      if (it.spans) for (const [from, to, a] of it.spans) paint(from, to, a);
      else if (it.valueAttr || (it.change && !it.attr)) {
        const k = it.label.indexOf(": ");
        if (k >= 0) paint(U.cols(it.label.slice(0, k + 2)), labelW, it.valueAttr || 0x0F);
      }
      if (inp && inp.value) paint(labelW, labelW + valueW, 0x0F);
    }
    // it.dim = [from, to]: label columns shown gray (disabled), e.g. a column that doesn't apply now
    if (it.dim && i !== this.sel)
      for (let c = x0 - labelW + it.dim[0]; c < Math.min(b.w, x0 - labelW + it.dim[1]); c++) t.vram[o + c * 2 + 1] = DISABLED;
    if (it.input && !it.input.value && value)
      for (let c = x0; c < Math.min(b.w, x0 + valueW); c++) t.vram[o + c * 2 + 1] = i === this.sel ? 0x57 : DISABLED;
    if (it.input && i === this.sel && !it.input.value && value && x0 < b.w)
      this.cursor = { col: b.x + x0, row: row - 1 };     // empty: a blinking underline under the placeholder's first letter (Display)
    else if (it.input && i === this.sel) {                // blinking cursor after the text
      const at = x0 + valueW;
      if (at < b.w) { t.vram[o + at * 2] = 0x5F; t.vram[o + at * 2 + 1] = SEL | 0x80; t.uni[(o >> 1) + at] = 0; }
    }
  }

  // spec.boxes: every box with its title in the top border and its items; returns the row below the
  // lowest box's bottom border
  drawBoxes() {
    const t = this.t;
    let bottom = 0;
    for (const b of this.boxesGeom()) {
      const line = (row, a, fill, z) => { t.textColor(frameColor()); t.gotoXY(b.x, row); t.write(a + fill.repeat(b.w) + z); };
      // (joinTop: no top border - the box continues whatever is drawn above it, e.g. a panel's last rows)
      if (!b.joinTop) line(b.y, "\xDA", "\xC4", "\xBF");
      if (b.title) { t.gotoXY(b.x + 2, b.y); t.textColor(titleColor()); t.write(" " + U.slice(b.title, b.w - 4) + " "); }
      let row = b.y + 1;
      for (let i = b.start; i < b.end; i++, row++) {
        if (this.spec.items[i].separator) { line(row, "\xC3", "\xC4", "\xB4"); continue; }
        t.textColor(frameColor());
        this.drawItem(i, row, b);
      }
      line(row, "\xC0", "\xC4", "\xD9");
      bottom = Math.max(bottom, row);
    }
    return bottom;
  }
  // spec.boxes side by side: each sized to its items unless w is given, together centred with one
  // column between them unless x is given; start..end = their items' indexes in spec.items
  boxesGeom() {
    let start = 0;
    const g = this.spec.boxes.map(bx => {
      const r = { x: bx.x, y: bx.y, w: bx.w || DosUI.boxWidth(bx.items), title: bx.title, joinTop: !!bx.joinTop, wrap: !!bx.wrap, start, end: start + bx.items.length };
      start = r.end;
      return r;
    });
    const total = g.reduce((a, b) => a + b.w + 2, 0) + g.length - 1;
    let x = Math.max(1, 41 - (total >> 1));
    for (const b of g) { if (!b.x) b.x = x; x = b.x + b.w + 3; }
    return g;
  }
  boxOf(i) { return this.boxesGeom().find(b => i >= b.start && i < b.end); }

  draw() {
    this.marq = null;
    this.drawScreen();
    this.marquee();
  }
  // the marquee of a selected row that doesn't fit (drawItem): a second at its start, then a column every
  // MARQ_MS to its end, a second there, back to the start; another selection starts it anew
  marquee() {
    const m = this.marq;
    if (!m || !this.active()) { if (this.marqTimer) { clearTimeout(this.marqTimer); this.marqTimer = null; } this.marqOff = 0; this.marqSel = -1; return; }
    if (this.marqSel !== m.i) { this.marqSel = m.i; this.marqOff = 0; if (this.marqTimer) { clearTimeout(this.marqTimer); this.marqTimer = null; } }
    if (this.marqTimer) return;
    const off = this.marqOff || 0, wait = off === 0 || off >= m.over ? 1000 : 160;
    this.marqTimer = setTimeout(() => {
      this.marqTimer = null;
      if (!this.marq || this.marqSel !== this.marq.i) return;
      this.marqOff = off >= this.marq.over ? 0 : off + 1;
      this.draw();
    }, wait);
  }
  drawScreen() {
    const t = this.t, s = this.spec;
    if (this.softFor && !(s && !s.page && s.items[this.sel] && s.items[this.sel].input === this.softFor)) this.softBlur();   // (moved off it)
    // (the page changed the input's value - a chat message sent clears it: the hidden input follows, or its
    // old text would come back with the next letter typed)
    if (this.softFor && soft && soft.value !== (this.softFor.value || "")) soft.value = this.softFor.value || "";
    if (s && s.onSel && this.sel !== this.selShown) {    // (the selection moved: the page may show something else)
      this.selShown = this.sel;
      s.onSel(this.sel);
      if (this.spec !== s) return;                       // (it showed a new spec: that one is drawn)
    }
    this.cursor = null;                                  // (drawItem: an empty input's cursor cell)
    if (this.isNarrow()) return this.drawNarrow();
    this.narrow = null;
    t.textMode();
    t.window(1, 1, 80, 25);
    t.textBackground(0);
    t.clearScreen();
    // (centred rows - [row, from, to): 0-based, the columns they are centred in - go with the snapshot:
    // graphics modern clean centres them to the pixel, gfx-text.js)
    this.centres = [];
    const put = (l, txt) => {
      if (!l.col) this.centres.push([l.row - 1, 0, 80]);
      t.textColor(l.color == null ? 7 : l.color);
      t.gotoXY(l.col || Math.max(1, 41 - (U.cols(txt) >> 1)), l.row);
      t.write(U.slice(txt, (l.row >= 25 ? 80 : 81) - (l.col || 1)));   // (up to column 80; 79 on the last row: no scroll)
    };
    for (const l of s.lines || []) put(l, l.text);
    for (const l of s.text || []) put(l, U.fromRaw(l.text));
    let row;
    if (s.boxes) row = this.drawBoxes();
    else {
      // box
      const b = this.geom(), shown = this.rowItems();
      t.textColor(frameColor());
      const line = (row, a, fill, z) => { t.gotoXY(b.x, row); t.write(a + fill.repeat(b.w) + z); };
      line(b.y, "\xDA", "\xC4", "\xBF");
      row = b.y + 1;
      if (s.header) {
        t.gotoXY(b.x, row); t.write("\xB3"); t.textColor(14); t.write(U.padEnd(U.slice(s.header, b.w), b.w)); t.textColor(frameColor()); t.write("\xB3");
        line(row + 1, "\xC3", "\xC4", "\xB4");
        row += 2;
      }
      let moreRow = 0;
      for (let k = 0; k < shown.length; k++, row++) {
        const i = shown[k], it = s.items[i];
        if (k === this.scrollRows) moreRow = row;
        if (it.separator) { line(row, "\xC3", "\xC4", "\xB4"); continue; }
        this.drawItem(i, row, b);
      }
      line(row, "\xC0", "\xC4", "\xD9");
      // more items above / below the scrolling part
      t.textColor(frameColor());
      if (this.top > 0) { t.gotoXY(b.x + b.w - 1, b.y + (s.header ? 2 : 0)); t.write("\x18"); }
      if (this.top + this.scrollRows < this.scrollN) { t.gotoXY(b.x + b.w - 1, moreRow || row); t.write("\x19"); }
    }
    // info about the selected item
    const it = s.items[this.sel];
    this.links = [];
    (it && it.info || []).forEach((l, i) => {
      t.textColor(l.color == null ? 3 : l.color);
      const text = typeof l === "string" ? l : l.text;
      const x = Math.max(1, 41 - (U.cols(text) >> 1)), y = (s.infoRow || row + 3) + i;
      this.centres.push([y - 1, 0, 80]);
      t.gotoXY(x, y);
      t.write(U.slice(text, 79));
      if (l.onClick) this.links.push({ x, y, w: Math.min(U.cols(text), 79), onClick: l.onClick });
    });
    // bottom line, like the game's "Press <ENTER> for main menu."
    t.drawBottomRule();
    const T = k => Lang.t(k);
    // (a phone / tablet: no keys to name - tap; GameScreen.mobile)
    const hint = " " + (GameScreen.mobile() ? T("ui.hint.touch") : s.hint || T("ui.hint", "\x18\x19 and <ENTER>, or the mouse.") + (s.back ? "  " + T("ui.back", "<ESC> back.") : ""));
    t.textColor(15); t.gotoXY(80 - U.cols(hint), 25); t.write(hint);
    if (s.footer) { t.textColor(8); t.gotoXY(2, 25); t.write(" " + U.slice(s.footer, 78 - U.cols(hint) - 2) + " "); }   // (bottom left)
    const snap = { t: 0, mode: "text", screen: "text", vram: t.vram.slice(0, 16000) };
    t.snapUni(snap);
    if (this.cursor) snap.cursor = this.cursor;
    if (this.centres.length) snap.centres = this.centres;
    this.present(snap);
  }

  // ---------------------------------------------------------------- the phone layout (docs/DESIGN-8P.md 32)
  // A phone held upright (GameScreen.mobile, portrait): the same spec laid out on a text screen NC columns
  // wide and as tall as the phone allows - twice the text size of the 80-column screen. The rows / columns
  // given in the spec are left aside: its lines (wrapped, in their order), then every box full width, one
  // below the other (titles in their borders, all items - no box scrolls), scrolling with the selection or
  // a drag when taller than the screen; at the bottom the selected item's info (wrapped), the rule and the
  // hint. A screen can make its own phone version (spec.narrow: replaces the spec there).
  // a page (Instructions / Information) on the phone layout: its rows ({c: centred, t: text with {n} colour
  // switches}) from ntop, the rule and "Tap to go back" at the bottom; up / down arrows while there is more
  presentNarrowPage() {
    // (every row in the snapshot, the rule and "Tap to go back" below them; the renderer shows the rows in a
    // window from view.top - smooth scrolling, like the menus: presentNarrowAt)
    const s = this.spec, R = this.narrowRows(), VIEW = R - 2, n = Math.min(s.nlines.length, 598), R2 = n + 2;   // (below: the rule, the hint)
    const o = this.t2 || (this.t2 = new TextBuf());
    o.textMode(R2); o.window(1, 1, 80, R2); o.textBackground(0); o.clearScreen();
    const centres = [];
    for (let k = 0; k < n; k++) {
      const l = s.nlines[k], w = U.cols(visible(l.t));
      o.gotoXY(l.c ? Math.max(1, (NC >> 1) + 1 - (w >> 1)) : 2, k + 1);
      if (l.c) centres.push([k, 0, NC]);
      let color = 7;
      for (const part of l.t.split(/(\{\d+\})/)) {
        const m = /^\{(\d+)\}$/.exec(part);
        if (m) { color = +m[1]; continue; }
        o.textColor(color); o.write(part);
      }
    }
    o.drawBottomRule(R2 - 1, 1, NC);
    const hint = " " + Lang.t("page.back.touch") + " ";
    o.textColor(15); o.gotoXY(Math.max(1, NC + 1 - U.cols(hint)), R2); o.write(U.slice(hint, NC));
    if (this.nspec !== s) { this.ntopU = 0; this.nanim = null; this.nspec = s; }
    this.narrow = { rows: R2, units: R, view: VIEW, maxTop: Math.max(0, n - VIEW), items: {}, links: [], height: n };
    const snap = { t: 0, mode: "text", screen: "text", vram: o.vram.slice(0, Math.max(16000, R2 * 160)), cols: NC, rows: R2, rowH: new Array(R2).fill(1) };
    o.snapUni(snap);
    if (centres.length) snap.centres = centres;
    this.nbase = snap;
    this.presentNarrowAt(this.ntopU || 0);
  }

  isNarrow() {
    const w = root.innerWidth || 0, h = root.innerHeight || 0;
    return GameScreen.mobile() && h > w && w > 0;
  }
  narrowRows() {
    // the height the page leaves the canvas: the window less the screen's padding - on a phone that includes the
    // safe area at the top (the camera cutout / status bar strip: env(safe-area-inset-top), style.css)
    let pad = 16;
    try {
      const box = this.canvas.closest && this.canvas.closest(".screen");
      if (box && root.getComputedStyle) { const cs = root.getComputedStyle(box); pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0); }
    } catch (e) { /* no layout (tests): the default */ }
    const w = Math.max(160, (root.innerWidth || 390) - 16), h = Math.max(200, (root.innerHeight || 844) - pad);
    return Math.max(25, Math.min(100, Math.floor(h / (w / NC * 16 * 1.35 / 9))));   // (rows of the DOS screen's height: display.js)
  }
  narrowBox(i) {
    const g = this.spec.boxes ? this.boxOf(i) : { start: 0, end: this.spec.items.length };
    return Object.assign({}, g, NB);
  }
  drawNarrow() {
    const t = this.t, s = this.spec.narrow || this.spec, R = this.narrowRows();
    const items = this.spec.items;
    t.textMode(600); t.window(1, 1, 80, 600); t.textBackground(0); t.clearScreen();
    this.centres = [];
    const rowItem = {}, links = [], centres = [];
    let row = 2;
    const centre = (txt, color, r) => {
      t.textColor(color == null ? 7 : color);
      t.gotoXY(Math.max(1, (NC >> 1) + 1 - (U.cols(txt) >> 1)), r); t.write(U.slice(txt, NC));
      centres.push([r - 1, 0, NC]);
    };
    // the lines, in their order (a gap in the rows: one blank row), wrapped to the width
    const lines = (s.lines || []).map(l => ({ row: l.row || 0, txt: l.text, color: l.color }))
      .concat((s.text || []).map(l => ({ row: l.row || 0, txt: U.fromRaw(l.text), color: l.color })))
      .filter(l => l.row < 24).sort((a, b) => a.row - b.row);
    let last = null;
    for (const l of lines) {
      if (last != null && l.row - last > 1) row++;
      for (const part of wrapCols(l.txt, NC - 2)) centre(part, l.color, row++);
      last = l.row;
    }
    if (lines.length) row++;
    // the boxes, full width, one below the other
    const boxes = this.spec.boxes ? this.boxesGeom() : [{ start: 0, end: items.length, title: null }];
    for (const g of boxes) {
      const b = Object.assign({}, g, NB);
      const line = (r, a, fill, z) => { t.textColor(frameColor()); t.gotoXY(b.x, r); t.write(a + fill.repeat(b.w) + z); };
      line(row, "\xDA", "\xC4", "\xBF");
      if (g.title) { t.gotoXY(b.x + 2, row); t.textColor(titleColor()); t.write(" " + U.slice(g.title, b.w - 4) + " "); }
      row++;
      if (!this.spec.boxes && this.spec.header) {
        t.gotoXY(b.x, row); t.textColor(frameColor()); t.write("\xB3"); t.textColor(14); t.write(U.padEnd(U.slice(this.spec.header, b.w), b.w));
        t.textColor(frameColor()); t.write("\xB3"); row++;
        line(row++, "\xC3", "\xC4", "\xB4");
      }
      for (let i = g.start; i < g.end; i++, row++) {
        if (items[i].separator) { line(row, "\xC3", "\xC4", "\xB4"); continue; }
        t.textColor(frameColor());
        this.drawItem(i, row, b);
        rowItem[row] = i;
      }
      line(row, "\xC0", "\xC4", "\xD9");
      row += 2;
    }
    const height = Math.min(row - 2, 592);                // (to the last box's bottom border: no empty row after it)
    // each content row's height: an item one can pick LINE_H, the rest 1 (in rows of the DOS screen's height)
    const H = r => { const it = rowItem[r] != null ? items[rowItem[r]] : null; return it && !it.static && !(it.disabled && !it.label) ? LINE_H : 1; };
    // the snapshot: every content row, then the info, the rule and the hint (7 rows); the renderer shows the
    // content in a window VIEW rows high from view.top (units: rows of the DOS screen's height - any fraction:
    // smooth scrolling), the rest below it - so the screen is always R rows high (owner, 2026-10-25)
    // the area below the window: an empty row, the info (4 rows; 5 - 7 when the selected item's info needs them:
    // the window gets that much shorter, the screen stays as tall), the rule, the hint
    const selInfo = items[this.sel] && items[this.sel].info || [];
    const infoLines = Math.min(7, selInfo.reduce((n, l) => n + wrapCols(typeof l === "string" ? l : l.text, NC - 2).length, 0));
    const BOTTOM = infoLines > 4 ? infoLines + 2 : 7;
    const VIEW = R - BOTTOM, start = [0];
    for (let r = 1; r <= height; r++) start.push(start[r - 1] + H(r));   // (row r from start[r - 1] to start[r])
    const total = start[height], maxTop = Math.max(0, total - VIEW);
    const selRow = +Object.keys(rowItem).find(r => rowItem[r] === this.sel) || 0;
    const fresh = this.nspec !== this.spec && !this.nkeep;
    // (the view follows the selection when it moved or on a new screen - not on a refresh: the online lobby's
    // pings and chat redraw it, and a drag away from the selection stays where it is)
    if (this.nsel !== this.sel || fresh) { this.nfollow = true; this.nsel = this.sel; }
    if (fresh) { this.ntopU = 0; this.nanim = null; }
    this.nspec = this.spec;
    let target = Math.max(0, Math.min(this.ntopU || 0, maxTop));
    if (this.nfollow && selRow) {                        // (the selection in view, a row of room around it)
      if (start[selRow - 1] - 1 < target) target = start[selRow - 1] - 1;
      if (start[selRow] + 1 > target + VIEW) target = start[selRow] + 1 - VIEW;
      target = Math.max(0, Math.min(target, maxTop));
    }
    const R2 = height + BOTTOM, o = this.t2 || (this.t2 = new TextBuf());
    o.textMode(R2); o.window(1, 1, 80, R2); o.textBackground(0); o.clearScreen();
    o.vram.set(t.vram.subarray(0, height * 160), 0);
    if (t.uniUsed) { o.uni.set(t.uni.subarray(0, height * 80), 0); o.uniUsed = true; }
    const rowH = [];
    for (let r = 1; r <= height; r++) rowH.push(H(r));
    for (let k = 0; k < BOTTOM; k++) rowH.push(1);
    // (content row r - 1-based, as gotoXY - is the snapshot's row r - 1, as the centred rows and the cursor have it)
    const itemCentres = this.centres;
    this.centres = [];
    for (const [r, a, z] of centres.concat(itemCentres)) if (r >= 0 && r < height) this.centres.push([r, a, z]);
    const cursor = this.cursor && this.cursor.row >= 0 && this.cursor.row < height ? this.cursor : null;
    const it = items[this.sel];
    let ir = infoLines > 4 ? height + 1 : height + 2;   // (a long info: no empty row above it)
    (it && it.info || []).forEach(l => {
      const text = typeof l === "string" ? l : l.text;
      for (const part of wrapCols(text, NC - 2)) {
        if (ir > R2 - 2) return;
        o.textColor(l.color == null ? 3 : l.color);
        const x = Math.max(1, (NC >> 1) + 1 - (U.cols(part) >> 1));
        o.gotoXY(x, ir); o.write(part);
        this.centres.push([ir - 1, 0, NC]);
        if (l.onClick) links.push({ x, y: ir, w: U.cols(part), onClick: l.onClick });
        ir++;
      }
    });
    o.drawBottomRule(R2 - 1, 1, NC);
    const hint = " " + (GameScreen.mobile() ? Lang.t("ui.hint.touch") : Lang.t("ui.hint")) + " ";
    o.textColor(15); o.gotoXY(Math.max(1, NC + 1 - U.cols(hint)), R2); o.write(U.slice(hint, NC));
    // (items: 0-based snapshot row + 1 -> item, as itemAt asks: the content row)
    const items1 = {};
    for (const r in rowItem) if (r <= height) items1[r] = rowItem[r];
    this.narrow = { rows: R2, units: R, view: VIEW, maxTop, items: items1, links, height };
    const snap = { t: 0, mode: "text", screen: "text", vram: o.vram.slice(0, Math.max(16000, R2 * 160)), cols: NC, rows: R2, rowH };
    o.snapUni(snap);
    if (cursor) snap.cursor = cursor;
    if (this.centres.length) snap.centres = this.centres;
    this.nbase = snap;
    this.scrollNarrow(target, !fresh && Math.abs(target - (this.ntopU || 0)) > 0.01);
  }
  // the phone layout's content window from `top` (units); animate: glide there (the selection moved out of view)
  presentNarrowAt(top) {
    // (not over a page a screen put up itself - the online game's statistics after a match: a drag there drew
    // the lobby's old picture back over it)
    if (!this.nbase || !this.narrow || (this.spec && this.spec.page && !this.spec.nlines)) return;
    this.ntopU = Math.max(0, Math.min(top, this.narrow.maxTop));
    this.present(Object.assign({}, this.nbase, { view: { rows: this.narrow.height, units: this.narrow.view, top: this.ntopU } }));
  }
  scrollNarrow(to, animate) {
    if (!animate) { this.nanim = null; return this.presentNarrowAt(to); }
    const a = this.nanim = { from: this.ntopU || 0, to, t0: performance.now() };
    const step = now => {
      if (this.nanim !== a || !this.active()) return;
      const k = Math.min(1, (now - a.t0) / 180);
      this.presentNarrowAt(a.from + (a.to - a.from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step); else this.nanim = null;
    };
    this.presentNarrowAt(a.from);
    requestAnimationFrame(step);
  }

  // Where centred item i (w columns wide) starts in box b (0-based interior column): the box's widest
  // centred item is centred, a narrower one starts half the difference later, rounded down - so one
  // column narrower starts in the same column, two or three narrower one column later (centred items
  // line up as a block instead of each one jumping half a column)
  centreStart(i, b, w) {
    const items = this.spec.items, from = b.start != null ? b.start : 0, to = b.end != null ? b.end : items.length;
    let M = w;
    for (let k = from; k < to; k++) {
      const it = items[k];
      if (it && !it.separator && it.align !== "left" && it.label) M = Math.max(M, U.cols(it.label));
    }
    return Math.max(0, ((b.w - M) >> 1) + ((M - w) >> 1));
  }

  key(e) {
    const s = this.spec;
    if (!s) return;
    // (from the hidden touch input: what it types arrives as its "input" event - only the other keys here)
    if (soft && e.target === soft && (e.code === "Backspace" || e.key === "Unidentified" || (e.key && Array.from(e.key).length === 1))) return;
    if (s.page) {
      if (["Enter", "NumpadEnter", "Escape", "Space"].includes(e.code)) { e.preventDefault(); s.back(); }
      else if ((s.engine || s.nlines) && PAGE_KEYS[e.key]) { e.preventDefault(); this.scrollPage(PAGE_KEYS[e.key]); }
      return;
    }
    const it = s.items[this.sel];
    // by the produced key, not the physical one: the numeric keypad gives digits with NumLock on and
    // arrows (e.key "ArrowUp"...) with NumLock off
    const k = e.key;
    if (it && it.digit && !it.input && /^[1-8]$/.test(k) && !e.ctrlKey && !e.altKey && !e.metaKey) it.digit(+k);
    else if (k === "ArrowUp") this.move(-1);
    else if (k === "ArrowDown" || (k === "Tab" && it && it.input)) this.move(1);
    else if (k === "Tab" && s.boxes) this.nextBox(e.shiftKey ? -1 : 1);
    else if (k === "Enter" || (e.code === "Space" && !(it && it.input))) { if (it && !it.disabled) it.go(); }
    else if ((k === "ArrowLeft" || k === "ArrowRight") && it && it.change) it.change(k === "ArrowLeft" ? -1 : 1);
    else if (e.code === "Escape") { if (s.back) s.back(); }
    else if (it && it.input && e.code === "Backspace") { it.input.value = Array.from(it.input.value).slice(0, -1).join(""); this.draw(); }
    else if (it && it.input && e.key && Array.from(e.key).length === 1 &&
      (!(e.ctrlKey || e.metaKey || e.altKey) || (e.getModifierState && e.getModifierState("AltGraph")))) {   // (AltGr letters too)
      if (!this.typed(it.input, e.key)) return;
      this.draw();
    } else return;
    e.preventDefault();
  }

  // touch: the hidden input's text into the selected input (checked as if typed), then back (what fits)
  softTyped() {
    const it = this.spec && !this.spec.page ? this.spec.items[this.sel] : null;
    if (!it || !it.input || it.input !== this.softFor) return;
    it.input.value = "";
    this.typed(it.input, soft.value.replace(/\s+/g, " "));
    if (soft.value !== it.input.value) soft.value = it.input.value;
    this.draw();
  }
  // a tap on an input row (touch screen): the hidden input gets the focus - the device's keyboard opens
  softFocus(input) {
    const si = softInput();
    if (!si) return;
    this.softFor = input;
    si.type = input.secret ? "password" : "text";
    si.value = input.value || "";
    try { si.focus({ preventScroll: true }); } catch (e) { si.focus(); }
  }
  softBlur() {
    if (soft && this.softFor) { this.softFor = null; soft.blur(); }
  }

  // adds text to an input (any printable characters, as many as fit its max display columns); true when
  // something was added
  typed(input, str) {
    let v = String(input.value || ""), n = U.rawCols(v), added = false;
    for (const ch of String(str).normalize("NFC")) {
      if (BAD_INPUT.test(ch)) continue;
      const w = U.charCols(ch.codePointAt(0));
      if (n + w > input.max) break;
      v += ch; n += w; added = true;
    }
    if (added) input.value = v.normalize("NFC");
    return added;
  }
  // pasting into the selected input
  paste(e) {
    const s = this.spec, it = s && !s.page ? s.items[this.sel] : null;
    if (!it || !it.input || it.disabled) return;
    const str = e.clipboardData ? e.clipboardData.getData("text") : "";
    e.preventDefault();
    if (this.typed(it.input, str.replace(/\s+/g, " "))) this.draw();
  }

  // clickable info line (link) under the mouse
  linkAt(ev) {
    const c = this.display.cellAt(ev);
    if (!c || !this.spec || this.spec.page) return null;
    if (this.narrow) return (this.narrow.links || []).find(l => c[1] + 1 === l.y && c[0] + 1 >= l.x && c[0] + 1 < l.x + l.w) || null;
    return (this.links || []).find(l => c[1] + 1 === l.y && c[0] + 1 >= l.x && c[0] + 1 < l.x + l.w) || null;
  }

  itemAt(ev) {
    const c = this.display.cellAt(ev);
    if (!c || !this.spec || this.spec.page) return -1;
    if (this.narrow) {                                   // (the phone layout: the item on that screen row)
      const i = this.narrow.items[c[1] + 1];
      return i != null && c[0] + 1 >= NB.x && c[0] + 1 <= NB.x + NB.w + 1 && this.enabled(i) ? i : -1;
    }
    if (this.spec.boxes) {
      for (const b of this.boxesGeom()) {
        const k = c[1] + 1 - (b.y + 1), x = c[0] + 1 - b.x;
        if (k >= 0 && k < b.end - b.start && x >= 0 && x <= b.w + 1) return this.enabled(b.start + k) ? b.start + k : -1;
      }
      return -1;
    }
    const b = this.geom(), k = c[1] + 1 - this.firstItemRow(), x = c[0] + 1 - b.x;
    const shown = this.rowItems();
    if (k < 0 || k >= shown.length || x < 0 || x > b.w + 1) return -1;
    return this.enabled(shown[k]) ? shown[k] : -1;
  }
  hover(ev) {
    const i = this.itemAt(ev);
    this.canvas.style.cursor = i >= 0 || this.linkAt(ev) || (this.spec && this.spec.page) ? "pointer" : "";
    if (i >= 0 && i !== this.sel) { this.sel = i; this.draw(); }
  }
  click(ev) {
    if (this.spec && this.spec.page) {
      if (this.dragged) { this.dragged = false; return; }      // (the end of a touch drag, not a tap)
      this.spec.back(); return;
    }
    const link = this.linkAt(ev);
    if (link) { link.onClick(); return; }
    if (this.zoneClick(ev, 1)) return;
    if (this.narrow && this.dragged) { this.dragged = false; return; }   // (the end of a drag, not a tap)
    const i = this.itemAt(ev);
    if (i < 0) return;
    // (a row with zones: a click elsewhere on it selects only - unless the item says clickGo: then it does go)
    if (this.spec.items[i].zones && !this.spec.items[i].clickGo) { if (i !== this.sel) { this.sel = i; this.draw(); } return; }
    const it = this.spec.items[i];
    if (it.input && !it.disabled && touchScreen(ev)) { this.sel = i; this.draw(); this.softFocus(it.input); return; }   // (touch: its keyboard)
    this.sel = i; it.go();
  }
  // the label column (0-based display column of item i's label text) under the mouse, or -1
  labelColAt(ev, i) {
    const c = this.display.cellAt(ev), it = this.spec.items[i], b = this.narrow ? this.narrowBox(i) : this.spec.boxes ? this.boxOf(i) : this.geom();
    if (!c) return -1;
    const x = c[0] + 1 - b.x - 1;                          // interior column, 0-based
    const labelW = U.cols(it.label);
    const x0 = it.align === "left" ? 1 : this.centreStart(i, b, labelW);
    return x - x0;
  }
  // a right click on a switch (an item with change(dir)): its value one step back (a left click goes
  // forward) - true when it took the click
  backClick(ev) {
    if (!this.spec || this.spec.page) return false;
    const i = this.itemAt(ev), it = i >= 0 ? this.spec.items[i] : null;
    if (!it || !it.change || it.disabled || it.static || it.zones) return false;
    this.sel = i;
    it.change(-1);
    if (this.spec.items[this.sel] === it) this.draw();
    return true;
  }
  // a click (dir +1) / right click (dir -1) on one of an item's zones: true when a zone took it
  // the slide (pointerdown on a slide row): the zone under the pointer's column, once per zone
  slideTo(ev) {
    const s = this.slide, i = s ? this.spec.items.findIndex(x => x.key === s.key) : -1;
    if (i < 0) return;
    const it = this.spec.items[i], col = this.labelColAt(ev, i), zs = it.zones;
    if (col < 0 && !this.display.cellAt(ev)) return;
    let z = zs.find(q => col >= q.from && col < q.to), dir = 1;
    if (!z) { const first = zs[0], last = zs[zs.length - 1]; if (col < first.from) { z = first; dir = -1; } else if (col >= last.to) z = last; }
    const at = z ? zs.indexOf(z) + ":" + dir : null;
    if (!z || at === s.at) return;
    s.at = at;
    this.sel = i;
    z.click(dir);
    if (this.spec.items[this.sel] && this.spec.items[this.sel].key === s.key) this.draw();
  }
  zoneClick(ev, dir) {
    if (!this.spec || this.spec.page) return false;
    const i = this.itemAt(ev), it = i >= 0 ? this.spec.items[i] : null;
    if (!it || !it.zones) return false;
    const col = this.labelColAt(ev, i);
    const z = it.zones.find(z => col >= z.from && col < z.to);
    if (!z) return false;
    this.sel = i;
    z.click(dir);
    if (this.spec.items === undefined || this.spec.items[this.sel] === it) this.draw();
    return true;
  }
}

// interior width of a box that fits these items (even: exactly centred)
DosUI.boxWidth = items => {
  const len = Math.max(0, ...items.map(it => it.separator ? 0 : U.cols(it.label) + (it.input ? (it.input.width || it.input.max) + 1 : 0)));
  const w = Math.max(14, len + 4);
  return w + w % 2;
};

// The player's name for online games (docs/DESIGN-8P.md 26): localStorage "tunneler.name", at most
// NAME_MAX display columns ("" = none yet: online play asks for one first - askName).
DosUI.NAME_MAX = 12;
DosUI.NARROW_W = NB.w;                   // (the phone layout's box width: screens with their own narrow version)
DosUI.playerName = () => {
  let v = "";
  try { v = root.localStorage.getItem("tunneler.name") || ""; } catch (e) { /* private mode */ }
  return U.truncRaw(v.replace(/\s+/g, " ").trim(), DosUI.NAME_MAX).trim();
};
DosUI.setPlayerName = v => {
  v = U.truncRaw(String(v || "").replace(/\s+/g, " ").trim(), DosUI.NAME_MAX).trim();
  try { root.localStorage.setItem("tunneler.name", v); } catch (e) { /* private mode */ }
  return v;
};
// "YOUR NAME": one input; done(name) once it isn't empty (stored), back() on <ESC> / "Back to main menu"
DosUI.prototype.askName = function (done, back) {
  const T = k => Lang.t(k);
  const form = { value: DosUI.playerName(), max: DosUI.NAME_MAX, width: DosUI.NAME_MAX };
  let err = false;
  const ok = () => {
    const v = DosUI.setPlayerName(form.value);
    if (!v) { err = true; this.sel = 0; return draw(); }
    done(v);
  };
  const draw = () => (form.placeholder = T("ph.name"), this.show({
    lines: [{ row: 2, text: T("name.title"), color: 12 }, { row: 6, text: T("name.i1"), color: 3 }, { row: 7, text: T("name.i2"), color: 3 }],
    box: { y: 10 }, infoRow: 17, back,
    items: [{ key: "name", label: T("name.label"), input: form, align: "left",
      info: err ? [{ text: T("name.err"), color: 12 }] : [T("name.i3")], go: ok },
    { key: "gap", label: "", disabled: true },
    { key: "go", label: T("name.go"), info: [T("name.i3")], go: ok },
    { key: "back", label: T("back.main"), info: [T("back.main.i")], go: back }],
  }, true));
  draw();
};

export { DosUI };
