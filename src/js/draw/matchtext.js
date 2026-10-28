// The match's text screens (docs/RENDERING.md): the "(creating world)" line, a round's title, the statistics and the
// rounds after a match - drawn like the menus (dosui.js) on a text buffer of their own (TextBuf) with their model (the
// round title's box, the bottom rule: snap.ui), so either look draws them (display.js / gfx-text.js) and nothing is
// guessed. The engine draws nothing: its snapshots carry the steps that showed the text (snap.text, playscreen.js) and
// this replays them - views.js for every game, play.js / online.js / replays.js for the screens after a match. The
// layout is the original program's, cell for cell (test/screen-check.js).
//   MatchText.snapshot(snap, engine) -> a text snapshot (vram, uni, ui) of an engine snapshot's text steps
//   new MatchText(engine).summary(boxRows) -> {top}   .statsPage(prompt)   .textSnap()
import { STRINGS_EN } from "../../lang/en/engine.js";
import { TextBuf } from "./textbuf.js";
import { UniText } from "../text/unitext.js";

const i16 = v => (v << 16) >> 16;
// display columns of font text (markup "{n}" excluded; wide Unicode characters count 2)
const visLen = t => UniText.cols(t.replace(/\{\d+\}/g, ""));
const centre = (t, w) => { const n = UniText.cols(t), l = (w - n) >> 1; return " ".repeat(l) + t + " ".repeat(w - n - l); };
const CycleColors = [12, 13, 9, 10, 14, 6];          // the round title's "ROUND n"

export class MatchText extends TextBuf {
  constructor(e) {
    super();
    this.e = e;
    for (let i = 0; i < this.vram.length; i += 2) { this.vram[i] = 0x20; this.vram[i + 1] = 0x07; }   // (the BIOS's blank screen)
    this.statsLeft = 43; this.statsFull = false;  // where the statistics go
    this.promptOverride = null;                   // statsPage's prompt
    this.titleLabel = null;                       // the round title's "ROUND n" cells (roundTitleCycle)
    this.ui = { titles: [], boxes: [], bar: null, rule: null };
  }
  get strings() { return this.promptOverride ? Object.assign({}, this.e.strings, { prompt: this.promptOverride }) : this.e.strings; }

  // ------------------------------------------------------------ an engine snapshot's text
  // the steps that drew it (playscreen.js text()): replayed on a blank screen
  static snapshot(snap, engine) {
    const m = new MatchText(engine);
    m.replay(snap.text || []);
    const s = Object.assign({}, snap, m.textSnap());
    delete s.text;
    s.t = snap.t;
    return s;
  }
  replay(ops) {
    for (const [op, ...a] of ops) {
      switch (op) {
        case "checking":                             // CheckIntegrity's "(checking...)", then a clear screen
          this.textColor(1); this.writeLn("(checking...)"); this.clearScreen(); this.textBackground(0); this.clearScreen(); break;
        case "clear": this.window(a[0], a[1], a[2], a[3]); this.clearScreen(); break;
        case "status": this.window(1, 1, 80, 25); this.worldStatus(a[0] ? this.strings[a[0]] : "", a[1], a[2]); break;
        case "clearMenu":                            // (the original's menu window cleared; after a match its divider's foot too)
          if (a[0]) { this.window(1, 1, 80, 25); this.gotoXY(40, 25); this.write(" "); }
          this.window(1, 1, 80, 24); this.clearScreen(); break;
        case "title": {                              // a round's title with that moment's round and wins
          const e = this.e;
          this.e = Object.create(e, { round: { value: a[0] }, wins: { value: a[1] }, teamWins: { value: a[2] } });
          try { this.roundTitle(); } finally { this.e = e; }
          break;
        }
        case "cycle": this.roundTitleCycle(a[0]); break;
      }
    }
  }
  vpoke(ofs, v) { this.vram[ofs] = v; if (this.uniUsed && !(ofs & 1)) this.uni[ofs >> 1] = 0; }
  // the engine's ClrScr: the window in the current colours
  clrScr() {
    for (let y = this.wy1; y <= this.wy2; y++)
      for (let x = this.wx1; x <= this.wx2; x++) { this.vram[y * 160 + x * 2] = 0x20; this.vram[y * 160 + x * 2 + 1] = this.textAttr; }
    if (this.uniUsed) for (let y = this.wy1; y <= this.wy2; y++) this.uni.fill(0, y * 80 + this.wx1, y * 80 + this.wx2 + 1);
    this.cx = this.wx1; this.cy = this.wy1;
  }
  drawBottomRule(row = 24) { super.drawBottomRule(row); this.ui.rule = { r: row - 1, c: 0, c2: 79 }; }
  // the screen as a snapshot with its model
  textSnap() {
    const s = { t: 0, mode: "text", screen: "text", vram: this.vram.slice(0, 16000),
      ui: { titles: this.ui.titles.slice(), boxes: this.ui.boxes.slice(), bar: null, rule: this.ui.rule } };
    this.snapUni(s);
    if (s.uni) s.uni = s.uni.slice(0, 8000);           // (the DOS screen's 25 rows)
    return s;
  }
  // the statistics alone, full screen (online, a replay)
  statsPage(prompt) { this.textBackground(0); this.showStatsPage(prompt); return this; }
  // the screen after a match without a menu (play.js puts its own on it) -> {top}: the row its box's top border goes on
  summary(boxRows) { return this.drawSummary(boxRows); }

