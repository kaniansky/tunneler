"use strict";
// The map with the score while Tab is held (1.3, owner 2026-10-31; draw/seenmap.js, playscreen.js seenTrack): the
// setting Show map - off / all / own / team (engine option showMap, NetProto room setting / cfg) - and what each shows:
//   - display only: a bot match with showMap own / team / all gives the same bits and stateHash as with it off
//   - off (the default): no picture, the score screen as before (no pic in its snapshot)
//   - all (Revealed): the whole world as the match started, changed only where the viewer saw it (an enemy's tunnels
//     nobody saw stay undug on it); allteam (Revealed (team)): changed where the team saw it
//   - the parts not seen now gray, what the team sees now in colour; tanks: the team's and the ones they see now
//   - own: only cells the viewer's view window has shown; more of the world as the match goes on; with line of sight
//     (circle) fewer cells than without
//   - team: a team's map holds every member's cells (at least each one's own)
//   - MatchText.liveStats: the picture in a box with the score (snap.pic), the settings left out
//   - NetProto: the setting checked, carried by roomSettings / readCfg / engineOptions (never with "off")
//   node test/seenmap-check.js
const H = require("./modes-harness.js");
const { PlayScreen } = require("../src/js/draw/playscreen.js");
const { NetProto, MatchText, TunnelerEngine, MapData } = require("./src.js");
const { SeenMap } = require("../src/js/draw/seenmap.js");
const check = H.check;

// (never seen: black or the faint dither - 1.3.1)
const blank = (rgba, o) => rgba[o] === rgba[o + 1] && (rgba[o] === 0 || rgba[o] === 30) && rgba[o + 2] === rgba[o] + (rgba[o] >> 2);
// (a picture's cells that aren't never-seen)
const lit = pic => { let n = 0; for (let i = 0; i < pic.w * pic.h; i++) if (!blank(pic.rgba, i * 4)) n++; return n; };
// (a world cell i - 4 x 4 px - in the picture, which has no rock frame: its rgba offset, null in the frame)
const at = (pic, e, i) => {
  const cw = e.worldW >> 2, K = (cw - pic.w) >> 1, x = i % cw - K, y = Math.floor(i / cw) - K;
  return x < 0 || y < 0 || x >= pic.w || y >= pic.h ? null : (y * pic.w + x) * 4;
};
const run = (showMap, extra = {}, frames = 1500, onFrame) => H.runMatch({ slots: H.slots([1, 2, 1, 2]), levels: ["normal", "normal", "normal", "normal"],
  seed: 5, size: "small", winScore: 3, maxFrames: frames, mods: Object.assign({ showMap }, extra.mods || {}),
  onFrame: (e, f) => { if (!f) e.youPlayer = 1; if (onFrame) onFrame(e, f); } });   // (the page's player: what the map tracks)

console.log("display only");
{
  const off = run("off"), rest = ["own", "team", "all", "allteam"].map(m => run(m));
  check(rest.every(r => r.bitsHash === off.bitsHash), "the same bits with every Show map");
  check(rest.every(r => r.stateHash === off.stateHash), "the same stateHash with every Show map");
  const own = rest[0];
  check(own.engine.showMap === "own" && off.engine.showMap === "off" && new TunnelerEngine(1, { showMap: "x" }).showMap === "off", "engine option showMap (anything else: off)");
}

