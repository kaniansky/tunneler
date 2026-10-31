// Graphics "modern" (docs/GRAPHICS.md 5, 9, 10): the view windows of the play screen and the world maps,
// drawn from the live world at the output's resolution:
// - terrain: the contour upscaler over material classes (tunnel / dirt / rock / base walls) - smooth or
//   pixel edges; textured, smooth or flat surfaces; tunnels darker near their walls
// - light (dark tunnels lit by the tanks' lamps and headlights, shots, explosion flashes), glow (shots,
//   embers, anything that isn't terrain - game modes' objects)
// - tanks as vector shapes (treads, body, turret, gun, shadow) in their sprite's colours; with the smooth
//   camera they glide between engine steps and turn smoothly, and the view follows them exactly
// - particles (dust, sparks, fire, debris, smoke - from engine.fx), screen shake
// - line of sight: what the player remembers (engine.sightMem) in fog - blurred, dark or gray
// - the static at low energy as noise
// - water and ground (1.3, engine.floor): animated water, sand / grass floors, splashes
// Display only: reads the engine (world, floor, tanks, shots, sprites, cams, fx, sight memory; sightView only
// fills its own scratch buffers) and never writes it; the particles' randomness is Math.random.
import { Display } from "./display.js";
import { MapData } from "../game/mapdata.js";
import { TunnelerEngine } from "../game/engine.js";
import { Gfx } from "./gfx.js";
import { Debug } from "../ui/debug.js";
const root = globalThis;

const VS = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
uniform usampler2D uWorld;    // world bytes (2 pixels each, odd x in the high nibble), tanks taken out
uniform sampler2D uVis;       // line of sight: 76 x 71, 1 = seen now (uVisOn)
uniform ivec2 uWorldPx;       // world size in pixels
uniform int uRowOff, uRows;   // the texture's first world row and its height (sight memory: a band)
uniform int uOutside;         // colour outside the texture (world: rock 7, a memory band: black 0)
uniform vec2 uSize, uOut;     // source canvas (dots), output (device pixels)
uniform vec4 uWin;            // the area in the source canvas: x, y, w, h (dots)
uniform vec2 uCam;            // world position at its top left
uniform vec2 uScale;          // world pixels per dot
uniform vec3 uPal[16];
uniform int uCls[16];         // colour -> 0 tunnel, 1 dirt, 2 rock, 3 base wall, 4 shot / ember, 5 shot trail, 6 other
uniform int uTerrain, uEdges, uGlow, uLight, uFog, uVisOn, uStatic, uMap;
uniform ivec2 uVisOrg;
uniform float uTime;
uniform int uNT;
uniform vec4 uTank[8];        // x, y, angle (radians), lamp (1 = its headlight shines)
uniform vec3 uTankCol[24];    // per tank: body, treads, gun
uniform float uTread[8];      // per tank: how far it has driven (world pixels) - its treads roll with it
uniform float uTS;            // tank size
uniform int uTankStyle;       // 0 simple shapes, 1 realistic (setting Tanks)
uniform int uNL;
uniform vec4 uLt[32];         // lights: x, y, radius, intensity
uniform int uNS;
uniform vec4 uShot[48];       // shells in flight: x, y, direction x, y (the engine draws and erases them within a frame)
uniform vec3 uLc[32];
uniform int uNTL;             // the first uNTL lights are the tanks' lamps (uTank's order)
uniform int uLMOn;            // the tanks' light masks (LMFS): their lamps and headlights stop at rock, walls, dirt
uniform sampler2D uLM;        // ... one LM_N x LM_N square per player (slot), its tank in the middle
uniform vec2 uLMC[8];         // ... per slot: the world point its middle texel is
uniform int uTSlot[8];        // ... per tank (uTank's order): its slot, -1 none
uniform int uDepth;           // 3D (setting Depth): the world as a heightfield, seen from straight above (uEye)
uniform vec3 uEye;            // 3D: the camera - world pixels, z its height above the tunnels' floor
uniform sampler2D uH;         // 3D, smooth edges: the terrain's heights around the view (HFS), height / HSCALE
uniform vec4 uHRect;          // ... its world rectangle: x, y, w, h
uniform sampler2D uHA;        // 3D: the heights per world pixel (HAFS) - voxel blocks
uniform vec4 uARect;          // ... its world rectangle
uniform usampler2D uFloor;    // water and ground (1.3): engine.floor, 2 pixels a byte as uWorld (the whole world)
uniform int uFloorOn;         // ... 0: no floor (no water, classic ground - every world before 1.3: drawn as before)
uniform int uGround;          // ... the map's ground: 0 classic, 1 sand, 2 grass
uniform int uMemSeen;         // ... a memory band: its green channel says which pixels the player has ever seen
out vec4 outColor;

// 3D: the heights of the materials (world pixels): dirt, rock, base walls; tanks below (tankH)
const float HD = 3.0, HR = 3.75, HW = 3.5, HMAX = 3.75, HSCALE = 4.0, SHOT_H = 1.6;   // (owner, 2026-10-28: half of the first ones)
const float LM_R = 52.0, LM_N = 105.0;                    // the light masks: radius (a headlight's reach), size
const vec3 SUN = vec3(-0.45, -0.55, 0.7);                 // (normalized below) the light the 3D shapes are shaded by

int colAt(ivec2 g) {
  // (outside the world: rock live, nothing in the memory - the remembered view drew rock past the world's edge, a
  // border far beyond the real one, the map's rock frame)
  if (g.x < 0 || g.y < 0 || g.x >= uWorldPx.x || g.y >= uWorldPx.y) return uOutside;
  int r = g.y - uRowOff;
  if (r < 0 || r >= uRows) return uOutside;
  uint b = texelFetch(uWorld, ivec2(g.x >> 1, r), 0).r;
  return int((g.x & 1) == 1 ? (b >> 4) & 15u : b & 15u);
}
int shapeOf(int cls) { return cls >= 4 ? 0 : cls; }
// water and ground (1.3; owner, 2026-10-31): how an open pixel at g looks - 0 dark (the classic tunnel), 1 sand, 2
// grass, 3 water: water; the shore (within 3 px of water) sand on every ground; open from the start the map's ground;
// dug since - dark on classic ground, sand on sand / grass. A memory: what the player never saw stays dark (the fog
// doesn't give the lakes or the ground away)
int lookAt(ivec2 g) {
  if (uFloorOn == 0 || g.x < 0 || g.y < 0 || g.x >= uWorldPx.x || g.y >= uWorldPx.y) return 0;
  if (uMemSeen == 1) {
    int r = g.y - uRowOff;
    if (r < 0 || r >= uRows || ((texelFetch(uWorld, ivec2(g.x >> 1, r), 0).g >> uint(g.x & 1)) & 1u) == 0u) return 0;
  }
  uint b = texelFetch(uFloor, ivec2(g.x >> 1, g.y), 0).r;
  int f = int((g.x & 1) == 1 ? (b >> 4) & 15u : b & 15u);
  return f == 1 ? 3 : f == 3 ? 1 : f == 2 ? uGround : uGround == 0 ? 0 : 1;
}
// (set by terrainAt for shade: the open floor's looks around - dark, sand, grass weights -, how much water is around)
vec3 gLook = vec3(1.0, 0.0, 0.0);
float gWet = 0.0;
// how much of tank i's own light reaches world position wp (its light mask; 1 without one)
float lmask(int i, vec2 wp) {
  int s = uLMOn == 1 ? uTSlot[i] : -1;
  if (s < 0) return 1.0;
  vec2 q = wp - uLMC[s] + LM_R + 0.5;
  if (q.x < 0.5 || q.y < 0.5 || q.x > LM_N - 0.5 || q.y > LM_N - 0.5) return 0.0;
  return texture(uLM, vec2((float(s) * LM_N + q.x) / (8.0 * LM_N), q.y / LM_N)).r;
}
// how much of world position wp the player sees now (0..1, soft at the edge; pixel edges: 0 or 1)
float seenAmt(vec2 wp) {
  if (uVisOn == 0) return 1.0;
  if (uEdges == 1) {
    ivec2 v = ivec2(floor(wp)) - uVisOrg;
    if (v.x < 0 || v.y < 0 || v.x >= 76 || v.y >= 71) return 0.0;
    return texelFetch(uVis, v, 0).r;
  }
  return texture(uVis, (wp - vec2(uVisOrg)) / vec2(76.0, 71.0)).r;
}

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float mn(float x) {
  x = abs(x);
  return x < 1.0 ? (7.0 * x * x * x - 12.0 * x * x + 16.0 / 3.0) / 6.0
       : x < 2.0 ? (-7.0 / 3.0 * x * x * x + 12.0 * x * x - 20.0 * x + 32.0 / 3.0) / 6.0 : 0.0;
}
float fbm3(vec2 p) { return vnoise(p) * 0.55 + vnoise(p * 2.07 + 5.3) * 0.28 + vnoise(p * 4.13 + 11.7) * 0.17; }
vec4 kern(float t) { return vec4(mn(1.0 + t), mn(t), mn(1.0 - t), mn(2.0 - t)); }

// water (1.3): still, deep blue - two slow wave trains drifting across it (uTime), lighter where they rise, their slopes
// the normal (glints of the light from the top left), lighter and foamy along the bank (gWet: how much water is around).
// A deep, grayish blue: darker than the blue / sky tanks and every base wall
float wave(vec2 p, float t) { return vnoise(p + vec2(t * 0.23, t * 0.08)) * 0.65 + vnoise(p * 1.73 - vec2(t * 0.12, t * 0.3) + 7.7) * 0.35; }
vec3 water(vec2 wp) {
  vec3 deep = vec3(0.035, 0.10, 0.26), lite = vec3(0.10, 0.25, 0.46);
  float t = uTime, amp = uTerrain == 0 ? 5.0 : uTerrain == 1 ? 3.0 : 0.0;
  vec2 p = wp * (uTerrain == 2 ? 0.08 : 0.12);
  float h = wave(p, t), hx = wave(p + vec2(0.05, 0.0), t), hy = wave(p + vec2(0.0, 0.05), t);
  vec3 n = normalize(vec3((h - hx) * amp / 0.05 * 0.04, (h - hy) * amp / 0.05 * 0.04, 1.0));
  vec3 col = uTerrain == 2 ? mix(deep, lite, 0.3 + 0.25 * step(0.6, h)) : mix(deep, lite, smoothstep(0.25, 0.85, h));
  // (faint lighter crests where the waves rise through one height - the ripples; a glint where a slope faces the light)
  if (uTerrain != 2) {
    col += vec3(0.05, 0.10, 0.12) * (1.0 - smoothstep(0.0, 0.06, abs(h - 0.62)));
    col *= 0.96 + 0.08 * vnoise(wp * 0.8 + vec2(t * 0.4, -t * 0.2));
  }
  col += vec3(0.5, 0.65, 0.75) * pow(clamp(dot(n, normalize(vec3(-0.12, -0.16, 0.98))), 0.0, 1.0), 40.0) * 0.35;
  float bank = 1.0 - smoothstep(0.45, 0.85, gWet);
  float foam = bank * (uTerrain == 2 ? 0.7 : 0.5 + 0.5 * vnoise(wp * 1.4 + vec2(t * 0.6, -t * 0.4)));
  return mix(col, vec3(0.50, 0.62, 0.66), foam * 0.5);
}
// sand (pale, fine-grained beige: wind ripples, grains) and grass (a muted, yellowish olive: tufts, patches) - looks only
vec3 sand(vec2 wp, float n, float grain) {
  vec3 c = vec3(0.80, 0.70, 0.47) * (0.92 + 0.16 * n);
  if (uTerrain == 0) c *= (1.0 + grain * 0.16) * (0.97 + 0.05 * sin(wp.x * 0.8 + wp.y * 0.45 + n * 4.0));
  return c;
}
vec3 grass(vec2 wp, float n, float grain) {
  vec3 c = mix(vec3(0.32, 0.37, 0.14), vec3(0.44, 0.47, 0.20), uTerrain == 2 ? 0.5 : n);
  if (uTerrain == 0) c *= (1.0 + grain * 0.3) * (0.9 + 0.2 * vnoise(wp * 0.11 + 23.0));
  return c;
}

