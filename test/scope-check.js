"use strict";
// src/js/scope.js: a route's timeouts / animation frames are cleared when it ends, and forgotten once they ran or were
// cleared - a loop that sets the next one every tick kept them all (1.5.4: 18 - 250 a second for as long as a game ran,
// a 0 ms loop millions - the tests ate the memory)
const assert = require("assert"), path = require("path");

(async () => {
  let raf = 0;
  const frames = new Map(), st = setTimeout, ct = clearTimeout;      // (the fake frames on node's own timers)
  globalThis.requestAnimationFrame = f => { const id = ++raf; frames.set(id, st(() => { frames.delete(id); f(performance.now()); }, 1)); return id; };
  globalThis.cancelAnimationFrame = id => { ct(frames.get(id)); frames.delete(id); };
  const { Scope } = await import(path.join(__dirname, "..", "src", "js", "scope.js"));
  Scope.install();
  const s = Scope.begin();
  const size = () => [...s.once.values()].reduce((n, ids) => n + ids.size, 0) + s.ends.length;
  // a self-rescheduling timeout and animation frame loop, 300 rounds each
  let ticks = 0, rafs = 0;
  await new Promise(done => { const t = () => { if (++ticks < 300) setTimeout(t, 0); else done(); }; setTimeout(t, 0); });
  await new Promise(done => { const f = () => { if (++rafs < 300) requestAnimationFrame(f); else done(); }; requestAnimationFrame(f); });
  assert.strictEqual(ticks, 300); assert.strictEqual(rafs, 300);
  assert(size() <= 2, "fired timers forgotten: " + size() + " kept");
  // cleared ones forgotten too; pending ones cleared when the route ends
  const a = setTimeout(() => assert.fail("cleared"), 20); clearTimeout(a);
  let fired = false;
  setTimeout(() => { fired = true; }, 30);
  const f = requestAnimationFrame(() => { fired = true; });
  assert.strictEqual(size(), 2, "the pending timeout and frame: " + size());
  Scope.end(s);
  await new Promise(r => setTimeout(r, 60));
  assert(!fired && f, "a pending timeout / frame cleared when the route ends");
  // outside a route: nothing kept
  setTimeout(() => {}, 0);
  assert.strictEqual(size(), 0);
  console.log("  ok  scope: one-shot timers forgotten once run or cleared, the pending ones cleared with the route");
})().catch(e => { console.error(e); process.exit(1); });