console.log("what each shows");
{
  const off = run("off", {}, 300);
  off.engine.youPlayer = 1;
  check(SeenMap.picture(off.engine, 1) === null, "off: no picture");
  const snap = new MatchText(off.engine).liveStats().textSnap();
  check(!snap.pic, "off: the score screen without a picture");

  const all = run("all", {}, 300), pa = SeenMap.picture(all.engine, 1);
  const K = MapData.FRAME[all.engine.size];
  check(pa && pa.w === (all.engine.worldW >> 2) - 2 * K && pa.h === (all.engine.worldH >> 2) - 2 * K,
    "all: a cell per 4 x 4 world pixels, without the rock frame (" + (pa && pa.w) + " x " + (pa && pa.h) + ")");
  let dither = 0;
  { const o = SeenMap.picture(run("own", {}, 100).engine, 1); for (let i = 0; i < o.w * o.h; i++) if (o.rgba[i * 4] === 30) dither++; }
  check(dither > 0, "never seen: a faint dither, not the background's black (" + dither + " cells)");
  check(lit(pa) > pa.w * pa.h * 0.5, "all: the world shown (" + lit(pa) + " of " + pa.w * pa.h + " cells not black)");

  let early = 0;
  const own = run("own", {}, 1500, (e, f) => { if (f === 150) early = lit(SeenMap.picture(e, 1)); });
  const po = SeenMap.picture(own.engine, 1), seen = own.engine.seenCells[1].filter(Boolean).length;
  check(seen > 0 && seen < po.w * po.h * 0.9, "own: only what was seen (" + seen + " of " + po.w * po.h + " cells)");
  check(lit(po) > early, "own: more of the world as the match goes on (" + early + " -> " + lit(po) + ")");
  // (the colour check: a picture while tank 1 lives - a destroyed tank sees nothing, its map all gray)
  let pLive = null;
  const all2 = run("all", {}, 1500, e => { if (e.screen === "play" && e.alive[1]) pLive = SeenMap.picture(e, 1); }), e2 = all2.engine, p2 = SeenMap.picture(e2, 1);
  check(lit(po) < lit(p2), "own shows less than all (" + lit(po) + " < " + lit(p2) + ")");
  // (all: where nobody of the team looked, the world as it started - the enemies' tunnels not on it)
  const mates = e2.teamMembers(e2.team(1)), cw = e2.worldW >> 2;
  let stale = 0, unseen = 0;
  for (let i = 0; i < e2.seenCells[1].length; i++) {
    if (mates.some(m => e2.seenAt[m] && e2.seenAt[m][i])) continue;
    unseen++;
    if (e2.seenCells[1][i] !== e2.out.seenCell(i % cw, Math.floor(i / cw))) stale++;
  }
  check(unseen > 0 && stale > 0, "all: what the team didn't see stays as it started (" + stale + " of " + unseen + " unseen cells changed since)");
  // (gray: known, not seen now; colour: seen now)
  let gray = 0, colour = 0;
  for (let i = 0; i < pLive.w * pLive.h; i++) {
    const r = pLive.rgba[i * 4], g = pLive.rgba[i * 4 + 1], b = pLive.rgba[i * 4 + 2];
    if (blank(pLive.rgba, i * 4)) continue;
    if (r === g && g === b && r) gray++; else if (r !== g || g !== b) colour++;
  }
  check(gray > colour && colour > 0, "all: what isn't seen now gray (" + gray + "), what is in colour (" + colour + ")");
  // (seen now after death: the views the after death setting watches - owner, 2026-11-02: "black screen - noone, my
  // wreck - only my square, watch team - all my living team members, watch killer - my team members and his view, watch
  // all - see everyones view"; alive: the Show map setting)
  {
    const colour = pd => { let c = 0; for (let i = 0; i < pd.w * pd.h; i++) { const o = i * 4; if (!blank(pd.rgba, o) && (pd.rgba[o] !== pd.rgba[o + 1] || pd.rgba[o + 1] !== pd.rgba[o + 2])) c++; } return c; };
    const after = (map, watchOut, dead = [1]) => {
      const d = run(map, {}, 400).engine;
      d.showSettings = { view: "self", visible: false, watchOut };
      d.killedBy = [0, 2, 0, 0, 0];                       // (GREEN destroyed you)
      for (const p of dead) d.alive[p] = false;
      for (let i = 0; i < 4; i++) d.step({ bits: [0, 0, 0, 0], keys: [] });
      return { c: colour(SeenMap.picture(d, 1)), viewers: PlayScreen.mapViewers(d).join() };
    };
    const live = after("own", "others", []), liveTeam = after("team", "others", []);
    check(live.viewers === "1" && liveTeam.viewers === "1,3", "alive: the Show map setting - seen by me: yours (" + live.viewers + "), seen by team: the team's (" + liveTeam.viewers + ")");
    const black = after("own", "black"), wreck = after("own", "wreck"), team = after("own", "team"), killer = after("own", "killer"), all = after("own", "others");
    check(black.viewers === "" && black.c === 0, "destroyed, black screen: nobody's view (" + black.c + " cells in colour)");
    check(wreck.viewers === "1" && wreck.c > 0, "destroyed, my wreck: only its own view (" + wreck.c + ")");
    check(team.viewers === "3" && team.c > 0, "destroyed, watch team: the living teammates' (" + team.viewers + ")");
    check(killer.viewers === "3,2" && killer.c > team.c, "destroyed, watch killer: the teammates' and the killer's (" + killer.viewers + ")");
    check(all.viewers === "2,3,4" && all.c > killer.c * 0.9, "destroyed, watch all: every living tank's (" + all.viewers + ", " + all.c + " cells)");
    const mateGone = after("team", "wreck", [3]);
    check(mateGone.viewers === "1", "alive, seen by team: a destroyed teammate's view no more (" + mateGone.viewers + ")");
  }
  // (allteam: the teammates' sight changes it too - where only a mate looked, the world as it is now)
  const et = run("allteam", {}, 1500).engine, mate2 = et.teamMembers(et.team(1)).find(p => p !== 1);
  const pAll = SeenMap.picture(e2, 1), pTeam = SeenMap.picture(et, 1);
  let mateOnly = 0, diff = 0;
  for (let i = 0; i < et.seenCells[1].length; i++) if (et.seenAt[mate2][i] && !et.seenAt[1][i]) {
    const o = at(pTeam, et, i);
    if (o === null) continue;
    mateOnly++;
    if (pAll.rgba[o] !== pTeam.rgba[o] || pAll.rgba[o + 1] !== pTeam.rgba[o + 1]) diff++;
  }
  check(mateOnly > 0 && diff > 0, "allteam: where only a teammate looked the map differs from all's (" + diff + " of " + mateOnly + " cells)");

  const circle = run("own", { mods: { sight: "circle" } }, 1500), sc = circle.engine.seenCells[1].filter(Boolean).length;
  check(sc > 0 && sc < seen, "line of sight (circle): fewer cells seen than the whole view window (" + sc + " < " + seen + ")");

  const team = run("team", {}, 1500), e = team.engine;
  const pt = SeenMap.picture(e, 1), mate = e.teamMembers(e.team(1)).find(p => p !== 1);
  const mine = e.seenCells[1], theirs = e.seenCells[mate];
  let missing = 0;
  for (let i = 0; i < mine.length; i++) {
    const o = at(pt, e, i);
    // (an open cell on classic ground is black itself - the newer memory of the two may be one)
    if ((mine[i] || theirs[i]) && o !== null && blank(pt.rgba, o) && !((mine[i] === 1 || theirs[i] === 1) && e.groundType === "classic")) missing++;
  }
  check(mate && missing === 0, "team: every cell a member has seen is on the map (" + missing + " missing)");
  check(e.teamMembers(e.team(1)).every(p => e.seenCells[p]) && [2, 4].every(p => !e.seenCells[p] || e.team(p) === e.team(1)),
    "only the viewer's team is tracked (what the map can show)");
  const ownOfTeam = SeenMap.picture(Object.assign(Object.create(Object.getPrototypeOf(e)), e, { showMap: "own" }), 1);
  check(lit(pt) > lit(ownOfTeam), "team: more than its member's own (" + lit(ownOfTeam) + " -> " + lit(pt) + ")");

  e.youPlayer = 1;
  const ls = new MatchText(e).liveStats().textSnap();
  check(ls.pic && ls.pic.w === pt.w && ls.pic.cols > 20 && ls.pic.rows >= 4 && ls.pic.col + ls.pic.cols <= 80 && ls.pic.row + ls.pic.rows <= 25,
    "liveStats: the map in its block (" + (ls.pic && [ls.pic.col, ls.pic.row, ls.pic.cols, ls.pic.rows].join(", ")) + ")");
  // (8 tanks in teams: the score too tall to have the map under it - beside it)
  const big = H.runMatch({ slots: H.slots([1, 2, 1, 2, 1, 2, 1, 2]), levels: new Array(8).fill("easy"), seed: 3, size: "small", winScore: 3, maxFrames: 200,
    mods: { showMap: "team" } });
  big.engine.youPlayer = 1;
  const lb = new MatchText(big.engine).liveStats().textSnap();
  check(lb.pic && lb.pic.col + lb.pic.cols <= 80 && lb.pic.row >= 0 && lb.pic.row + lb.pic.rows <= 25, "8 tanks in teams: the map fits beside the score");
}

console.log("NetProto");
{
  check(NetProto.SHOW_MAPS.join() === TunnelerEngine.SHOW_MAPS.join() && NetProto.SHOW_MAPS.join() === "off,own,team,all,allteam", "the same choices as the engine's, in the rows' order");
  check(NetProto.SETTINGS.showMap("team") === "team" && NetProto.SETTINGS.showMap("everything") === undefined, "a room setting, checked");
  check(NetProto.roomSettings({}).showMap === "off" && NetProto.roomSettings({ showMap: "own" }).showMap === "own", "roomSettings: off by default");
  const cfg = NetProto.readCfg({ slots: [{ color: 0, team: 1 }, { color: 1, team: 2 }], showMap: "all" });
  check(cfg.showMap === "all" && NetProto.engineOptions(Object.assign({}, cfg, { ext: true })).showMap === "all", "readCfg / engineOptions carry it");
  check(!("showMap" in NetProto.engineOptions(Object.assign({}, cfg, { showMap: "off" }))), "off: not an engine option");
}
H.done("seenmap-check");
