// A custom map as a small picture (the map gallery and the map picker's preview, docs/v6/MAPS.md - owner, 2026-10-28):
// one pixel per map cell - tunnels black, dirt in the game's two browns, rock gray, each base a square of its tank
// colour with a black inside - as {w, h, rgba} for a DOS screen's picture region (DosUI spec.pic: Display and
// gfx-text.js draw it, square on the screen); without the map's rock frame (owner, 2026-10-28: the picture's own box
// is its border). Kept per map code. Water and ground (1.3, owner 2026-10-31): water cells in the water's colour,
// tunnels in the ground's look (classic black, sand, grass), sand beside water (the shore) and inside the bases on
// sand / grass (the engine digs them out: dug floor is sand) - playscreen.js FLOOR_LOOK, display.js's floor colours.
import { Display } from "./display.js";
import { MapData } from "../game/mapdata.js";
import { TunnelerEngine } from "../game/engine.js";
import { PlayScreen } from "./playscreen.js";

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
  // (c: a palette entry; -L: floor look L)
  const put = (x, y, c) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const o = (y * w + x) * 4, p = c < 0 ? Display.FLOOR_PALETTE[-c] : pal[c];
    rgba[o] = p[0]; rgba[o + 1] = p[1]; rgba[o + 2] = p[2]; rgba[o + 3] = 255;
  };
  const L = PlayScreen.FLOOR_LOOK, g = map.ground, cells = map.cells;
  const wet = (x, y) => x >= 0 && y >= 0 && x < map.w && y < map.h && cells[y * map.w + x] === MapData.WATER;
  const open = (mx, my) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (wet(mx + dx, my + dy)) return -L.SAND;
    const f = PlayScreen.floorLook(MapData.FLOOR.OPEN, mx, my, g, true);
    return f ? -f : 0;
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const mx = x + k, my = y + k, v = cells[my * map.w + mx];
      put(x, y, v === MapData.ROCK ? 7 : v === MapData.WATER ? -L.WATER : v === MapData.TUNNEL ? open(mx, my) : MapData.dirtAt(mx, my));
    }
  // a base: its walls (35 world pixels = ~9 cells a side) in its colour, black inside (sand / grass: sand)
  const inside = g === "sand" || g === "grass" ? -L.SAND : 0;
  map.bases.forEach((b, i) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) put(b.x - k + dx, b.y - k + dy, Math.abs(dx) === 4 || Math.abs(dy) === 4 ? BASE_COLORS[i] : inside);
  });
  const pic = { w, h, rgba };
  if (cache.size > 64) cache.delete(cache.keys().next().value);
  cache.set(key, pic);
  return pic;
}

export const MapPic = { of };
