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
// urlencoded: the /create form. json: the lobby's seat endpoints (/join, /seat/:n/*,
// /score) - all small structured POST bodies, no passwords in any of them anymore, so
// there's no longer a "keep it out of the URL" reason for POST specifically, but keeping
// them as POST still avoids bloating server access logs with per-keystroke-shaped noise
// a GET would accumulate.
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Map size presets a session can be created with - kept as a server-side whitelist
// (rather than accepting arbitrary client-supplied width/height) so a session can't be
// created with an unreasonably huge field. Same aspect ratio as the original fixed
// 1024x480 field (now "medium", the default - unchanged from before this existed).
const MAP_SIZE_PRESETS = {
  small: { x: 768, y: 360 },
  medium: { x: 1024, y: 480 },
  large: { x: 1536, y: 720 },
};

const MAX_SID_LENGTH = 100;
const MAX_SEATS = 8;
const MIN_SEATS = 2;
const MAX_TEAMS = 8;
const DEFAULT_WIN_SCORE = 3;
const MIN_WIN_SCORE = 1;
const MAX_WIN_SCORE = 20;

// A claimed-but-abandoned lobby seat (tab closed, no heartbeat since) is freed once its
// lastSeen is this stale - see the sweep in GET /:id/status and the heartbeat route
// below. Comfortably above lobby.jsx's own POLL_INTERVAL_MS (2s, which is also how often
// it heartbeats) so one dropped beat doesn't evict an idle-but-present player.
const STALE_SEAT_TIMEOUT_MS = 8000;

// how long the ready-up countdown holds once every seat is ready, before the match
// actually starts - see startSessionIfReady()/session.started below.
const MATCH_START_COUNTDOWN_MS = 5000;

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
// until startSessionIfReady() sees enough ready seats.
//
// No per-seat passwords (players or spectators are never individually gated) - seats are
// claimed via the lobby's own /join endpoint, first-come-first-served, same trust model
// as every other URL in this app. A session CAN have a single optional password gating
// the whole thing (session.password below, checked by /join, /:id/spectate, and
// /:id/verify-password) - one shared secret for the session, not per-role. friendlyFire is
// a fixed-for-the-match setting chosen at creation time (see engine-core.js's atest()).
function createSession(settings) {
  const id = slugify(settings.displayName);
  if (!id) return null;
  if (!(id in sessions)) {
    sessions[id] = new Session(id);
    const session = sessions[id];
    session.displayName = capitalizeWords(settings.displayName.trim().slice(0, MAX_SID_LENGTH));
    session.listed = settings.listed;
    session.allowSpectate = settings.allowSpectate;
    session.friendlyFire = settings.friendlyFire;
    // empty string = no password (falsy, gates nothing below) - a lightweight join/
    // spectate deterrent, same trust model as the rest of this app (plain string
    // compare, sent/checked over plain JSON - not meant to withstand a hostile client).
    session.password = String(settings.password || "").trim().slice(0, MAX_SID_LENGTH);
    session.mapSize = Object.hasOwn(MAP_SIZE_PRESETS, settings.mapSize) ? settings.mapSize : "medium";
    const maxPlayers = Number(settings.maxPlayers);
    const seatCount = Number.isInteger(maxPlayers)
      ? Math.min(MAX_SEATS, Math.max(MIN_SEATS, maxPlayers))
      : MAX_SEATS;
    session.seats = new Array(seatCount).fill(null);
    const winScore = Number(settings.winScore);
    session.winScore = Number.isInteger(winScore)
      ? Math.min(MAX_WIN_SCORE, Math.max(MIN_WIN_SCORE, winScore))
      : DEFAULT_WIN_SCORE;
    console.log("Created session", id, "-", session.displayName);
  }
  return id;
}