  // the game's settings as compact font-text parts ("map size: medium", "rounds to win: 3", ...): map size,
  // rounds to win, friendly fire (only when a team has 2+ tanks), the view / online visible limit and
  // ghost mode when the page set them (showSettings), the round time limit when there is one (time: 0 =
  // the full text, 1 = the short one, 2 = left out; 3 = the line of sight left out too); [] without showSettings
  settingsParts(time = 0) {
    const o = this.e.showSettings;
    if (!o) return [];
    const S = Object.assign({}, STRINGS_EN.settings, this.strings.settings);
    const sizes = this.e.constructor.SIZES || ["small", "medium", "large"];
    const goalText = this.e.goal && (S.goals || STRINGS_EN.settings.goals)[this.e.gameMode];
    const parts = [S.size[Math.max(0, sizes.indexOf(this.e.size))], goalText ? goalText.replace("{n}", String(this.e.goal)) : S.win.replace("{n}", String(this.e.winScore))];
    if (this.e.gameMode !== "standard") parts.unshift((S.modes || {})[this.e.gameMode] || this.e.gameMode);
    if (this.e.teams) parts.push(S.ff[this.e.friendlyFire ? 1 : 0]);
    if (this.e.sight !== "full" && time < 3) parts.push(S.sight[this.e.constructor.SIGHTS.indexOf(this.e.sight) - 1]);   // (short: it packs well here)
    const vi = ["self", "team", "everyone"].indexOf(o.view);
    if (vi >= 0) parts.push((o.visible ? S.visible : S.view).replace("{v}", S.views[vi]));
    // the round time limit only when there is one (here, before the longest part, it fits best)
    if (this.e.roundTime && time < 2) parts.push((time ? S.timeShort || S.time : S.time).replace("{n}", String(this.e.roundTime)));
    if (o.watchOut != null) parts.push(S.watch[this.e.constructor.AFTER_DEATH.indexOf(this.e.constructor.afterDeath(o.watchOut))] || S.watch[1]);
    return parts;
  }

  // the parts joined by ", " and wrapped into lines of at most `width` columns; more than maxLines lines:
  // the round time's short text, else without it, else without the line of sight too
  settingsLines(width, maxLines = 4) {
    let lines;
    for (let time = 0; time < 4; time++) {
      if (time === 3 ? this.e.sight === "full" : time && !this.e.roundTime) continue;
      lines = [];
      let cur = "";
      for (const p of this.settingsParts(time)) {
        if (cur && visLen(cur) + 2 + visLen(p) + 1 > width) { lines.push(cur + ","); cur = p; }
        else cur = cur ? cur + ", " + p : p;
      }
      if (cur) lines.push(cur);
      if (lines.length <= maxLines) break;
    }
    return lines;
  }

