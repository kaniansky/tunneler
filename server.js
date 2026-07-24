"use strict";
process.title = "tunneler";

// webserver
const express = require("express");
const ws = require("ws");
const path = require("node:path");
const fs = require("node:fs");
const https = require("node:https");
const selfsigned = require("selfsigned");

// build.js/esbuild are a build-time concern, not a runtime one at all - server.js only
// ever serves whatever's already in public/ (see "Run / build / deploy" in CLAUDE.md:
// `npm run build`, `npm run watch`, or the Dockerfile's build stage produce it).

const HELP_TEXT = `Tunneler multiplayer server

Usage: node server.js [options]

Options:
  --port=N, --port N, -p=N, -p N               HTTP port (default: 8042, or PORT env var)
  --https-port=N, --https-port N, -P=N, -P N   HTTPS port (default: http port + 1, or HTTPS_PORT env var)
  --help, -h                                   Show this help and exit

CLI flags win over env vars if both are set. Serves the game over both HTTP and HTTPS at once - the
HTTPS listener uses a self-signed certificate, auto-generated into certs/ on first run. public/ must
already be built (\`npm run build\` or \`npm run watch\`) before starting - server.js does not build it
itself.`;

// bail before touching the filesystem/network at all
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(HELP_TEXT);
  process.exit(0);
}

const app = express();
app.disable("x-powered-by");
const wsServer = new ws.Server({ noServer: true });

// --port=8042 / --port 8042 / -p=8042 / -p 8042 (same shape for --https-port/-P),
// falling back to the given env var and then the default - CLI flag wins over env var,
// matching common CLI tool convention.
function parseArg(longName, shortName, envVar, fallback) {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === `--${longName}` || arg === `-${shortName}`) return argv[i + 1];
    if (arg.startsWith(`--${longName}=`)) return arg.slice(longName.length + 3);
    if (arg.startsWith(`-${shortName}=`)) return arg.slice(shortName.length + 2);
  }
  return process.env[envVar] || fallback;
}

console.log(HELP_TEXT + "\n");

const port = Number(parseArg("port", "p", "PORT", 8042));
// no --https-port given: default to port+1, so both listeners come up out of the box
// with no extra flags required.
const httpsPort = Number(parseArg("https-port", "P", "HTTPS_PORT", port + 1));

const server = app.listen(port, () =>
  console.log(`Tunneler at http://localhost:${port}/`),
);
// listen() failures (e.g. EADDRINUSE) surface as an async "error" event, not a thrown
// exception - without this handler they're an uncaught error that kills the process with
// a raw stack trace instead of a clear message.
server.on("error", (err) => {
  console.error(`Could not start HTTP listener on port ${port}:`, err.message);
  process.exit(1);
});

// Self-signed cert, generated once and cached on disk under certs/ so restarts don't
// re-generate (and re-trigger the browser's untrusted-cert warning) every time. This is
// NOT a real certificate - browsers will show a trust warning to click through. For a
// publicly trusted cert, put a real reverse proxy (nginx/Caddy) in front instead and
// point it at the plain http port above.
// selfsigned.generate() is async (5.x) - so this whole chain is too, and the actual
// https.createServer()/.listen() happens later (see the bottom of the file, once
// handleUpgrade exists) via startHttps().
async function ensureSelfSignedCert() {
  const certDir = path.join(__dirname, "certs");
  const keyPath = path.join(certDir, "key.pem");
  const certPath = path.join(certDir, "cert.pem");
  if (fs.existsSync(keyPath) && fs.existsSync(certPath))
    return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };

  console.log("Generating self-signed HTTPS certificate (first run)...");
  const pems = await selfsigned.generate([{ name: "commonName", value: "localhost" }], {
    days: 3650,
    keySize: 2048,
  });
  fs.mkdirSync(certDir, { recursive: true });
  fs.writeFileSync(keyPath, pems.private);
  fs.writeFileSync(certPath, pems.cert);
  return { key: pems.private, cert: pems.cert };
}