// Called whenever a seat is claimed/updated/readied/left, and once more on socket
// connect for safety. Starts the match once: at least 2 seats are occupied, EVERY
// occupied seat is ready, AND at least 2 distinct teams are represented (with only one
// team, last-team-standing could never produce a winner - see engine-core.js's
// totalTeams guard, which relies on this never seeding a single-team match). Generates
// the seed/start-time that everyone (players and spectators) polls for - see
// Net.connect()/reInit() in netcode.js. Idempotent: does nothing once session.started is
// already set.
function startSessionIfReady(session) {
  if (session.started != 0) return;
  const occupied = session.seats.filter(Boolean);
  if (occupied.length < 2 || !occupied.every((s) => s.ready)) return;
  if (new Set(occupied.map((s) => s.team)).size < 2) return;
  session.seed = generateSeed();
  // started is set to a few seconds in the future, not now - this both locks the roster
  // in immediately (every other route already guards on `started != 0`) and gives
  // clients a real timestamp to count down against (see /:id/status's startsAt).
  // Net.currentFrame() computing a negative frame number until this timestamp arrives is
  // harmless - callers only ever compare it against gameLocal.frame (starting at 0), so
  // the game clock simply idles rather than stepping early.
  session.started = Date.now() + MATCH_START_COUNTDOWN_MS;
  console.log(
    "All players ready - starting session",
    session.id,
    session.seed.toString(16),
  );
}

// Reads an HTML file and swaps in the session's display name wherever
// {{SESSION_NAME}} appears - lobby.html (plain text) and tunneler.html/spectator.html
// (a data attribute their JS reads at startup, since their banners keep rewriting
// themselves over the static markup). Per-player names/colors/teams are no longer
// templated server-side at all (there's no fixed "blue"/"green" to template) - the
// lobby/tunneler/spectator pages fetch the live seat roster from /:id/status instead.
// escapeHtml() because displayName is arbitrary user input landing inside HTML/an
// attribute value.
function sendWithSessionName(res, filename, session) {
  const html = fs.readFileSync(path.join(__dirname, "public", filename), "utf8");
  res.type("html").send(
    html.replace(/\{\{SESSION_NAME\}\}/g, escapeHtml(session.displayName)),
  );
}

// Shared validation for /join and /seat/:n/update: name is free text (truncated,
// defaulted if blank); color must be one of the MAX_SEATS palette indices
// (engine-render.js's PLAYER_COLORS - kept in sync manually, no shared schema file, same
// as the wire protocol opcodes); team is a plain 1-MAX_TEAMS grouping number, not
// required to be unique (that's the whole point - teammates share one). Returns null on
// any invalid field.
function validSeatFields(body) {
  const name = String(body.name || "").trim().slice(0, MAX_SID_LENGTH) || "Player";
  const color = Number(body.color);
  const team = Number(body.team);
  if (!Number.isInteger(color) || color < 0 || color >= MAX_SEATS) return null;
  if (!Number.isInteger(team) || team < 1 || team > MAX_TEAMS) return null;
  return { name, color, team };
}

// Colors are per-session-unique (not per-team) - engine-terrain.js bakes a player's
// CHOSEN color, not their seat index, into their base border's field value, so two
// players sharing a color would render identical (and collide in fieldColor()'s decode).
function colorTaken(session, color, excludeSeat = -1) {
  return session.seats.some((s, i) => s && i !== excludeSeat && s.color === color);
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// the only route that creates a session - index.html's form submits here. Still POST
// (not GET) even with passwords gone entirely - keeps per-keystroke-shaped form data out
// of the URL/access logs/Referer header on general principle, not for any secret left in
// this particular form.
app.post("/create", (req, res) => {
  const id = createSession({
    displayName: String(req.body.name || "").trim() || randomSessionName(),
    // an unchecked checkbox sends no field at all (not "off") - only "on" means checked
    listed: req.body.listed == "on",
    allowSpectate: req.body.allowSpectate == "on",
    friendlyFire: req.body.friendlyFire == "on",
    mapSize: req.body.mapSize,
    maxPlayers: req.body.maxPlayers,
    winScore: req.body.winScore,
    password: req.body.password,
  });
  res.redirect(303, id ? "/" + id + "/" : "/");
});

// polled by index.html's game list (index.js) - only sessions whose creator left the
// "list publicly" checkbox on the create form checked (default: checked) show up here;
// everyone else is joinable only by whoever already has the link, same as before this
// existed. Registered before app.param("id", ...)/the "/:id" routes below for the same
// reason /play and /ai are - otherwise "/games" itself would be swallowed as a session id.
app.get("/games", (req, res) => {
  res.json(
    Object.values(sessions)
      .filter((s) => s.listed)
      .map((s) => ({
        id: s.id,
        name: s.displayName,
        players: s.seats.filter(Boolean).length,
        maxPlayers: s.seats.length,
        hasPassword: !!s.password,
        mapSize: s.mapSize,
        round: s.round,
        teamScores: s.teamScores,
      })),
  );
});

// the create-network-game form now lives on its own page (index.html only shows
// singleplayer/split-screen links + the public games list) - registered before the
// "/:id" routes below for the same reason "/play"/"/games" are: "/:id" is a wildcard
// and would otherwise swallow "new" as a session id.
app.get("/new", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "create.html"));
});