  // something drawn on screen row y (1-based)?
  rowUsed(y) {
    for (let c = 0; c < 80; c++) { const b = this.vram[((y - 1) * 80 + c) * 2]; if (b !== 0 && b !== 0x20) return true; }
    return false;
  }

  // the settings lines centred on column c (screen columns), from row y, in cyan
  writeSettings(c, y, width) {
    this.textColor(3);
    this.settingsLines(width).forEach((l, i) => { this.gotoXY(c - (visLen(l) >> 1), y + i); this.write(l); });
  }

  // the "you" marker around player p's text at columns x..x+w-1 of row y (display only)
  markYou(p, x, w, y, color) {
    if (this.e.youPlayer !== p) return;
    this.textColor(color);
    if (x > 2) { this.gotoXY(x - 2, y); this.write("\x10"); }
    if (x + w + 1 <= 80) { this.gotoXY(x + w + 1, y); this.write("\x11"); }
  }

  roundTitle() {
    this.window(1, 1, 80, 25);
    this.clearScreen();
    const S = this.strings;
    const label = S.round + " " + this.e.round;                 // "ROUND n", colour-cycled
    const x = this.centreCol(label) - 2;                       // box: "\xB3 ROUND n \xB3"
    this.textColor(5);
    this.gotoXY(x, 8);
    this.write("\xDA", "\xC4".repeat(label.length + 2), "\xBF");
    this.gotoXY(x, 9);
    this.write("\xB3 ", label, " \xB3");
    this.gotoXY(x, 10);
    this.write("\xC0", "\xC4".repeat(label.length + 2), "\xD9");
    this.ui.boxes.push({ r: 7, c: x - 1, r2: 9, c2: x + label.length + 2 });   // (no title on this screen: names and scores)
    const name = (t, c, y) => this.gotoXY(c - (visLen(t) >> 1), y);
    if (this.e.extended) this.roundTitleExt();
    else {
      const blue = this.e.classicName(1), green = this.e.classicName(2);
      this.textColor(9);
      name(blue, 28, 16); this.write(blue);
      name(String(this.e.wins[1]), 28, 18); this.write(this.e.wins[1]);
      this.textColor(10);
      name(green, 53, 16); this.write(green);
      name(String(this.e.wins[2]), 53, 18); this.write(this.e.wins[2]);
      this.markYou(1, 28 - (visLen(blue) >> 1), visLen(blue), 16, 9);
      this.markYou(2, 53 - (visLen(green) >> 1), visLen(green), 16, 10);
    }
    if (this.e.showSettings) {                                   // at the bottom, wrapped onto several rows,
      let last = 24;                                           // with a blank row above them (row 25 if
      while (last > 11 && !this.rowUsed(last)) last--;         // the players' list needs the room)
      const n = this.settingsLines(48).length;
      this.writeSettings(41, Math.min(26 - n, Math.max(25 - n, last + 2)), 48);
    }
    this.titleLabel = { at: 8 * 160 + (x + 1) * 2 + 1, n: label.length };   // attribute of the first label cell
  }

  // the label's colours, the i-th time (1..80)
  roundTitleCycle(i) {
    const { at, n } = this.titleLabel;
    for (let j = 0; j < n; j++) this.vpoke(at + j * 2, CycleColors[(i + j) % 6]);
  }

