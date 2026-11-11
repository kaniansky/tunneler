// The current route's scope (app.js: one route - the main menu, the games list, a game, a local game - at a
// time): everything a route sets up while it runs goes away with it. Scope.install() (app.js, once) makes the
// browser's own registrations count: event listeners on any target, timeouts, intervals, animation frames
// and websockets made while a route runs are removed / cleared / closed when it ends. Modules with their
// own registries (UniFont.onLoad, Controls.onChange, GameScreen.onChange, Speaker, Gfx's displays) call
// Scope.onEnd for theirs. App-wide things (Gfx's frame loop, the Alt+Enter listener) are made with
// Scope.free(fn) or before any route runs, and stay.
const root = globalThis;
let current = null, freeDepth = 0;
const live = () => current && !freeDepth ? current : null;

export const Scope = {
  // a new route starts (the previous one must have ended)
  begin() {
    current = { ends: [], once: new Map(), alive: true };
    return current;
  },
  // the route ends: its registrations undone, last first
  end(s) {
    if (!s || !s.alive) return;
    s.alive = false;
    if (current === s) current = null;
    for (const [cancel, ids] of s.once) for (const id of ids) try { cancel.call(root, id); } catch (e) { /* gone */ }
    s.once.clear();
    for (const f of s.ends.splice(0).reverse()) try { f(); } catch (e) { if (root.console) console.warn("scope:", e); }
  },
  // fn runs when the current route ends (no route running: never - an app-wide registration)
  onEnd(fn) { const s = live(); if (s) s.ends.push(fn); },
  // runs fn with nothing it registers belonging to the route (app-wide)
  free(fn) { freeDepth++; try { return fn(); } finally { freeDepth--; } },
  get current() { return current; },
  install,
};

let installed = false;
function install() {
  if (installed) return;
  installed = true;
  const ET = root.EventTarget && root.EventTarget.prototype;
  if (ET) {
    const add = ET.addEventListener;
    ET.addEventListener = function (type, fn, opts) {
      add.call(this, type, fn, opts);
      const s = live();
      if (s) s.ends.push(() => this.removeEventListener(type, fn, opts));
    };
  }
  const wrap = (set, clear) => {
    const orig = root[set], cancel = root[clear];
    if (typeof orig !== "function") return;
    root[set] = function (...a) {
      const id = orig.apply(root, a), s = live();
      if (s) s.ends.push(() => cancel.call(root, id));
      return id;
    };
  };
  // (one-shot timers - timeouts, animation frames - are forgotten once they ran or were cleared: a loop that sets the
  // next one every frame or tick kept them all, 60 - 250 a second for as long as the route ran - and a 0 ms loop
  // millions; owner, 2026-11-11: "the tests eat up all my memory")
  const once = (set, clear) => {
    const orig = root[set], cancel = root[clear];
    if (typeof orig !== "function" || typeof cancel !== "function") return;
    root[set] = function (fn, ...rest) {
      const s = live();
      if (!s || typeof fn !== "function") {
        const id = orig.call(root, fn, ...rest);
        if (s) s.ends.push(() => cancel.call(root, id));
        return id;
      }
      let ids = s.once.get(cancel);
      if (!ids) s.once.set(cancel, ids = new Set());
      const id = orig.call(root, function (...a) { ids.delete(id); return fn.apply(this, a); }, ...rest);
      ids.add(id);
      return id;
    };
    root[clear] = function (id) {
      if (current) { const ids = current.once.get(cancel); if (ids) ids.delete(id); }
      return cancel.call(root, id);
    };
  };
  once("setTimeout", "clearTimeout");
  wrap("setInterval", "clearInterval");
  once("requestAnimationFrame", "cancelAnimationFrame");
  const WS = root.WebSocket;
  if (typeof WS === "function") {
    const Tracked = function (...a) {
      const ws = new WS(...a), s = live();
      // (closing it later must not run the route's handlers - a reconnect, a "connection lost" screen)
      if (s) s.ends.push(() => { ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null; try { ws.close(); } catch (e) { /* closed */ } });
      return ws;
    };
    Tracked.prototype = WS.prototype;
    for (const k of ["CONNECTING", "OPEN", "CLOSING", "CLOSED"]) Tracked[k] = WS[k];
    root.WebSocket = Tracked;
  }
}