app.use(express.static("public"));
// only needed to read index.html's create-session form (see the /create route below) -
// it's a POST, not a GET, specifically so the passwords in it never end up in a URL
// (address bar, browser history, server access logs, Referer header) the way a GET's
// query string would put them.
app.use(express.urlencoded({ extended: false }));

const MAX_SID_LENGTH = 100;

// Shared by the HTTP "/:id" param handler and the websocket connection handler below, so
// a session name longer than this truncates identically on both paths - otherwise a long
// enough name would activate two different Session objects under two different (both
// truncated-inconsistently) keys, one from the lobby visit and another from the socket.
function normalizeSid(id) {
  return id.slice(0, MAX_SID_LENGTH);
}

function generateSeed() {
  return (
    Math.floor(Math.random() * 0x10000) |
    (Math.floor(Math.random() * 0x10000) << 16)
  );
}

// Turns a user-entered display name into a URL-safe id: same rules as index.js used to
// apply client-side, now the single source of truth server-side instead.
function slugify(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, MAX_SID_LENGTH);
}

// Title-cases a display name ("my game night" -> "My Game Night") - purely cosmetic,
// applied only to the stored displayName (what banners show), never to the id itself
// (slugify() already lowercases that, separately, for the URL).
function capitalizeWords(s) {
  return s.replace(/\S+/g, (word) => word[0].toUpperCase() + word.slice(1));
}

