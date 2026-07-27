"use strict"

// Session/blue/green names are arbitrary user input read back out of a data-* attribute
// (already HTML-escaped once by server.js's sendWithSessionName() when it templated the
// attribute) - the browser un-escapes that when parsing the attribute, so the value
// tunneler.js/spectator.js get from .dataset is the raw original text again. Escaping it
// a second time here, right before it goes into an innerHTML template string (see both
// files' formatScore()), is what actually prevents it from being parsed as markup.
function escapeHtml(s)
{
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

let Path = {
  Extract(path, f)
  {
    // An empty path means this tank has never pressed anything (Append() deliberately
    // never seeds a [0,0] entry for an all-zero start - see its own comment), which is
    // exactly the common case for any tank that hasn't yet acted while OTHER tanks
    // already have entries in the same server response (e.g. right as the round-start
    // freeze ends and one player moves a beat before another) - default to "nothing
    // pressed" rather than crashing on path[0] of an empty array. That crash used to be
    // silently swallowed by netsync()'s outer .catch(), permanently freezing
    // gameRemote/spectator's replay from that point on - looked like "can't leave base,
    // keeps getting reset back inside" once recalc() next rewound gameLocal to that
    // stuck state (confirmed by user).
    if (path.length == 0)
      return 0;
    // TODO: slow
    const binarySearch = (a, t) => {
      for (let i=1; i<a.length; i++)
        if (a[i][0] > t)
          return i-1;
      return a.length-1;
    }
    if (f <= path[0][0])
      return path[0][1];
    const i = binarySearch(path, f);
    return path[i][1];
  },
  Append(path, frame, keyState)
  {
    if (path.length == 0 && keyState == 0)
      return;
    if (path.length == 0 || path[path.length-1][1] != keyState)
      path.push([frame, keyState]);
  },
  Sub(path, l, r)
  {
    const aux = [];
    for (const point of path)
      if (point[0] > l && point[0] <= r)
        aux.push([point[0], point[1]])
    return aux;
  }
}

// Wraps TunnelerEngine (engine/engine.js) to match the exact public surface this
// file's callers (tunneler.js's Session, spectator.js) already use - load()/
// step()/state()/render()/copy() plus the plain frame/paths/seed properties.
// Previously wrapped WasmApp (the emscripten-compiled DOS binary) - see the plan
// doc for why/how this was swapped.
//
// `paths` replaces the old single pathOur/pathTheir pair with one sparse
// [[frame,rawBits],...] array PER TANK (roster order) - a straight
// generalization of the old asymmetric 2-tank naming to up to 8 online seats
// (or exactly 2 for offline hotseat, which still goes through this same class -
// see tunneler.js's legacyTank0Bits()/legacyTank1Bits()). Whichever entry is
// "this client's own seat" is Session's concern (it knows its own seat index),
// not Game's - every tank's path is tracked uniformly here.
class Game
{
  constructor()
  {
    this.engine = null;
    this.frame = 0;
    this.paths = null;
    this.ready = new Promise((resolve, reject)=>{this.resolveReady = resolve})
    this.seed = Math.floor(Math.random()*0x10000) | (Math.floor(Math.random()*0x10000)<<16)
  }

  // roster/friendlyFire: see TunnelerEngine's constructor (engine.js). Defaults
  // match its own 2-tank default, for offline hotseat callers that don't care.
  load(roster = [{ team: 1, color: 0 }, { team: 2, color: 1 }], friendlyFire = false)
  {
    this.engine = new TunnelerEngine(this.seed, roster, friendlyFire);
    this.frame = 0;
    this.paths = roster.map(() => [[0, 0]]);
    this.resolveReady();
    return Promise.resolve();
  }

  // Single fixed 5-bit-per-tank layout (up=bit0,down=bit1,left=bit2,right=bit3,
  // fire=bit4), used identically for every tank now that each has its own
  // independent raw scalar instead of sharing one combined 11-bit field split
  // by bit-range - replaces the old decodeInputs(combinedBits) (see git history),
  // which depended on two DIFFERENT per-half bit orders that only worked because
  // both tanks' bits lived in one shared integer. tunneler.js's
  // legacyTank0Bits()/legacyTank1Bits() re-derive this same order from the old
  // hotseat layout for offline modes, so this decoder needs no hotseat special
  // case.
  static decodeInput(bits)
  {
    return {
      up: !!(bits & 1), down: !!(bits & 2), left: !!(bits & 4),
      right: !!(bits & 8), fire: !!(bits & 16),
    };
  }

  // rawStates: this tick's raw 5-bit (0-31) scalar per tank, roster order.
  // Recorded into this.paths (harmless bookkeeping even when never read, e.g.
  // offline hotseat) and decoded for the engine.
  step(rawStates)
  {
    for (let i = 0; i < rawStates.length; i++)
      Path.Append(this.paths[i], this.frame, rawStates[i]);
    this.engine.step(rawStates.map(Game.decodeInput));
    this.frame++;
    return true;
  }

  state()
  {
    return this.engine.snapshot();
  }

  // Field grid accessor for spectator.js's map overview - the new engine has no
  // packed framebuffer to read, just the plain field array.
  getField()
  {
    return this.engine.terrain;
  }

  // force is accepted for interface compatibility with tunneler.js's callers (the
  // old WASM engine had an appBlit() dirty-frame check `force` could bypass) - the
  // new engine has no such concept, it always redraws from current state.
  render(ctx, force = false)
  {
    this.engine.render(ctx);
  }

  // Copies netGame's ENGINE checkpoint into this instance (used by recalc() to
  // rewind gameLocal to gameRemote's last-confirmed state) - deliberately
  // doesn't touch this.paths, same as the old copy() never touched
  // pathOur/pathTheir: this instance's own recorded input history stays intact
  // across the rewind, it's only the simulated game state being reset.
  copy(netGame)
  {
    this.engine.copyFrom(netGame.engine);
    this.seed = netGame.seed;
    this.frame = netGame.frame;
  }
}

class Net
{
  constructor()
  {
    this.fps = 1000/30;
    this.lastFrame = 0;
    this.connected = false;
    this.offline = false;
  }
  // offline: true for local-only hotseat modes (bare tunneler.html, or the dedicated
  // /play route) - the caller decides this from its own role, since there's no
  // reliable way to infer it here from the URL alone.
  //
  // No passwords anywhere anymore (players or spectators) - seats are still
  // "whoever holds the link", same trust model as the rest of the app.
  //
  // The server doesn't seed a session until enough seats are filled AND every
  // occupied seat is ready (see startSessionIfReady() in server.js), so this
  // single handshake attempt may come back with seed=0/started=0 if the caller
  // gets here before that. It's on the caller to poll (via sync(), checking
  // resp.frame/connectedMask) and call reInit() once the server actually has a
  // seed. connect() itself no longer retries internally.
  connect(masterSeed, offline = false)
  {
    if (offline)
    {
      const p = {started:new Date().getTime(), seed:masterSeed};
      this.started = p.started;
      this.seed = p.seed;
      this.offline = true;
      return Promise.resolve(p);
    }

    return new Promise((resolve, reject) =>
    {
      let settled = false;
      // a plain relative path resolves against the page's own http(s) scheme, which the
      // WebSocket constructor rejects outright (it only accepts ws:/wss:) - build the
      // absolute ws(s) URL explicitly so this also works served over https.
      const wsProtocol = document.location.protocol == "https:" ? "wss:" : "ws:";
      this.socket = new WebSocket(wsProtocol + "//" + document.location.host + document.location.pathname);
      this.socket.addEventListener("open", async (event) => {
        this.connected = true;
        const p = await this.reInit(masterSeed);
        if (!p)
          return; // socket closed while the request was in flight - close handler below rejects
        settled = true;
        resolve(p)
      });

      this.socket.addEventListener("message", (event) => {
        if (this.receiver)
        {
          event.data.arrayBuffer().then( d=> {
            this.receiver(new Uint8Array(d))
            this.receiver = null;
          } );
        } else
          event.data.arrayBuffer().then(ab=>
            console.log("Unhandled message from server ", [...new Uint8Array(ab)]))
      });

      this.socket.addEventListener("close", (event) => {
        this.connected = false;
        // e.g. an unknown/never-lobby-minted session id gets closed right after the
        // handshake (see server.js) - without this, a pending transfer() would just
        // hang forever waiting for a response that will never arrive.
        if (this.receiver)
        {
          this.receiver(null);
          this.receiver = null;
        }
        if (!settled)
        {
          settled = true;
          reject(new Error("Connection closed" + (event.reason ? ": " + event.reason : "")));
        }
      });

    });
  }
  // Re-sends the init handshake on the already-open socket and updates this.seed/started
  // from the response. Used both by connect() itself and by callers polling for a seed
  // that didn't exist yet on the first attempt (see connect()'s doc comment above).
  // Returns null (rather than throwing) if the socket closed mid-request.
  async reInit(masterSeed)
  {
    const initPacket = this.buildInitPacket({seed:masterSeed, started:new Date().getTime()});
    const resp = await this.transfer(initPacket);
    if (!resp)
      return null;
    const p = this.parseInitPacket(resp);
    this.started = p.started;
    this.seed = p.seed;
    return p;
  }
  // private:
  transfer(buf)
  {
    return new Promise(resolve => {
      this.receiver = resp => {
        resolve(resp);
      };
      this.socket.send(new Uint8Array(buf));
    });
  }
  timestampToBytes(ts)
  {
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setFloat64(0, ts, true);
    return new Uint8Array(buffer);
  }
  dwordToBytes(dw)
  {
    return new Uint8Array([(dw >> 24) & 0xff, (dw >> 16) & 0xff, (dw >> 8) & 0xff, dw & 0xff]);
  }
  bytesToDword(b)
  {
    return (b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3];
  }
  bytesToTimestamp(b)
  {
    const view = new DataView(new Uint8Array(b).buffer);
    return view.getFloat64(0, true);
  }
  buildInitPacket(p)
  {
    return [0x30, ...this.dwordToBytes(p.seed), ...this.timestampToBytes(p.started)];
  }
  parseInitPacket(buf)
  {
    if (buf[0] != 0x31 || buf.length != 13)
      throw new Error("wrong token");
    return {seed:this.bytesToDword(buf.slice(1, 1+4)), started:this.bytesToTimestamp(buf.slice(5, 5+8))};
  }

  // public:
  // This client's own outgoing path only ever needs a 5-bit (0-31) keystate per
  // entry now (one tank's own inputs, not a combined multi-tank field) - 3 bytes/
  // entry (frame:u16, keystate:u8) instead of the old 4.
  pathToBytes(path)
  {
    const buf = [];
    for (const point of path)
    {
      if (point[0] >= 0x10000 || point[1] > 0x1f)
        throw new Error("Too large value to encode");
      buf.push(point[0]>>8, point[0]&255, point[1]);
    }
    return buf;
  }
  currentFrame()
  {
    const now = new Date().getTime();
    return Math.floor((now - this.started)/this.fps);
  }
  buildSyncPacket(frame, path)
  {
    const lastFrame = path.length ? path[path.length-1][0] : 0;
    const subPath = Path.Sub(path, this.lastFrame, lastFrame)
    this.lastFrame = lastFrame;
    return [0x32, ...this.dwordToBytes(frame), ...this.pathToBytes(subPath)];
  }
  // Response carries a SEAT-TAGGED merge of every connected tank's own sparse
  // path (4 bytes/entry: frame:u16, seat:u8, keystate:u8) rather than one
  // shared combined keystate - up to 8 tanks x 5 bits each can't fit in a
  // single bitwise-safe JS number (bitwise ops are 32-bit), so each tank keeps
  // its own independent scalar all the way through, same as Game.paths[].
  // connectedMask: bit i set = seat i has a live socket (fits exactly, 8 seats/
  // 8 bits). clients: total socket count including spectators (was folded into
  // the same byte as the 2 old connected-bits; a full byte of its own now that
  // 8 seats already use their own byte).
  parseSyncPacket(buf)
  {
    if (buf[0] != 0x33 || (buf.length - 7) % 4 != 0)
      throw new Error("wrong token");
    // bytesToDword's bitwise OR is 32-bit SIGNED - four 0xff bytes (the "no data yet"
    // sentinel the server sends for maxRecvFrame=-1, see server.js's getMaxRecvFrame())
    // naturally comes back as -1 already, not 0xffffffff/4294967295, so no separate
    // sentinel check is needed here at all (unlike the old 24-bit-masked design, which
    // had to compare against 0xffffff explicitly to get a reliably non-negative result).
    const frame = this.bytesToDword(buf.slice(1, 5));
    const connectedMask = buf[5];
    const clients = buf[6];
    const paths = [];
    for (let i = 7; i < buf.length; i += 4)
    {
      const f = (buf[i] << 8) | buf[i + 1], seat = buf[i + 2], keystate = buf[i + 3];
      if (!paths[seat])
        paths[seat] = [];
      paths[seat].push([f, keystate]);
    }
    return { frame, clients, connectedMask, paths };
  }
  // path: this seat's own sparse [[frame,keystate],...] array (Game.paths[mySeat]).
  sync(frame, path)
  {
    if (!this.connected)
      return Promise.reject(new Error("not connected"));
    return this.transfer(this.buildSyncPacket(frame, path))
     .then(resp => {
       return this.parseSyncPacket(resp);
     })
  }
}
