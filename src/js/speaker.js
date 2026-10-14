"use strict";
// PC speaker: one square wave whose frequency the game sets with Crt.Sound / NoSound.
// Engine sound events are {t: ms offset inside the step, hz: frequency or 0}; they are scheduled on
// the WebAudio clock relative to the moment the step is presented.
(function (root) {

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

  // events of one engine step presented at performance.now() time `at`
  play(events, at) {
    if (!this.ctx || this.muted || !events.length || this.ctx.state !== "running") return;
    const now = performance.now();
    const base = this.ctx.currentTime + 0.03 + Math.max(0, at - now) / 1000;
    for (const e of events) {
      const t = base + e.t / 1000;
      if (e.hz > 0) {
        this.osc.frequency.setValueAtTime(e.hz, t);
        this.gain.gain.setValueAtTime(this.volume, t);
      } else this.gain.gain.setValueAtTime(0, t);
    }
  }

  silence() { if (this.ctx) this.gain.gain.setValueAtTime(0, this.ctx.currentTime); }
}

root.Speaker = Speaker;
})(window);
