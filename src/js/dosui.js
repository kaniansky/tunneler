"use strict";
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
//   spec.boxes:  [{x, y, w, title, items}]           instead of box / items: boxes side by side (each
//                                                  sized to its items, centred together, the title in
//                                                  the top border), one selection over all of them:
//                                                  Up / Down continue into the next / previous box,
//                                                  Tab jumps to the other box (in a text input: as Down)
//   spec.fixed:  the last N items always stay visible below the scrolling ones
//   spec.header: "text"                            non-selectable heading row inside the box (yellow)
//   spec.text:   [{row, col, text, color}]         raw Unicode text (any language, not encoded for the
//                                                  font; drawn through the Unicode plane), rows / cols 1-based
//   All other texts are font text (Lang.t / Lang.enc - unitext.js: other characters, e.g. a player's
//   name inside a translated line, go through the Unicode plane); widths are display columns
//   (UniText.cols: CJK / emoji take 2).
//   spec.items:  [{label, go, info: [..], disabled, attr, align: "left", input: {value, max, placeholder,
//                width}}]   input.value: raw Unicode, any printable characters may be typed / pasted;
//                input.max / input.width: display columns (the end of a value wider than width is shown)
//                {separator: true} draws a horizontal line across the box
//                change(dir): a switch - Left / Right step its value back (-1) / forward (+1)
//                digit(n): number keys 1..8 on this row (e.g. a slot's team)
//                zones: [{from, to, click(dir)}] - parts of the label (display columns from..to-1 of the
//                label text) a mouse click acts on: left button dir +1, right button -1 (no browser menu
//                then); a click elsewhere on a row with zones only selects it
//                info lines may be {text, color, onClick} - clickable (e.g. the invite link)
//                static: a read-only text row (never selected; attr, default light gray)
//
// ui.showPage(kind, uiMode, back[, engineOpts]) shows the game's own Instructions / Information page full screen
// (drawn by an engine instance, like in the game); Enter, Esc or a click calls back(). A page longer
// than the screen scrolls: Up / Down, PgUp / PgDn, Home / End, the mouse wheel, or dragging it on a
// touch screen (engine.pageScroll; the engine draws the scroll bar).
//   spec.infoRow: row of the selected item's info lines (cyan, centred)
//   spec.hint:   bottom line text;  spec.back: Esc handler;  spec.sel: initially selected item
//
// new DosUI(canvas) owns the canvas. new DosUI(canvas, {display, present, active}) draws over another
// page's Display instead: present(snapshot) receives each drawn screen, and input is only handled
// while active() returns true.
(function (root) {

const ATTR = 0x05, SEL = 0x5F, DISABLED = 0x08;
// keys that scroll an Instructions / Information page (KeyboardEvent.key; the numeric keypad with
// NumLock off gives the same) -> engine.pageScroll
const PAGE_KEYS = { ArrowUp: "up", ArrowDown: "down", PageUp: "pgup", PageDown: "pgdn", Home: "home", End: "end" };
const U = root.UniText;
// characters an input never takes: control, bidi, zero-width, private use (see NetProto's cleaning)
const BAD_INPUT = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ue000-\uf8ff\ufe00-\ufe0f]/;

class DosUI {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.display = opts.display || new Display(canvas);
    this.present = opts.present || (snap => this.display.setSnapshot(snap));
    this.active = opts.active || (() => true);
    this.t = new TunnelerEngine(0);          // only its Crt text routines and video buffer are used
    this.spec = null; this.sel = 0; this.top = 0;
    window.addEventListener("keydown", e => { if (this.active()) this.key(e); });
    window.addEventListener("paste", e => { if (this.active()) this.paste(e); });
    canvas.addEventListener("mousemove", e => { if (this.active()) this.hover(e); });
    canvas.addEventListener("click", e => { if (this.active()) this.click(e); });
    canvas.addEventListener("contextmenu", e => { if (this.active() && this.zoneClick(e, -1)) e.preventDefault(); });
    canvas.addEventListener("wheel", e => { if (this.active() && this.wheel(e)) e.preventDefault(); }, { passive: false });
    // touch screens: dragging a page scrolls it (a tap still goes back)
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
    if (!opts.display) {
      const loop = now => { this.display.draw(now); requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    }
  }

  // keepSel: keep the selected item (matched by its key, or label) when redrawing the same screen
  // with fresh data
  showPage(kind, uiMode, back, engineOpts) {
    const e = new TunnelerEngine(0, engineOpts);      // (engineOpts: extended games' instructions)
    if (root.Lang) {
      root.Lang.apply(e);
      e.strings = Object.assign({}, e.strings, { prompt: root.Lang.t("page.back") });
    }
    e.uiMode = uiMode || "hotseat";
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
    const e = this.spec.engine, snap = { t: 0, mode: "text", screen: "text", vram: e.vram.slice(0, 16000) };
    e.snapUni(snap);
    this.present(snap);
  }
  // scroll the page shown by showPage: "up" / "down" / "pgup" / "pgdn" / "home" / "end" or a number of rows
  scrollPage(what) {
    const s = this.spec;
    if (s && s.engine && s.engine.pageScroll(what)) this.presentPage();
  }

  show(spec, keepSel) {
    const keyOf = it => it && (it.key != null ? it.key : it.label);
    const prev = this.spec && keyOf(this.spec.items[this.sel]);
    this.spec = spec;
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
      if (!s.engine) return false;
      this.wheelAcc = (this.wheelAcc || 0) + ev.deltaY * (ev.deltaMode === 1 ? 33 : ev.deltaMode === 2 ? 700 : 1);
      const d = Math.trunc(this.wheelAcc / 33);
      if (d) { this.wheelAcc -= d * 33; this.scrollPage(d); }
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
    let value = !inp ? "" : inp.value ? U.fromRaw(inp.value) : inp.placeholder || "";
    if (inp && inp.value && inp.width && U.cols(value) >= inp.width) {
      const ch = [];
      U.each(value, (bt, cp, w, a, z) => { ch.push([a, z, w]); });
      let n = 0, k = ch.length;
      while (k > 0 && n + ch[k - 1][2] <= inp.width - 1) n += ch[--k][2];
      value = value.slice(k < ch.length ? ch[k][0] : value.length);
    }
    const labelW = U.cols(it.label), valueW = U.cols(value);
    let text = it.label + value;
    text = it.align === "left" ? U.padEnd(" " + text, b.w) : this.centre(text, b.w);
    text = U.padEnd(U.slice(text, b.w), b.w);
    t.gotoXY(b.x, row); t.write("\xB3" + text + "\xB3");
    const o = (row - 1) * 160 + b.x * 2;
    const attr = it.static ? it.attr || 0x07 : i === this.sel ? SEL : it.disabled ? DISABLED : it.attr || ATTR;
    for (let c = 0; c < b.w; c++) t.vram[o + c * 2 + 1] = attr;
    const x0 = (it.align === "left" ? 1 : (b.w - (labelW + valueW)) >> 1) + labelW;
    if (it.input && !it.input.value && value)
      for (let c = x0; c < Math.min(b.w, x0 + valueW); c++) t.vram[o + c * 2 + 1] = i === this.sel ? 0x57 : DISABLED;
    if (it.input && i === this.sel) {                     // blinking cursor after the text
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
      const line = (row, a, fill, z) => { t.textColor(5); t.gotoXY(b.x, row); t.write(a + fill.repeat(b.w) + z); };
      line(b.y, "\xDA", "\xC4", "\xBF");
      if (b.title) { t.gotoXY(b.x + 2, b.y); t.textColor(13); t.write(" " + U.slice(b.title, b.w - 4) + " "); }
      let row = b.y + 1;
      for (let i = b.start; i < b.end; i++, row++) {
        if (this.spec.items[i].separator) { line(row, "\xC3", "\xC4", "\xB4"); continue; }
        t.textColor(5);
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
      const r = { x: bx.x, y: bx.y, w: bx.w || DosUI.boxWidth(bx.items), title: bx.title, start, end: start + bx.items.length };
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
    const t = this.t, s = this.spec;
    t.textMode();
    t.window(1, 1, 80, 25);
    t.textBackground(0);
    t.clearScreen();
    const put = (l, txt) => {
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
      t.textColor(5);
      const line = (row, a, fill, z) => { t.gotoXY(b.x, row); t.write(a + fill.repeat(b.w) + z); };
      line(b.y, "\xDA", "\xC4", "\xBF");
      row = b.y + 1;
      if (s.header) {
        t.gotoXY(b.x, row); t.write("\xB3"); t.textColor(14); t.write(U.padEnd(U.slice(s.header, b.w), b.w)); t.textColor(5); t.write("\xB3");
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
      t.textColor(5);
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
      t.gotoXY(x, y);
      t.write(U.slice(text, 79));
      if (l.onClick) this.links.push({ x, y, w: Math.min(U.cols(text), 79), onClick: l.onClick });
    });
    // bottom line, like the game's "Press <ENTER> for main menu."
    t.drawBottomRule();
    const T = (k, d) => root.Lang ? root.Lang.t(k) : d;
    const hint = " " + (s.hint || T("ui.hint", "\x18\x19 and <ENTER>, or the mouse.") + (s.back ? "  " + T("ui.back", "<ESC> back.") : ""));
    t.textColor(15); t.gotoXY(80 - U.cols(hint), 25); t.write(hint);
    const snap = { t: 0, mode: "text", screen: "text", vram: t.vram.slice(0, 16000) };
    t.snapUni(snap);
    this.present(snap);
  }

  centre(s, w) { const l = Math.max(0, (w - U.cols(s)) >> 1); return U.padEnd(" ".repeat(l) + s, w); }

  key(e) {
    const s = this.spec;
    if (!s) return;
    if (s.page) {
      if (["Enter", "NumpadEnter", "Escape", "Space"].includes(e.code)) { e.preventDefault(); s.back(); }
      else if (s.engine && PAGE_KEYS[e.key]) { e.preventDefault(); this.scrollPage(PAGE_KEYS[e.key]); }
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
    return (this.links || []).find(l => c[1] + 1 === l.y && c[0] + 1 >= l.x && c[0] + 1 < l.x + l.w) || null;
  }

  itemAt(ev) {
    const c = this.display.cellAt(ev);
    if (!c || !this.spec || this.spec.page) return -1;
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
    const i = this.itemAt(ev);
    if (i < 0) return;
    if (this.spec.items[i].zones) { if (i !== this.sel) { this.sel = i; this.draw(); } return; }   // (selects only)
    this.sel = i; this.spec.items[i].go();
  }
  // the label column (0-based display column of item i's label text) under the mouse, or -1
  labelColAt(ev, i) {
    const c = this.display.cellAt(ev), it = this.spec.items[i], b = this.spec.boxes ? this.boxOf(i) : this.geom();
    if (!c) return -1;
    const x = c[0] + 1 - b.x - 1;                          // interior column, 0-based
    const labelW = U.cols(it.label);
    const x0 = it.align === "left" ? 1 : (b.w - labelW) >> 1;
    return x - x0;
  }
  // a click (dir +1) / right click (dir -1) on one of an item's zones: true when a zone took it
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

root.DosUI = DosUI;
})(window);