// Jitsi-style random room name ("Swift Tanks Ambush Quietly") for whoever submits the
// create form with no session name at all - picked from small themed word lists rather
// than e.g. random digits, so it's actually memorable/readable/shareable out loud.
const RANDOM_NAME_ADJECTIVES = ["Swift", "Rusty", "Silent", "Sneaky", "Fierce", "Lucky", "Bold", "Clever", "Shiny", "Grumpy"];
const RANDOM_NAME_NOUNS = ["Tanks", "Tunnels", "Badgers", "Moles", "Miners", "Shields", "Bunkers", "Turrets", "Wolves", "Hawks"];
const RANDOM_NAME_VERBS = ["Ambush", "Burrow", "Rumble", "Charge", "Collide", "Explode", "Retreat", "Advance", "Dig", "Strike"];
const RANDOM_NAME_ADVERBS = ["Quietly", "Fiercely", "Swiftly", "Bravely", "Wildly", "Cleverly", "Boldly", "Sneakily", "Loudly", "Relentlessly"];
function randomSessionName() {
  const pick = (words) => words[Math.floor(Math.random() * words.length)];
  return `${pick(RANDOM_NAME_ADJECTIVES)} ${pick(RANDOM_NAME_NOUNS)} ${pick(RANDOM_NAME_VERBS)} ${pick(RANDOM_NAME_ADVERBS)}`;
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// The ONLY way a session gets created - visiting/connecting to an id nobody has created
// this way is a 404/redirect (see app.param("id", ...) and the websocket handler below),
// not an auto-creation. Slugifies settings.displayName into the session's id; if that id
// is already taken, joins the EXISTING session rather than overwriting its settings (so
// two people naming sessions "My Game" and "my game" end up in the same one, keeping
// whoever got there first's settings). Does NOT seed the session - seed/started stay 0
// until startSessionIfReady() sees both blue and green connected.
//
// blueName/greenName are purely cosmetic (shown instead of "Blue"/"Green" in banners,
// scoreboards, and lobby buttons - see sendWithSessionName()); bluePassword/
// greenPassword gate joining those roles the same way spectatePassword already gates
// spectate - checked in handleInitMessage(), never as a URL query param (see
// "do not store the password in a url" - same reasoning applies to every role's
// password, not just spectate's).
function createSession(settings) {
  const id = slugify(settings.displayName);
  if (!id) return null;
  if (!(id in sessions)) {
    sessions[id] = new Session(id);
    const session = sessions[id];
    session.displayName = capitalizeWords(settings.displayName.trim().slice(0, MAX_SID_LENGTH));
    session.spectatePassword = settings.spectatePassword.trim().slice(0, MAX_SID_LENGTH);
    session.blueName = settings.blueName.trim().slice(0, MAX_SID_LENGTH);
    session.greenName = settings.greenName.trim().slice(0, MAX_SID_LENGTH);
    session.bluePassword = settings.bluePassword.trim().slice(0, MAX_SID_LENGTH);
    session.greenPassword = settings.greenPassword.trim().slice(0, MAX_SID_LENGTH);
    console.log("Created session", id, "-", session.displayName);
  }
  return id;
}

// Called whenever a socket joins. Once both blue and green are present, generates the
// seed/start-time that everyone (players and spectators) polls for - see Net.connect()/
// reInit() in netcode.js. Idempotent: does nothing once session.started is already set.
function startSessionIfReady(session) {
  if (session.started != 0) return;
  const blueConnected = session.sockets.some((s) => s.role == "blue");
  const greenConnected = session.sockets.some((s) => s.role == "green");
  if (blueConnected && greenConnected) {
    session.seed = generateSeed();
    session.started = Date.now();
    console.log(
      "Both players connected - starting session",
      session.id,
      session.seed.toString(16),
    );
  }
}

// Reads an HTML file and swaps in the session's display name/blue name/green name
// wherever {{SESSION_NAME}}/{{BLUE_NAME}}/{{GREEN_NAME}} appear - lobby.html (plain
// text) and tunneler.html/spectator.html (data attributes their JS reads at startup,
// since their banners keep rewriting themselves over the static markup). Falls back to
// "Blue"/"Green" when the session's creator didn't set custom names. escapeHtml()
// because all three are arbitrary user input landing inside HTML/an attribute value.
function sendWithSessionName(res, filename, session) {
  const html = fs.readFileSync(path.join(__dirname, "public", filename), "utf8");
  res.type("html").send(
    html
      .replace(/\{\{SESSION_NAME\}\}/g, escapeHtml(session.displayName))
      .replace(/\{\{BLUE_NAME\}\}/g, escapeHtml(session.blueName || "Blue"))
      .replace(/\{\{GREEN_NAME\}\}/g, escapeHtml(session.greenName || "Green")),
  );
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// the only route that creates a session - index.html's form submits here. POST (not
// GET) on purpose: the form carries up to three passwords, and a GET would put them in
// the request URL - visible in the address bar, saved in browser history, and logged by
// this (or any intermediate) server, none of which a POST body is.
app.post("/create", (req, res) => {
  const id = createSession({
    displayName: String(req.body.name || "").trim() || randomSessionName(),
    spectatePassword: String(req.body.spectatePassword || ""),
    blueName: String(req.body.blueName || ""),
    greenName: String(req.body.greenName || ""),
    bluePassword: String(req.body.bluePassword || ""),
    greenPassword: String(req.body.greenPassword || ""),
  });
  res.redirect(303, id ? "/" + id + "/" : "/");
});

// classic single-browser hotseat split-screen: purely local, no networking, no server
// session, no id needed at all. Registered BEFORE the "/:id" routes below - Express
// matches in registration order, and "/:id" would otherwise shadow this literal path
// (treating "play" as an id, activating and forever reusing one shared session literally
// named "play" for every visitor of this route).
app.get("/play", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "tunneler.html"));
});

// looks up (never creates) a session; bounces to the "name a session" page if the id
// doesn't exist - a manually-typed/guessed/stale-bookmarked id has nothing to join.
app.param("id", (req, res, next, id) => {
  const sid = normalizeSid(id);
  if (!(sid in sessions)) return res.redirect(307, "/");
  req.params.id = sid;
  next();
});

app.get(["/:id", "/:id/"], (req, res) => {
  sendWithSessionName(res, "lobby.html", sessions[req.params.id]);
});
app.get("/:id/blue", (req, res) => {
  sendWithSessionName(res, "tunneler.html", sessions[req.params.id]);
});
app.get("/:id/green", (req, res) => {
  sendWithSessionName(res, "tunneler.html", sessions[req.params.id]);
});
app.get("/:id/spectate", (req, res) => {
  // this page is just markup/canvas/script - no session-specific secret lives here, so
  // it's served unconditionally like blue/green. The actual game data only flows over
  // the websocket below, which is where the spectate password (if any) is checked -
  // see handleInitMessage() - never as a URL query param, so it never lands in browser
  // history/server logs/the Referer header.
  sendWithSessionName(res, "spectator.html", sessions[req.params.id]);
});