  // "ROUND n" title: every player's color name (or display name) and wins; with shared teams the teams
  // ("TEAM n", their wins and members) side by side (up to 4 teams), or one line per team (5 or more)
  roundTitleExt() {
    const N = this.e.nPlayers, T = this.e.nTeams, teams = this.e.teams && !this.e.perTankWins();
    if (teams && T <= 4) {
      const cols = T === 2 ? [28, 53] : Array.from({ length: T }, (_, k) => Math.round(80 * (2 * k + 1) / (2 * T)) + 1);
      const cw = Math.trunc(80 / T) - 1;
      cols.forEach((c, t) => {
        const tn = this.e.teamName(t), w = String(this.e.teamWins[t]);
        this.textColor(15);
        this.gotoXY(c - (visLen(tn) >> 1), 14); this.write(tn);
        this.gotoXY(c - (w.length >> 1), 16); this.write(w);
        let y = 18;
        for (const p of this.e.teamMembers(t)) {
          const n = UniText.slice(this.e.playerName(p), p === this.e.youPlayer ? cw - 4 : cw);
          this.textColor(this.e.playerTextColor(p));
          this.gotoXY(c - (visLen(n) >> 1), y); this.write(n);
          this.markYou(p, c - (visLen(n) >> 1), visLen(n), y++, this.e.playerTextColor(p));
        }
      });
      return;
    }
    if (teams) {
      let lw = 0, mw = 0, most = 0;
      for (let t = 0; t < T; t++) {
        lw = Math.max(lw, visLen(this.e.teamName(t)));
        most = Math.max(most, this.e.teamMembers(t).length);
      }
      // (a team's names on one line: each cut so the longest team's line fits the screen - 16-column names, 4
      // members; owner, 2026-10-28)
      const cut = Math.max(4, Math.floor((78 - lw - 5 - 4 - 2 * (most - 1)) / Math.max(1, most)));
      const nameOf = p => UniText.slice(this.e.playerName(p), cut);
      for (let t = 0; t < T; t++) mw = Math.max(mw, this.e.teamMembers(t).reduce((a, p) => a + visLen(nameOf(p)) + (p === this.e.youPlayer ? 4 : 2), -2));
      const x = Math.max(1, 41 - ((lw + 5 + mw) >> 1)), gap = T <= 6 ? 2 : 1;
      for (let t = 0; t < T; t++) {
        const tn = this.e.teamName(t);
        this.gotoXY(x, 13 + t * gap);
        this.textColor(15);
        this.write(tn + " ".repeat(lw - visLen(tn) + 2) + this.e.teamWins[t] + "  ");
        this.e.teamMembers(t).forEach((p, i) => {
          this.textColor(this.e.playerTextColor(p));
          const you = p === this.e.youPlayer;          // "►NAME◄" (display only)
          this.write((i ? "  " : "") + (you ? "\x10" : "") + nameOf(p) + (you ? "\x11" : ""));
        });
      }
      return;
    }
    let nw = 0;
    for (let p = 1; p <= N; p++) nw = Math.max(nw, visLen(this.e.playerName(p)));
    const x = 41 - ((nw + 4) >> 1), gap = N <= 5 ? 2 : 1;
    for (let p = 1; p <= N; p++) {
      const n = this.e.playerName(p);
      this.textColor(this.e.playerTextColor(p));
      this.gotoXY(x, 13 + (p - 1) * gap);
      this.write(n + " ".repeat(nw - visLen(n) + 3) + this.e.wins[p]);
      this.markYou(p, x, nw + 3 + String(this.e.wins[p]).length, 13 + (p - 1) * gap, this.e.playerTextColor(p));
    }
  }

