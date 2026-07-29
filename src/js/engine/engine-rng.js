"use strict"

// Deterministic seeded PRNG (mulberry32) - replaces tunneler.c's unseeded rand()/
// srand(time(NULL)). Every random draw the engine makes (terrain generation -
// background sand, wall midpoint displacement - and gameplay - explosion particle
// angles, digging-noise flicker) must come from one EngineRng instance per Game,
// consumed in a fixed order every step, so two clients replaying the same input
// path from the same seed produce bit-identical worlds. That's a hard requirement
// of the lockstep-rollback netcode this engine plugs into (see netcode.js/
// tunneler.js's Session) - there is no server-side reconciliation to catch a
// divergence, only client-side rollback against a merged input history, which
// assumes both peers' simulations are otherwise identical.
class EngineRng
{
  constructor(seed)
  {
    this.state = seed >>> 0;
  }

  // Float in [0, 1) - same role as C's `rand()/(RAND_MAX+1.0)`.
  next()
  {
    this.state = (this.state + 0x6D2B79F5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Integer in [0, n) - same role as C's `(int)(n*rand()/(RAND_MAX+1.0))`.
  nextInt(n)
  {
    return Math.floor(this.next() * n);
  }
}