// tunneler.js calls this once a player detects the match is over (someone hit
// Session.WIN_SCORE) - the session has nothing left to relay at that point, so drop it
// immediately rather than waiting out the normal empty-socket grace period. Sockets
// already connected (finishing players/spectators watching the reveal) keep working
// fine - they hold a direct reference to the Session object, not a sessions[id] lookup -
// this only stops NEW joins/reconnects to an id that's done.
app.get("/:id/end", (req, res) => {
  const session = sessions[req.params.id];
  if (session.emptyTimer) clearTimeout(session.emptyTimer);
  delete sessions[req.params.id];
  console.log("Match ended - destroying session", req.params.id);
  res.sendStatus(204);
});

function handleUpgrade(request, socket, head) {
  wsServer.handleUpgrade(request, socket, head, (socket) => {
    wsServer.emit("connection", socket, request);
  });
}
server.on("upgrade", handleUpgrade);

async function startHttps() {
  try {
    const { key, cert } = await ensureSelfSignedCert();
    const httpsServer = https.createServer({ key, cert }, app);
    // same async-"error"-event issue as the http listener above, but non-fatal here -
    // https is a nice-to-have second listener, not the primary server.
    httpsServer.on("error", (err) => {
      console.error(`Could not start HTTPS listener on port ${httpsPort}:`, err.message);
    });
    httpsServer.listen(httpsPort, () =>
      console.log(`Tunneler at https://localhost:${httpsPort}/ (self-signed - browser will warn)`),
    );
    httpsServer.on("upgrade", handleUpgrade);
  } catch (err) {
    console.error("Could not start HTTPS listener, continuing with HTTP only:", err.message);
  }
}
startHttps();

// websocket

function pathSub(path, l, r) {
  const aux = [];
  for (const point of path)
    if (point[0] > l && point[0] <= r) aux.push([point[0], point[1]]);
  return aux;
}

class Session {
  constructor(id) {
    this.id = id;
    this.sockets = [];
    this.seed = 0;
    this.started = 0;
    this.fps = 0;
    this.mergedPath = [];
    this.emptyTimer = null;
    this.displayName = id;
    this.spectatePassword = "";
    this.blueName = "";
    this.greenName = "";
    this.bluePassword = "";
    this.greenPassword = "";
  }
}

class NetBackend {
  timestampToBytes(ts) {
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setFloat64(0, ts, true);
    return new Uint8Array(buffer);
  }
  dwordToBytes(dw) {
    return new Uint8Array([
      (dw >> 24) & 0xff,
      (dw >> 16) & 0xff,
      (dw >> 8) & 0xff,
      dw & 0xff,
    ]);
  }
  bytesToDword(b) {
    return (b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3];
  }
  bytesToTimestamp(b) {
    const view = new DataView(new Uint8Array(b).buffer);
    return view.getFloat64(0, true);
  }
  buildInitPacket(p) {
    return [
      0x31,
      ...this.dwordToBytes(p.seed),
      ...this.timestampToBytes(p.started),
    ];
  }
  parseInitPacket(buf) {
    if (buf[0] != 0x30 || buf.length < 13) throw new Error("wrong token");
    return {
      seed: this.bytesToDword(buf.slice(1, 1 + 4)),
      started: this.bytesToTimestamp(buf.slice(5, 5 + 8)),
      // trailing bytes (if any) are this role's join password, UTF-8 encoded - see
      // netcode.js's Net.buildInitPacket(). "" when the role has none set, or when the
      // client hasn't been prompted for one yet.
      password: buf.slice(13).toString("utf8"),
      path: [],
    };
  }
  pathToBytes(path) {
    const buf = [];
    for (const point of path)
      buf.push(point[0] >> 8, point[0] & 255, point[1] >> 8, point[1] & 255);
    return buf;
  }
  bytesToPath(buf) {
    const path = [];
    for (let i = 0; i < buf.length; i += 4)
      path.push([(buf[i] << 8) | buf[i + 1], (buf[i + 2] << 8) | buf[i + 3]]);
    return path;
  }
  parseSyncPacket(buf) {
    if (buf[0] != 0x32 || buf.length % 4 != 1) throw new Error("wrong token");
    const frame = this.bytesToDword(buf.slice(1, 5));
    return { frame: frame, path: this.bytesToPath(buf.slice(5, buf.length)) };
  }
  buildSyncPacket(path, frame, clients, startFrame) {
    const lastFrame = path.length ? path[path.length - 1][0] : 0;
    const subPath = pathSub(path, startFrame, lastFrame);
    // mask frame to 24 bits first - a negative frame (all bits set) would otherwise
    // swallow the whole top byte regardless of `clients`, corrupting it
    return [
      0x33,
      ...this.dwordToBytes((frame & 0xffffff) | (clients << 24)),
      ...this.pathToBytes(subPath),
    ];
  }
}

