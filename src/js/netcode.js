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

class Game
{
  constructor()
  {
    this.app = new WasmApp()
    this.videoBuffer = null;
    this.memoryBuffer = null;
    this.frame = 0;
    this.pathOur = [[0, 0]];
    this.pathTheir = [[0, 0]];
    this.ready = new Promise((resolve, reject)=>{this.resolveReady = resolve})
    this.seed = Math.floor(Math.random()*0x10000) | (Math.floor(Math.random()*0x10000)<<16)
  }

  load()
  {
    return this.app.load().then(() => {
      this.videoBuffer = new Uint8ClampedArray(this.app.memory.buffer, this.app.HEAP32[this.app.symbols.appVideo.value>>2], 640 * 400 * 4);
      this.memoryBuffer = new Uint8Array(this.app.memory.buffer, this.app.HEAP32[this.app.symbols.appMemory.value>>2], 0x10000*14);
      this.asyncifyBuffer = new Uint8Array(this.app.memory.buffer, this.app.HEAP32[this.app.symbols.asyncifyBuffer.value>>2], 1024+12);

      this.app.HEAP32[this.app.symbols.seed.value>>2] = this.seed;
      this.app.symbols.appLoop();
      this.app.symbols.asyncify_stop_unwind();
      // wait until map is generated
      this.app.asyncifyResume();
      this.app.asyncifyResume();
      this.app.asyncifyResume();
      this.app.asyncifyResume();
      // F1 to start a game
      this.app.HEAP32[this.app.symbols.lastKey.value>>2] = 0x3b00;
      this.app.asyncifyResume();
      this.app.HEAP32[this.app.symbols.lastKey.value>>2] = 0x0100;
      this.frame = 0;
      this.resolveReady();
    });
  }

  step(keyStateOur, keyStateTheir)
  {
    if (this.app.HEAP32[this.app.symbols.lastKey.value>>2] != 0x0100)
      return false;
    const keys = ["H".charCodeAt(0), "M".charCodeAt(0), "P".charCodeAt(0), "K".charCodeAt(0),
      0x1c, 0x01, 0x11, 0x2d, 0x1e, 0x20, 0x1d];
    for (let i=0; i<keys.length; i++)
      this.memoryBuffer[0x0ac30+0x14f0+keys[i]] = !!((keyStateOur | keyStateTheir) & (1<<i))
    Path.Append(this.pathOur, this.frame, keyStateOur);
    Path.Append(this.pathTheir, this.frame, keyStateTheir);
    this.app.asyncifyResume();
    this.frame++;
    return true;
  }
  state()
  {
    const getWord = (seg, ofs) => this.memoryBuffer[seg*16+ofs] + (this.memoryBuffer[seg*16+ofs+1]<<8);
    const getByte = (seg, ofs) => this.memoryBuffer[seg*16+ofs];

    return {
      round: getWord(0x0ac3, 0x1264),
      blue: {
        score: getWord(0x0ac3, 0x1266),
        x: getWord(0x0c41, 0x0ee6),
        y: getWord(0x0c41, 0x0eea),
        energy: getByte(0x0c41, 0x0c8c),
        shield: getByte(0x0c41, 0x0c84)
      },
      green: {
        score: getWord(0x0ac3, 0x1268),
        x: getWord(0x0c41, 0x0ee8),
        y: getWord(0x0c41, 0x0eec),
        energy: getByte(0x0c41, 0x0c8e),
        shield: getByte(0x0c41, 0x0c86)
      }};
  }
  render(ctx)
  {
    if (this.app.symbols.appBlit())
    {
      const img = new ImageData(this.videoBuffer, 640, 400);
      ctx.putImageData(img, 0, 0);
    }
  }

  copy(netGame)
  {
    this.videoBuffer.set(netGame.videoBuffer);
    this.memoryBuffer.set(netGame.memoryBuffer);
    this.asyncifyBuffer.set(netGame.asyncifyBuffer);
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
    this.password = "";
  }
  // offline: true for local-only hotseat modes (bare tunneler.html, or the dedicated
  // /play route) - the caller decides this from its own role, since there's no
  // reliable way to infer it here from the URL alone.
  //
  // password: only meaningful when this role (blue/green/spectate) has a join password
  // set on the session - sent inside the init packet itself (see buildInitPacket()/
  // reInit() below), never as a URL query param, so it never lands in browser
  // history/server logs/the Referer header. Stored on the instance so every later
  // reInit() call (polling for the seed, reconnects) resends it without the caller
  // having to pass it again.
  //
  // The server no longer seeds a session until both blue and green are connected (see
  // startSessionIfReady() in server.js), so this single handshake attempt may come back
  // with seed=0/started=0 if the caller is first to arrive - it's on the caller to poll
  // (via sync(), checking blueConnected/greenConnected) and call reInit() once the
  // server actually has a seed. connect() itself no longer retries internally.
  connect(masterSeed, offline = false, password = "")
  {
    this.password = password;
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
    const initPacket = this.buildInitPacket({seed:masterSeed, started:new Date().getTime(), password:this.password});
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
    // trailing bytes (if any) carry this role's join password, UTF-8 encoded - see
    // server.js's parseInitPacket(). Offline modes never set p.password (they never
    // reach here at all), and any role with no password set on the session just sends
    // "" - so this is the fixed 13-byte packet for them.
    const passwordBytes = new TextEncoder().encode(p.password || "");
    return [0x30, ...this.dwordToBytes(p.seed), ...this.timestampToBytes(p.started), ...passwordBytes];
  }
  parseInitPacket(buf)
  {
    if (buf[0] != 0x31 || buf.length != 13)
      throw new Error("wrong token");
    return {seed:this.bytesToDword(buf.slice(1, 1+4)), started:this.bytesToTimestamp(buf.slice(5, 5+8))};
  }

  // public:
  pathToBytes(path)
  {
    const buf = [];
    for (const point of path)
    {
      if (point[0] >= 0x10000 || point[1] >= 0x10000)
        throw new Error("Too large value to encode");
      buf.push(point[0]>>8, point[0]&255, point[1]>>8, point[1]&255);
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
  parseSyncPacket(buf)
  {
    if (buf[0] != 0x33 || buf.length % 4 != 1)
      throw new Error("wrong token");
    const path = [];
    let frame = this.bytesToDword(buf.slice(1, 5)) & 0xffffff;
    if (frame == 0xffffff)
      frame = -1;

    // top byte: bit0 = blue connected, bit1 = green connected, remaining 6 bits = total socket count
    const statusByte = this.bytesToDword(buf.slice(1, 5)) >> 24;
    const clients = statusByte >> 2;
    const blueConnected = !!(statusByte & 1);
    const greenConnected = !!(statusByte & 2);
    for (let i=5; i<buf.length; i+= 4)
      path.push([(buf[i]<<8)|(buf[i+1]), (buf[i+2]<<8)|(buf[i+3])]);

    return {frame:frame, clients:clients, blueConnected:blueConnected, greenConnected:greenConnected, path:path};
  }
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