// a material's colour at world position wp; c: the colour index it comes from, open: how much tunnel is
// around (0..1), tone: how much of the dirt around is the light kind
vec3 shade(int cls, int c, vec2 wp, float open, float tone) {
  float n = 0.5, grain = 0.0;
  if (uTerrain == 0) { n = vnoise(wp * 0.7) * 0.6 + vnoise(wp * 2.3) * 0.4; grain = hash(floor(wp * 3.0)) - 0.5; }
  else if (uTerrain == 1) n = vnoise(wp * 0.25);
  if (cls == 0) {
    vec3 t = vec3(0.085, 0.07, 0.06) * (0.85 + 0.3 * n);
    float dk = mix(0.35, 1.0, smoothstep(0.35, 0.95, open));          // darker close to the walls
    if (uFloorOn == 1 && gLook.x < 1.0) {                              // (sand / grass: in shade near the walls too)
      t = t * gLook.x + sand(wp, n, grain) * gLook.y + grass(wp, n, grain) * gLook.z;
      dk = mix(dk, mix(0.55, 1.0, smoothstep(0.3, 0.95, open)), 1.0 - gLook.x);
    }
    return t * dk;
  }
  if (cls == 4) return water(wp);
  if (cls == 1) {
    vec3 d = uTerrain == 2 ? (tone > 0.5 ? uPal[6] : uPal[8]) * 0.95
      : mix(vec3(0.50, 0.25, 0.05), vec3(0.72, 0.45, 0.20), clamp(tone * 0.55 + n * 0.6 - 0.1, 0.0, 1.0));
    d *= 1.0 + grain * 0.12;
    return d * (1.0 - 0.45 * smoothstep(0.0, 0.5, open));             // the edge of a tunnel in shadow
  }
  if (cls == 2) {
    if (uTerrain != 0) {
      float r = uTerrain == 2 ? 0.55 : 0.42 + 0.22 * n;
      return vec3(r * 0.97, r, r * 1.04) * (1.0 - 0.35 * smoothstep(0.0, 0.5, open));
    }
    // textured (owner, 2026-10-26: "more like a rock"): a warped, layered height - lumps and facets lit from the top
    // left -, a few long thin cracks in some places only, mineral grains, a warm / cool cast
    vec2 q = wp * 0.16;
    vec2 w = vec2(vnoise(q * 0.7 + 2.3), vnoise(q * 0.7 + 9.1)) * 0.9;
    float h = fbm3(q + w), hx = fbm3(q + w + vec2(0.11, 0.0)), hy = fbm3(q + w + vec2(0.0, 0.11));
    vec3 nrm = normalize(vec3((h - hx) * 7.0, (h - hy) * 7.0, 1.0));
    float lit = clamp(dot(nrm, normalize(vec3(-0.45, -0.55, 0.7))), 0.0, 1.0);
    float crack = smoothstep(0.0, 0.03, abs(vnoise(q * 0.9 + w * 0.9 + 19.0) - 0.5));
    crack = mix(1.0, crack, smoothstep(0.5, 0.7, vnoise(q * 0.35 + 50.0)));
    float speck = hash(floor(wp * 2.0));
    vec3 rk = mix(vec3(0.27, 0.26, 0.25), vec3(0.58, 0.57, 0.54), h);
    rk *= mix(vec3(0.96, 0.98, 1.03), vec3(1.05, 1.0, 0.93), vnoise(q * 0.45 + 31.0));
    rk *= (0.62 + 0.62 * lit) * (0.86 + 0.28 * speck) * mix(0.5, 1.0, crack);
    return rk * (1.0 - 0.35 * smoothstep(0.0, 0.5, open));
  }
  return uPal[c] * 1.05;                                                // base walls
}

float sdBox(vec2 p, vec2 c, vec2 h, float r) {
  vec2 d = abs(p - c) - h + r;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r;
}

// the terrain's colour at world position wp (pw: output pixels per world pixel; vis: seen now) -> col, and the
// shape it shows (bs: 0 tunnel, 1 dirt, 2 rock, 3 base wall, 4 water - open floor too, at the same height)
vec3 terrainAt(vec2 wp, float pw, bool vis, out int bs) {
  // terrain: the contour upscaler over material shapes (tunnel / dirt / rock / walls), or plain pixels
  int bc, ss, sc2;
  float best = 1.0, second = -9.0, open = 0.0, tone = 0.5;
  vec2 tp = wp;                                          // (where the surfaces are textured)
  if (uEdges == 1) {
    ivec2 g = ivec2(floor(wp));
    bc = colAt(g); bs = shapeOf(uCls[bc]);
    if (bs == 0 && uFloorOn == 1) {                       // (water and ground: this pixel's look)
      int lk = lookAt(g);
      if (lk == 3) bs = 4;
      gLook = lk == 1 ? vec3(0.0, 1.0, 0.0) : lk == 2 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
    }
    ss = bs; sc2 = bc;
    tp = floor(wp) + 0.5;
    float o = 0.0, l = 0.0, d = 0.0, wt = 0.0;
    for (int y = -1; y <= 1; y++)
      for (int x = -1; x <= 1; x++) {
        int c = colAt(g + ivec2(x, y)), m = shapeOf(uCls[c]);
        if (m == 0) { o += 1.0 / 9.0; if (uFloorOn == 1 && lookAt(g + ivec2(x, y)) == 3) wt += 1.0 / 9.0; }
        if (m == 1) { d += 1.0; if (c == 6) l += 1.0; }
      }
    open = o; tone = d > 0.0 ? l / d : 0.5; gWet = wt;
  } else {
    vec2 q = wp - 0.5, b = floor(q), t = q - b;
    vec4 wx = kern(t.x), wy = kern(t.y);
    ivec2 base = ivec2(b);
    int cs[16], sh[16];
    float w[16], light = 0.0, dirt = 0.0;
    vec3 lw = vec3(0.0);                                  // (water and ground: the open floor's looks around, water)
    float wt = 0.0;
    for (int y = 0; y < 4; y++)
      for (int x = 0; x < 4; x++) {
        int k = y * 4 + x, c = colAt(base + ivec2(x - 1, y - 1));
        cs[k] = c; sh[k] = shapeOf(uCls[c]); w[k] = wx[x] * wy[y];
        if (sh[k] == 0 && uFloorOn == 1) {
          int lk = lookAt(base + ivec2(x - 1, y - 1));
          if (lk == 3) { sh[k] = 4; wt += w[k]; }
          else lw += (lk == 1 ? vec3(0.0, 1.0, 0.0) : lk == 2 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0)) * max(w[k], 0.0);
        }
        if (sh[k] == 0 || sh[k] == 4) open += w[k];
        if (sh[k] == 1) { dirt += w[k]; if (c == 6) light += w[k]; }
      }
    tone = dirt > 0.0 ? light / dirt : 0.5;
    if (uFloorOn == 1) { gWet = wt; float s = lw.x + lw.y + lw.z; gLook = s > 0.0 ? lw / s : vec3(1.0, 0.0, 0.0); }
    const int cand[4] = int[4](5, 6, 9, 10);
    best = -9.0;
    bs = sh[5]; bc = cs[5]; ss = sh[5]; sc2 = cs[5];
    for (int i = 0; i < 4; i++) {
      int k = cand[i], m = sh[k];
      if (i > 0 && m == bs) continue;
      float sum = 0.0;
      for (int j = 0; j < 16; j++) sum += sh[j] == m ? w[j] : 0.0;
      if (sum > best) { second = best; ss = bs; sc2 = bc; best = sum; bs = m; bc = cs[k]; }
      else if (sum > second) { second = sum; ss = m; sc2 = cs[k]; }
    }
  }
  open = clamp(open, 0.0, 1.0);
  vec3 col = shade(bs, bc, tp, open, tone);
  // (fog "blurred": soft edges)
  float edge = vis || uFog != 0 ? pw * 0.5 : 0.35;
  if (second > -1.0) col = mix(shade(ss, sc2, tp, open, tone), col, clamp(0.5 + (best - second) * edge, 0.0, 1.0));

  return col;
}