const sessions = {};
const net = new NetBackend();

// custom blue/green names are cosmetic only here (console logs) - the actual
// banner/scoreboard/lobby text comes from sendWithSessionName()'s {{BLUE_NAME}}/
// {{GREEN_NAME}} templating instead, since this runs server-side with no HTML to inject.
function roleLabel(session, role) {
  if (role == "spectate") return "Spectator";
  if (role == "blue") return session.blueName || "Blue";
  return session.greenName || "Green";
}

function passwordForRole(session, role) {
  if (role == "blue") return session.bluePassword;
  if (role == "green") return session.greenPassword;
  return session.spectatePassword;
}

function handleInitMessage(socket, session, role, msg) {
  // this role's join password (if the session's creator set one) travels inside this
  // packet, never as a URL query param or query string - it never lands in browser
  // history, server access logs, or the Referer header this way. Sent on every
  // connect()/reInit() (see netcode.js), so this also re-checks on reconnects.
  const { password } = net.parseInitPacket(msg);
  const requiredPassword = passwordForRole(session, role);
  if (requiredPassword && password != requiredPassword) {
    console.log(roleLabel(session, role), "gave wrong password for session", session.id);
    socket.close(4403, `Wrong ${role} password`);
    return;
  }
  // seed/started may still be 0 here if this is the first (or only) socket in the
  // session - startSessionIfReady() only sets them once both blue and green are in.
  console.log(roleLabel(session, role), "connected to session", session.id);
  socket.send(
    net.buildInitPacket({ seed: session.seed, started: session.started }),
  );
}

function handleSyncMessage(socket, session, msg) {
  const resp = net.parseSyncPacket(msg);
  socket.lastRecvFrame = resp.frame;

  if (resp.path.length) {
    // insert last value, we check for differences
    mergePath(session, [
      socket.path.length ? socket.path[socket.path.length - 1] : [0, 0],
      ...resp.path,
    ]);

    if (resp.path[0][0] < socket.sentFrame) throw new Error("continuity");
    socket.path = [...socket.path, ...resp.path];
  }

  const { frame: maxRecvFrame, path: mergedPath } = getMergedPath(session);
  const blueConnected = session.sockets.some((s) => s.role == "blue");
  const greenConnected = session.sockets.some((s) => s.role == "green");
  const statusByte =
    (blueConnected ? 1 : 0) |
    (greenConnected ? 2 : 0) |
    ((session.sockets.length & 0x3f) << 2);
  socket.send(
    net.buildSyncPacket(mergedPath, maxRecvFrame, statusByte, socket.sentFrame),
  );
  socket.sentFrame = maxRecvFrame;
}

const EMPTY_SESSION_TIMEOUT = 30 * 60 * 1000;

