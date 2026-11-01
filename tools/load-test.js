// How many online matches a server carries (1.3.2): starts a server - optionally held to a share of one CPU core, like a
// small hosting plan (Render's free one: 0.1) - and plays more and more matches on it with light fake clients (no
// engine: they send held keys, pings and frame hashes as pages do), measuring how late the frames come and the server's
// CPU. Each step: that many matches of `players` connected players (the other seats computer tanks - the server only
// relays, so they cost it nothing), measured for `secs` seconds.
//   node tools/load-test.js [--cpu 10] [--players 2] [--steps 5,10,20,40] [--secs 20] [--port 8121] [--prof <dir>]
// --cpu N: the server in a systemd scope with CPUQuota=N% (Linux, systemd-run --user); without it: unlimited.
// --gen-every S: while measuring, every S seconds a new match on a large generated map with 8 tanks starts (the server
// makes its map: the CPU spike it brings). --prof DIR: the server's CPU profile (node --cpu-prof) into that folder.
// Measured 2026-10-31 (1.3.2, CPUQuota 10%): about 120 two-player or 35 eight-player matches before frames run late.
// Lateness: a frame's arrival minus when the server's clock made it (55 ms a frame from the match's first frame, the
// earliest arrival as zero) - p50 / p99 / worst over every client; a step is "late" when p99 > 100 ms (about two
// frames: the pages smooth over one late frame, not more).
"use strict";
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const WebSocket = require("ws");
const { NetProto } = require("../src/js/game/netproto.js");

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const CPU = arg("cpu", ""), PROF = arg("prof", ""), PLAYERS = Math.max(1, Math.min(8, +arg("players", 2))), SECS = +arg("secs", 20), PORT = +arg("port", 8121);
const STEPS = arg("steps", "5,10,20,40").split(",").map(Number), GEN_EVERY = +arg("gen-every", 0);
const ROOT = path.join(__dirname, ".."), TICK = NetProto.TICK_MS, ROLES = NetProto.ROLES;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// the server: createServer with the per-address limits out of the way (every fake room has an address of its own:
// the header x-load-addr, trusted)
function startServer() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "tunneler-load-"));
  const code = `const { createServer } = require(${JSON.stringify(path.join(ROOT, "server.js"))});
    createServer({ accounts: false, dataDir: ${JSON.stringify(data)}, quiet: true, version: "", trustProxy: "x-load-addr",
      maxRoomsPerAddr: 1e6, maxConnectsPerMin: 1e6 }).listen(${PORT}, () => console.log("ready"));
    process.on("SIGTERM", () => process.exit(0));`;   // (--prof: the profile is written on exit)
  const node = [process.execPath, ...(PROF ? ["--cpu-prof", "--cpu-prof-dir", PROF] : []), "-e", code];
  const cmd = CPU ? ["systemd-run", ["--user", "--scope", "--quiet", "-p", "CPUQuota=" + CPU + "%", ...node]] : [node[0], node.slice(1)];
  const child = spawn(cmd[0], cmd[1], { stdio: ["ignore", "pipe", "inherit"], env: Object.assign({}, process.env, { UPDATE_CHECK: "0", KEEP_AWAKE: "0" }) });
  return new Promise((res, rej) => {
    child.stdout.on("data", d => { if (String(d).includes("ready")) res(child); });
    child.once("exit", c => rej(new Error("server exited " + c)));
  });
}
// the node process's id (systemd-run --scope runs it in place: the child itself)
const cpuTicks = pid => { try { const f = fs.readFileSync("/proc/" + pid + "/stat", "utf8").split(") ")[1].split(" "); return [+f[11], +f[12]]; } catch (e) { return [0, 0]; } };
const HZ = 100;   // (clock ticks a second: /proc's unit)

