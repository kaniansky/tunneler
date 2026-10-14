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
//                                                  without w the box fits its longest item, centred
//   spec.fixed:  the last N items always stay visible below the scrolling ones
//   spec.header: "text"                            non-selectable heading row inside the box (yellow)
//   spec.items:  [{label, go, info: [..], disabled, attr, align: "left", input: {value, max}}]
//                {separator: true} draws a horizontal line across the box
//                change(dir): a switch - Left / Right step its value back (-1) / forward (+1)
//                info lines may be {text, color, onClick} - clickable (e.g. the invite link)
//
// ui.showPage(kind, uiMode, back) shows the game's own Instructions / Information page full screen
// (drawn by an engine instance, like in the game); Enter, Esc or a click calls back().
//   spec.infoRow: row of the selected item's info lines (cyan, centred)
//   spec.hint:   bottom line text;  spec.back: Esc handler;  spec.sel: initially selected item
//
// new DosUI(canvas) owns the canvas. new DosUI(canvas, {display, present, active}) draws over another
// page's Display instead: present(snapshot) receives each drawn screen, and input is only handled
// while active() returns true.
(function (root) {

const ATTR = 0x05, SEL = 0x5F, DISABLED = 0x08;

class DosUI {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.display = opts.display || new Display(canvas);
    this.present = opts.present || (snap => this.display.setSnapshot(snap));
    this.active = opts.active || (() => true);
    this.t = new TunnelerEngine(0);          // only its Crt text routines and video buffer are used
    this.spec = null; this.sel = 0; this.top = 0;
    window.addEventListener("keydown", e => { if (this.active()) this.key(e); });
    canvas.addEventListener("mousemove", e => { if (this.active()) this.hover(e); });
    canvas.addEventListener("click", e => { if (this.active()) this.click(e); });
    if (!opts.display) {
      const loop = now => { this.display.draw(now); requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    }
  }

  // keepSel: keep the selected item (matched by its key, or label) when redrawing the same screen
  // with fresh data
  showPage(kind, uiMode, back) {
    const e = new TunnelerEngine(0);
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
    this.spec = { page: true, back, items: [] };
    this.present({ t: 0, mode: "text", screen: "text", vram: e.vram.slice(0, 16000) });
  }

  show(spec, keepSel) {
    const keyOf = it => it && (it.key != null ? it.key : it.label);
    const prev = this.spec && keyOf(this.spec.items[this.sel]);
    this.spec = spec;
    const n = spec.items.length;
    if (!keepSel) { this.sel = spec.sel || 0; this.top = 0; }
    else { const i = spec.items.findIndex(it => keyOf(it) === prev); if (i >= 0) this.sel = i; }
    this.sel = Math.min(Math.max(this.sel, 0), n - 1);
    if (!this.enabled(this.sel)) this.move(1, true);
    this.draw();
  }

  enabled(i) { const it = this.spec.items[i]; return it && !it.disabled && !it.separator; }
  move(d, quiet) {
    const n = this.spec.items.length;
    for (let k = 1; k <= n; k++) {
      const i = (this.sel + d * k + n * k) % n;
      if (this.enabled(i)) { this.sel = i; break; }
    }
    if (!quiet) this.draw();
  }

  // the box, sized to its items when no width is given
  geom() {
    const s = this.spec, b = s.box;
    if (b.w) return b;
    const len = Math.max(0, ...s.items.map(it => it.separator ? 0 : it.label.length + (it.input ? it.input.max + 1 : 0)));
    let w = Math.max(14, len + 4);
    w += w % 2;                                            // even: exactly centred
    return { x: 41 - ((w + 2) >> 1), y: b.y, w, rows: b.rows };
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

  draw() {
    const t = this.t, s = this.spec, b = this.geom();
    t.textMode();
    t.window(1, 1, 80, 25);
    t.textBackground(0);
    t.clearScreen();
    for (const l of s.lines || []) {
      t.textColor(l.color == null ? 7 : l.color);
      t.gotoXY(l.col || Math.max(1, 41 - (l.text.length >> 1)), l.row);
      t.write(l.text.slice(0, 80 - (l.col || 1)));
    }
    // box
    const shown = this.rowItems();
    t.textColor(5);
    const line = (row, a, fill, z) => { t.gotoXY(b.x, row); t.write(a + fill.repeat(b.w) + z); };
    line(b.y, "\xDA", "\xC4", "\xBF");
    let row = b.y + 1;
    if (s.header) {
      t.gotoXY(b.x, row); t.write("\xB3"); t.textColor(14); t.write(s.header.padEnd(b.w).slice(0, b.w)); t.textColor(5); t.write("\xB3");
      line(row + 1, "\xC3", "\xC4", "\xB4");
      row += 2;
    }
    let moreRow = 0;
    for (let k = 0; k < shown.length; k++, row++) {
      const i = shown[k], it = s.items[i];
      if (k === this.scrollRows) moreRow = row;
      if (it.separator) { line(row, "\xC3", "\xC4", "\xB4"); continue; }
      let text = it.label + (it.input ? it.input.value : "");
      text = it.align === "left" ? (" " + text).padEnd(b.w) : this.centre(text, b.w);
      text = text.slice(0, b.w);
      t.gotoXY(b.x, row); t.write("\xB3" + text + "\xB3");
      const o = (row - 1) * 160 + b.x * 2;
      const attr = i === this.sel ? SEL : it.disabled ? DISABLED : it.attr || ATTR;
      for (let c = 0; c < b.w; c++) t.vram[o + c * 2 + 1] = attr;
      if (it.input && i === this.sel) {                     // blinking cursor after the text
        const at = (it.align === "left" ? 1 : (b.w - (it.label.length + it.input.value.length)) >> 1) + it.label.length + it.input.value.length;
        if (at < b.w) { t.vram[o + at * 2] = 0x5F; t.vram[o + at * 2 + 1] = SEL | 0x80; }
      }
    }
    line(row, "\xC0", "\xC4", "\xD9");
    // more items above / below the scrolling part
    t.textColor(5);
    if (this.top > 0) { t.gotoXY(b.x + b.w - 1, b.y + (s.header ? 2 : 0)); t.write("\x18"); }
    if (this.top + this.scrollRows < this.scrollN) { t.gotoXY(b.x + b.w - 1, moreRow || row); t.write("\x19"); }
    // info about the selected item
    const it = s.items[this.sel];
    this.links = [];
    (it && it.info || []).forEach((l, i) => {
      t.textColor(l.color == null ? 3 : l.color);
      const text = typeof l === "string" ? l : l.text;
      const x = Math.max(1, 41 - (text.length >> 1)), y = (s.infoRow || row + 3) + i;
      t.gotoXY(x, y);
      t.write(text.slice(0, 79));
      if (l.onClick) this.links.push({ x, y, w: Math.min(text.length, 79), onClick: l.onClick });
    });
    // bottom line, like the game's "Press <ENTER> for main menu."
    t.drawBottomRule();
    const T = (k, d) => root.Lang ? root.Lang.t(k) : d;
    t.textColor(1); t.gotoXY(2, 25); t.write(T("ui.pd", "public domain, 2026"));
    const hint = " " + (s.hint || T("ui.hint", "\x18\x19 and <ENTER>, or the mouse.") + (s.back ? "  " + T("ui.back", "<ESC> back.") : ""));
    t.textColor(15); t.gotoXY(80 - hint.length, 25); t.write(hint);
    this.present({ t: 0, mode: "text", screen: "text", vram: t.vram.slice(0, 16000) });
  }

  centre(s, w) { const l = Math.max(0, (w - s.length) >> 1); return (" ".repeat(l) + s).padEnd(w); }

  key(e) {
    const s = this.spec;
    if (!s) return;
    if (s.page) {
      if (["Enter", "NumpadEnter", "Escape", "Space"].includes(e.code)) { e.preventDefault(); s.back(); }
      return;
    }
    const it = s.items[this.sel];
    if (e.code === "ArrowUp" || e.code === "Numpad8") this.move(-1);
    else if (e.code === "ArrowDown" || e.code === "Numpad2" || (e.code === "Tab" && it && it.input)) this.move(1);
    else if (e.code === "Enter" || e.code === "NumpadEnter" || (e.code === "Space" && !(it && it.input))) { if (it && !it.disabled) it.go(); }
    else if ((e.code === "ArrowLeft" || e.code === "ArrowRight" || e.code === "Numpad4" || e.code === "Numpad6") && it && it.change)
      it.change(e.code === "ArrowLeft" || e.code === "Numpad4" ? -1 : 1);
    else if (e.code === "Escape") { if (s.back) s.back(); }
    else if (it && it.input && e.code === "Backspace") { it.input.value = it.input.value.slice(0, -1); this.draw(); }
    else if (it && it.input && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const c = e.key.charCodeAt(0);
      if (c < 32 || c > 126 || it.input.value.length >= it.input.max) return;
      it.input.value += e.key;
      this.draw();
    } else return;
    e.preventDefault();
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
    if (this.spec && this.spec.page) { this.spec.back(); return; }
    const link = this.linkAt(ev);
    if (link) { link.onClick(); return; }
    const i = this.itemAt(ev);
    if (i >= 0) { this.sel = i; this.spec.items[i].go(); }
  }
}

root.DosUI = DosUI;
})(window);