wsServer.on("connection", function (socket, request) {
  // path is "/<id>/<role>" (role: blue, green, spectate), mirroring the page's own HTTP
  // path exactly; bare "/<id>" (no role, shouldn't normally happen) is treated as blue
  const segments = new URL(request.url, "http://x").pathname
    .split("/")
    .filter(Boolean);
  const sid = normalizeSid(segments[0] || "");
  let role = segments[1] || "blue";
  if (!["blue", "green", "spectate"].includes(role)) role = "blue";
  socket.role = role;

  // sessions are only created via /create now - a socket to an id nobody created
  // (stale link, typo, expired session) has nothing to join.
  const session = sessions[sid];
  if (!session) {
    socket.close(4404, "Unknown session");
    return;
  }

  // someone rejoined before the empty-session grace period elapsed - keep it alive
  if (session.emptyTimer) {
    clearTimeout(session.emptyTimer);
    session.emptyTimer = null;
  }

  session.sockets.push(socket);
  socket.sentFrame = 0;
  socket.path = [];
  socket.lastRecvFrame = 0;
  startSessionIfReady(session);

  socket.on("message", function (msg) {
    if (msg[0] == 0x30) return handleInitMessage(socket, session, role, msg);
    if (msg[0] == 0x32) return handleSyncMessage(socket, session, msg);
    console.log(msg);
  });

  // When a socket closes, or disconnects, remove it from the array.
  socket.on("close", function () {
    console.log(roleLabel(session, socket.role), "disconnected from session", session.id);
    session.sockets = session.sockets.filter((s) => s !== socket);
    if (session.sockets.length == 0) {
      // don't tear down immediately - give everyone a grace period to reconnect
      // (reload, connection blip) before the session and its history are lost for good
      session.emptyTimer = setTimeout(() => {
        if (session.sockets.length == 0) {
          delete sessions[session.id];
          console.log(
            "Closing empty session",
            session.id,
            "remaining",
            Object.keys(sessions).length,
          );
        }
      }, EMPTY_SESSION_TIMEOUT);
    }
  });
});

function mergePath(session, path) {
  // 0th index is last value
  for (let i = 1; i < path.length; i++) {
    const changedKeys = path[i][1] ^ path[i - 1][1];
    const addedKeys = changedKeys & path[i][1];
    const removedKeys = changedKeys & path[i - 1][1];
    insertMergedPoint(session, {
      time: path[i][0],
      added: addedKeys,
      removed: removedKeys,
    });
  }
}

function insertMergedPoint(session, pt) {
  const mergedPath = session.mergedPath;
  if (mergedPath.length == 0 || pt.time < mergedPath[0].time) {
    mergedPath.unshift(pt);
    return;
  }
  if (pt.time > mergedPath[mergedPath.length - 1].time) {
    mergedPath.push(pt);
    return;
  }
  for (const element of mergedPath) {
    if (element.time == pt.time) {
      element.added |= pt.added;
      element.removed |= pt.removed;
      return;
    }
  }
  for (let i = 0; i < mergedPath.length - 1; i++) {
    if (pt.time > mergedPath[i].time && pt.time < mergedPath[i + 1].time) {
      mergedPath.splice(i + 1, 0, pt);
      return;
    }
  }
  throw new Error("could not place merged point - path is not sorted");
}

// TODO: this rebuilds the full running keystate from session.mergedPath on every sync
// call for every connected socket - fine for a short match, but it's unbounded work
// per call as a session's history grows. A cache keyed by the slowest connected
// client's frame would need to pick a cutoff safe for ALL clients (they call this with
// different progress), which is why there isn't one yet - do that before this becomes
// a real bottleneck, not by re-guessing it under time pressure.
function getMergedPath(session) {
  if (session.sockets.length == 0) return { frame: 0, path: [] };

  // throttle to the slowest actual player; with no players connected (e.g. only
  // spectators), fall back to any connected socket's own reported frame
  const players = session.sockets.filter((s) => s.role != "spectate");
  const maxFrame = players.length
    ? players
        .map((s) => s.lastRecvFrame)
        .reduce((a, b) => Math.min(a, b), players[0].lastRecvFrame) - 1
    : session.sockets[0].lastRecvFrame - 1;

  let keyState = 0;
  const path = [];
  for (const point of session.mergedPath) {
    keyState = (keyState | point.added) & ~point.removed;
    path.push([point.time, keyState]);
  }
  return { frame: maxFrame, path: path };
}
