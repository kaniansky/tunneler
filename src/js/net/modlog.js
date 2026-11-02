// The Mods screen's console (1.5, docs/MODS.md 2 and 6): what a mod said (g.say) and why it stopped (its error with the
// line number, the budget, memory...) in the last local game played with a mod - so a mod's author sees them after the
// match (ui/modsui.js). Kept in this browser: localStorage "tunneler.mods.log" = {id (the mod's), name, date (the game's
// start), lines: [{kind: "say" | "stop", text | why + detail, frame}]} - at most MAX lines (the newest). Display only:
// nothing here goes back into a game.
//   ModLog.begin(id)   app.js: a local game with mod <id> is starting (its route is about to mount) - the console starts
//                      anew; the mod's events (Mods.onEvent) are added as they come
//   ModLog.last()      -> the log, or null (no game with a mod yet)        ModLog.clear()
import { Mods } from "../game/mods.js";
const root = globalThis;

const KEY = "tunneler.mods.log", MAX = 60;
const read = () => { try { const v = JSON.parse(root.localStorage.getItem(KEY)); return v && typeof v === "object" && Array.isArray(v.lines) ? v : null; } catch (e) { return null; } };
const write = v => { try { if (v) root.localStorage.setItem(KEY, JSON.stringify(v)); else root.localStorage.removeItem(KEY); } catch (e) { /* private mode */ } };

let cur = null;
function begin(id) {
  cur = { id: typeof id === "string" ? id : "", name: "", date: Date.now(), lines: [] };
  write(cur);
}
// (every mod engine on this page: a game's - a replay of a modded game would come here too)
Mods.onEvent(ev => {
  if (!ev || typeof ev !== "object") return;
  if (!cur) cur = read();
  if (!cur || (cur.id && cur.id !== ev.id)) begin(ev.id);
  cur.id = ev.id; cur.name = String(ev.name || "");
  cur.lines.push(ev.kind === "say" ? { kind: "say", text: String(ev.text || ""), frame: ev.frame | 0 }
    : { kind: "stop", why: String(ev.why || "error"), detail: String(ev.detail || ""), frame: ev.frame | 0 });
  if (cur.lines.length > MAX) cur.lines.splice(0, cur.lines.length - MAX);
  write(cur);
});

export const ModLog = {
  KEY, MAX, begin,
  last: () => cur || read(),
  clear() { cur = null; write(null); },
};
