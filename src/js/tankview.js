// The touch controls' tank look (pads.js): the knob is the player's own tank as the game draws it right now -
// graphics original: the game's 7 x 7 sprite; modern: gfx-modern.js's tank (simple or realistic, the setting Tanks),
// its shader's shapes and shading drawn here on the CPU - in the tank colours the views use (Display.tankPalette8),
// facing one of the 8 directions. Display only (owner, 2026-10-27).
// TankView.provider(() => engine, () => p) -> pads.js's touchTank: () => {key, dir, paint(canvas, dir)} | null
import { Display } from "./display.js";
import { Gfx } from "./gfx.js";
import { Pads } from "./pads.js";

// the modern picture: pixels a side; tank units (world pixels) from its centre to its edge - 4.5: a turned tank
// reaches past the sprite's 3.5, so the canvas is 4.5 / 3.5 of the knob, overhanging it (BIG)
const N = 128, HALF = 4.5, BIG = HALF / 3.5;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
// gfx-modern.js's sdBox: a rounded box (centre c, half size h, corner r)
function sdBox(px, py, cx, cy, hx, hy, r) {
  const dx = Math.abs(px - cx) - hx + r, dy = Math.abs(py - cy) - hy + r;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r;
}

// gfx-modern.js's tank (its fragment shader's "tanks" part, one tank, tread offset 0) on transparent ground: every
// mix(col, X, k) of the shader is X over what is there with coverage k, every darkening black over it
function modernTank(realistic, body, tread, gun, dir, lamp) {
  const img = new Uint8ClampedArray(N * N * 4), ta = 2 * HALF / N, a = dir * Math.PI / 4;
  const fx = Math.sin(a), fy = -Math.cos(a), rx = Math.cos(a), ry = Math.sin(a);
  const Lwx = -0.6, Lwy = -0.8, Llx = Lwx * rx + Lwy * ry, Lly = -(Lwx * fx + Lwy * fy);
  const cov = d => clamp(0.5 - d / ta, 0, 1);
  for (let py = 0; py < N; py++)
    for (let px = 0; px < N; px++) {
      const dx = ((px + 0.5) / N * 2 - 1) * HALF, dy = ((py + 0.5) / N * 2 - 1) * HALF;
      const lx = dx * rx + dy * ry, ly = -(dx * fx + dy * fy);
      const sx = dx - 0.45, sy = dy - 0.6, lsx = sx * rx + sy * ry, lsy = -(sx * fx + sy * fy);
      let R = 0, G = 0, B = 0, A = 0;                    // (premultiplied)
      const over = (c, k) => { if (k <= 0) return; R = R * (1 - k) + c[0] * k; G = G * (1 - k) + c[1] * k; B = B * (1 - k) + c[2] * k; A = A * (1 - k) + k; };
      const dark = s => { if (s <= 0) return; R *= 1 - s; G *= 1 - s; B *= 1 - s; A = A * (1 - s) + s; };
      const mul = (c, m) => [c[0] * m, c[1] * m, c[2] * m];
      const sr = realistic ? 1 : 0;
      const dS = Math.min(sdBox(lsx, lsy, 0, 0.5, 2.5, 3.0, 0.8 * sr), sdBox(lsx, lsy, 0, -1.8, 0.35, 1.8, 0.3 * sr));
      dark(0.5 * clamp(0.5 - dS / 1.2, 0, 1));
      if (!realistic) {
        const dTr = Math.min(sdBox(lx, ly, -2.015, 0.5, 0.415, 3.05, 0), sdBox(lx, ly, 2.015, 0.5, 0.415, 3.05, 0));
        const fr = ly * 1.6 - Math.floor(ly * 1.6);
        over(mul(tread, 0.82 + 0.25 * (fr >= 0.5 ? 1 : 0)), cov(dTr));
        over(mul(body, 1.15 - 0.3 * clamp((ly + 1.5) / 4, 0, 1)), cov(sdBox(lx, ly, 0, 0.5, 1.6, 2.05, 0)));
        const hl = 0.25 * (1 - smooth(0, 0.9, Math.hypot(lx + 0.35, ly - 0.25)));
        over(body.map(v => v * 0.78 + hl), cov(sdBox(lx, ly, 0, 0.6, 0.95, 0.95, 0)));
        over(mul(gun, 1 - 0.2 * clamp(-ly / 3.5, 0, 1)), cov(sdBox(lx, ly, 0, -1.75, 0.34, 1.85, 0)));
      } else {
        // the tracks: steel links, the guide teeth along the middle
        const dTr = Math.min(sdBox(lx, ly, -2, 0.5, 0.64, 3.01, 0.5), sdBox(lx, ly, 2, 0.5, 0.64, 3.01, 0.5));
        const side = clamp(Math.abs(Math.abs(lx) - 2) / 0.64, 0, 1);
        const link = ly * 2.4 - Math.floor(ly * 2.4), gap = smooth(0, 0.14, link) * smooth(1, 0.8, link);
        const st = (0.5 + 0.5 * gap) * (1.12 - 0.5 * side * side), teeth = 0.07 * (1 - smooth(0, 0.18, Math.abs(side - 0.5))) * gap;
        over([0.24 * st + teeth, 0.235 * st + teeth, 0.23 * st + teeth], cov(dTr));
        // the hull: bevelled edges lit by which way they face, the front plate, the engine deck's slats
        const e = 0.06, dH = sdBox(lx, ly, 0, 0.5, 1.5, 2, 0.3);
        let gx = sdBox(lx + e, ly, 0, 0.5, 1.5, 2, 0.3) - sdBox(lx - e, ly, 0, 0.5, 1.5, 2, 0.3);
        let gy = sdBox(lx, ly + e, 0, 0.5, 1.5, 2, 0.3) - sdBox(lx, ly - e, 0, 0.5, 1.5, 2, 0.3);
        const gl = Math.hypot(gx, gy);
        if (gl > 0) { gx /= gl; gy /= gl; } else { gx = gy = 0; }
        const rim = 1 - clamp(-dH / 0.32, 0, 1);
        let hm = (0.84 + 0.36 * rim * (gx * Llx + gy * Lly)) * (ly < -1.05 ? 1.08 : 1);
        if (ly > 1.5 && ly < 2.35 && Math.abs(lx) < 1.05) hm *= 0.76 + 0.24 * smooth(0.35, 0.55, ly * 4 - Math.floor(ly * 4));
        over(mul(body, hm), cov(dH));
        // the turret: a dome, the hatch's ring, its shadow on the hull
        const tqx = lx / 1.2, tqy = (ly - 0.6) / 1.15;
        const dT = sdBox(lx, ly, 0, 0.6, 1.15, 1.1, 0.75), dome = Math.sqrt(Math.max(0, 1 - tqx * tqx - tqy * tqy));
        let tm = 0.66 + 0.26 * dome + 0.4 * clamp(tqx * Llx + tqy * Lly, 0, 1);
        const dHa = Math.abs(Math.hypot(lx - 0.5, ly - 0.95) - 0.3) - 0.05;
        tm *= 1 - 0.35 * cov(dHa);
        dark(0.35 * clamp(0.5 - sdBox(lx - Llx * 0.25, ly - Lly * 0.25, 0, 0.6, 1.15, 1.1, 0.75) / 0.4, 0, 1) * (1 - cov(dT)));
        over(mul(body, tm), cov(dT));
        // the gun: the mantlet, the round barrel, the fume extractor, the muzzle brake
        over(mul(body, 0.6), cov(sdBox(lx, ly, 0, -0.55, 0.58, 0.28, 0.12)));
        const dB = sdBox(lx, ly, 0, -1.95, 0.24, 1.5, 0.2), dEv = sdBox(lx, ly, 0, -2.1, 0.35, 0.34, 0.18), dMz = sdBox(lx, ly, 0, -3.35, 0.38, 0.18, 0.08);
        const dG = Math.min(dB, dEv, dMz), w = dMz < 0 ? 0.38 : dEv < 0 ? 0.35 : 0.24;
        const cyl = clamp(1 - (lx / w) * (lx / w), 0, 1), gm = 0.56 * (0.5 + 0.65 * Math.sqrt(cyl)), sh = 0.1 * Math.pow(cyl, 6);
        over([body[0] * gm + sh, body[1] * gm + sh, body[2] * gm + sh], cov(dG));
        // the headlights (lit while the lamps shine - the setting Light)
        const dL = Math.min(Math.hypot(lx + 1.12, ly + 1.28), Math.hypot(lx - 1.12, ly + 1.28)) - 0.16;
        over(lamp ? [1, 0.94, 0.7] : [0.35, 0.33, 0.28], cov(dL));
      }
      const o = (py * N + px) * 4;
      if (A > 0) { img[o] = R / A * 255; img[o + 1] = G / A * 255; img[o + 2] = B / A * 255; img[o + 3] = A * 255; }
    }
  return img;
}

