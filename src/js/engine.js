"use strict"

// Ties engine-terrain.js/engine-core.js/engine-render.js together into one
// self-contained simulation object. This is the actual replacement for the old
// WASM/DOS binary - netcode.js's Game class (see its own file) wraps THIS class to
// match the exact public surface tunneler.js's Session already expects
// (load/step/state/render/copy), so this class itself stays free to have whatever
// API is natural for the simulation instead of contorting to match that shape
// directly.
class TunnelerEngine
{
  // `roster` is [{team, color}, ...], one entry per tank, order matching however
  // the lobby assigned seats. `friendlyFire` is a fixed-for-the-match session
  // setting (see engine-core.js's atest()).
  constructor(seed, roster = [{ team: 1, color: 0 }, { team: 2, color: 1 }], friendlyFire = false)
  {
    this.rng = new EngineRng(seed);
    this.friendlyFire = friendlyFire;
    const { field, bases } = EngineTerrain.initField(this.rng, roster);
    this.terrain = { field, sizeX: EngineConfig.FIELD_SIZEX, sizeY: EngineConfig.FIELD_SIZEY };
    this.state = EngineCore.initTanks(bases, roster);
  }

  // Advances exactly one fixed tick (EngineConfig.TICK_MS). `inputs[i]` is
  // {up,down,left,right,fire} booleans for tanks[i] - no wall-clock dependency
  // inside the engine at all, required for the lockstep netcode's replay/rollback
  // to reproduce identical results from the same input sequence.
  step(inputs)
  {
    const dt = EngineConfig.TICK_MS / 1000;
    const { roundEnded } = EngineCore.step(this.state, this.terrain, inputs, this.rng, dt, this.friendlyFire);
    if (roundEnded)
      EngineCore.startNextRound(this.state, this.terrain, this.rng);
    return true;
  }

  render(ctx)
  {
    // Once a team reaches WIN_SCORE round wins, the match is decided - tunneler.c's
    // own Draw() switched into a whole-map reveal at that point instead of
    // continuing split-screen play (tunneler.js's Session.render() already widens
    // its canvas to 640 for exactly this - see its own gameOver branch).
    if (Object.values(this.state.teamScores).some(s => s >= EngineConfig.WIN_SCORE))
      EngineRender.renderFullMap(ctx, this.state, this.terrain);
    else
      EngineRender.render(ctx, this.state, this.terrain);
  }

  // Plain-object snapshot - a generic `tanks` array (one entry per seat, in
  // roster order) rather than named blue/green keys, since a match can now have
  // up to 8. `score` mirrors that tank's team's running teamScores entry, so a
  // single-tank consumer doesn't need to look anything up separately.
  snapshot()
  {
    return {
      round: this.state.round,
      teamScores: { ...this.state.teamScores },
      tanks: this.state.tanks.map(t => ({
        x: t.x, y: t.y, rot: t.rot, energy: t.energy, shield: t.shields,
        team: t.team, color: t.color, roundOut: t.roundOut,
        score: this.state.teamScores[t.team] || 0,
      })),
    };
  }

  // Field-cell accessor for the AI adapter (see ai-sighting.js's rewritten
  // readNibble()) - replaces the old engine's packed-EGA-buffer read entirely.
  // Rounds to the nearest cell (world positions are floats); returns -2 out of
  // bounds, matching readNibble()'s old sentinel for "outside the map".
  fieldAt(x, y)
  {
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || xi >= this.terrain.sizeX || yi < 0 || yi >= this.terrain.sizeY)
      return -2;
    return this.terrain.field[yi * this.terrain.sizeX + xi];
  }

  // Deep snapshot of the entire engine (field + tanks + ammo + explosions + PRNG
  // state) - backs the rollback netcode's Game.copy()/recalc(), which needs to
  // rewind gameLocal to gameRemote's last-confirmed state and replay forward.
  clone()
  {
    const c = Object.create(TunnelerEngine.prototype);
    c.rng = new EngineRng(0);
    c.rng.state = this.rng.state;
    c.friendlyFire = this.friendlyFire;
    c.terrain = {
      field: this.terrain.field.slice(),
      sizeX: this.terrain.sizeX,
      sizeY: this.terrain.sizeY,
    };
    c.state = {
      round: this.state.round,
      tick: this.state.tick,
      teamScores: { ...this.state.teamScores },
      totalTeams: this.state.totalTeams,
      tanks: this.state.tanks.map(t => ({ ...t, ammo: t.ammo.map(a => ({ ...a })) })),
      expl: this.state.expl.map(e => ({ ...e })),
    };
    return c;
  }

  // In-place restore from a clone() snapshot (or another live engine) - mirrors
  // clone() but writes into this instance instead of allocating a new one, since
  // netcode.js's Game.copy(netGame) copies INTO an existing instance.
  copyFrom(other)
  {
    this.rng.state = other.rng.state;
    this.friendlyFire = other.friendlyFire;
    this.terrain.field.set(other.terrain.field);
    this.state.round = other.state.round;
    this.state.tick = other.state.tick;
    this.state.teamScores = { ...other.state.teamScores };
    this.state.totalTeams = other.state.totalTeams;
    this.state.tanks = other.state.tanks.map(t => ({ ...t, ammo: t.ammo.map(a => ({ ...a })) }));
    this.state.expl = other.state.expl.map(e => ({ ...e }));
  }
}
