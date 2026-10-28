// Graphics "modern" (docs/GRAPHICS.md 10): the play screen's HUD, a transparent 2D layer over the modern
// view windows - for every view (views.js sceneOf: cells) a frame with the window cut out and its border
// in the player's colour, the instrument panel (energy and shield bars), the round clock and a game mode's
// number (engine.clockShown / hudShown - what the engine shows in the frame), the view's name label, and
// across the screen the ping and the notice band ("Press <ESC> again..."). Panel "classic": nothing here -
// the upscaled original frame and panel stay. Display only: reads the engine, never writes it.
import { Display } from "./display.js";
import { TunnelerEngine } from "../game/engine.js";
import { Gfx } from "./gfx.js";

const FONT = '"TunnelerMono", "DejaVu Sans Mono", monospace';    // (gfx-text.js loads the bundled face)
// the 16 text colours as gfx-text.js's clean palette (labels, the mode's tag), its background, panel and
// hairline colours: flat - no gradients, no glow (docs/GRAPHICS.md 6)
const HUES = ["#16130f", "#4e6fa3", "#5c8a4f", "#7fa596", "#a8543f", "#9a83bd", "#a8763d", "#b9b0a2",
  "#6f675c", "#86a6d8", "#93c27e", "#93c7c1", "#e08470", "#cfa3d6", "#e3c065", "#efe7da"];
const BACK = "#16130f", PANEL = "#1d1915", LINE = "#4a4238", TEXT = "#b9b0a2";
const RETRO = ["#000000", "#0000aa", "#00aa00", "#00aaaa", "#aa0000", "#aa00aa", "#aa5500", "#aaaaaa",
  "#555555", "#5555ff", "#55ff55", "#55ffff", "#ff5555", "#ff55ff", "#ffff55", "#ffffff"];

const rgb = c => "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")";
function rrect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function bolt(ctx, x, y, s) {
  ctx.beginPath();
  ctx.moveTo(x + 0.55 * s, y); ctx.lineTo(x + 0.1 * s, y + 0.58 * s); ctx.lineTo(x + 0.45 * s, y + 0.58 * s);
  ctx.lineTo(x + 0.3 * s, y + s); ctx.lineTo(x + 0.9 * s, y + 0.36 * s); ctx.lineTo(x + 0.55 * s, y + 0.36 * s);
  ctx.lineTo(x + 0.75 * s, y); ctx.closePath(); ctx.fill();
}
function shield(ctx, x, y, s) {
  ctx.beginPath();
  ctx.moveTo(x + 0.5 * s, y); ctx.lineTo(x + 0.92 * s, y + 0.16 * s);
  ctx.quadraticCurveTo(x + 0.92 * s, y + 0.78 * s, x + 0.5 * s, y + s);
  ctx.quadraticCurveTo(x + 0.08 * s, y + 0.78 * s, x + 0.08 * s, y + 0.16 * s);
  ctx.closePath(); ctx.fill();
}

// the end-of-match world map: the frame around the map and the "PRESS ANY KEY" banner - retro: the engine's
// own pixel banner shows through (its box as showWorldMap draws it); clean: a panel with the text in the
// modern font instead (sc.anykey, translated)
function drawMap(ctx, W, H, sc, sw, sh, clean) {
  const e = sc.engine, m = sc.map, kx = W / sw, ky = H / sh;
  const B = e.bannerRows ? e.bannerRows() : null, bw = B ? B[0].length : 56, bx = 80 - (bw >> 1) - 1;
  const c0 = Math.max(1, (bx - 7) >> 1), c1 = Math.min(78, (bx + bw + 8) >> 1);
  const banner = [c0 * 9 * kx, 85 * 4 * ky, (c1 - c0 + 1) * 9 * kx, 9 * 4 * ky];
  const holes = [[m.x * kx, m.y * ky, m.w * kx, m.h * ky]].concat(clean && sc.anykey ? [] : [banner]);
  const r = clean ? 1.5 * ky : 0;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  for (const [x, y, w, h] of holes) rrect(ctx, x, y, w, h, r);
  ctx.fillStyle = clean ? BACK : "#000018";
  ctx.fill("evenodd");
  for (const [x, y, w, h] of holes) {
    ctx.beginPath(); rrect(ctx, x, y, w, h, r);
    ctx.strokeStyle = clean ? LINE : "#5555ff"; ctx.lineWidth = Math.max(1, kx);
    ctx.stroke();
  }
  if (clean && sc.anykey) {
    const [x, y, w, h] = banner;
    ctx.beginPath(); rrect(ctx, x, y, w, h, r);
    ctx.fillStyle = PANEL; ctx.fill();
    ctx.strokeStyle = LINE; ctx.lineWidth = Math.max(1, kx); ctx.stroke();
    let size = Math.round(h * 0.42);
    ctx.font = "bold " + size + "px " + FONT;
    const tw = ctx.measureText(sc.anykey).width;
    if (tw > w * 0.9) { size = Math.floor(size * w * 0.9 / tw); ctx.font = "bold " + size + "px " + FONT; }   // (a long translation)
    ctx.fillStyle = HUES[14]; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(sc.anykey, x + w / 2, y + h / 2 + h * 0.03);
  }
  ctx.restore();
}