  // statistics after a match (right of the menu): one row per player - color name (blinking for the
  // winners), shots fired, hits, percent, meters dug, meters traveled - grouped by team (a blank row
  // between teams) when teams are shared
  statsExt() {
    const st = this.strings.stats, N = this.e.nPlayers;
    // a game mode's own total per tank (gold brought home, captures, kills...: GM.stat) instead of the
    // meters moved - why the winner won (docs/DESIGN-8P.md 27)
    const modeStat = this.e.GM && this.e.GM.stat ? p => this.e.GM.stat(this.e, p) : null;
    const head = (st.head || STRINGS_EN.stats.head).slice(), widths = [5, 5, 5, 6, 6];
    if (modeStat) head[4] = UniText.slice(this.e.mt("stat"), 5);
    this.window(this.statsLeft, 5, this.statsLeft + 36, 25);     // 37 columns
    this.textColor(11);
    this.gotoXY(19 - (visLen(st.title) >> 1), 1);
    this.write(st.title);
    const perTank = this.e.perTankWins();
    const name = p => UniText.slice(this.e.playerName(p), 9);
    let nw = 0;
    for (let p = 1; p <= N; p++) nw = Math.max(nw, visLen(name(p)));
    nw++;
    const x0 = 1 + Math.max(0, (37 - nw - 27) >> 1);
    let y = 3;
    this.gotoXY(x0, y);
    this.textColor(6);
    this.write(" ".repeat(nw));
    head.forEach((h, i) => this.write(h.slice(0, widths[i] - 1).padStart(widths[i])));
    const order = [];
    if (this.e.teams && !perTank) for (let t = 0; t < this.e.nTeams; t++) { if (t) order.push(0); order.push(...this.e.teamMembers(t)); }
    else for (let p = 1; p <= N; p++) order.push(p);
    for (const p of order) {
      y++;
      if (!p) continue;
      const c = this.e.playerTextColor(p), n = name(p);
      this.gotoXY(x0, y);
      this.textColor(c + (this.e.matchWinner(p) ? 128 : 0));
      this.write(n);
      this.textColor(c);
      const fired = this.e.shotsFired[p], hit = this.e.shotsHit[p];
      const pct = Math.trunc(hit * 100 / (fired > 0 ? fired : 1));
      // "NAME◄": the you marker in the gap after the name (display only)
      this.write(p === this.e.youPlayer ? "\x11" + " ".repeat(nw - visLen(n) - 1) : " ".repeat(nw - visLen(n)), this.num(fired, 5), this.num(hit, 5), this.num(pct + "%", 5),
        this.num(this.e.metersDug[p], 6), this.num(modeStat ? modeStat(p) : this.e.metersMoved[p], 6));
    }
    // (no "The winner is ..." line: the winners' names blink in the table)
  }

  // the rounds (number, winner, length) as lines of at most w columns: [{text, color}]
  matchRoundLines(w) {
    const S = Object.assign({}, STRINGS_EN.stats, this.strings.stats), out = [];
    const mmss = t => Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0");
    this.e.roundLog.forEach((r, i) => {
      let name, color = 7;
      if (r.winner < 0) name = r.how === "esc" ? S.ended : S.draw;
      else if (!this.e.extended) { name = this.e.classicName(r.winner); color = r.winner + 8; }   // (the lighter BLUE / GREEN, as in the table there)
      else if (r.player) { name = this.e.playerName(r.player); color = this.e.playerTextColor(r.player); }
      else if (this.e.perTankWins()) name = this.e.teamName(r.winner);   // (the sides change: no tank's colour)
      else { name = this.e.teamName(r.winner); color = this.e.playerTextColor(this.e.teamMembers(r.winner)[0]); }
      const num = String(i + 1).padStart(2) + " ", time = " " + (r.note ? UniText.slice(r.note, 8) : mmss(r.secs));
      const n = UniText.slice(name, Math.max(1, w - num.length - time.length));
      out.push({ text: num + n + " ".repeat(Math.max(0, w - num.length - visLen(n) - time.length)) + time, color });
    });
    return out;
  }

  // a block of lines at column x, rows y..y2 (1-based): a heading, then as many lines as fit (latest:
  // the last ones, "..." in front when some don't fit)
  writeBlock(x, y, y2, w, head, lines, latest) {
    if (!lines.length || y2 - y < 1) return;
    const room = y2 - y;
    let show = lines;
    if (lines.length > room) show = latest ? [{ text: " ...", color: 8 }, ...lines.slice(lines.length - room + 1)] : lines.slice(0, room - room % 2);
    this.textColor(14); this.gotoXY(x, y); this.write(UniText.slice(head, w));
    show.forEach((l, i) => { this.textColor(l.color); this.gotoXY(x, y + 1 + i); this.write(UniText.slice(l.text, w)); });
  }

  // rows the rounds take (a heading + the list), at most max
  matchExtrasHeight(w, max) {
    const n = this.matchRoundLines(w).length;
    return n ? Math.min(max, n + 1) : 0;
  }

