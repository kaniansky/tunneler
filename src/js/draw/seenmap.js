// The map with the score while Tab is held (1.3, owner 2026-10-31: "a new setting to show map... show no map, show
// everything revealed, show only what the user has seen (keep in mind the line of sight) or what the team has seen (if
// there is a team)"; then: "show map everything should only reveal the map but not update from the enemy view.. the map
// should update only what the user/team sees... revealed but not currently seen parts of the map should be greyed out").
// engine.showMap (NetProto.SHOW_MAPS, a room / skirmish setting; display only - nothing here reaches the engine's state):
//   "own"      Seen by me: the map cells the viewer's tank has seen (its view window; with line of sight what that
//              showed), each as it was seen last (playscreen.js seenTrack - engine.seenCells / seenAt)
//   "team"     Seen by team: the same for the viewer's team, per cell the newest of its members' memories
//   "all"      Revealed: the whole world as the match started, changed only by what the viewer's tank sees
//   "allteam"  Revealed (team): the same, changed by what the viewer's team sees
// (owner, 2026-10-31: "Seen by me, Seen by team (if team exist), Revealed instead of Everything and Revealed (team)";
// the team ones without teammates: as the viewer's own)
// What one of them sees now in its colours, the rest gray (remembered); never seen a faint dark dither (1.3.1: not the
// background's black - the edge of what is known shows). Without the world's rock frame (as map pictures:
// MapData.FRAME cells on every side). Tanks: the viewer's team and
// the tanks one of them sees now. A cell of the map is 4 x 4 world pixels (the map editor's cell): rock gray, dirt in the
// game's browns, open floor in the ground's look (classic black, sand, grass), water blue. Bases: their walls in their
// tank's colour (once their middle cell is known); tanks: a 3 x 3 square in their colour, the viewer's own with a white
// edge.
//   SeenMap.picture(engine, viewer) -> {w, h, rgba} | null (no map: "off", not the extended engine, no viewer)
import { Display } from "./display.js";
import { MapData } from "../game/mapdata.js";
import { PlayScreen } from "./playscreen.js";

const OPEN = 1, DIRT = 2, ROCK = 3, WATER = 4;            // (seenCells: 0 = never seen)
const NOW = 2;                                           // (seen in the last NOW steps: "now" - in colour)
const UNSEEN = 30;                                       // (never seen: every other cell this dark gray, a hint of blue)

// does the team of `viewers` see world pixel (x, y) now? Line of sight off: inside a viewer's view window (its cam)
function seesNow(e, viewers, x, y) {
  for (const v of viewers) {
    if (!e.alive[v]) continue;
    if (e.sight && e.sight !== "full") { if (e.sightSees(v, x, y)) return true; continue; }
    const c = e.cams && e.cams[v];
    if (c && !c.noise && x >= c.x && x < c.x + 76 && y >= c.y && y < c.y + 71) return true;
  }
  return false;
}

function picture(e, viewer) {
  const mode = e && e.showMap;
  if (!e || !e.extended || !mode || mode === "off" || !viewer || !e.world) return null;
  const cw = e.worldW >> 2, ch = e.worldH >> 2, W = e.worldW, F = e.floor, g = e.groundType;
  // (the viewers: the viewer, its team too with "team" / "allteam")
  const team = (mode === "team" || mode === "allteam") && e.team ? e.teamMembers(e.team(viewer)) : [viewer];
  const viewers = team.length ? team : [viewer];
  const rgba = new Uint8ClampedArray(cw * ch * 4), pal = Display.EXT_PALETTE, L = PlayScreen.FLOOR_LOOK;
  // (gray: the colour's brightness, darker - as line of sight's memory)
  const put = (x, y, c, gray) => {
    if (x < 0 || y < 0 || x >= cw || y >= ch) return;
    const o = (y * cw + x) * 4, p = c < 0 ? Display.FLOOR_PALETTE[-c] : pal[c];
    if (gray) { const v = Math.round((p[0] * 0.3 + p[1] * 0.59 + p[2] * 0.11) * 0.7); rgba[o] = rgba[o + 1] = rgba[o + 2] = v; }
    else { rgba[o] = p[0]; rgba[o + 1] = p[1]; rgba[o + 2] = p[2]; }
    rgba[o + 3] = 255;
  };
  const look = (cls, cx, cy) => {
    if (cls === ROCK) return 7;
    if (cls === WATER) return -L.WATER;
    if (cls === DIRT) return MapData.dirtAt(cx, cy);
    const f = F ? F[(cy * 4 + 2) * W + cx * 4 + 2] : 0;
    const k = f === 3 ? L.SAND : PlayScreen.floorLook(f === 2 ? MapData.FLOOR.OPEN : f, cx, cy, g, true);
    return k ? -k : 0;
  };
  // the cells: the newest memory of the viewers (all / allteam: the start's world where none saw it yet)
  const known = new Uint8Array(cw * ch), best = new Uint32Array(cw * ch), now = (e.tick >>> 0) + 1 - NOW;
  for (const v of viewers) {
    const S = e.seenCells && e.seenCells[v], A = e.seenAt && e.seenAt[v];
    if (!S || S.length !== known.length) continue;
    for (let i = 0; i < S.length; i++) if (S[i] && (!known[i] || A[i] > best[i])) { best[i] = A[i]; known[i] = S[i]; }
  }
  const seen = i => best[i] && best[i] >= now;
  for (let cy = 0; cy < ch; cy++)
    for (let cx = 0; cx < cw; cx++) {
      const i = cy * cw + cx, k = known[i];
      if (k) put(cx, cy, look(k, cx, cy), !seen(i));
      else { const o = i * 4, v = (cx ^ cy) & 1 ? UNSEEN : 0; rgba[o] = rgba[o + 1] = v; rgba[o + 2] = v + (v >> 2); rgba[o + 3] = 255; }
    }
  // the bases: walls 17 px from the middle (4 cells), the doorways at the top and the bottom
  for (let p = 1; p <= e.nPlayers; p++) {
    const bx = e.baseX[p] >> 2, by = e.baseY[p] >> 2, i = by * cw + bx;
    if (!known[i]) continue;
    const c = e.playerColor(p), gray = !seen(i);
    for (let d = -4; d <= 4; d++) {
      if (d) { put(bx + d, by - 4, c, gray); put(bx + d, by + 4, c, gray); }
      put(bx - 4, by + d, c, gray); put(bx + 4, by + d, c, gray);
    }
  }
  // the tanks: the viewers and the ones they see now
  const shown = [];
  for (let p = 1; p <= e.nPlayers; p++)
    if (e.alive[p] && (viewers.includes(p) || seesNow(e, viewers, e.tankX[p], e.tankY[p]))) shown.push(p);
  shown.sort((a, b) => (a === viewer) - (b === viewer));   // (the viewer's own on top)
  for (const p of shown) {
    const tx = e.tankX[p] >> 2, ty = e.tankY[p] >> 2, c = e.playerColor(p);
    if (p === viewer) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) put(tx + dx, ty + dy, 15);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) put(tx + dx, ty + dy, c);
  }
  // (without the rock frame round the world: MapData.FRAME cells on every side)
  const K = Math.min(MapData.FRAME[e.size] || 0, (Math.min(cw, ch) >> 1) - 1), w = cw - 2 * K, h = ch - 2 * K;
  if (K <= 0) return { w: cw, h: ch, rgba };
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) out.set(rgba.subarray(((y + K) * cw + K) * 4, ((y + K) * cw + K + w) * 4), y * w * 4);
  return { w, h, rgba: out };
}

export const SeenMap = { picture };
