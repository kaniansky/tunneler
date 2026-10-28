// The score during a match (owner, 2026-10-28): while a player holds Tab - or a gamepad's Back / Select, or the
// touch controls' SCORE button (pads.js makes both a Tab) - the round, every player's or team's score and the game's
// settings in a box over the game (MatchText.liveStats, refreshed a few times a second). Display only: the engine runs on
// underneath, nothing reaches it. Not for spectators (Tab switches their views) nor replays.
//   LiveStats.attach({engine: () => engine, allowed: () => bool, show: snap | null => void})
// (Tab is never a tank's key: controls.js)
import { MatchText } from "../draw/matchtext.js";

function attach(o) {
  let held = false, timer = null;
  function refresh() {
    const e = o.engine();
    if (!held || !e || !o.allowed()) { stop(); return; }
    o.show(new MatchText(e).liveStats().textSnap());
  }
  function start() {
    if (held || !o.allowed()) return;
    held = true;
    refresh();
    timer = setInterval(refresh, 250);
  }
  function stop() {
    if (!held) return;
    held = false;
    clearInterval(timer);
    o.show(null);
  }
  window.addEventListener("keydown", e => {
    if (e.code !== "Tab" || e.ctrlKey || e.altKey || e.metaKey || !o.allowed()) return;
    e.preventDefault();                                // (never moves the focus)
    if (!e.repeat) start();
  });
  window.addEventListener("keyup", e => { if (e.code === "Tab") stop(); });
  window.addEventListener("blur", stop);
  return { get held() { return held; }, stop };
}

export const LiveStats = { attach };