  // the rounds at column x, w wide, rows y..y2
  matchExtrasAt(x, w, y, y2) {
    const S = Object.assign({}, STRINGS_EN.stats, this.strings.stats);
    const keep = [this.wx1, this.wy1, this.wx2, this.wy2, this.cx, this.cy, this.textAttr];
    this.window(1, 1, 80, 25);
    this.writeBlock(x, y, y2, w, S.rounds, this.matchRoundLines(w), true);
    [this.wx1, this.wy1, this.wx2, this.wy2, this.cx, this.cy, this.textAttr] = keep;
  }

  // the classic game's statistics (BLUE / GREEN), in the 37 columns from statsLeft (the menu's right half)
  statsClassic() {
    const S = this.strings;
    // BLUE / GREEN: the original's darker colours on the original screen (split screen); the lighter ones
    // (easier to read) against the computer and online
    const L = this.e.matchExtras || this.statsFull ? 8 : 0, alive = this.e.alive.slice();
    this.window(this.statsLeft, 6, this.statsLeft + 36, 20);
    this.textColor(11);
    this.gotoXY(19 - (visLen(S.stats.title) >> 1), 1);
    this.writeLn(S.stats.title);
    this.writeLn();
    this.writeLn();
    if (alive[1] === alive[2]) { alive[1] = false; alive[2] = false; }   // (the original set the game's own: engine.showMainMenu)
    if (this.e.youPlayer === 1) {                 // "►BLUE" (display only)
      this.textColor(9);
      this.write(" ".repeat(24 - visLen(this.e.classicName(1))) + "\x10");
      this.textColor(((this.e.wins[1] > this.e.wins[2]) ? 1 : 0) * 128 + 1 + L);
      this.write(this.e.classicName(1));
    } else {
      this.textColor(((this.e.wins[1] > this.e.wins[2]) ? 1 : 0) * 128 + 1 + L);
      this.write(UniText.padStart(this.e.classicName(1), 25));
    }
    this.textColor(((this.e.wins[2] > this.e.wins[1]) ? 1 : 0) * 128 + 2 + L);
    if (this.e.youPlayer === 2) {                 // "GREEN◄" (display only)
      this.write(UniText.padStart(this.e.classicName(2), 9));
      this.textColor(10);
      this.writeLn("\x11");
    } else this.writeLn(UniText.padStart(this.e.classicName(2), 9));
    this.writeLn();
    const row = (label, f) => {
      this.textColor(6);
      this.write(label.slice(0, 16).padEnd(16));
      for (let i = 1; i <= 2; i++) { this.textColor(i + L); f(i); }
      this.writeLn();
    };
    row(S.stats.fired, i => this.write(this.num(this.e.shotsFired[i], 9)));
    row(S.stats.hit, i => this.write(this.num(this.e.shotsHit[i], 9)));
    // the original set ShotsFired to 1 here when 0 (to avoid dividing by zero), so a redraw of this
    // screen showed 1 shot; online the statistics are drawn by several engine copies, so don't
    row(S.stats.percent, i => {
      const fired = this.e.shotsFired[i] === 0 ? 1 : this.e.shotsFired[i];
      this.write(this.num(Math.trunc(i16(this.e.shotsHit[i] * 100) / fired), 8), "%");
    });
    this.writeLn();
    row(S.stats.dug, i => this.write(this.num(this.e.metersDug[i], 9)));
    row(S.stats.moved, i => this.write(this.num(this.e.metersMoved[i], 9)));
    this.writeLn();
    this.writeLn();
    if (alive[1] !== alive[2]) {
      this.textColor(6);
      this.write(S.stats.winner);
      if (this.e.wins[1] > this.e.wins[2]) { this.textColor(1 + L); this.write(this.e.classicName(1)); }
      else { this.textColor(2 + L); this.write(this.e.classicName(2)); }
      this.textColor(6);
      this.writeLn(".");
    }
  }