// the tanks drawn over col at world position wp (their shadows too)
vec3 tanksAt(vec3 col, vec2 wp, float pw) {
  float aa = 1.0 / pw;
  for (int i = 0; i < 8; i++) {
    if (i >= uNT) break;
    vec2 d = (wp - (uTank[i].xy + 0.5)) / uTS;
    if (dot(d, d) > 30.0) continue;
    float a = uTank[i].z;
    vec2 f = vec2(sin(a), -cos(a)), r = vec2(cos(a), sin(a));
    vec2 l = vec2(dot(d, r), -dot(d, f));                // u to the right, v backwards (forward = -v)
    vec2 ls = vec2(dot(d - vec2(0.45, 0.6), r), -dot(d - vec2(0.45, 0.6), f));
    float ta = aa / uTS;
    float sr = uTankStyle == 0 ? 0.0 : 1.0;                // (the simple tank's shadow square too)
    float dShadow = min(sdBox(ls, vec2(0.0, 0.5), vec2(2.5, 3.0), 0.8 * sr), sdBox(ls, vec2(0.0, -1.8), vec2(0.35, 1.8), 0.3 * sr));
    col *= 1.0 - 0.5 * clamp(0.5 - dShadow / 1.2, 0.0, 1.0);
    vec3 body = uTankCol[i * 3], tread = uTankCol[i * 3 + 1], gun = uTankCol[i * 3 + 2];
    if (uTankStyle == 0) {
      // simple: flat shapes, square corners (owner, 2026-10-26: no rounded corners)
      // (the tracks 1.6 .. 2.43 out, the body to them - as wide as the game's sprite: measured against it, owner 2026-10-26)
      float dTr = min(sdBox(l, vec2(-2.015, 0.5), vec2(0.415, 3.05), 0.0), sdBox(l, vec2(2.015, 0.5), vec2(0.415, 3.05), 0.0));
      float stripe = 0.82 + 0.25 * step(0.5, fract((l.y + uTread[i] / uTS) * 1.6));
      col = mix(col, tread * stripe, clamp(0.5 - dTr / ta, 0.0, 1.0));
      float dBody = sdBox(l, vec2(0.0, 0.5), vec2(1.6, 2.05), 0.0);
      vec3 bc3 = body * (1.15 - 0.3 * clamp((l.y + 1.5) / 4.0, 0.0, 1.0));
      col = mix(col, bc3, clamp(0.5 - dBody / ta, 0.0, 1.0));
      float dTur = sdBox(l, vec2(0.0, 0.6), vec2(0.95, 0.95), 0.0);
      vec3 tc = body * 0.78 + 0.25 * (1.0 - smoothstep(0.0, 0.9, length(l - vec2(-0.35, 0.25))));
      col = mix(col, tc, clamp(0.5 - dTur / ta, 0.0, 1.0));
      float dGun = sdBox(l, vec2(0.0, -1.75), vec2(0.34, 1.85), 0.0);
      col = mix(col, gun * (1.0 - 0.2 * clamp(-l.y / 3.5, 0.0, 1.0)), clamp(0.5 - dGun / ta, 0.0, 1.0));
      continue;
    }
    // realistic (setting Tanks - owner, 2026-10-26): the same layout - two tracks, the hull between them, the
    // turret, the gun - as steel links, a bevelled armor plate with an engine deck, a cast turret with a hatch and a
    // round barrel; lit from the top left, fixed in the world (the light doesn't turn with the tank)
    vec2 Lw = normalize(vec2(-0.6, -0.8)), Ll = vec2(dot(Lw, r), -dot(Lw, f));
    // the tracks: links rolling with the tank (uTread), the guide teeth along the middle
    // (owner, 2026-10-26: as long as the game's sprite - measured against it: tracks -2.51 .. 3.51, hull -1.5 .. 2.5,
    // the gun to -3.53; the gun thicker)
    float dTr = min(sdBox(l, vec2(-2.0, 0.5), vec2(0.64, 3.01), 0.5), sdBox(l, vec2(2.0, 0.5), vec2(0.64, 3.01), 0.5));
    float side = clamp(abs(abs(l.x) - 2.0) / 0.64, 0.0, 1.0);
    float link = fract((l.y + uTread[i] / uTS) * 2.4);
    float gap = smoothstep(0.0, 0.14, link) * smoothstep(1.0, 0.8, link);
    vec3 steel = vec3(0.24, 0.235, 0.23) * (0.5 + 0.5 * gap) * (1.12 - 0.5 * side * side);
    steel += vec3(0.07) * (1.0 - smoothstep(0.0, 0.18, abs(side - 0.5))) * gap;
    col = mix(col, steel, clamp(0.5 - dTr / ta, 0.0, 1.0));
    // the hull: its edges bevelled (lit or in shadow by which way they face), the front plate, the engine deck's slats
    vec2 hc = vec2(0.0, 0.5), hh = vec2(1.5, 2.0);
    float e = 0.06, dH = sdBox(l, hc, hh, 0.3);
    vec2 g = vec2(sdBox(l + vec2(e, 0.0), hc, hh, 0.3) - sdBox(l - vec2(e, 0.0), hc, hh, 0.3),
                  sdBox(l + vec2(0.0, e), hc, hh, 0.3) - sdBox(l - vec2(0.0, e), hc, hh, 0.3));
    g = dot(g, g) > 0.0 ? normalize(g) : vec2(0.0);
    float rim = 1.0 - clamp(-dH / 0.32, 0.0, 1.0);
    vec3 hull = body * (0.84 + 0.36 * rim * dot(g, Ll)) * (l.y < -1.05 ? 1.08 : 1.0);
    if (l.y > 1.5 && l.y < 2.35 && abs(l.x) < 1.05) hull *= 0.76 + 0.24 * smoothstep(0.35, 0.55, fract(l.y * 4.0));
    col = mix(col, hull, clamp(0.5 - dH / ta, 0.0, 1.0));
    // the turret: lit like a dome, a ring for the commander's hatch
    vec2 tcn = vec2(0.0, 0.6), tq = (l - tcn) / vec2(1.2, 1.15);
    float dT = sdBox(l, tcn, vec2(1.15, 1.1), 0.75), dome = sqrt(max(0.0, 1.0 - dot(tq, tq)));
    vec3 tur = body * (0.66 + 0.26 * dome + 0.4 * clamp(dot(tq, Ll), 0.0, 1.0));
    float dHa = abs(length(l - tcn - vec2(0.5, 0.35)) - 0.3) - 0.05;
    tur *= 1.0 - 0.35 * clamp(0.5 - dHa / ta, 0.0, 1.0);
    col *= 1.0 - 0.35 * clamp(0.5 - sdBox(l - Ll * 0.25, tcn, vec2(1.15, 1.1), 0.75) / 0.4, 0.0, 1.0) * (1.0 - clamp(0.5 - dT / ta, 0.0, 1.0));
    col = mix(col, tur, clamp(0.5 - dT / ta, 0.0, 1.0));
    // the gun: the mantlet, the barrel (round: bright along its middle), the fume extractor, the muzzle brake
    float dM = sdBox(l, vec2(0.0, -0.55), vec2(0.58, 0.28), 0.12);
    col = mix(col, body * 0.6, clamp(0.5 - dM / ta, 0.0, 1.0));
    float dB = sdBox(l, vec2(0.0, -1.95), vec2(0.24, 1.5), 0.2);
    float dEv = sdBox(l, vec2(0.0, -2.1), vec2(0.35, 0.34), 0.18);
    float dMz = sdBox(l, vec2(0.0, -3.35), vec2(0.38, 0.18), 0.08);
    float dG = min(dB, min(dEv, dMz)), wdt = dMz < 0.0 ? 0.38 : dEv < 0.0 ? 0.35 : 0.24;
    float cyl = clamp(1.0 - (l.x / wdt) * (l.x / wdt), 0.0, 1.0);
    vec3 gc = body * 0.56 * (0.5 + 0.65 * sqrt(cyl)) + vec3(0.1) * pow(cyl, 6.0);
    col = mix(col, gc, clamp(0.5 - dG / ta, 0.0, 1.0));
    // the headlights (on while its lamp shines)
    float dL = min(length(l - vec2(-1.12, -1.28)), length(l - vec2(1.12, -1.28))) - 0.16;
    col = mix(col, uTank[i].w > 0.5 ? vec3(1.0, 0.94, 0.7) : vec3(0.35, 0.33, 0.28), clamp(0.5 - dL / ta, 0.0, 1.0));
  }
  return col;
}

// 3D: a tank's height at world position wp (its tracks, hull, turret and gun; 0 = no tank there)
float tankH(vec2 wp) {
  float h = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= uNT) break;
    vec2 d = (wp - (uTank[i].xy + 0.5)) / uTS;
    if (dot(d, d) > 30.0) continue;
    float a = uTank[i].z;
    vec2 f = vec2(sin(a), -cos(a)), r = vec2(cos(a), sin(a));
    vec2 l = vec2(dot(d, r), -dot(d, f));
    if (min(sdBox(l, vec2(-2.0, 0.5), vec2(0.5, 3.03), 0.0), sdBox(l, vec2(2.0, 0.5), vec2(0.5, 3.03), 0.0)) < 0.0) h = max(h, 1.0);
    if (sdBox(l, vec2(0.0, 0.5), vec2(1.55, 2.0), 0.0) < 0.0) h = max(h, 1.35);
    if (sdBox(l, vec2(0.0, 0.6), vec2(1.0, 1.0), 0.0) < 0.0) h = max(h, 2.0);
    if (sdBox(l, vec2(0.0, -1.75), vec2(0.3, 1.85), 0.0) < 0.0) h = max(h, 1.75);
  }
  return h * uTS;
}
// 3D: the terrain's height - voxel blocks (pixel edges: each world pixel its material's height) or sculpted (smooth
// edges: between the pixels' heights, steep in the middle)
float hOf(int c) { int k = uCls[c]; return k == 1 ? HD : k == 2 ? HR : k == 3 ? HW : 0.0; }
float terrH(vec2 wp) {
  if (uEdges == 1) {
    ivec2 a = ivec2(floor(wp - uARect.xy));
    if (uARect.z > 0.0 && a.x >= 0 && a.y >= 0 && a.x < int(uARect.z) && a.y < int(uARect.w)) return texelFetch(uHA, a, 0).r * HSCALE;
    return hOf(colAt(ivec2(floor(wp))));
  }
  vec2 hq = (wp - uHRect.xy) / uHRect.zw;
  if (uHRect.z > 0.0 && hq.x >= 0.0 && hq.y >= 0.0 && hq.x <= 1.0 && hq.y <= 1.0) return texture(uH, hq).r * HSCALE;
  vec2 q = wp - 0.5, b = floor(q), t = q - b;
  ivec2 i = ivec2(b);
  float h00 = hOf(colAt(i)), h10 = hOf(colAt(i + ivec2(1, 0))), h01 = hOf(colAt(i + ivec2(0, 1))), h11 = hOf(colAt(i + ivec2(1, 1)));
  float lo = min(min(h00, h10), min(h01, h11)), hi = max(max(h00, h10), max(h01, h11));
  if (hi - lo < 0.01) return hi;
  float bil = mix(mix(h00, h10, t.x), mix(h01, h11, t.x), t.y);
  return mix(lo, hi, smoothstep(0.3, 0.7, (bil - lo) / (hi - lo)));
}
float sceneH(vec2 wp) { return max(terrH(wp), tankH(wp)); }
// (whether a point z high is below / in the scene's shade: above the tanks' top - 2 x uTS, tankH's highest - only the
// terrain counts, the same answer as sceneH's for less)
bool below(vec2 wp, float z) { return z <= (z > 2.0 * uTS ? terrH(wp) : sceneH(wp)); }
bool under(vec2 wp, float z) { return (z >= 2.0 * uTS ? terrH(wp) : sceneH(wp)) > z; }

