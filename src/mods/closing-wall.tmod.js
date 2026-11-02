// @name    Closing wall
// @by      Norko
// @about   After half a minute rock closes in from the edge of the world, a ring at a time; around the middle it waits a
// @about   minute, then closes on. Caught outside it: your shield drains; a base it reaches is gone. The last team
// @about   standing wins.
// @game    1.5+
// @version 1.0
// (an example mod that changes the world - docs/MODS.md; the API: src/js/game/mods.js)

const START = 30 * 18;         // frames before the ring starts to close (~30 s)
const STEP = 8;                // pixels the ring closes by, each time round
const BLOB = 6, GAP = 8;       // rock blobs of radius 6, 8 px apart along the ring
const PER_FRAME = 24;          // blobs a frame (g.fill: at most 64 a frame)
const PAUSE = 2 * 18;          // frames it waits after each ring (~2 s - owner, 2026-11-02: "closing wall is too fast": from
                               // the corners to the middle in ~3 minutes, not ~40 s)
const MIN = 70;                // it waits here (the final fight) ...
const HOLD = 60 * 18;          // ... ~a minute, then closes on to the middle (pockets of tanks walled apart by rock can't
                               // hold out for ever: the round always ends)
const DRAIN = 60;              // shield lost a frame outside the ring (more than a base repairs - rules.baseShield 40: no
                               // hiding at home)

mod({
  round(g) {
    const S = g.state;
    S.cx = g.width >> 1; S.cy = g.height >> 1;
    S.r = Math.floor(Math.hypot(S.cx, S.cy));       // the ring's radius: the world's corners
    S.k = 0;                                         // the next blob on the ring
    S.hold = 0;                                      // frames waited at MIN
    S.wait = 0;                                      // frames left of the pause after a ring
  },

  frame(g) {
    const S = g.state;
    if (g.frame < START) return;
    // tanks outside the ring lose shield (a tank that isn't in it yet: as soon as the rock gets near) - none left:
    // destroyed (a shield at 0 alone destroys nobody: only a hit does)
    for (const t of g.tanks())
      if (Math.hypot(t.x - S.cx, t.y - S.cy) > S.r + BLOB) { if (t.shield > DRAIN) g.setShield(t.p, t.shield - DRAIN); else g.destroy(t.p); }
    // (a base the ring reaches - its inner edge at the base's walls: gone, rock fills it; owner, 2026-11-02)
    for (const b of g.bases()) if (!b.gone && Math.hypot(b.x - S.cx, b.y - S.cy) + 17 >= S.r - BLOB) g.removeBase(b.i);
    if (S.r <= 0 || (S.r <= MIN && ++S.hold < HOLD)) return;
    if (S.wait > 0) { S.wait--; return; }
    // the ring: blobs along its circle, PER_FRAME a frame; round once - it closes by STEP
    const n = Math.max(8, Math.floor(2 * Math.PI * S.r / GAP));
    for (let i = 0; i < PER_FRAME && S.k < n; i++, S.k++) {
      const a = 2 * Math.PI * S.k / n;
      const x = Math.round(S.cx + S.r * Math.cos(a)), y = Math.round(S.cy + S.r * Math.sin(a));
      if (x > 0 && y > 0 && x < g.width && y < g.height) g.fill(x, y, BLOB, "rock");
    }
    if (S.k >= n) { S.k = 0; S.r -= STEP; S.wait = PAUSE; }
  },

  hud(g, p) {
    const s = Math.ceil((START - g.frame) / 18);
    return s > 0 ? { value: s, color: 11 } : null;
  },

  // computer tanks head for the middle once it closes
  aiGoal(g, p) {
    const S = g.state, t = g.tank(p);
    if (g.frame < START - 10 * 18 || Math.hypot(t.x - S.cx, t.y - S.cy) < S.r * 0.6) return null;
    return { x: S.cx, y: S.cy, dig: true };
  },
});
