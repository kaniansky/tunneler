"use strict";
// PC speaker: one square wave whose frequency the game sets with Crt.Sound / NoSound.
// Engine sound events are {t: ms offset inside the step, hz: frequency or 0, x, y: world pixel of the
// sound's source or -1}; they are scheduled on the WebAudio clock relative to the moment the step is
// presented.
//
// Distance (docs/DESIGN-8P.md 8): play(events, at, listener) with listener = {x, y} (world pixels, e.g.
// the player's own tank) scales each tone's volume by Speaker.attenuation(event, listener): full volume
// within NEAR pixels, fading to silence at FAR pixels (the play viewport is 76 x 71 world pixels, so the
// fade starts just past the edge of your own screen and ends about three screens away). listener null /
// undefined, or an event without a source (x < 0), plays at full volume (split screen, spectators,
// menus). Output only - nothing here feeds back into the game.
(function (root) {

const NEAR = 40, FAR = 240;

// 0..1 volume factor of one sound event heard at `listener` ({x, y} or null)
function attenuation(ev, listener) {
  if (!listener || !ev || !(ev.x >= 0) || !(ev.y >= 0)) return 1;
  const dx = ev.x - listener.x, dy = ev.y - listener.y;
  const d2 = dx * dx + dy * dy;
  if (d2 <= NEAR * NEAR) return 1;
  if (d2 >= FAR * FAR) return 0;
  // quadratic fall-off in amplitude: -6 dB about a third of the way out, then quickly quieter, which
  // sounds like a smooth fade on the square wave (a linear fade stays loud for too long)
  const f = (FAR - Math.sqrt(d2)) / (FAR - NEAR);
  return f * f;
}

class Speaker {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.volume = 0.07;
    this.offset = null;          // performance.now() -> AudioContext time
  }

  // must be called from a user gesture (browsers block audio before one)
  unlock() {
    if (!this.ctx) {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.osc = this.ctx.createOscillator();
      this.osc.type = "square";
      this.gain = this.ctx.createGain();
      this.gain.gain.value = 0;
      this.osc.connect(this.gain).connect(this.ctx.destination);
      this.osc.start();
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    if (m && this.ctx) this.gain.gain.setValueAtTime(0, this.ctx.currentTime);
  }

  // events of one engine step presented at performance.now() time `at`, heard at `listener`
  // ({x, y} world pixels, or null = full volume)
  play(events, at, listener) {
    if (!this.ctx || this.muted || !events.length || this.ctx.state !== "running") return;
    const now = performance.now();
    const base = this.ctx.currentTime + 0.03 + Math.max(0, at - now) / 1000;
    for (const e of events) {
      const t = base + e.t / 1000;
      if (e.hz > 0) {
        this.osc.frequency.setValueAtTime(e.hz, t);
        this.gain.gain.setValueAtTime(this.volume * attenuation(e, listener), t);
      } else this.gain.gain.setValueAtTime(0, t);
    }
  }

  silence() { if (this.ctx) this.gain.gain.setValueAtTime(0, this.ctx.currentTime); }
}

Speaker.attenuation = attenuation;
Speaker.NEAR = NEAR;
Speaker.FAR = FAR;
root.Speaker = Speaker;
if (typeof module !== "undefined") module.exports = Speaker;
})(typeof window !== "undefined" ? window : globalThis);
