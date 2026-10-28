// Glue between an engine and the browser: runs engine steps, presents the screen snapshots each step
// produced at their proper times, plays the speaker events, and repaints every animation frame.
import { TunnelerEngine } from "../game/engine.js";

const TICK_MS = TunnelerEngine.TICK_MS;

class Runner {
  constructor(engine, display, speaker) {
    this.engine = engine;
    this.display = display;
    this.speaker = speaker;
    this.queue = [];              // [{at: performance.now() time, snap}]
    this.onStep = null;           // optional hook after every step (scoreboards, AI)
    // optional: (engine) => ({x, y}) | {left, right} | {mute: true} | null - where this viewer hears the
    // game from (world pixels, e.g. their own tank); sounds fade with distance from it
    // (Speaker.attenuation) and pan by their x offset from it (Speaker.pan); {left, right}: the split
    // screen's two tanks (full volume, panned by the nearer). null / unset = full volume, centred.
    // Called once per presented step that has sound events or fx, after the step.
    this.listener = null;
    // optional: a replay recorder (replay.js) - gets every step's input before it runs and a call after it
    this.recorder = null;
    this.raf = requestAnimationFrame(t => this.frame(t));
  }

  // Runs one engine step whose virtual start is presented at real time `at`.
  // quiet: fast-forward (catching up / replaying), nothing is shown or played.
  runStep(input, at, quiet) {
    if (this.recorder) this.recorder.input(input);
    this.engine.step(input);
    if (this.recorder) this.recorder.stepped();
    if (!quiet) {
      for (const s of this.engine.snapshots) this.queue.push({ at: at + s.t, snap: s });
      // soundEvents: the PC speaker ("original" style); fx: semantic effects for the synthesized styles
      const fx = this.engine.fx || [];
      if (this.speaker && (this.engine.soundEvents.length || fx.length))
        this.speaker.play(this.engine.soundEvents, at, this.listener ? this.listener(this.engine) : null, fx);
    } else if (this.engine.snapshots.length) {
      this.queue = [{ at: 0, snap: this.engine.snapshots[this.engine.snapshots.length - 1] }];
    }
    if (this.onStep) this.onStep(this.engine);
  }

  // A local-only screen shown instead of the engine's (online: F2/F3 menu pages); null to remove.
  setOverlay(snap) {
    this.overlay = snap;
    const show = snap || this.latest;
    if (show) this.display.setSnapshot(show);
  }

  frame(now) {
    let snap = null;
    while (this.queue.length && this.queue[0].at <= now) snap = this.queue.shift().snap;
    if (snap) { this.latest = snap; if (!this.overlay) this.display.setSnapshot(snap); }
    this.display.draw(now);
    this.raf = requestAnimationFrame(t => this.frame(t));
  }

  stop() { cancelAnimationFrame(this.raf); if (this.speaker) this.speaker.silence(); }
}

// Runs an engine on the local clock (split screen / vs CPU): one step per BIOS tick.
class LocalClock {
  constructor(runner, inputFn) {
    this.runner = runner;
    this.inputFn = inputFn;
    this.start = performance.now();
    this.steps = 0;
    this.timer = setInterval(() => this.pump(), 5);
  }
  pump() {
    const now = performance.now();
    let due = Math.floor((now - this.start) / TICK_MS);
    // (the tab was asleep - or every frame takes longer than 10 ticks on a slow device: one step, not none, so the
    // game runs slowly instead of standing still)
    if (due - this.steps > 10) { this.start = now - (this.steps + 1) * TICK_MS; due = this.steps + 1; }
    // (stopped by a step - the match over: no more steps from this pump either)
    while (this.steps < due && !this.stopped) {
      this.runner.runStep(this.inputFn(), this.start + (this.steps + 1) * TICK_MS);
      this.steps++;
    }
  }
  stop() { clearInterval(this.timer); this.stopped = true; }
}

export { Runner, LocalClock };