const cache = new Map();
// the sprite player p is drawn with (gfx-modern.js's sprite(): the extended engine's coloured ones, the classic one's
// kind = player) and the palette its view uses
const spriteOf = (e, p, dir) => e.extended ? e.extSprites && e.extSprites[p] && e.extSprites[p][dir & 7] : e.tankSprites && e.tankSprites[p] && e.tankSprites[p][dir & 7];
function palette(e, p) {
  const base = e.extended ? Display.EXT_PALETTE : Display.LORES_PALETTE;
  return Display.tankPalette8 ? Display.tankPalette8(base, e, p) : base;
}

function provider(engine, player) {
  return () => {
    const e = engine(), p = player();
    const sp0 = e && p > 0 ? spriteOf(e, p, 0) : null;
    if (!sp0 || !sp0.some(r => r.some(v => v !== 0x10 && v !== 0))) return null;   // (no sprites yet: initTables)
    const pal = palette(e, p), dir = e.tankDir[p] & 7;
    if (Gfx.mode() !== "modern") {
      const css = v => v === 0x10 ? null : "rgb(" + pal[v & 15].join(",") + ")";
      const key = "o" + p + ":" + pal.map(c => c.join(",")).join(";") + (e.extended ? "x" : "c");
      return { key, dir, paint: (cv, d) => {
        if (cv.style) Object.assign(cv.style, { imageRendering: "pixelated", width: "", height: "", margin: "" });
        Pads.paintPixels(cv, Array.from(spriteOf(e, p, d), r => Array.from(r, css)));
      } };
    }
    const set = Gfx.modern(), realistic = set.tanks !== "simple", lamp = set.light === "on";
    const col = v => pal[v & 15].map(c => c / 255);
    const body = col(sp0[4][2]), tread = col(sp0[1][1]), gun = col(sp0[0][3]);
    const key = "m" + (realistic ? "r" : "s") + (lamp ? "l" : "") + ":" + [body, tread, gun].join(";");
    return { key, dir, paint: (cv, d) => {
      const k = key + ":" + d;
      let img = cache.get(k);
      if (!img) { if (cache.size > 64) cache.clear(); img = modernTank(realistic, body, tread, gun, d, lamp); cache.set(k, img); }
      const ctx = cv.getContext && cv.getContext("2d");
      if (!ctx || !ctx.putImageData || typeof ImageData === "undefined") return;
      cv.width = N; cv.height = N;
      const big = (BIG * 100).toFixed(2) + "%", m = (-(BIG - 1) * 50).toFixed(2) + "%";
      if (cv.style) Object.assign(cv.style, { imageRendering: "auto", width: big, height: big, margin: m });
      ctx.putImageData(new ImageData(img, N, N), 0, 0);
    } };
  };
}

export const TankView = { provider, modernTank, N, HALF };