  // The statistics alone, full screen (the online lobby's Statistics page): centred, the settings below
  // them across the whole width, `prompt` on the bottom line
  showStatsPage(prompt) {
    this.window(1, 1, 80, 25);
    this.clearScreen();
    // (laid out as the vs computer statistics: the rounds in the left half, the table in the right one - owner,
    // 2026-10-24: the left column was too narrow and stuck to the table)
    this.statsLeft = 43; this.statsFull = false;
    if (this.e.extended) this.statsExt(); else this.statsClassic();
    this.matchExtrasAt(11, 18, 5, 20);                        // (the rounds, left of the table)
    this.centreStats(1, 80, 1, 23);                           // (all of it in the middle, above the bottom line)
    this.window(1, 1, 80, 25);
    if (prompt) this.promptOverride = prompt;
    this.showEscPrompt();
  }

  // The score during a match (a player holding Tab / SCORE: ui/livestats.js; owner, 2026-10-28 - "only what is
  // important, not the whole stats as at the end"): a box in the middle with the round, every player's or team's
  // rounds won and the mode's score (destroyed tanks gray), and the game's settings. Display only (reads the engine).
  liveStats() {
    this.window(1, 1, 80, 25);
    this.clearScreen();
    const w = 40, score = this.scoreLines(w), set = this.e.showSettings ? this.settingsLines(w, 3) : [];
    const rows = [{ text: this.strings.round + " " + this.e.round, color: 14 }, null, ...score, ...(set.length ? [null, ...set.map(text => ({ text, color: 3 }))] : [])];
    const x = 41 - ((w + 4) >> 1), top = Math.max(1, 13 - ((rows.length + 4) >> 1));
    this.textColor(5);
    this.gotoXY(x, top); this.write("\xDA", "\xC4".repeat(w + 2), "\xBF");
    for (let i = 0; i <= rows.length + 1; i++) { this.gotoXY(x, top + 1 + i); this.write("\xB3", " ".repeat(w + 2), "\xB3"); }
    this.gotoXY(x, top + rows.length + 3); this.write("\xC0", "\xC4".repeat(w + 2), "\xD9");
    this.ui.boxes.push({ r: top - 1, c: x - 1, r2: top + rows.length + 2, c2: x + w + 2 });
    rows.forEach((l, i) => { if (l) { this.textColor(l.color); this.gotoXY(x + 2, top + 2 + i); this.write(UniText.slice(l.text, w)); } });
    return this;
  }
  // the score as lines of at most w columns: [{text, color}] - per team (shared teams: its name, rounds won and the
  // mode's score, then its members) or per tank: the name, the rounds won (not in a one-round match: king of the
  // hill...) and the mode's score ("hill 45/60s"); a destroyed tank gray
  scoreLines(w) {
    const e = this.e, out = [], teams = e.extended && e.teams && !e.perTankWins(), won = x => e.extended && e.winScore <= 1 ? "" : x;
    const line = (name, wins, extra, color, indent = "") => {
      const tail = (wins === "" ? "" : String(wins).padStart(3)) + (extra ? "  " + extra : "");
      const n = UniText.slice(name, Math.max(4, w - indent.length - visLen(tail) - 1));
      out.push({ text: UniText.slice(indent + n + " ".repeat(Math.max(1, w - indent.length - visLen(n) - visLen(tail))) + tail, w), color });
    };
    const mark = p => (p === e.youPlayer ? "\x10" : ""), col = (p, c) => (e.alive[p] ? c : 8);
    if (!e.extended) {
      for (let p = 1; p <= 2; p++) line(mark(p) + e.classicName(p), e.wins[p], "", col(p, p + 8));
      return out;
    }
    if (teams) {
      for (let t = 0; t < e.nTeams; t++) {
        const m = e.teamMembers(t);
        line(e.teamName(t), won(e.teamWins[t]), m.length ? e.modeScoreText(m[0]) : "", 15);
        for (const p of m) line(mark(p) + e.playerName(p), "", "", col(p, e.playerTextColor(p)), "  ");
      }
      return out;
    }
    for (let p = 1; p <= e.nPlayers; p++) line(mark(p) + e.playerName(p), won(e.wins[p]), e.modeScoreText(p), col(p, e.playerTextColor(p)));
    return out;
  }