void main() {
  vec2 s = vec2(gl_FragCoord.x / uOut.x * uSize.x, (uOut.y - gl_FragCoord.y) / uOut.y * uSize.y);
  if (s.y >= uWin.y + uWin.w || s.y < uWin.y) discard;
  if (uStatic == 1) {                                     // low energy: the view is static
    // (bright snow, black to white with a hint of the palette's colours as the original's static - owner, 2026-10-30:
    // "show static instead of going dark"; the dim gray noise before read as the view going dark)
    // (a block per world pixel, as the original's; an integer hash of the block and the frame - the float one repeated
    // in stripes; a little dimmer than full - owner, 2026-10-30)
    ivec2 cell = ivec2(floor((s - uWin.xy) / vec2(4.5, 4.0)));
    uvec3 v = uvec3(uvec2(cell + 4096), uint(uTime * 24.0)) * 1664525u + 1013904223u;
    v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y; v ^= v >> 16u;
    v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
    float h = float(v.x & 65535u) / 65535.0, k = float(v.y & 65535u) / 65535.0;
    float band = 0.88 + 0.12 * sin(s.y * 0.35 + uTime * 9.0);
    vec3 c = k < 0.4 ? uPal[int(h * 15.99)] : vec3(smoothstep(0.2, 0.75, h));
    outColor = vec4(c * band * 0.75, 1.0);
    return;
  }
  vec2 wp = uCam + (s - uWin.xy) * uScale;                // world pixels (3D: on the tunnels' floor)
  vec2 wp0 = wp;                                          // (3D: that floor point - the shells fly above it)
  float pw = uOut.x / uSize.x / uScale.x;                 // output pixels per world pixel
  // 3D: from the camera through this pixel's floor point - the first surface it meets (the world's heights are small
  // against the camera's: only the last bit of the way, coarse steps then halving) - and its normal
  vec3 nrm = vec3(0.0, 0.0, 1.0);
  float hz = 0.0;
  bool d3 = uDepth == 1 && uMap == 0;
  if (d3) {
    vec3 D = vec3(wp, 0.0) - uEye;
    float t0 = 1.0 - HMAX / uEye.z, ta = t0, tb = 1.0;
    bool hit = false;
    for (int k = 1; k <= 16; k++) {
      float t = t0 + (1.0 - t0) * float(k) / 16.0;
      vec3 P = uEye + D * t;
      if (below(P.xy, P.z)) { tb = t; hit = true; break; }
      ta = t;
    }
    if (hit) for (int k = 0; k < 7; k++) {
      float t = (ta + tb) * 0.5;
      vec3 P = uEye + D * t;
      if (below(P.xy, P.z)) tb = t; else ta = t;
    }
    vec3 P = uEye + D * tb;
    wp = P.xy; hz = P.z;
    float e = uEdges == 1 ? 0.25 : 0.4;
    vec2 g = vec2(sceneH(wp + vec2(e, 0.0)) - sceneH(wp - vec2(e, 0.0)), sceneH(wp + vec2(0.0, e)) - sceneH(wp - vec2(0.0, e))) / (2.0 * e);
    nrm = normalize(vec3(-g, 1.0));
  }
  float va = seenAmt(wp);
  float fade = smoothstep(0.3, 0.7, va);
  bool vis = va > 0.5;
  int bs;
  vec3 col = terrainAt(wp, pw, vis, bs);
  vec3 ground = col;
  col = tanksAt(col, wp, pw);
  if (d3) {
    // 3D: a wall's top or side shows its own surface (no tank drawn on it); the sides lit by which way they face,
    // darker low down
    if (hz > tankH(wp) + 0.2) col = ground;
    vec3 L = normalize(SUN);
    float lit = clamp(dot(nrm, L), 0.0, 1.0);
    float side = clamp((1.0 - nrm.z) * 1.6, 0.0, 1.0);
    col *= mix(1.0, (0.4 + 0.8 * lit) * mix(0.5, 1.0, clamp(hz / HD, 0.0, 1.0)), side);
    // shadows: towards the light, anything higher than the ray in the way (the walls' shadows on the floor, the tanks')
    float sh = 0.0;
    for (int k = 1; k <= 8; k++) {
      vec3 Q = vec3(wp, hz + 0.05) + L * (float(k) * 0.5);
      if (under(Q.xy, Q.z)) { sh = 1.0 - float(k - 1) / 10.0; break; }
    }
    col *= 1.0 - 0.45 * sh;
  }
  // rock and base walls over the tanks: a turned tank (a rectangle) reaches half a pixel past the game's own 7 x 7
  // sprite, over a wall beside it - the wall covers it there, as in the original graphics (owner, 2026-10-26)
  if (!d3 && (bs == 2 || bs == 3)) col = ground;

  // light: dark tunnels, lit by lamps, headlights, shots and flashes
  if (uLight == 1) {
    // (sand and grass lie open to the sky: lighter than the classic tunnels' dark; water as dark as a tunnel)
    vec3 L = vec3(bs == 0 ? 0.36 + (uFloorOn == 1 ? 0.24 * (1.0 - gLook.x) : 0.0) : bs == 4 ? 0.42 : 0.48);
    for (int i = 0; i < 32; i++) {
      if (i >= uNL) break;
      float d = length(wp - uLt[i].xy), k = clamp(1.0 - d / uLt[i].z, 0.0, 1.0);
      if (k > 0.0 && i < uNTL) k *= lmask(i, wp);
      L += uLc[i] * uLt[i].w * k * k;
    }
    for (int i = 0; i < 8; i++) {
      if (i >= uNT) break;
      if (uTank[i].w < 0.5) continue;
      vec2 v = wp - (uTank[i].xy + 0.5);
      float d = length(v);
      if (d < 2.5 || d > 52.0) continue;
      vec2 f = vec2(sin(uTank[i].z), -cos(uTank[i].z));
      float cone = smoothstep(0.62, 0.9, dot(v / d, f)) * pow(1.0 - d / 52.0, 1.4);
      if (cone > 0.0) cone *= lmask(i, wp);
      L += vec3(1.0, 0.93, 0.78) * cone * 0.95;
    }
    col *= min(L, vec3(1.7));
  }

  // glowing pixels: shots, explosion embers, anything that isn't terrain (not in the fog: memories don't glow)
  if (fade > 0.0) {
    ivec2 g0 = ivec2(floor(wp));
    vec3 glow = vec3(0.0);
    for (int y = -2; y <= 2; y++)
      for (int x = -2; x <= 2; x++) {
        int c = colAt(g0 + ivec2(x, y)), k = uCls[c];
        if (k < 4) continue;
        vec3 e = k == 4 ? vec3(1.0, 0.55, 0.18) : k == 5 ? vec3(0.75, 0.12, 0.05) : uPal[c];
        vec2 d = wp - (vec2(g0 + ivec2(x, y)) + 0.5);
        float core = uEdges == 1 ? (x == 0 && y == 0 ? 1.0 : 0.0) : 1.0 - smoothstep(0.25, 0.45, max(abs(d.x), abs(d.y)));
        glow += e * (float(uGlow) * exp(-dot(d, d) * 1.1) * 0.55 + core * 0.9);
      }
    // shells in flight: a hot head, a red pixel behind it, a glow around
    for (int i = 0; i < 48; i++) {
      if (i >= uNS) break;
      vec2 hd = wp - (uShot[i].xy + 0.5), tl = wp - (uShot[i].xy - uShot[i].zw + 0.5);
      if (d3) {                                          // 3D: at the gun's height - where the camera sees that, on its floor
        float k = uEye.z / (uEye.z - SHOT_H);
        hd = wp0 - (uEye.xy + (uShot[i].xy + 0.5 - uEye.xy) * k);
        tl = wp0 - (uEye.xy + (uShot[i].xy - uShot[i].zw + 0.5 - uEye.xy) * k);
      }
      if (dot(hd, hd) > 40.0) continue;
      float core = 1.0 - smoothstep(0.3, 0.55, max(abs(hd.x), abs(hd.y)));
      float tail = 1.0 - smoothstep(0.3, 0.55, max(abs(tl.x), abs(tl.y)));
      glow += vec3(1.0, 0.85, 0.55) * core * 1.4 + vec3(0.8, 0.15, 0.05) * tail * 0.9
        + vec3(1.0, 0.5, 0.15) * float(uGlow) * (exp(-dot(hd, hd) * 0.6) * 0.8 + exp(-dot(tl, tl) * 0.9) * 0.3);
    }
    col += glow * fade;
  }
  if (fade < 1.0) {
    // the fog: gray (the original's), dark, blurred (soft and dim)
    float y = dot(col, vec3(0.3, 0.59, 0.11));
    vec3 f = uFog == 2 ? vec3(y * 0.55) : uFog == 1 ? col * 0.22 : mix(col, vec3(y), 0.6) * 0.42;
    col = mix(f, col, fade);
  }
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

// The tanks' light masks (owner, 2026-10-30: "the light from the tank should not go through the wall and rock, maybe not
// even through the dirt"): for every world pixel up to LM_R from a tank, how much of its light gets there - along the
// line from the tank: rock and base walls stop it (their first pixel, the face it shines on, still lit), dirt lets it
// in DIRT px (the tunnel's edge glows, no other tunnel behind it). One slot per player, LM_N texels square, made when
// its tank moved or the ground near it changed (a step)
const LMFS = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
uniform usampler2D uWorld;
uniform ivec2 uWorldPx;
uniform int uCls[16];
uniform vec2 uC;                 // the tank's middle (world px)
uniform float uX0;               // the slot's first column
out vec4 outColor;
const float R = 52.0, DIRT = 1.5;
int colAt(ivec2 g) {
  if (g.x < 0 || g.y < 0 || g.x >= uWorldPx.x || g.y >= uWorldPx.y) return 7;
  uint b = texelFetch(uWorld, ivec2(g.x >> 1, g.y), 0).r;
  return int((g.x & 1) == 1 ? (b >> 4) & 15u : b & 15u);
}
void main() {
  ivec2 o = ivec2(floor(vec2(gl_FragCoord.x - uX0, gl_FragCoord.y))) - int(R);
  float dist = length(vec2(o));
  if (dist > R) { outColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec2 a = uC, b = uC + vec2(o);
  ivec2 to = ivec2(floor(b));
  int n = int(ceil(dist * 2.0));
  float tr = 1.0, dirt = 0.0, len = dist / float(max(n, 1));
  for (int k = 1; k < 112; k++) {
    if (k >= n) break;
    ivec2 g = ivec2(floor(mix(a, b, float(k) / float(n))));
    if (g == to) break;
    int c = uCls[colAt(g)];
    if (c == 2 || c == 3) { tr = 0.0; break; }
    if (c == 1) { dirt += len; tr = 1.0 - smoothstep(0.0, DIRT, dirt); if (tr <= 0.0) break; }
  }
  outColor = vec4(tr, 0.0, 0.0, 1.0);
}`;

// 3D: the terrain's heights around a view, in two passes (both: height / 4 in red)
// A - one texel per world pixel (uOrg: the world pixel of texel 0): its material's height; rock rises from half its
// height at a tunnel's edge to the full one 3 px in, with bumps where its texture (shade) is high (owner, 2026-10-28: "more
// like a rock") - voxel blocks use it as it is
const HAFS = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
uniform usampler2D uWorld;
uniform ivec2 uWorldPx;
uniform int uRowOff, uRows, uOutside;
uniform int uCls[16];
uniform vec2 uOrg;
out vec4 outColor;
int colAt(ivec2 g) {
  if (g.x < 0 || g.y < 0 || g.x >= uWorldPx.x || g.y >= uWorldPx.y) return uOutside;
  int r = g.y - uRowOff;
  if (r < 0 || r >= uRows) return uOutside;
  uint b = texelFetch(uWorld, ivec2(g.x >> 1, r), 0).r;
  return int((g.x & 1) == 1 ? (b >> 4) & 15u : b & 15u);
}
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm3(vec2 p) { return vnoise(p) * 0.55 + vnoise(p * 2.07 + 5.3) * 0.28 + vnoise(p * 4.13 + 11.7) * 0.17; }
void main() {
  ivec2 g = ivec2(uOrg) + ivec2(gl_FragCoord.xy);
  int k = uCls[colAt(g)];
  float h = k == 1 ? 3.0 : k == 3 ? 3.5 : 0.0;
  if (k == 2) {
    float d = 4.0;                                     // (the distance to the nearest open pixel - a tunnel -, up to 3:
    for (int y = -3; y <= 3; y++)                      // next to dirt it stands at its full height)
      for (int x = -3; x <= 3; x++) {
        int m = uCls[colAt(g + ivec2(x, y))];
        if (m == 0 || m >= 4) d = min(d, length(vec2(x, y)));
      }
    float ramp = clamp((d - 1.0) / 3.0, 0.0, 1.0);
    vec2 wp = vec2(g) + 0.5, q = wp * 0.16;             // (the rock texture's own height - shade in the main pass)
    vec2 w = vec2(vnoise(q * 0.7 + 2.3), vnoise(q * 0.7 + 9.1)) * 0.9;
    h = 3.75 * (0.5 + 0.5 * ramp) + (fbm3(q + w) - 0.5) * 1.4 * (0.4 + 0.6 * ramp);
  }
  outColor = vec4(clamp(h, 0.0, 3.99) / 4.0, 0.0, 0.0, 1.0);
}`;
// B - smooth edges: pass A through the 2D contours' kernel, uRes texels per world pixel; steepened between the lowest
// and highest around where it meets the floor (round tunnel walls), smooth elsewhere (the rock's bumps)
const HFS = `#version 300 es
precision highp float;
uniform sampler2D uA;
uniform vec2 uOrg, uOrgA, uSizeA;
uniform float uRes;
out vec4 outColor;
float mn(float x) {
  x = abs(x);
  return x < 1.0 ? (7.0 * x * x * x - 12.0 * x * x + 16.0 / 3.0) / 6.0
       : x < 2.0 ? (-7.0 / 3.0 * x * x * x + 12.0 * x * x - 20.0 * x + 32.0 / 3.0) / 6.0 : 0.0;
}
vec4 kern(float t) { return vec4(mn(1.0 + t), mn(t), mn(1.0 - t), mn(2.0 - t)); }
float hA(ivec2 g) { ivec2 t = clamp(g - ivec2(uOrgA), ivec2(0), ivec2(uSizeA) - 1); return texelFetch(uA, t, 0).r * 4.0; }
void main() {
  vec2 wp = uOrg + gl_FragCoord.xy / uRes;
  vec2 q = wp - 0.5, b = floor(q), t = q - b;
  vec4 wx = kern(t.x), wy = kern(t.y);
  float sum = 0.0, lo = 99.0, hi = 0.0;
  for (int y = 0; y < 4; y++)
    for (int x = 0; x < 4; x++) {
      float h = hA(ivec2(b) + ivec2(x - 1, y - 1));
      sum += h * wx[x] * wy[y];
      if (x >= 1 && x <= 2 && y >= 1 && y <= 2) { lo = min(lo, h); hi = max(hi, h); }
    }
  float h = lo > 0.5 || hi - lo < 0.01 ? sum : mix(lo, hi, smoothstep(0.3, 0.7, (sum - lo) / (hi - lo)));
  outColor = vec4(clamp(h, 0.0, 3.99) / 4.0, 0.0, 0.0, 1.0);
}`;

// particles: one point each (x, y world pixels, size in world pixels), premultiplied colour
const PVS = `#version 300 es
in vec2 aP;
in vec4 aC;
in float aS;
uniform vec2 uCam, uScale, uSize, uOut;
uniform vec4 uWin;
out vec4 vC;
void main() {
  vec2 s = uWin.xy + (aP - uCam) / uScale;
  gl_Position = vec4(s.x / uSize.x * 2.0 - 1.0, 1.0 - s.y / uSize.y * 2.0, 0.0, 1.0);
  gl_PointSize = max(1.0, aS * uOut.x / uSize.x / uScale.x);
  vC = aC;
}`;
const PFS = `#version 300 es
precision highp float;
in vec4 vC;
out vec4 outColor;
void main() {
  float a = 1.0 - smoothstep(0.25, 0.5, length(gl_PointCoord - 0.5));
  outColor = vec4(vC.rgb * vC.a * a, vC.a * a);
}`;

const CLASS = { tunnel: 0, dirt: 1, rock: 2, wall: 3, ember: 4, trail: 5, other: 6 };
const MAX_PARTS = { high: 900, low: 300, off: 0 };
const VIEW_HALF = 38;                     // the view window's tank offset (blitView: x - 38, y - 38)
const EYE = 36;                           // 3D: the camera's height above the floor (world pixels; the walls are 3 - 3.75)

function program(gl, vs, fs, attribs) {
  const sh = (type, text) => { const s = gl.createShader(type); gl.shaderSource(s, text); gl.compileShader(s); return s; };
  const prog = gl.createProgram();
  const f = sh(gl.FRAGMENT_SHADER, fs), v = sh(gl.VERTEX_SHADER, vs);
  gl.attachShader(prog, v);
  gl.attachShader(prog, f);
  attribs.forEach((a, i) => gl.bindAttribLocation(prog, i, a));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    if (root.console) console.warn("gfx modern: shader failed", gl.getShaderInfoLog(v), gl.getShaderInfoLog(f), gl.getProgramInfoLog(prog));
    gl.deleteShader(v); gl.deleteShader(f); gl.deleteProgram(prog);
    return null;
  }
  return prog;
}
function texture(gl) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
  for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
  return t;
}
const rnd = (a, b) => a + Math.random() * (b - a);
const angDiff = (a, b) => { let d = (b - a) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return d; };