function draw(ctx, W, H, sc, sw, sh, set, now, style) {
  if (set.panel === "classic") return;
  if (sc.map) { if (sc.map.kind === "end") drawMap(ctx, W, H, sc, sw, sh, style !== "retro"); return; }
  const e = sc.engine, kx = W / sw, ky = H / sh, clean = style !== "retro";
  const D = Display, pal = e.extended ? D.EXT_PALETTE : D.LORES_PALETTE, hues = clean ? HUES : RETRO;
  const MAX = TunnelerEngine.MAX_POWER || 11400;
  const px = v => v * kx, py = v => v * ky;
  for (const c of sc.cells || []) {
    const p = c.p, X = px(c.x), Y = py(c.y), CW = px(360), CH = py(400);
    const wx = px(c.x + 9), wy = py(c.y + 8), ww = px(342), wh = py(284), r = clean ? py(1.5) : 0;
    // (tank colours, Settings: as this view's viewer sees the tanks - also the name label then)
    const tpal = D.tankPalette8 ? D.tankPalette8(pal, e, c.viewer || p) : pal;
    const col = tpal[(e.playerColor ? e.playerColor(p) : [0, 9, 10][p]) & 15] || [200, 200, 200];
    // the frame: the view's area with its window cut out
    ctx.save();
    ctx.beginPath();
    ctx.rect(X, Y, CW, CH);
    rrect(ctx, wx, wy, ww, wh, r);
    ctx.fillStyle = clean ? BACK : "#000018";
    ctx.fill("evenodd");
    ctx.restore();
    // the window's border in the player's colour
    ctx.save();
    ctx.beginPath(); rrect(ctx, wx, wy, ww, wh, r);
    ctx.strokeStyle = rgb(col); ctx.lineWidth = Math.max(1, px(clean ? 1 : 2));
    ctx.stroke();
    ctx.restore();
    if (c.black) {                                     // after death "black": DESTROYED
      ctx.save();
      ctx.beginPath(); rrect(ctx, wx, wy, ww, wh, r); ctx.fillStyle = clean ? BACK : "#000"; ctx.fill();
      ctx.fillStyle = clean ? HUES[12] : "#ff5555"; ctx.font = "bold " + Math.round(py(16)) + "px " + FONT;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(sc.destroyed || "DESTROYED", wx + ww / 2, wy + wh / 2);
      ctx.restore();
    }
    // the panel: energy and shield - as wide as the window above it (owner, 2026-10-26)
    const bx = wx, by = py(c.y + 300), bw = ww, bh = py(92);
    ctx.save();
    ctx.beginPath(); rrect(ctx, bx, by, bw, bh, clean ? py(1.5) : 0);
    ctx.fillStyle = clean ? PANEL : "#2b2b2b"; ctx.fill();
    ctx.lineWidth = Math.max(1, px(0.8)); ctx.strokeStyle = clean ? LINE : "#777"; ctx.stroke();
    ctx.restore();
    // the round clock and a game mode's number: tags at the panel's right end (owner, 2026-10-28: beside the
    // panel they covered its percentages since it is as wide as the window) - room kept for them whenever the game
    // can show them, so the bars don't jump when the clock appears
    const TW = 24, slots = (e.roundTicks ? 1 : 0) + (e.GM && e.GM.hud ? 1 : 0);
    const right = bx + bw - (slots ? px(6 + slots * (TW + 4)) : 0);   // (the bars' and percentages' right end)
    const bars = [[e.energy[p], clean ? HUES[14] : "#ffff55", bolt], [e.shield[p], clean ? HUES[11] : "#55ffff", shield]];
    bars.forEach(([v, cs, icon], i) => {
      const f = Math.max(0, Math.min(1, v / MAX)), y = by + bh * (0.17 + i * 0.44), h = bh * 0.25;
      const ix = bx + bw * 0.04, isz = h * 1.25, tx = ix + isz + bw * 0.045, tw = right - bw * 0.26 - tx;   // (a clear gap after the icon)
      ctx.save();
      ctx.fillStyle = cs;
      icon(ctx, ix, y - (isz - h) / 2, isz);
      ctx.beginPath(); rrect(ctx, tx, y, tw, h, clean ? py(1) : 0); ctx.fillStyle = clean ? BACK : "#000"; ctx.fill();
      if (f > 0) {                                     // (below a fifth: blinking rust)
        const low = f < 0.2 && Math.floor(now / 300) % 2 === 0;
        ctx.beginPath(); rrect(ctx, tx, y, Math.max(px(1), tw * f), h, clean ? py(1) : 0);
        ctx.fillStyle = low ? (clean ? HUES[4] : "#aa0000") : cs;
        ctx.fill();
      }
      ctx.restore();
      ctx.save();
      ctx.fillStyle = clean ? TEXT : "#aaaaaa";
      ctx.font = Math.round(Math.min(h * 0.95, bw * 0.19 / 2.6)) + "px " + FONT; ctx.textAlign = "right"; ctx.textBaseline = "middle";
      ctx.fillText(Math.round(f * 100) + "%", right - bw * 0.04, y + h / 2);
      ctx.restore();
    });
    // the round clock (left) and a game mode's number (right), as the engine shows them in the frame
    const tag = (x, text, colr) => {
      const tw = px(TW), th = py(40), ty = by + (bh - th) / 2;
      ctx.save();
      ctx.beginPath(); rrect(ctx, x - tw / 2, ty, tw, th, clean ? px(1.5) : 0);
      ctx.fillStyle = clean ? PANEL : "#000"; ctx.fill();
      ctx.strokeStyle = colr; ctx.lineWidth = Math.max(1, px(1)); ctx.stroke();
      ctx.fillStyle = colr; ctx.font = "bold " + Math.round(Math.min(tw / 1.35, th * 0.5)) + "px " + FONT;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(text, x, ty + th / 2);
      ctx.restore();
    };
    if (e.roundTicks && e.clockShown >= 0 && e.clockShown <= 30)
      tag(right + px(4 + TW / 2), String(e.clockShown), e.clockShown <= 10 ? (Math.floor(now / 250) % 2 ? hues[12] : hues[15]) : hues[14]);
    const hs = e.hudShown && e.hudShown[p];
    if (hs) { const [v, k] = hs.split(":"); tag(bx + bw - px(6 + TW / 2), v, hues[(+k || 14) & 15]); }
    // the name on the top border
    if (sc.labels && c.name) {
      const fs = Math.round(py(9)), text = c.name + (c.team ? "  " + c.team : "");
      ctx.save();
      ctx.font = "bold " + fs + "px " + FONT;
      const tw = ctx.measureText(text).width + fs, lx = X + CW / 2 - tw / 2, ly = Y + py(0.5);
      ctx.beginPath(); rrect(ctx, lx, ly, tw, py(9.5), clean ? py(1.5) : 0);
      ctx.fillStyle = clean ? BACK : "#000"; ctx.fill();
      ctx.textBaseline = "middle"; ctx.textAlign = "left";
      ctx.fillStyle = tpal === pal ? hues[c.color & 15] : rgb(col);
      ctx.fillText(c.name, lx + fs / 2, ly + py(4.9));
      if (c.team) { ctx.fillStyle = clean ? HUES[8] : "#aaaaaa"; ctx.fillText("  " + c.team, lx + fs / 2 + ctx.measureText(c.name).width, ly + py(4.9)); }
      ctx.restore();
    }
  }
  if (sc.ping) {
    ctx.save();
    ctx.font = Math.round(py(8)) + "px " + FONT; ctx.fillStyle = clean ? HUES[8] : "#aaaaaa"; ctx.textBaseline = "top";
    ctx.fillText(sc.ping, px(4), py(0.5));
    ctx.restore();
  }
  if (sc.notice && sc.cut) {
    const y0 = py(sc.cut[0]), y1 = py(sc.cut[1]);
    ctx.save();
    ctx.fillStyle = clean ? BACK : "#000";
    ctx.fillRect(0, y0, W, y1 - y0);
    ctx.fillStyle = clean ? HUES[14] : "#ffff55";
    let fs = Math.round(py(14));
    ctx.font = "bold " + fs + "px " + FONT;
    const tw = ctx.measureText(sc.notice).width;
    if (tw > W * 0.94) { fs = Math.floor(fs * W * 0.94 / tw); ctx.font = "bold " + fs + "px " + FONT; }
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(sc.notice, W / 2, (y0 + y1) / 2);
    ctx.restore();
  }
}

Gfx.Hud = { draw };
export const Hud = Gfx.Hud;
