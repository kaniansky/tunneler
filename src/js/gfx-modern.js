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
// Display only: reads the engine (world, tanks, shots, sprites, cams, fx, sight memory; sightView only
// fills its own scratch buffers) and never writes it; the particles' randomness is Math.random.
import { Display } from "./display.js";
import { TunnelerEngine } from "./engine.js";
import { Gfx } from "./gfx.js";
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
out vec4 outColor;

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

// a material's colour at world position wp; c: the colour index it comes from, open: how much tunnel is
// around (0..1), tone: how much of the dirt around is the light kind
vec3 shade(int cls, int c, vec2 wp, float open, float tone) {
  float n = 0.5, grain = 0.0;
  if (uTerrain == 0) { n = vnoise(wp * 0.7) * 0.6 + vnoise(wp * 2.3) * 0.4; grain = hash(floor(wp * 3.0)) - 0.5; }
  else if (uTerrain == 1) n = vnoise(wp * 0.25);
  if (cls == 0) {
    vec3 t = vec3(0.085, 0.07, 0.06) * (0.85 + 0.3 * n);
    return t * mix(0.35, 1.0, smoothstep(0.35, 0.95, open));          // darker close to the walls
  }
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

void main() {
  vec2 s = vec2(gl_FragCoord.x / uOut.x * uSize.x, (uOut.y - gl_FragCoord.y) / uOut.y * uSize.y);
  if (s.y >= uWin.y + uWin.w || s.y < uWin.y) discard;
  if (uStatic == 1) {                                     // low energy: the view is static
    float h = hash(floor(s * vec2(0.7, 0.5)) + floor(uTime * 24.0) * 17.31);
    float band = 0.75 + 0.25 * sin(s.y * 0.35 + uTime * 9.0);
    outColor = vec4(vec3(h * 0.65 * band + 0.05), 1.0);
    return;
  }
  vec2 wp = uCam + (s - uWin.xy) * uScale;                // world pixels
  float pw = uOut.x / uSize.x / uScale.x;                 // output pixels per world pixel
  float va = seenAmt(wp);
  float fade = smoothstep(0.3, 0.7, va);
  bool vis = va > 0.5;
  // terrain: the contour upscaler over material shapes (tunnel / dirt / rock / walls), or plain pixels
  int bs, bc, ss, sc2;
  float best = 1.0, second = -9.0, open = 0.0, tone = 0.5;
  vec2 tp = wp;                                          // (where the surfaces are textured)
  if (uEdges == 1) {
    ivec2 g = ivec2(floor(wp));
    bc = colAt(g); bs = shapeOf(uCls[bc]); ss = bs; sc2 = bc;
    tp = floor(wp) + 0.5;
    float o = 0.0, l = 0.0, d = 0.0;
    for (int y = -1; y <= 1; y++)
      for (int x = -1; x <= 1; x++) {
        int c = colAt(g + ivec2(x, y)), m = shapeOf(uCls[c]);
        if (m == 0) o += 1.0 / 9.0;
        if (m == 1) { d += 1.0; if (c == 6) l += 1.0; }
      }
    open = o; tone = d > 0.0 ? l / d : 0.5;
  } else {
    vec2 q = wp - 0.5, b = floor(q), t = q - b;
    vec4 wx = kern(t.x), wy = kern(t.y);
    ivec2 base = ivec2(b);
    int cs[16], sh[16];
    float w[16], light = 0.0, dirt = 0.0;
    for (int y = 0; y < 4; y++)
      for (int x = 0; x < 4; x++) {
        int k = y * 4 + x, c = colAt(base + ivec2(x - 1, y - 1));
        cs[k] = c; sh[k] = shapeOf(uCls[c]); w[k] = wx[x] * wy[y];
        if (sh[k] == 0) open += w[k];
        if (sh[k] == 1) { dirt += w[k]; if (c == 6) light += w[k]; }
      }
    tone = dirt > 0.0 ? light / dirt : 0.5;
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

  // tanks
  float aa = 1.0 / pw;
  for (int i = 0; i < 8; i++) {
    if (i >= uNT) break;
    // (Tunnel edges "pixel" - the retro style: sampled on the world's pixel grid with hard edges, blocky like the
    // terrain - owner, 2026-10-26)
    vec2 d = ((uEdges == 1 ? floor(wp) + 0.5 : wp) - (uTank[i].xy + 0.5)) / uTS;
    if (dot(d, d) > 30.0) continue;
    float a = uTank[i].z;
    vec2 f = vec2(sin(a), -cos(a)), r = vec2(cos(a), sin(a));
    vec2 l = vec2(dot(d, r), -dot(d, f));                // u to the right, v backwards (forward = -v)
    vec2 ls = vec2(dot(d - vec2(0.45, 0.6), r), -dot(d - vec2(0.45, 0.6), f));
    float ta = uEdges == 1 ? 0.0001 : aa / uTS;
    float dShadow = min(sdBox(ls, vec2(0.0, 0.5), vec2(2.5, 3.0), 0.8), sdBox(ls, vec2(0.0, -1.8), vec2(0.35, 1.8), 0.3));
    col *= 1.0 - 0.5 * clamp(0.5 - dShadow / 1.2, 0.0, 1.0);
    vec3 body = uTankCol[i * 3], tread = uTankCol[i * 3 + 1], gun = uTankCol[i * 3 + 2];
    if (uTankStyle == 0) {
      // simple: flat shapes
      float dTr = min(sdBox(l, vec2(-2.0, 0.5), vec2(0.62, 3.05), 0.45), sdBox(l, vec2(2.0, 0.5), vec2(0.62, 3.05), 0.45));
      float stripe = 0.82 + 0.25 * step(0.5, fract((l.y + uTread[i] / uTS) * 1.6));
      col = mix(col, tread * stripe, clamp(0.5 - dTr / ta, 0.0, 1.0));
      float dBody = sdBox(l, vec2(0.0, 0.5), vec2(1.45, 2.05), 0.55);
      vec3 bc3 = body * (1.15 - 0.3 * clamp((l.y + 1.5) / 4.0, 0.0, 1.0));
      col = mix(col, bc3, clamp(0.5 - dBody / ta, 0.0, 1.0));
      float dTur = length(l - vec2(0.0, 0.6)) - 1.05;
      vec3 tc = body * 0.78 + 0.25 * (1.0 - smoothstep(0.0, 0.9, length(l - vec2(-0.35, 0.25))));
      col = mix(col, tc, clamp(0.5 - dTur / ta, 0.0, 1.0));
      float dGun = sdBox(l, vec2(0.0, -1.75), vec2(0.34, 1.85), 0.3);
      col = mix(col, gun * (1.0 - 0.2 * clamp(-l.y / 3.5, 0.0, 1.0)), clamp(0.5 - dGun / ta, 0.0, 1.0));
      continue;
    }
    // realistic (setting Tanks - owner, 2026-10-26): the same layout - two tracks, the hull between them, the
    // turret, the gun - as steel links, a bevelled armor plate with an engine deck, a cast turret with a hatch and a
    // round barrel; lit from the top left, fixed in the world (the light doesn't turn with the tank)
    vec2 Lw = normalize(vec2(-0.6, -0.8)), Ll = vec2(dot(Lw, r), -dot(Lw, f));
    // the tracks: links rolling with the tank (uTread), the guide teeth along the middle
    float dTr = min(sdBox(l, vec2(-2.0, 0.5), vec2(0.64, 3.08), 0.5), sdBox(l, vec2(2.0, 0.5), vec2(0.64, 3.08), 0.5));
    float side = clamp(abs(abs(l.x) - 2.0) / 0.64, 0.0, 1.0);
    float link = fract((l.y + uTread[i] / uTS) * 2.4);
    float gap = smoothstep(0.0, 0.14, link) * smoothstep(1.0, 0.8, link);
    vec3 steel = vec3(0.24, 0.235, 0.23) * (0.5 + 0.5 * gap) * (1.12 - 0.5 * side * side);
    steel += vec3(0.07) * (1.0 - smoothstep(0.0, 0.18, abs(side - 0.5))) * gap;
    col = mix(col, steel, clamp(0.5 - dTr / ta, 0.0, 1.0));
    // the hull: its edges bevelled (lit or in shadow by which way they face), the front plate, the engine deck's slats
    vec2 hc = vec2(0.0, 0.45), hh = vec2(1.5, 2.35);
    float e = 0.06, dH = sdBox(l, hc, hh, 0.3);
    vec2 g = vec2(sdBox(l + vec2(e, 0.0), hc, hh, 0.3) - sdBox(l - vec2(e, 0.0), hc, hh, 0.3),
                  sdBox(l + vec2(0.0, e), hc, hh, 0.3) - sdBox(l - vec2(0.0, e), hc, hh, 0.3));
    g = dot(g, g) > 0.0 ? normalize(g) : vec2(0.0);
    float rim = 1.0 - clamp(-dH / 0.32, 0.0, 1.0);
    vec3 hull = body * (0.84 + 0.36 * rim * dot(g, Ll)) * (l.y < -1.35 ? 1.08 : 1.0);
    if (l.y > 1.55 && l.y < 2.55 && abs(l.x) < 1.05) hull *= 0.76 + 0.24 * smoothstep(0.35, 0.55, fract(l.y * 4.0));
    col = mix(col, hull, clamp(0.5 - dH / ta, 0.0, 1.0));
    // the turret: lit like a dome, a ring for the commander's hatch
    vec2 tcn = vec2(0.0, 0.7), tq = (l - tcn) / vec2(1.5, 1.15);
    float dT = sdBox(l, tcn, vec2(1.45, 1.1), 0.75), dome = sqrt(max(0.0, 1.0 - dot(tq, tq)));
    vec3 tur = body * (0.66 + 0.26 * dome + 0.4 * clamp(dot(tq, Ll), 0.0, 1.0));
    float dHa = abs(length(l - tcn - vec2(0.75, 0.35)) - 0.3) - 0.05;
    tur *= 1.0 - 0.35 * clamp(0.5 - dHa / ta, 0.0, 1.0);
    col *= 1.0 - 0.35 * clamp(0.5 - sdBox(l - Ll * 0.25, tcn, vec2(1.45, 1.1), 0.75) / 0.4, 0.0, 1.0) * (1.0 - clamp(0.5 - dT / ta, 0.0, 1.0));
    col = mix(col, tur, clamp(0.5 - dT / ta, 0.0, 1.0));
    // the gun: the mantlet, the barrel (round: bright along its middle), the fume extractor, the muzzle brake
    float dM = sdBox(l, vec2(0.0, -0.4), vec2(0.42, 0.28), 0.12);
    col = mix(col, body * 0.6, clamp(0.5 - dM / ta, 0.0, 1.0));
    float dB = sdBox(l, vec2(0.0, -2.0), vec2(0.17, 1.6), 0.15);
    float dEv = sdBox(l, vec2(0.0, -2.2), vec2(0.25, 0.34), 0.14);
    float dMz = sdBox(l, vec2(0.0, -3.42), vec2(0.27, 0.2), 0.08);
    float dG = min(dB, min(dEv, dMz)), wdt = dMz < 0.0 ? 0.27 : dEv < 0.0 ? 0.25 : 0.17;
    float cyl = clamp(1.0 - (l.x / wdt) * (l.x / wdt), 0.0, 1.0);
    vec3 gc = body * 0.56 * (0.5 + 0.65 * sqrt(cyl)) + vec3(0.1) * pow(cyl, 6.0);
    col = mix(col, gc, clamp(0.5 - dG / ta, 0.0, 1.0));
    // the headlights (on while its lamp shines)
    float dL = min(length(l - vec2(-1.12, -1.75)), length(l - vec2(1.12, -1.75))) - 0.16;
    col = mix(col, uTank[i].w > 0.5 ? vec3(1.0, 0.94, 0.7) : vec3(0.35, 0.33, 0.28), clamp(0.5 - dL / ta, 0.0, 1.0));
  }

  // light: dark tunnels, lit by lamps, headlights, shots and flashes
  if (uLight == 1) {
    vec3 L = vec3(bs == 0 ? 0.36 : 0.48);
    for (int i = 0; i < 32; i++) {
      if (i >= uNL) break;
      float d = length(wp - uLt[i].xy), k = clamp(1.0 - d / uLt[i].z, 0.0, 1.0);
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
  const prog = program(gl, VS, FS, ["aPos"]);
  if (!prog) return null;
  const pprog = program(gl, PVS, PFS, ["aP", "aC", "aS"]);
  const u = {}, pu = {};
  for (const n of ["uWorld", "uVis", "uWorldPx", "uRowOff", "uRows", "uOutside", "uSize", "uOut", "uWin", "uCam", "uScale", "uPal",
    "uCls", "uTerrain", "uEdges", "uGlow", "uLight", "uFog", "uVisOn", "uStatic", "uMap", "uVisOrg", "uTime", "uNT", "uTank",
    "uTankCol", "uTread", "uTS", "uTankStyle", "uNL", "uLt", "uLc", "uNS", "uShot"]) u[n] = gl.getUniformLocation(prog, n);
  if (pprog) for (const n of ["uCam", "uScale", "uSize", "uOut", "uWin"]) pu[n] = gl.getUniformLocation(pprog, n);
  const worldTex = texture(gl), visTex = texture(gl);
  gl.bindTexture(gl.TEXTURE_2D, visTex);
  for (const q of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, q, gl.LINEAR);
  const memTex = new Map();                          // player -> {tex, y0, rows, tick, vis, vx, vy}
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
  function uploadWorld(e) {
    if (!S.buf || S.buf.length !== e.world.length) S.buf = new Uint8Array(e.world.length);
    const buf = S.buf, ws = e.ws;
    buf.set(e.world);
    untank(e, buf, 0);
    gl.bindTexture(gl.TEXTURE_2D, worldTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, ws, e.worldH, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, buf);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
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
    }
    const max = MAX_PARTS[set.particles] || 0;
    if (S.parts.length > max) S.parts.splice(0, S.parts.length - max);
  }

  function update(e, now, set) {
    if (e !== S.e) {
      Object.assign(S, { e, tick: -1, tanks: [], parts: [], flashes: [], shake: [] });
      for (const m of memTex.values()) gl.deleteTexture(m.tex);
      memTex.clear();
    }
    const dt = Math.min(0.1, Math.max(0, (now - (S.last || now)) / 1000));
    S.last = now;
    if (e.tick !== S.tick) {
      S.tick = e.tick; S.t0 = now;
      uploadWorld(e);
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
    if (!m) memTex.set(p, m = { tex: texture(gl), tick: -1 });
    const mem = e.sightMem && e.sightMem[p];
    if (m.tick !== e.tick && mem) {
      m.tick = e.tick;
      m.y0 = Math.max(0, cam.y - 8); m.rows = Math.min(e.worldH - m.y0, 88);
      gl.bindTexture(gl.TEXTURE_2D, m.tex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      const band = m.band && m.band.length === m.rows * e.ws ? m.band : (m.band = new Uint8Array(m.rows * e.ws));
      band.set(mem.subarray(m.y0 * e.ws, (m.y0 + m.rows) * e.ws));
      untank(e, band, m.y0, p);                          // (the tanks seen now: drawn as shapes; old ghosts stay)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, e.ws, m.rows, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, band);
      const v = e.sightView(p, cam.x, cam.y), vis = new Uint8Array(76 * 71);
      for (let i = 0; i < vis.length; i++) vis[i] = v[i] ? 255 : 0;
      m.vis = vis; m.vx = cam.x; m.vy = cam.y;
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    }
    return mem ? m : null;
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
    const cls = new Int32Array(16).fill(CLASS.other);
    cls[0] = CLASS.tunnel; cls[6] = cls[8] = CLASS.dirt; cls[7] = CLASS.rock; cls[12] = CLASS.ember; cls[4] = CLASS.trail;
    for (let p = 1; p <= e.nPlayers; p++) cls[e.playerColor ? e.playerColor(p) : [0, 9, 10][p]] = CLASS.wall;
    gl.uniform1iv(u.uCls, cls);
    gl.uniform1i(u.uTerrain, ["textured", "smooth", "flat"].indexOf(set.terrain));
    gl.uniform1i(u.uEdges, set.edges === "pixel" ? 1 : 0);
    gl.uniform1i(u.uGlow, set.glow === "on" ? 1 : 0);
    gl.uniform1i(u.uFog, ["blurred", "dark", "gray"].indexOf(set.fog));
    gl.uniform1i(u.uTankStyle, set.tanks === "simple" ? 0 : 1);
    gl.uniform1f(u.uTime, now / 1000);
    return pal;
  }
  // tanks (and their lamps) for a view: own view (p), or everyone (p 0); with line of sight only those seen
  function tanksFor(e, p, pal, lamps, scale) {
    const tanks = [], cols = [], lights = [], lcols = [], treads = [];
    for (let q = 1; q <= e.nPlayers && tanks.length < 32; q++) {
      const t = S.tanks[q], sp = e.alive[q] ? sprite(e, q, 0) : null;
      if (!sp || !t || t.x === undefined) continue;
      if (p && q !== p && e.sight && e.sight !== "full" && !e.sightSees(p, e.tankX[q], e.tankY[q])) continue;
      tanks.push(t.x, t.y, t.ang, lamps ? 1 : 0);
      treads.push(t.tr || 0);
      for (const v of [sp[4][2], sp[1][1], sp[0][3]]) cols.push(...pal[v & 15].map(c => c / 255));
      if (lamps) { lights.push(t.x + 0.5, t.y + 0.5, 30 * scale, 0.75); lcols.push(1, 0.9, 0.75); }
    }
    return { tanks, cols, lights, lcols, treads };
  }
  function setTanks(T) {
    gl.uniform1i(u.uNT, T.tanks.length / 4);
    if (T.tanks.length) { gl.uniform4fv(u.uTank, T.tanks); gl.uniform3fv(u.uTankCol, T.cols); gl.uniform1fv(u.uTread, T.treads); }
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
    const base = setCommon(e, sw, sh, W, H, now, set), D = Display;
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
      gl.uniform1i(u.uVisOn, 0); gl.uniform1i(u.uStatic, 0); gl.uniform1i(u.uMap, 1); gl.uniform1i(u.uLight, 0);
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
      gl.uniform1i(u.uEdges, set.edges === "pixel" ? 1 : 0);
      const m = sight && !cam0.noise ? sightFor(e, w.p, cam0) : null;
      if (m) {
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, m.tex);
        gl.uniform1i(u.uRowOff, m.y0); gl.uniform1i(u.uRows, m.rows); gl.uniform1i(u.uOutside, 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, visTex);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 76, 71, 0, gl.RED, gl.UNSIGNED_BYTE, m.vis);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform1i(u.uVisOn, 1); gl.uniform2i(u.uVisOrg, m.vx, m.vy);
      } else {
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, worldTex);
        gl.uniform1i(u.uRowOff, 0); gl.uniform1i(u.uRows, e.worldH); gl.uniform1i(u.uOutside, 7);
        gl.uniform1i(u.uVisOn, 0);
      }
      const pal = palFor(w.viewer || w.p);
      const T = tanksFor(e, w.p, pal, set.light === "on", 1);
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