function create(gl) {
  // (a GPU that can't build the 3D shader still gets the modern look: the same shader without 3D - Gfx.fail3d)
  let prog = program(gl, VS, FS, ["aPos"]), why3d = "";
  if (!prog && (prog = program(gl, VS, FS.replace("uniform int uDepth;", "const int uDepth = 0;"), ["aPos"]))) why3d = "shader";
  if (!prog) return null;
  const pprog = program(gl, PVS, PFS, ["aP", "aC", "aS"]);
  // 3D: the height passes into their own textures - A one texel per world pixel around a view, B (smooth edges) HRES
  const haprog = program(gl, VS, HAFS, ["aPos"]), hprog = program(gl, VS, HFS, ["aPos"]), hau = {}, hu = {};
  if (!why3d && !(haprog && hprog)) why3d = "height shader";
  if (haprog) for (const n of ["uWorld", "uWorldPx", "uRowOff", "uRows", "uOutside", "uCls", "uOrg"]) hau[n] = gl.getUniformLocation(haprog, n);
  if (hprog) for (const n of ["uA", "uOrg", "uOrgA", "uSizeA", "uRes"]) hu[n] = gl.getUniformLocation(hprog, n);
  const HRES = 4, HW_ = 100, HH_ = 96;                 // (the view's 76 x 71 and a margin: rays reach a few px out)
  // (also made while drawing - a view's first height maps: the texture and framebuffer bound before stay bound)
  const target = (w, h, filter) => {
    const wasTex = gl.getParameter(gl.TEXTURE_BINDING_2D), wasFb = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    const tex = gl.createTexture(), fbo = gl.createFramebuffer();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (const q of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, q, filter);
    for (const q of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, q, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (!why3d && gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) why3d = "height target";
    gl.bindFramebuffer(gl.FRAMEBUFFER, wasFb);
    gl.bindTexture(gl.TEXTURE_2D, wasTex);
    return { tex, fbo };
  };
  // (a view's own pair, made on first use - kept while nothing they come from changed: the step, the camera's
  // whole world pixel, the settings; a view that moves smoothly between steps reuses them)
  const hTargets = new Map();                        // view key -> {hA, hB, key}
  const hFirst = { hA: target(HW_, HH_, gl.NEAREST), hB: target(HW_ * HRES, HH_ * HRES, gl.LINEAR), key: "" };
  Gfx.fail3d(why3d);
  // the tanks' light masks (LMFS): a slot per player in one texture (none - a GPU that can't: light through everything)
  const LM_N = 105, lmprog = program(gl, VS, LMFS, ["aPos"]), lmu = {};
  if (lmprog) for (const n of ["uWorld", "uWorldPx", "uCls", "uC", "uX0"]) lmu[n] = gl.getUniformLocation(lmprog, n);
  const lmT = lmprog ? target(8 * LM_N, LM_N, gl.LINEAR) : null;
  // the height maps of a view whose camera (top left of the floor it shows) is cam: the world texture now bound to
  // unit 0 (the world or the player's memory band, rowOff / rows / outside as the main pass) -> [A's, B's (or null)]
  // world rectangles; A on unit 3, B on unit 2
  function heights(view, e, cam, rowOff, rows, outside, cls, smooth) {
    if (!haprog || (smooth && !hprog)) return null;
    const org = [Math.floor(cam[0]) - 12, Math.floor(cam[1]) - 12];
    let t = hTargets.get(view);
    if (!t) hTargets.set(view, t = hTargets.size ? { hA: target(HW_, HH_, gl.NEAREST), hB: target(HW_ * HRES, HH_ * HRES, gl.LINEAR), key: "" } : hFirst);
    const { hA, hB } = t, r = [org[0], org[1], HW_, HH_];
    const key = [e.tick, org[0], org[1], rowOff, rows, outside, smooth ? 1 : 0, cls.join()].join();
    if (key === t.key) {
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, hA.tex);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, smooth ? hB.tex : null);
      gl.activeTexture(gl.TEXTURE0);
      return [r, smooth ? r : null];
    }
    t.key = key;
    Debug.count("3d heights");
    const fb = gl.getParameter(gl.FRAMEBUFFER_BINDING), vp = gl.getParameter(gl.VIEWPORT), sc = gl.isEnabled(gl.SCISSOR_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, hA.fbo);
    gl.viewport(0, 0, HW_, HH_);
    gl.useProgram(haprog);
    gl.uniform1i(hau.uWorld, 0); gl.uniform2i(hau.uWorldPx, e.worldW, e.worldH);
    gl.uniform1i(hau.uRowOff, rowOff); gl.uniform1i(hau.uRows, rows); gl.uniform1i(hau.uOutside, outside);
    gl.uniform1iv(hau.uCls, cls); gl.uniform2f(hau.uOrg, org[0], org[1]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, hA.tex);
    if (smooth) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, hB.fbo);
      gl.viewport(0, 0, HW_ * HRES, HH_ * HRES);
      gl.useProgram(hprog);
      gl.uniform1i(hu.uA, 3); gl.uniform2f(hu.uOrg, org[0], org[1]); gl.uniform2f(hu.uOrgA, org[0], org[1]);
      gl.uniform2f(hu.uSizeA, HW_, HH_); gl.uniform1f(hu.uRes, HRES);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, hB.tex);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.viewport(vp[0], vp[1], vp[2], vp[3]);
    if (sc) gl.enable(gl.SCISSOR_TEST);
    gl.useProgram(prog);
    return [r, smooth ? r : null];
  }
  const u = {}, pu = {};
  for (const n of ["uWorld", "uVis", "uWorldPx", "uRowOff", "uRows", "uOutside", "uSize", "uOut", "uWin", "uCam", "uScale", "uPal",
    "uCls", "uTerrain", "uEdges", "uGlow", "uLight", "uFog", "uVisOn", "uStatic", "uMap", "uVisOrg", "uTime", "uNT", "uTank",
    "uTankCol", "uTread", "uTS", "uTankStyle", "uNL", "uLt", "uLc", "uNS", "uShot", "uDepth", "uEye", "uH", "uHRect", "uHA", "uARect",
    "uNTL", "uLMOn", "uLM", "uLMC", "uTSlot", "uFloor", "uFloorOn", "uGround", "uMemSeen"]) u[n] = gl.getUniformLocation(prog, n);
  if (pprog) for (const n of ["uCam", "uScale", "uSize", "uOut", "uWin"]) pu[n] = gl.getUniformLocation(pprog, n);
  const worldTex = texture(gl), visTex = texture(gl);
  gl.bindTexture(gl.TEXTURE_2D, visTex);
  for (const q of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, q, gl.LINEAR);
  const memTex = new Map();                          // player -> {tex, y0, rows, tick, vis, vx, vy}
  // water and ground (1.3): engine.floor on unit 5, 2 pixels a byte (uploadFloor); no floor - a 1 x 1 zero, never read
  const floorTex = texture(gl);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, 1, 1, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, new Uint8Array(1));
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  let vao = null, vbo = null;
  if (pprog) {
    vao = gl.createVertexArray(); vbo = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 8);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 28, 24);
    gl.bindVertexArray(null);
  }

  // ---------------------------------------------------------- what moves between engine steps
  const S = { e: null, tick: -1, t0: 0, last: 0, tanks: [], parts: [], flashes: [], shake: [], buf: null };
  const TICK = TunnelerEngine.TICK_MS;

  // the tank sprite a player is drawn with (its colours; the classic engine: kind = player)
  const sprite = (e, p, dir) => e.extended ? e.extSprites && e.extSprites[p] && e.extSprites[p][dir & 7]
    : e.tankSprites && e.tankSprites[p] && e.tankSprites[p][dir & 7];

  // the alive tanks' sprite pixels out of buf (world bytes from world row y0 on): they are drawn as shapes
  // (viewer: only the tanks that player sees - a memory keeps the ghosts of the others)
  function untank(e, buf, y0, viewer) {
    const ws = e.ws;
    for (let p = 1; p <= e.nPlayers; p++) {
      if (viewer && p !== viewer && !e.sightSees(viewer, e.tankX[p], e.tankY[p])) continue;
      const sp = e.alive[p] ? sprite(e, p, e.tankDir[p]) : null;
      if (!sp) continue;
      for (let r = 0; r < 7; r++)
        for (let c = 0; c < 7; c++) {
          if (sp[r][c] === 0x10) continue;
          const x = e.tankX[p] - 3 + c, y = e.tankY[p] - 3 + r - y0, i = y * ws + (x >> 1);
          if (x < 0 || y < 0 || x >= e.worldW || i >= buf.length) continue;
          buf[i] &= x & 1 ? 0x0F : 0xF0;
        }
    }
  }
  // the world as the views show it, into worldTex - only the rows that changed since the last step (two buffers in
  // turn: the one uploaded last is what the texture holds)
  function uploadWorld(e) {
    if (!S.buf || S.buf.length !== e.world.length) {
      S.buf = new Uint8Array(e.world.length);
      if (S.prev && S.prev.length !== e.world.length) S.prev = null;
    }
    const buf = S.buf, ws = e.ws;
    buf.set(e.world);
    // the game mode's objects (taken out of the world again before the step ended): as the views showed them
    const o = e.objsShown || [];
    for (let k = 0; k < o.length; k += 3) {
      const x = o[k], i = o[k + 1] * ws + (x >> 1);
      if (i < buf.length) buf[i] = x & 1 ? (buf[i] & 0x0F) | (o[k + 2] << 4) : (buf[i] & 0xF0) | o[k + 2];
    }
    untank(e, buf, 0);
    const prev = S.prev;
    let r0 = 0, r1 = e.worldH;
    if (prev && S.prevW === ws) {
      let a = 0, b = buf.length;
      while (a < b && buf[a] === prev[a]) a++;
      while (b > a && buf[b - 1] === prev[b - 1]) b--;
      r0 = Math.floor(a / ws); r1 = Math.ceil(b / ws);
    }
    gl.bindTexture(gl.TEXTURE_2D, worldTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (!prev || S.prevW !== ws) gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, ws, e.worldH, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, buf);
    else if (r1 > r0) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, r0, ws, r1 - r0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, buf, r0 * ws);
    Debug.count("world KB", (r1 - r0) * ws / 1024);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    S.buf = prev && prev.length === buf.length ? prev : null;
    S.prev = buf; S.prevW = ws;
    S.wband = !prev || S.prevW !== ws ? [0, e.worldH] : [r0, r1];        // (the light masks: the rows that changed)
  }

  // water and ground (1.3): engine.floor into floorTex - static for a match once its world is made, so only when it
  // could have changed: another array or a new match (newMatchExt gives it a new roundLog); not while a map is being
  // painted (nothing shows the floor before the world is ready)
  function uploadFloor(e) {
    const F = e.floor;
    S.floorOn = !!F;
    if (!F) return;
    if (e.worldStage !== -1) return;
    const key = e.roundLog || 1;
    if (S.floorArr === F && S.floorKey === key) return;
    S.floorArr = F; S.floorKey = key;
    const W = e.worldW, H = e.worldH, ws = e.ws;
    const buf = S.fbuf && S.fbuf.length === ws * H ? S.fbuf : (S.fbuf = new Uint8Array(ws * H));
    for (let y = 0; y < H; y++)
      for (let i = 0, r = y * W, o = y * ws; i < ws; i++) buf[o + i] = F[r + 2 * i] | F[r + 2 * i + 1] << 4;
    gl.bindTexture(gl.TEXTURE_2D, floorTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, ws, H, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, buf);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    Debug.count("floor KB", ws * H / 1024);
  }

  function spawn(kind, x, y, set, e) {
    const n = set.particles === "off" ? 0 : set.particles === "low" ? 0.4 : 1;
    const add = (count, f) => { for (let i = 0; i < Math.round(count * n); i++) S.parts.push(f()); };
    const spark = (sp, col, life) => () => { const a = rnd(0, 6.283), v = rnd(sp * 0.3, sp);
      return { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(life * 0.5, life), age: 0, size: rnd(0.5, 1.1), col, add: true, drag: 3 }; };
    const dust = (sp, life, sz) => () => { const a = rnd(0, 6.283), v = rnd(0, sp);
      return { x: x + rnd(-1.5, 1.5), y: y + rnd(-1.5, 1.5), vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(life * 0.6, life), age: 0,
        size: rnd(sz * 0.6, sz), col: [0.55, 0.36, 0.18], add: false, drag: 4, alpha: 0.55 }; };
    const flash = (r, i, ms, col) => S.flashes.push({ x, y, r, i, ms, age: 0, col });
    if (kind === "dig") add(1.2, dust(6, 0.45, 1.6));
    else if (kind === "bump") add(3, dust(8, 0.4, 1.4));
    else if (kind === "fire") { add(4, spark(40, [1, 0.85, 0.5], 0.18)); flash(16, 0.9, 90, [1, 0.8, 0.5]); }
    else if (kind === "impact") { add(9, spark(45, [1, 0.6, 0.2], 0.35)); add(5, dust(10, 0.6, 1.8)); flash(14, 0.8, 140, [1, 0.6, 0.25]); }
    else if (kind === "hit") {
      add(16, spark(60, [1, 0.95, 0.7], 0.4)); flash(20, 1.1, 180, [1, 0.85, 0.6]);
      for (let p = 1; p <= e.nPlayers; p++) if (Math.abs(e.tankX[p] - x) < 6 && Math.abs(e.tankY[p] - y) < 6) S.shake[p] = Math.max(S.shake[p] || 0, 1.6);
    } else if (kind === "destroy") {
      add(60, () => { const a = rnd(0, 6.283), v = rnd(5, 55);
        return { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(0.4, 1.1), age: 0, size: rnd(1.2, 2.6), col: [1, 0.6, 0.15], add: true, drag: 2.2, fire: true }; });
      add(26, () => { const a = rnd(0, 6.283), v = rnd(20, 70);
        return { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(0.6, 1.4), age: 0, size: rnd(0.8, 1.6), col: [0.25, 0.22, 0.2], add: false, drag: 2.5, alpha: 0.9 }; });
      add(18, () => ({ x: x + rnd(-3, 3), y: y + rnd(-3, 3), vx: rnd(-4, 4), vy: rnd(-4, 4), life: rnd(1.2, 2.4), age: 0, size: rnd(3, 6),
        col: [0.12, 0.11, 0.1], add: false, drag: 0.8, alpha: 0.5, grow: 2 }));
      flash(70, 1.6, 650, [1, 0.6, 0.25]);
      for (let p = 1; p <= e.nPlayers; p++) {
        const d = Math.hypot(e.tankX[p] - x, e.tankY[p] - y);
        if (d < 90) S.shake[p] = Math.max(S.shake[p] || 0, 3.2 * (1 - d / 90) + 0.6);
      }
    } else if (kind === "splash") {
      // (1.3: a tank moved a pixel in water - drops thrown up around its tracks, a faint ring spreading behind it)
      add(1.6, () => { const a = rnd(0, 6.283), v = rnd(3, 12);
        return { x: x + rnd(-3, 3), y: y + rnd(-3, 3), vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(0.25, 0.5), age: 0,
          size: rnd(0.6, 1.3), col: [0.62, 0.8, 0.95], add: false, drag: 5, alpha: 0.75 }; });
      add(0.6, () => ({ x, y, vx: 0, vy: 0, life: 0.6, age: 0, size: 3, col: [0.6, 0.76, 0.86], add: false, drag: 0, alpha: 0.16, grow: 7 }));
    }
    const max = MAX_PARTS[set.particles] || 0;
    if (S.parts.length > max) S.parts.splice(0, S.parts.length - max);
  }

  function update(e, now, set) {
    if (e !== S.e) {
      Object.assign(S, { e, tick: -1, tanks: [], parts: [], flashes: [], shake: [], floorArr: null, floorKey: null });
      for (const m of memTex.values()) { gl.deleteTexture(m.tex); gl.deleteTexture(m.visTex); }
      memTex.clear();
      for (const t of hTargets.values()) t.key = "";
      S.lm = [];
    }
    const dt = Math.min(0.1, Math.max(0, (now - (S.last || now)) / 1000));
    S.last = now;
    if (e.tick !== S.tick) {
      S.tick = e.tick; S.t0 = now;
      uploadWorld(e);
      uploadFloor(e);
      for (let p = 1; p <= e.nPlayers; p++) {
        const t = S.tanks[p] || (S.tanks[p] = { px: e.tankX[p], py: e.tankY[p], cx: e.tankX[p], cy: e.tankY[p], ang: (e.tankDir[p] & 7) * Math.PI / 4 });
        t.px = t.cx; t.py = t.cy; t.cx = e.tankX[p]; t.cy = e.tankY[p];
        if (Math.abs(t.cx - t.px) > 6 || Math.abs(t.cy - t.py) > 6) { t.px = t.cx; t.py = t.cy; t.ang = (e.tankDir[p] & 7) * Math.PI / 4; }
      }
      for (const f of e.fx || []) if (f.x >= 0) spawn(f.kind, f.x + 0.5, f.y + 0.5, set, e);
    }
    const f = Math.min(1, (now - S.t0) / TICK), smooth = set.camera === "smooth";
    for (let p = 1; p <= e.nPlayers; p++) {
      const t = S.tanks[p];
      if (!t) continue;
      const ox = t.x, oy = t.y;
      t.x = smooth ? t.px + (t.cx - t.px) * f : t.cx;
      t.y = smooth ? t.py + (t.cy - t.py) * f : t.cy;
      const target = (e.tankDir[p] & 7) * Math.PI / 4;
      t.ang = smooth ? t.ang + angDiff(t.ang, target) * Math.min(1, dt * 16) : target;
      // the treads: the way driven along its facing (backwards negative; a jump - a new round - not driven);
      // kept below 1100 px = 800 tread links at a view's scale, so the wrap doesn't show
      if (ox !== undefined && Math.abs(t.x - ox) < 6 && Math.abs(t.y - oy) < 6)
        t.tr = ((t.tr || 0) + (t.x - ox) * Math.sin(t.ang) - (t.y - oy) * Math.cos(t.ang)) % 1100;
      S.shake[p] = (S.shake[p] || 0) * Math.exp(-dt * 7);
    }
    for (const q of S.parts) {
      q.age += dt; q.x += q.vx * dt; q.y += q.vy * dt;
      const k = Math.exp(-q.drag * dt); q.vx *= k; q.vy *= k;
      if (q.grow) q.size += q.grow * dt;
    }
    S.parts = S.parts.filter(q => q.age < q.life);
    for (const l of S.flashes) l.age += dt * 1000;
    S.flashes = S.flashes.filter(l => l.age < l.ms);
  }

  // the sight memory around a view (the rows it can show) and what its tank sees now - once per step
  function sightFor(e, p, cam) {
    let m = memTex.get(p);
    if (!m) {
      memTex.set(p, m = { tex: texture(gl), visTex: texture(gl), tick: -1, vis: new Uint8Array(76 * 71) });
      gl.bindTexture(gl.TEXTURE_2D, m.visTex);
      for (const q of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, q, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 76, 71, 0, gl.RED, gl.UNSIGNED_BYTE, null);
    }
    const mem = e.sightMem && e.sightMem[p];
    if (m.tick !== e.tick && mem) {
      m.tick = e.tick;
      m.y0 = Math.max(0, cam.y - 8); m.rows = Math.min(e.worldH - m.y0, 88);
      gl.bindTexture(gl.TEXTURE_2D, m.tex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      const band = m.band && m.band.length === m.rows * e.ws ? m.band : (m.band = new Uint8Array(m.rows * e.ws));
      band.set(mem.subarray(m.y0 * e.ws, (m.y0 + m.rows) * e.ws));
      untank(e, band, m.y0, p);                          // (the tanks seen now: drawn as shapes; old ghosts stay)
      // what its tank sees now (once per step, into the view's own texture - every frame binds it)
      const v = e.sightView(p, cam.x, cam.y), vis = m.vis;
      if (S.floorOn) {
        // water and ground (1.3): which pixels the player has ever seen (a bit each, 2 pixels a byte as the world; a new
        // match - a new roundLog - forgets, as the memory does), as the band's green channel: never seen stays dark
        const n = e.ws * e.worldH;
        if (!m.seen || m.seen.length !== n || m.seenKey !== e.roundLog) { m.seen = new Uint8Array(n); m.seenKey = e.roundLog; }
        for (let r = 0; r < 71; r++) {
          const y = cam.y + r;
          if (y < 0 || y >= e.worldH) continue;
          for (let c = 0; c < 76; c++) {
            const x = cam.x + c;
            if (v[r * 76 + c] && x >= 0 && x < e.worldW) m.seen[y * e.ws + (x >> 1)] |= 1 << (x & 1);
          }
        }
        const rg = m.rg && m.rg.length === band.length * 2 ? m.rg : (m.rg = new Uint8Array(band.length * 2));
        for (let i = 0, o = m.y0 * e.ws; i < band.length; i++) { rg[2 * i] = band[i]; rg[2 * i + 1] = m.seen[o + i]; }
        if (m.texRows === m.rows && m.texWs === e.ws && m.texRG) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, e.ws, m.rows, gl.RG_INTEGER, gl.UNSIGNED_BYTE, rg);
        else { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8UI, e.ws, m.rows, 0, gl.RG_INTEGER, gl.UNSIGNED_BYTE, rg); m.texRows = m.rows; m.texWs = e.ws; m.texRG = true; }
      } else if (m.texRows === m.rows && m.texWs === e.ws && !m.texRG) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, e.ws, m.rows, gl.RED_INTEGER, gl.UNSIGNED_BYTE, band);
      else { gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, e.ws, m.rows, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, band); m.texRows = m.rows; m.texWs = e.ws; m.texRG = false; }
      for (let i = 0; i < vis.length; i++) vis[i] = v[i] ? 255 : 0;
      m.vx = cam.x; m.vy = cam.y;
      gl.bindTexture(gl.TEXTURE_2D, m.visTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 76, 71, gl.RED, gl.UNSIGNED_BYTE, vis);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    }
    return mem ? m : null;
  }

  // what each of the world's 16 colours is (CLASS): the tanks' colours their base walls
  function classes(e) {
    const cls = new Int32Array(16).fill(CLASS.other);
    cls[0] = CLASS.tunnel; cls[6] = cls[8] = CLASS.dirt; cls[7] = CLASS.rock; cls[12] = CLASS.ember; cls[4] = CLASS.trail;
    for (let p = 1; p <= e.nPlayers; p++) cls[e.playerColor ? e.playerColor(p) : [0, 9, 10][p]] = CLASS.wall;
    return cls;
  }
  function setCommon(e, sw, sh, W, H, now, set) {
    gl.useProgram(prog);
    gl.uniform1i(u.uWorld, 0);
    gl.uniform1i(u.uVis, 1);
    gl.uniform2i(u.uWorldPx, e.worldW, e.worldH);
    gl.uniform2f(u.uSize, sw, sh);
    gl.uniform2f(u.uOut, W, H);
    const D = Display, pal = e.extended ? D.EXT_PALETTE : D.LORES_PALETTE;
    gl.uniform3fv(u.uPal, pal.flatMap(c => c.map(v => v / 255)));
    const cls = classes(e);
    gl.uniform1iv(u.uCls, cls);
    S.cls = cls;
    gl.uniform1i(u.uTerrain, ["textured", "smooth", "flat"].indexOf(set.terrain));
    gl.uniform1i(u.uEdges, set.edges === "pixel" ? 1 : 0);
    gl.uniform1i(u.uGlow, set.glow === "on" ? 1 : 0);
    gl.uniform1i(u.uFog, ["blurred", "dark", "gray"].indexOf(set.fog));
    gl.uniform1i(u.uTankStyle, set.tanks === "simple" ? 0 : 1);
    gl.uniform1f(u.uTime, now / 1000);
    // water and ground (1.3): no floor - none of it is read
    gl.uniform1i(u.uFloor, 5); gl.uniform1i(u.uFloorOn, S.floorOn ? 1 : 0); gl.uniform1i(u.uMemSeen, 0);
    gl.uniform1i(u.uGround, Math.max(0, MapData.GROUNDS.indexOf(e.groundType)));   // (0 classic, 1 sand, 2 grass)
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, floorTex); gl.activeTexture(gl.TEXTURE0);
    return pal;
  }
  // tanks (and their lamps) for a view: own view (p), or everyone (p 0); with line of sight only those seen
  function tanksFor(e, p, pal, lamps, scale) {
    const tanks = [], cols = [], lights = [], lcols = [], treads = [], slots = [];
    for (let q = 1; q <= e.nPlayers && tanks.length < 32; q++) {
      const t = S.tanks[q], sp = e.alive[q] ? sprite(e, q, 0) : null;
      if (!sp || !t || t.x === undefined) continue;
      if (p && q !== p && e.sight && e.sight !== "full" && !e.sightSees(p, e.tankX[q], e.tankY[q])) continue;
      tanks.push(t.x, t.y, t.ang, lamps ? 1 : 0);
      treads.push(t.tr || 0);
      slots.push(S.lm && S.lm[q - 1] ? q - 1 : -1);
      for (const v of [sp[4][2], sp[1][1], sp[0][3]]) cols.push(...pal[v & 15].map(c => c / 255));
      if (lamps) { lights.push(t.x + 0.5, t.y + 0.5, 30 * scale, 0.75); lcols.push(1, 0.9, 0.75); }
    }
    return { tanks, cols, lights, lcols, treads, slots };
  }
  function setTanks(T) {
    gl.uniform1i(u.uNT, T.tanks.length / 4);
    if (T.tanks.length) { gl.uniform4fv(u.uTank, T.tanks); gl.uniform3fv(u.uTankCol, T.cols); gl.uniform1fv(u.uTread, T.treads); }
    if (T.slots && T.slots.length) gl.uniform1iv(u.uTSlot, T.slots);
  }
  // the light masks of the tanks whose lamps shine (Lighting on) - a slot made again when its tank moved or the ground
  // within its reach changed (the rows uploadWorld changed); the world texture bound to unit 0 after it
  function lightMasks(e, set) {
    if (!lmT || set.light !== "on" || !S.prev) return;
    const L = S.lm || (S.lm = []), band = S.wband || [0, 0], R = 53;
    const todo = [];
    for (let q = 1; q <= e.nPlayers && q <= 8; q++) {
      if (!e.alive[q]) continue;
      const x = e.tankX[q], y = e.tankY[q], m = L[q - 1];
      if (m && m.x === x && m.y === y && !(m.tick !== e.tick && band[1] > y - R && band[0] < y + R + 1)) continue;
      todo.push(q);
      L[q - 1] = { x, y, tick: e.tick, c: [x + 0.5, y + 0.5] };
    }
    if (!todo.length) return;
    const fb = gl.getParameter(gl.FRAMEBUFFER_BINDING), vp = gl.getParameter(gl.VIEWPORT), sc = gl.isEnabled(gl.SCISSOR_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, lmT.fbo);
    gl.useProgram(lmprog);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, null);   // (not sampled while drawn into)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, worldTex);
    gl.uniform1i(lmu.uWorld, 0); gl.uniform2i(lmu.uWorldPx, e.worldW, e.worldH); gl.uniform1iv(lmu.uCls, classes(e));
    for (const q of todo) {
      gl.viewport((q - 1) * LM_N, 0, LM_N, LM_N);
      gl.uniform2f(lmu.uC, ...L[q - 1].c); gl.uniform1f(lmu.uX0, (q - 1) * LM_N);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    Debug.count("light masks", todo.length);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.viewport(vp[0], vp[1], vp[2], vp[3]);
    if (sc) gl.enable(gl.SCISSOR_TEST);
  }
  function setLights(e, p, T, on) {
    if (!on) { gl.uniform1i(u.uLight, 0); return; }
    const lt = T.lights.slice(), lc = T.lcols.slice();
    for (let q = 1; q <= e.nPlayers; q++)
      for (let s = 1; s < e.shotX[q].length; s++) {
        const x = e.shotX[q][s], y = e.shotY[q][s];
        if (x === -1 || lt.length >= 32 * 4) continue;
        if (p && e.sight && e.sight !== "full" && !e.sightSees(p, x, y)) continue;
        lt.push(x + 0.5, y + 0.5, 13, 0.9); lc.push(1, 0.55, 0.2);
      }
    for (const l of S.flashes) {
      if (lt.length >= 32 * 4) break;
      if (p && e.sight && e.sight !== "full" && !e.sightSees(p, Math.floor(l.x), Math.floor(l.y))) continue;   // (no light from what can't be seen)
      const k = 1 - l.age / l.ms;
      lt.push(l.x, l.y, l.r * (0.6 + 0.4 * k), l.i * k * k); lc.push(...l.col);
    }
    gl.uniform1i(u.uLight, 1);
    gl.uniform1i(u.uNTL, T.lights.length / 4);
    gl.uniform1i(u.uNL, lt.length / 4);
    if (lt.length) { gl.uniform4fv(u.uLt, lt); gl.uniform3fv(u.uLc, lc); }
  }
  // the shells in flight a view shows (with line of sight: those its player sees)
  function setShots(e, p) {
    const DX = TunnelerEngine.DirDX, DY = TunnelerEngine.DirDY, out = [];
    if (DX && e.shotX)
      for (let q = 1; q <= e.nPlayers; q++)
        for (let s = 1; s < e.shotX[q].length && out.length < 48 * 4; s++) {
          const x = e.shotX[q][s], y = e.shotY[q][s];
          if (x === -1) continue;
          if (p && e.sight && e.sight !== "full" && !e.sightSees(p, x, y)) continue;
          const d = e.shotDir[q][s] & 7;
          out.push(x, y, DX[d], DY[d]);
        }
    gl.uniform1i(u.uNS, out.length / 4);
    if (out.length) gl.uniform4fv(u.uShot, out);
  }
  function scissor(x, y, w, h, sw, sh, W, H) {
    const ox = Math.round(x / sw * W), oy = Math.round(y / sh * H), ox2 = Math.round((x + w) / sw * W), oy2 = Math.round((y + h) / sh * H);
    gl.scissor(ox, H - oy2, ox2 - ox, oy2 - oy);
  }
  // the particles as vertex data, once per frame: [alpha-blended, additive] (x, y, r, g, b, a, size each)
  let pdata = new Float32Array(0), pcount = [0, 0], pframe = -1;
  function buildParticles(now) {
    if (pframe === now) return;
    pframe = now;
    if (pdata.length < S.parts.length * 7) pdata = new Float32Array(S.parts.length * 7 + 700);
    let i = 0;
    pcount = [0, 0];
    for (let pass = 0; pass < 2; pass++)
      for (const q of S.parts) {
        if (!!q.add !== !!pass) continue;
        const t = q.age / q.life;
        let r = q.col[0], g = q.col[1], b = q.col[2];
        if (q.fire) {
          if (t < 0.3) { r = 1; g = 0.85 - t; b = 0.4 - t; } else { r = 1 - (t - 0.3) * 0.9; g = 0.45 - (t - 0.3) * 0.5; b = 0.1; }
        }
        pdata[i] = q.x; pdata[i + 1] = q.y; pdata[i + 2] = r; pdata[i + 3] = g; pdata[i + 4] = b;
        pdata[i + 5] = Math.min(1, (q.alpha || 1) * (1 - t) * (q.add ? 1.6 : 1)); pdata[i + 6] = q.size;
        i += 7; pcount[pass]++;
      }
  }
  // line of sight: only the particles player p sees (their own buffer)
  function visibleParticles(e, p) {
    const out = new Float32Array((pcount[0] + pcount[1]) * 7), n = [0, 0];
    let i = 0, k = 0;
    for (let pass = 0; pass < 2; pass++)
      for (let j = 0; j < pcount[pass]; j++, k += 7)
        if (e.sightSees(p, Math.floor(pdata[k]), Math.floor(pdata[k + 1]))) { out.set(pdata.subarray(k, k + 7), i); i += 7; n[pass]++; }
    return { data: out, count: n };
  }
  function drawParticles(P, cam, scale, win, sw, sh, W, H) {
    if (!pprog || !(P.count[0] + P.count[1])) return;
    gl.useProgram(pprog);
    gl.uniform2f(pu.uCam, cam[0], cam[1]); gl.uniform2f(pu.uScale, scale[0], scale[1]);
    gl.uniform2f(pu.uSize, sw, sh); gl.uniform2f(pu.uOut, W, H); gl.uniform4f(pu.uWin, ...win);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, P.data.subarray(0, (P.count[0] + P.count[1]) * 7), gl.STREAM_DRAW);
    gl.enable(gl.BLEND);
    if (P.count[0]) { gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.drawArrays(gl.POINTS, 0, P.count[0]); }
    if (P.count[1]) { gl.blendFunc(gl.ONE, gl.ONE); gl.drawArrays(gl.POINTS, P.count[0], P.count[1]); }
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
    gl.useProgram(prog);
  }

  function draw(sc, sw, sh, W, H, now, set) {
    const e = sc.engine;
    if (!e || !e.world) return;
    update(e, now, set);
    lightMasks(e, set);
    const base = setCommon(e, sw, sh, W, H, now, set), D = Display;
    // (the light masks on unit 4: every slot's middle; off - Lighting off, none made - the lamps light by distance)
    const lmOn = !!(lmT && set.light === "on" && S.lm && S.lm.length);
    gl.uniform1i(u.uLMOn, lmOn ? 1 : 0); gl.uniform1i(u.uLM, 4);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, lmT ? lmT.tex : null);
    if (lmOn) { const c = []; for (let k = 0; k < 8; k++) c.push(...(S.lm[k] ? S.lm[k].c : [0, 0])); gl.uniform2fv(u.uLMC, c); }
    // tank colours (Settings, Graphics; display only): each view's palette as its viewer sees the tanks
    const palFor = viewer => {
      const pal = D.tankPalette8 ? D.tankPalette8(base, e, viewer) : base;
      gl.uniform3fv(u.uPal, pal.flatMap(c => c.map(v => v / 255)));
      return pal;
    };
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, visTex);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, worldTex);
    gl.enable(gl.SCISSOR_TEST);
    const sight = e.sight && e.sight !== "full";
    if (sc.map) {
      const m = sc.map, k = e.worldW / 1024;
      const cam = m.kind === "end" ? [7 * k, 0] : [0, 0];
      const scale = m.kind === "end" ? [7 * k / 4.5, 7 * k / 4] : [e.worldW / m.w, e.worldH / m.h];
      gl.uniform4f(u.uWin, m.x, m.y, m.w, m.h);
      gl.uniform2f(u.uCam, cam[0], cam[1]); gl.uniform2f(u.uScale, scale[0], scale[1]);
      gl.uniform1i(u.uRowOff, 0); gl.uniform1i(u.uRows, e.worldH); gl.uniform1i(u.uOutside, 7);
      gl.uniform1i(u.uVisOn, 0); gl.uniform1i(u.uStatic, 0); gl.uniform1i(u.uMap, 1); gl.uniform1i(u.uLight, 0); gl.uniform1i(u.uDepth, 0);
      gl.uniform1i(u.uEdges, 0);
      const pal = palFor(sc.viewer || null);
      gl.uniform1i(u.uNS, 0);
      const T = m.kind === "live" ? tanksFor(e, 0, pal, false, 1) : { tanks: [], cols: [] };
      gl.uniform1f(u.uTS, Math.max(1, 2.2 * scale[0]));
      setTanks(T);
      scissor(m.x, m.y, m.w, m.h, sw, sh, W, H);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    for (const w of sc.windows || []) {
      const cam0 = e.cams && e.cams[w.p];
      if (!cam0) continue;
      const t = S.tanks[w.p], win = [w.x + 9, w.y + 8, 342, 284];       // cells 1-38 x rows 2-72
      let cam = [cam0.x, cam0.y];
      if (set.camera === "smooth" && !cam0.noise && t && e.alive[w.p]) cam = [t.x - VIEW_HALF, t.y - VIEW_HALF];
      const amp = set.shake === "on" ? S.shake[w.p] || 0 : 0;
      if (amp > 0.05) cam = [cam[0] + amp * Math.sin(now * 0.071 + w.p * 1.7), cam[1] + amp * Math.cos(now * 0.083 + w.p * 2.3)];
      gl.uniform4f(u.uWin, ...win);
      gl.uniform2f(u.uCam, cam[0], cam[1]); gl.uniform2f(u.uScale, 1 / 4.5, 1 / 4);
      gl.uniform1i(u.uStatic, cam0.noise ? 1 : 0); gl.uniform1i(u.uMap, 0); gl.uniform1f(u.uTS, 1);
      // 3D: the camera straight above the view's middle, EYE world pixels up (the floor fills the view exactly as in 2D)
      const d3 = set.depth === "3d" && !why3d;
      gl.uniform1i(u.uDepth, d3 ? 1 : 0);
      gl.uniform3f(u.uEye, cam[0] + win[2] * 0.5 / 4.5, cam[1] + win[3] * 0.5 / 4, EYE);
      gl.uniform1i(u.uEdges, set.edges === "pixel" ? 1 : 0);
      const m = sight && !cam0.noise ? sightFor(e, w.p, cam0) : null;
      if (m) {
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, m.tex);
        gl.uniform1i(u.uRowOff, m.y0); gl.uniform1i(u.uRows, m.rows); gl.uniform1i(u.uOutside, 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, m.visTex);
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform1i(u.uVisOn, 1); gl.uniform2i(u.uVisOrg, m.vx, m.vy);
        gl.uniform1i(u.uMemSeen, m.texRG ? 1 : 0);
      } else {
        gl.uniform1i(u.uMemSeen, 0);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, worldTex);
        gl.uniform1i(u.uRowOff, 0); gl.uniform1i(u.uRows, e.worldH); gl.uniform1i(u.uOutside, 7);
        gl.uniform1i(u.uVisOn, 0);
      }
      // 3D: the height maps around this view (A per world pixel on unit 3; smooth edges: B on unit 2)
      gl.uniform1i(u.uH, 2); gl.uniform1i(u.uHA, 3);
      const hr = d3 && !cam0.noise
        ? heights((m ? "m" : "w") + w.p, e, cam, m ? m.y0 : 0, m ? m.rows : e.worldH, m ? 0 : 7, S.cls, set.edges !== "pixel") : null;
      gl.uniform4f(u.uARect, ...(hr ? hr[0] : [0, 0, 0, 0]));
      gl.uniform4f(u.uHRect, ...(hr && hr[1] ? hr[1] : [0, 0, 0, 0]));
      const pal = palFor(w.viewer || w.p);
      const T = tanksFor(e, w.p, pal, set.light === "on", 1);
      // marked teammates (views.js teamMarks): where their tanks are drawn in this window - gfx-hud.js draws the marks
      w.markAt = (w.marks || []).filter(q => S.tanks[q] && S.tanks[q].x !== undefined && e.alive[q] &&
        !(sight && e.sightSees && !e.sightSees(w.p, e.tankX[q], e.tankY[q])))
        .map(q => [win[0] + (S.tanks[q].x + 0.5 - cam[0]) * 4.5, win[1] + (S.tanks[q].y + 0.5 - cam[1]) * 4, q]);
      setShots(e, w.p);
      setTanks(T);
      setLights(e, w.p, T, set.light === "on");
      // (the notice band stays the picture below)
      const cut = sc.cut, y0 = win[1], y1 = win[1] + win[3];
      const parts = cut && cut[0] < y1 && cut[1] > y0 ? [[y0, Math.min(y1, cut[0])], [Math.max(y0, cut[1]), y1]] : [[y0, y1]];
      let P = null;
      if (!cam0.noise && S.parts.length) { buildParticles(now); P = m ? visibleParticles(e, w.p) : { data: pdata, count: pcount }; }
      for (const [a, b] of parts) {
        if (b <= a) continue;
        scissor(win[0], a, win[2], b - a, sw, sh, W, H);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        if (P) drawParticles(P, cam, [1 / 4.5, 1 / 4], win, sw, sh, W, H);
      }
    }
    gl.disable(gl.SCISSOR_TEST);
    gl.activeTexture(gl.TEXTURE0);
  }
  return { draw };
}

Gfx.Modern = { create, CLASS };
export const Modern = Gfx.Modern;