let addrN = 0;
const stats = { late: [], frames: 0, genStarts: 0 };   // (this step's: every client reports into it)
async function makeRoom() {
  const addr = "10." + (++addrN >> 16 & 255) + "." + (addrN >> 8 & 255) + "." + (addrN & 255);
  const seats = ROLES.map((r, i) => i < PLAYERS ? { kind: "open", team: i + 1 } : i < Math.max(2, PLAYERS) + 2 ? { kind: "easy", team: i + 1 } : { kind: "closed", team: i + 1 });
  const res = await fetch(`http://127.0.0.1:${PORT}/api/rooms`, { method: "POST", headers: { "Content-Type": "application/json", "x-load-addr": addr },
    body: JSON.stringify({ name: "Load " + addrN, seats, version: "dev" }) });
  const r = await res.json();
  if (!r.id) throw new Error("room: " + JSON.stringify(r));
  const clients = [];
  for (let i = 0; i < PLAYERS; i++) {
    const url = `ws://127.0.0.1:${PORT}/ws?room=${r.id}&cid=load-client-${addrN}-${i}&name=P${i}&v=dev&role=${ROLES[i]}` + (i === 0 ? "&host=" + r.hostKey : "");
    const c = { ws: new WebSocket(url, { headers: { "x-load-addr": addr } }), no: 0, t0: 0, n: 0 };
    c.ws.on("message", d => {
      const m = JSON.parse(d), now = performance.now();
      if (m.t === "match") { c.no = m.no; c.t0 = 0; c.n = m.n; }
      else if (m.t === "f" && m.m === c.no) {
        const n = m.n + m.f.length;                     // (frames made up to this message)
        if (!c.t0) c.t0 = now - n * TICK;               // (the first one: its clock's origin)
        const late = now - (c.t0 + n * TICK);
        if (late < 0) c.t0 += late;                    // (earlier than expected: the origin moves - the earliest = 0)
        else stats.late.push(late);
        if (Math.floor(c.n / 64) < Math.floor(n / 64)) send(c, { t: "h", m: c.no, n: Math.floor(n / 64) * 64, h: 12345 });   // (every client the same hash)
        c.n = n; stats.frames += m.f.length;
      }
    });
    await new Promise((res2, rej) => { c.ws.once("open", res2); c.ws.once("error", rej); });
    clients.push(c);
  }
  await sleep(300);
  for (const c of clients.slice(1)) send(c, { t: "ready", v: 1 });
  await sleep(300);
  send(clients[0], { t: "start" });
  // a player's keys change a few times a second; a ping every 2 s (the pages' ping)
  for (const c of clients) {
    c.keys = setInterval(() => send(c, { t: "b", v: [0, 1, 2, 4, 8, 16, 17, 18][Math.floor(Math.random() * 8)] }), 200 + Math.random() * 200);
    c.ping = setInterval(() => send(c, { t: "ping", c: Date.now() }), 2000);
  }
  return clients;
}
// a match on a large generated map, 1 player + 7 computer tanks: started at once (its map made by the server)
async function genMatch() {
  const addr = "10.200." + (++addrN >> 8 & 255) + "." + (addrN & 255);
  const seats = ROLES.map((r, i) => ({ kind: i ? "easy" : "open", team: i + 1 }));
  const r = await (await fetch(`http://127.0.0.1:${PORT}/api/rooms`, { method: "POST", headers: { "Content-Type": "application/json", "x-load-addr": addr },
    body: JSON.stringify({ name: "Gen " + addrN, seats, size: "large", map: "gen:labyrinth:natural", version: "dev" }) })).json();
  const c = { ws: new WebSocket(`ws://127.0.0.1:${PORT}/ws?room=${r.id}&cid=gen-client-${addrN}&name=G&v=dev&role=${ROLES[0]}&host=${r.hostKey}`, { headers: { "x-load-addr": addr } }) };
  await new Promise((res, rej) => { c.ws.once("open", res); c.ws.once("error", rej); });
  c.ws.on("message", d => { const m = JSON.parse(d); if (m.t === "err") console.log("gen match:", m.msg); if (m.t === "match") stats.genStarts++; });
  await sleep(200);
  send(c, { t: "start" });
  return c;
}
const send = (c, m) => { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(m)); };
const pct = (a, p) => a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : 0;

(async () => {
  const server = await startServer();
  console.log(`server: ${CPU ? CPU + "% of a core (systemd scope)" : "no CPU limit"}; ${PLAYERS} player(s) a match; ${SECS} s a step`);
  const all = [];
  let total = 0;
  try {
    for (const want of STEPS) {
      while (total < want) { all.push(await makeRoom()); total++; }
      await sleep(2000);                                  // (settle)
      stats.late = []; stats.frames = 0; stats.genStarts = 0;
      const c0 = cpuTicks(server.pid), t0 = performance.now();
      const gens = [];
      const genTimer = GEN_EVERY ? setInterval(() => genMatch().then(c => gens.push(c), e => console.log("gen match:", e.message)), GEN_EVERY * 1000) : null;
      await sleep(SECS * 1000);
      clearInterval(genTimer);
      for (const c of gens) c.ws.terminate();
      if (GEN_EVERY) console.log("(" + stats.genStarts + " generated-map matches started meanwhile)");
      const c1 = cpuTicks(server.pid), secs = (performance.now() - t0) / 1000;
      const user = (c1[0] - c0[0]) / HZ / secs * 100, sys = (c1[1] - c0[1]) / HZ / secs * 100, cpu = user + sys;
      const p50 = pct(stats.late, 0.5), p99 = pct(stats.late, 0.99), worst = stats.late.length ? Math.max(...stats.late) : 0;
      console.log(`${String(want).padStart(4)} matches, ${String(want * PLAYERS).padStart(4)} players: CPU ${cpu.toFixed(1).padStart(5)}% of a core (user ${user.toFixed(1)}, system ${sys.toFixed(1)}); ` +
        `late p50 ${p50.toFixed(0)} ms, p99 ${p99.toFixed(0)} ms, worst ${worst.toFixed(0)} ms${p99 > 100 ? "  <- late" : ""}`);
      if (p99 > 400) { console.log("(stopping: frames far behind)"); break; }
    }
  } finally {
    for (const cs of all) for (const c of cs) { clearInterval(c.keys); clearInterval(c.ping); c.ws.terminate(); }
    server.kill(PROF ? "SIGTERM" : "SIGKILL");
  }
})().catch(e => { console.error(e); process.exit(1); });