// classic single-browser hotseat split-screen: purely local, no networking, no server
// session, no id needed at all. Registered BEFORE the "/:id" routes below - Express
// matches in registration order, and "/:id" would otherwise shadow this literal path
// (treating "play" as an id, activating and forever reusing one shared session literally
// named "play" for every visitor of this route).
app.get("/play", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "tunneler.html"));
});

// singleplayer vs a simple built-in AI (green) - same story as /play: purely local, no
// networking, no server session, registered before "/:id" for the same reason.
// difficulty (easy/medium/hard) is read client-side from the path by tunneler.js/ai.js,
// not by this route - a bare "/ai" defaults to "medium" there.
app.get(["/ai", "/ai/easy", "/ai/medium", "/ai/hard"], (req, res) => {
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

// Checked by lobby.jsx before it shows any seat/join UI at all (and cached client-side
// per session so it's asked once, not on every visit) - a plain password compare, same
// trust model as the rest of this app, not meant to withstand a hostile client. A session
// with no password set always passes, so callers don't need to special-case that first.
app.post("/:id/verify-password", (req, res) => {
  const session = sessions[req.params.id];
  if (session.password && req.body.password !== session.password)
    return res.status(403).json({ error: "wrong password" });
  res.sendStatus(204);
});

// Seat lifecycle - all pre-start (once session.started is set the roster is locked in,
// see startSessionIfReady()). Seats are claimed first-come-first-served, no auth beyond
// "whoever has the session link", same trust model as every other URL in this app.
app.post("/:id/join", (req, res) => {
  const session = sessions[req.params.id];
  if (session.started != 0) return res.status(409).json({ error: "already started" });
  if (session.password && req.body.password !== session.password)
    return res.status(403).json({ error: "wrong password" });
  const fields = validSeatFields(req.body);
  if (!fields) return res.status(400).json({ error: "invalid fields" });
  const seat = session.seats.findIndex((s) => s == null);
  if (seat == -1) return res.status(409).json({ error: "session full" });
  if (colorTaken(session, fields.color)) return res.status(409).json({ error: "color taken" });
  session.seats[seat] = { ...fields, ready: false, lastSeen: Date.now() };
  res.json({ seat });
});
// editing a seat un-readies it - the other players should see (and re-confirm against)
// whatever just changed rather than the match silently starting mid-edit.
app.post("/:id/seat/:n/update", (req, res) => {
  const session = sessions[req.params.id];
  const n = Number(req.params.n);
  if (session.started != 0) return res.status(409).json({ error: "already started" });
  if (!session.seats[n]) return res.status(404).json({ error: "seat not claimed" });
  const fields = validSeatFields(req.body);
  if (!fields) return res.status(400).json({ error: "invalid fields" });
  if (colorTaken(session, fields.color, n)) return res.status(409).json({ error: "color taken" });
  session.seats[n] = { ...fields, ready: false, lastSeen: Date.now() };
  res.sendStatus(204);
});
app.post("/:id/seat/:n/ready", (req, res) => {
  const session = sessions[req.params.id];
  const n = Number(req.params.n);
  if (!session.seats[n]) return res.status(404).json({ error: "seat not claimed" });
  session.seats[n].ready = !!req.body.ready;
  session.seats[n].lastSeen = Date.now();
  startSessionIfReady(session);
  res.sendStatus(204);
});
app.post("/:id/seat/:n/leave", (req, res) => {
  const session = sessions[req.params.id];
  const n = Number(req.params.n);
  if (session.started != 0) return res.status(409).json({ error: "already started" });
  session.seats[n] = null;
  res.sendStatus(204);
});
// lobby.jsx sends this alongside its normal status poll, for as long as this browser
// holds a seat - keeps that seat's lastSeen fresh so the sweep in GET /:id/status (below)
// doesn't mistake "tab still open, just idle" for "tab was closed". A missing seat here
// (already left/kicked/session gone) is a no-op, not an error - nothing to bump.
app.post("/:id/seat/:n/heartbeat", (req, res) => {
  const session = sessions[req.params.id];
  const n = Number(req.params.n);
  if (session.seats[n]) session.seats[n].lastSeen = Date.now();
  res.sendStatus(204);
});

// blue/green's page is now one generic per-seat page - a direct/bookmarked/shared URL to
// a seat nobody's claimed (or that's already connected - see the websocket handler's
// occupancy check below) bounces back to this session's own lobby, same reasoning as
// app.param("id", ...) above for an unknown id entirely.
app.get("/:id/seat/:n", (req, res) => {
  const session = sessions[req.params.id];
  const n = Number(req.params.n);
  if (!(n >= 0 && n < session.seats.length) || !session.seats[n])
    return res.redirect(307, "/" + session.id + "/");
  sendWithSessionName(res, "tunneler.html", session);
});

// polled by lobby.js to render the live seat grid (name/color/team/ready per seat) and by
// tunneler.js/spectator.js while waiting for the match to start.
app.get("/:id/status", (req, res) => {
  const session = sessions[req.params.id];
  // Free any seat whose tab went away without ever calling /leave (closed, crashed,
  // lost network) - piggybacked on this poll rather than a standalone timer, since every
  // lobby viewer already hits this endpoint every couple seconds regardless. Only while
  // still in the lobby - once started, an abandoned seat is the websocket layer's
  // problem (connectedMask), not this one's.
  if (session.started == 0) {
    const now = Date.now();
    session.seats.forEach((s, i) => {
      if (s && now - (s.lastSeen || 0) > STALE_SEAT_TIMEOUT_MS) session.seats[i] = null;
    });
  }
  res.json({
    seats: session.seats.map((s) =>
      s ? { name: s.name, color: s.color, team: s.team, ready: s.ready } : null,
    ),
    friendlyFire: session.friendlyFire,
    mapSize: session.mapSize,
    mapSizeX: MAP_SIZE_PRESETS[session.mapSize].x,
    mapSizeY: MAP_SIZE_PRESETS[session.mapSize].y,
    winScore: session.winScore,
    allowSpectate: session.allowSpectate,
    round: session.round,
    teamScores: session.teamScores,
    started: session.started != 0,
    hasPassword: !!session.password,
    // raw scheduled-start timestamp (0 if not started yet) - lets clients render a
    // countdown for the MATCH_START_COUNTDOWN_MS gap between "started" flipping true and
    // the match actually running; `started` alone only says "roster is locked in".
    startsAt: session.started,
  });
});
// the lowest-connected seat's client calls this whenever the round/teamScores change
// (see tunneler.js's renderScore()) - the server never runs game logic itself, so this
// is the only way it learns a score to show in /games' list. Purely cosmetic: never fed
// back into the game, never authoritative over anything the wire protocol already
// handles.
app.post("/:id/score", (req, res) => {
  const session = sessions[req.params.id];
  session.round = Number(req.body.round) || 1;
  session.teamScores =
    req.body.teamScores && typeof req.body.teamScores === "object" ? req.body.teamScores : {};
  res.sendStatus(204);
});
app.get("/:id/spectate", (req, res) => {
  const session = sessions[req.params.id];
  // creator turned spectating off entirely (the "allow spectate" checkbox on the create
  // form) - bounce back to this session's own lobby, same as an unclaimed/taken seat
  // above, rather than serving a page that can never actually connect (the websocket
  // handler below refuses the same session/role regardless).
  if (!session.allowSpectate) return res.redirect(307, "/" + session.id + "/");
  if (session.password && req.query.password !== session.password)
    return res.redirect(307, "/" + session.id + "/");
  sendWithSessionName(res, "spectator.html", session);
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

class Session {
  constructor(id) {
    this.id = id;
    this.sockets = [];
    this.seed = 0;
    this.started = 0;
    this.emptyTimer = null;
    this.displayName = id;
    this.friendlyFire = false;
    this.mapSize = "medium";
    this.winScore = DEFAULT_WIN_SCORE;
    this.listed = true;
    this.allowSpectate = true;
    // seats[n] = null (open) or {name, color, team, ready}, claimed via /join
    this.seats = new Array(MAX_SEATS).fill(null);
    // paths[seat] = that seat's own accumulated sparse [[frame,keystate],...] input
    // history, appended to directly from that seat's own sync requests. Unlike the old
    // 2-player design, seats no longer share bits within one combined keystate, so
    // there's no XOR-diff bitmask merge to compute anymore - each seat's own reported
    // path already IS its complete canonical history, verbatim.
    this.paths = [];
    this.round = 1;
    this.teamScores = {};
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
    if (buf[0] != 0x30 || buf.length != 13) throw new Error("wrong token");
    return {
      seed: this.bytesToDword(buf.slice(1, 1 + 4)),
      started: this.bytesToTimestamp(buf.slice(5, 5 + 8)),
    };
  }
  // Client->server: this seat's own sparse path only, 3 bytes/entry (frame:u16,
  // keystate:u8, 0-31 - one tank's own up/down/left/right/fire bits, see netcode.js's
  // Game.decodeInput()) - no seat tag needed, the socket's own seat is already known
  // from its connection URL.
  parseSyncPacket(buf) {
    if (buf[0] != 0x32 || (buf.length - 5) % 3 != 0) throw new Error("wrong token");
    const frame = this.bytesToDword(buf.slice(1, 5));
    const path = [];
    for (let i = 5; i < buf.length; i += 3)
      path.push([(buf[i] << 8) | buf[i + 1], buf[i + 2]]);
    return { frame, path };
  }
  // Server->client: a seat-tagged merge of every seat's own sparse path, 4 bytes/entry
  // (frame:u16, seat:u8, keystate:u8) - up to 8 tanks x 5 bits each can't fit in one
  // bitwise-safe JS number (bitwise ops are 32-bit), so unlike the old design this never
  // combines seats into a single shared keystate at all, each stays its own scalar all
  // the way through. connectedMask: bit i set = seat i has a live socket right now
  // (fits exactly in one byte for 8 seats). clients: total socket count including
  // spectators - its own byte now that connectedMask already needs all 8 bits of the one
  // it used to share 2 of.
  buildSyncPacket(merged, frame, connectedMask, clients) {
    const buf = [0x33, ...this.dwordToBytes(frame >>> 0), connectedMask & 0xff, clients & 0xff];
    for (const e of merged) buf.push(e.time >> 8, e.time & 255, e.seat & 0xff, e.keystate & 0xff);
    return buf;
  }
}

const sessions = {};
const net = new NetBackend();

function seatLabel(socket) {
  return socket.seat != null ? `Seat ${socket.seat}` : "Spectator";
}

function handleInitMessage(socket, session, msg) {
  net.parseInitPacket(msg); // shape-only validation now - no password to check
  // seed/started may still be 0 here if not enough seats are ready yet - see
  // startSessionIfReady(). Sent on every connect()/reInit() (see netcode.js), so this
  // also re-answers on reconnects with whatever the session currently has.
  console.log(seatLabel(socket), "connected to session", session.id);
  socket.send(
    net.buildInitPacket({ seed: session.seed, started: session.started }),
  );
}

function handleSyncMessage(socket, session, msg) {
  const resp = net.parseSyncPacket(msg);
  socket.lastRecvFrame = resp.frame;

  // spectators have no seat/path of their own to contribute - they only ever receive.
  if (socket.seat != null && resp.path.length) {
    if (resp.path[0][0] < socket.sentFrame) throw new Error("continuity");
    if (!session.paths[socket.seat]) session.paths[socket.seat] = [];
    session.paths[socket.seat].push(...resp.path);
  }

  const maxRecvFrame = getMaxRecvFrame(session);
  // Every seat's own entries newer than what THIS socket has already been sent, up to
  // the slowest-client throttle - same incremental-delta shape as the old single-path
  // design, just seat-tagged and flattened across all seats instead of one shared
  // stream. TODO: same as the old getMergedPath() - this walks every seat's full stored
  // path on every call, unbounded as a session's history grows; fine for a match-length
  // session, revisit with a real cache before it's a bottleneck.
  const merged = [];
  for (let seat = 0; seat < session.paths.length; seat++) {
    const p = session.paths[seat];
    if (!p) continue;
    for (const [t, ks] of p)
      if (t > socket.sentFrame && t <= maxRecvFrame) merged.push({ time: t, seat, keystate: ks });
  }
  merged.sort((a, b) => a.time - b.time);

  const connectedMask = session.sockets.reduce(
    (m, s) => (s.seat != null ? m | (1 << s.seat) : m),
    0,
  );
  socket.send(net.buildSyncPacket(merged, maxRecvFrame, connectedMask, session.sockets.length));
  socket.sentFrame = maxRecvFrame;
}

// Slowest-connected-player throttle: no client's canonical timeline advances faster than
// a straggler can confirm. Spectators are excluded (a lagging/idle spectator shouldn't
// stall real players); with no players connected at all (spectator-only), falls back to
// any connected socket's own reported frame.
function getMaxRecvFrame(session) {
  if (session.sockets.length == 0) return 0;
  const players = session.sockets.filter((s) => s.seat != null);
  if (!players.length) return session.sockets[0].lastRecvFrame - 1;
  return (
    players.map((s) => s.lastRecvFrame).reduce((a, b) => Math.min(a, b), players[0].lastRecvFrame) - 1
  );
}

const EMPTY_SESSION_TIMEOUT = 5 * 60 * 1000;

wsServer.on("connection", function (socket, request) {
  // path is "/<id>/seat/<n>" (gameplay, n = a seat already claimed via /join) or
  // "/<id>/spectate" - mirrors the page's own HTTP path exactly, see "/:id/seat/:n" and
  // "/:id/spectate" above.
  const segments = new URL(request.url, "http://x").pathname
    .split("/")
    .filter(Boolean);
  const sid = normalizeSid(segments[0] || "");

  // sessions are only created via /create now - a socket to an id nobody created
  // (stale link, typo, expired session) has nothing to join.
  const session = sessions[sid];
  if (!session) {
    socket.close(4404, "Unknown session");
    return;
  }

  let seat = null;
  if (segments[1] == "spectate") {
    if (!session.allowSpectate) {
      socket.close(4403, "Spectating disabled for this session");
      return;
    }
  } else if (segments[1] == "seat" && /^\d+$/.test(segments[2] || "")) {
    seat = Number(segments[2]);
    if (seat < 0 || seat >= session.seats.length || !session.seats[seat]) {
      socket.close(4404, "Seat not claimed");
      return;
    }
    // single-occupancy per seat - a second socket can't join a seat someone else
    // already holds (would let two clients drive the same tank).
    if (session.sockets.some((s) => s.seat == seat)) {
      socket.close(4409, `Seat ${seat} already connected`);
      return;
    }
  } else {
    socket.close(4400, "Unknown role");
    return;
  }
  socket.seat = seat;

  // someone rejoined before the empty-session grace period elapsed - keep it alive
  if (session.emptyTimer) {
    clearTimeout(session.emptyTimer);
    session.emptyTimer = null;
  }

  session.sockets.push(socket);
  socket.sentFrame = 0;
  socket.lastRecvFrame = 0;
  startSessionIfReady(session);

  socket.on("message", function (msg) {
    if (msg[0] == 0x30) return handleInitMessage(socket, session, msg);
    if (msg[0] == 0x32) return handleSyncMessage(socket, session, msg);
    console.log(msg);
  });

  // When a socket closes, or disconnects, remove it from the array.
  socket.on("close", function () {
    console.log(seatLabel(socket), "disconnected from session", session.id);
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