  // Centre what is drawn in columns c0..c1, rows r0..r1 vertically: the vs computer statistics, the online
  // page (the game's settings are not repeated there any more - owner, 2026-10-24; the round title has them)
  centreStats(c0, c1, r0, r1) {
    const used = r => {
      for (let c = c0; c <= c1; c++) { const b = this.vram[((r - 1) * 80 + c - 1) * 2]; if (b !== 0 && b !== 0x20) return true; }
      return false;
    };
    let first = 0, last = 0;
    for (let r = r0; r <= r1; r++) if (used(r)) { if (!first) first = r; last = r; }
    if (!first) return;
    const delta = r0 + Math.max(0, (r1 - r0 + 1 - (last - first + 1)) >> 1) - first;
    if (delta) this.shiftRows(c0, c1, first, last, delta);
  }

  // move the cells of columns c0..c1, rows ra..rb (1-based) by d rows (the text and its Unicode plane)
  shiftRows(c0, c1, ra, rb, d) {
    const cells = [];
    for (let r = ra; r <= rb; r++)
      for (let c = c0; c <= c1; c++) {
        const i = (r - 1) * 80 + c - 1;
        cells.push([r, c, this.vram[i * 2], this.vram[i * 2 + 1], this.uni[i]]);
        this.vram[i * 2] = 0x20; this.vram[i * 2 + 1] = 0; this.uni[i] = 0;
      }
    for (const [r, c, ch, at, u] of cells) {
      const i = (r + d - 1) * 80 + c - 1;
      if (r + d < 1 || r + d > 25) continue;
      this.vram[i * 2] = ch; this.vram[i * 2 + 1] = at; this.uni[i] = u;
    }
    this.dirty = true;
  }

  // The screen after a match without a menu (display only; the pages put their own on it): the statistics in the right
  // half (vs computer: centred), the rounds above the menu's place in the left half (matchExtras), a line between the
  // halves. boxRows: the page's menu box, borders included. -> {top}: the row (1-based) its top border goes on
  drawSummary(boxRows) {
    this.window(1, 1, 80, 25);
    this.clearScreen();
    const extras = this.e.matchExtras;
    const extraH = extras ? this.matchExtrasHeight(18, 24 - boxRows - 1) : 0;
    const top = extras ? 1 + ((24 - (extraH + (extraH ? 1 : 0) + boxRows)) >> 1) + extraH + (extraH ? 1 : 0) : 11;
    this.textColor(8);
    for (let i = 1; i <= 23; i++) { this.gotoXY(40, i); this.write("\xB3"); }
    if (extras) this.matchExtrasAt(11, 18, top - 1 - extraH, top - 2);
    if (this.e.extended) this.statsExt(); else this.statsClassic();
    if (extras) this.centreStats(42, 80, 1, 23);
    this.window(1, 1, 80, 25);
    return { top };
  }

  // "(creating world)" / "(world ready)" on the bottom line, padded to the same width so either
  // one fully covers the other
  worldStatus(text, shift, color) {
    const S = this.strings, w = Math.max(visLen(S.creating), visLen(S.ready)) + 2;
    const t = centre(text, w);
    this.gotoXY(this.centreCol(t, shift), 25);
    this.textColor(color);
    this.write(t);
  }

  showEscPrompt() {
    this.drawBottomRule();
    this.window(1, 1, 80, 25);
    this.gotoXY(80 - visLen(this.strings.prompt) - 1, 25);
    this.textColor(15);
    this.write(" " + this.strings.prompt);
  }

  // column for text centred on the 80-column screen
  centreCol(t, shift) { return (shift || 0) + 41 - (visLen(t) >> 1); }

  num(n, width) { return String(n).padStart(width || 0); }

  writeLn(...items) { this.write(...items, "\r\n"); }

  // write text with "{n}" colour switches; a line filling the whole 80 columns wraps by itself, so
  // it gets no CR/LF (like the original's Write of exactly 80 characters)
  markup(line, newline) {
    for (const part of line.split(/(\{\d+\})/)) {
      const m = /^\{(\d+)\}$/.exec(part);
      if (m) this.textColor(+m[1]); else if (part) this.write(part);
    }
    if (newline && visLen(line) < 80) this.writeLn();
  }
}
