// A custom map as a small picture (the map gallery and the map picker's preview, docs/v6/MAPS.md - owner, 2026-10-28):
// one pixel per map cell - tunnels black, dirt in the game's two browns, rock gray, each base a square of its tank
// colour with a black inside - as {w, h, rgba} for a DOS screen's picture region (DosUI spec.pic: Display and
// gfx-text.js draw it, square on the screen); without the map's rock frame (owner, 2026-10-28: the picture's own box
// is its border). Kept per map code.
import { Display } from "./display.js";
import { MapData } from "../game/mapdata.js";
import { TunnelerEngine } from "../game/engine.js";

const cache = new Map();
const BASE_COLORS = TunnelerEngine.PLAYER_COLORS;           // base i in tank colour i (extended palette)

function of(map) {
  if (!map) return null;
  const key = MapData.code(map);
  if (cache.has(key)) return cache.get(key);
  // (the frame's cells across, from the left edge on the middle row: cut off)
  let F = 0;
  while (F < map.w >> 1 && MapData.inFrame(map.size, F, map.h >> 1)) F++;
  const k = F, w = map.w - 2 * k, h = map.h - 2 * k;
  const pal = Display.EXT_PALETTE, rgba = new Uint8ClampedArray(w * h * 4);
  const put = (x, y, c) => { if (x < 0 || y < 0 || x >= w || y >= h) return; const o = (y * w + x) * 4, p = pal[c]; rgba[o] = p[0]; rgba[o + 1] = p[1]; rgba[o + 2] = p[2]; rgba[o + 3] = 255; };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const mx = x + k, my = y + k, v = map.cells[my * map.w + mx];
      put(x, y, v === MapData.ROCK ? 7 : v === MapData.TUNNEL ? 0 : MapData.dirtAt(mx, my));
    }
  // a base: its walls (35 world pixels = ~9 cells a side) in its colour, black inside
  map.bases.forEach((b, i) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) put(b.x - k + dx, b.y - k + dy, Math.abs(dx) === 4 || Math.abs(dy) === 4 ? BASE_COLORS[i] : 0);
  });
  const pic = { w, h, rgba };
  if (cache.size > 64) cache.delete(cache.keys().next().value);
  cache.set(key, pic);
  return pic;
}

export const MapPic = { of };
