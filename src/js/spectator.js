"use strict"

class SpectatorSession
{
  constructor(ctx, mapCtx, scoreEl, sessionName, blueName, greenName)
  {
    this.ctx = ctx;
    this.mapCtx = mapCtx;
    this.scoreEl = scoreEl;
    this.sessionName = sessionName;
    this.blueName = blueName;
    this.greenName = greenName;
    this.net = new Net();
    this.game = new Game();
    this.running = false;
    this.waitSync = false;
    this.fullCanvas = document.createElement('canvas');
    this.fullCanvas.width = 640;
    this.fullCanvas.height = 400;
    this.fullCtx = this.fullCanvas.getContext('2d');
    // blue spawns on the left facing right, green on the right facing left (toward each
    // other - same assumption the waiting screen's 180deg green rotation makes) rather
    // than defaulting both to 0 and waiting for the first movement sample to correct it.
    this.heading = { blue: 0, green: Math.PI };
    this.prevPos = { blue: null, green: null };
    this.tankImages = { blue: new Image(), green: new Image() };
    this.tankImages.blue.src = "/assets/tank-blue.png";
    this.tankImages.green.src = "/assets/tank-green.png";
  }
  loadTankImages()
  {
    const wait = img => img.complete ? Promise.resolve() : new Promise(r => { img.onload = r; });
    return Promise.all([wait(this.tankImages.blue), wait(this.tankImages.green)]);
  }
  async start()
  {
    // this proposal is normally moot - the server doesn't seed a session until both
    // blue and green are connected (see startSessionIfReady() in server.js), so it just
    // ignores whatever we propose here. It only matters as a fallback in the (currently
    // unreachable) case that a spectator socket somehow becomes one of the two roles the
    // server checks for, which it can't - spectate is excluded from that check on purpose.
    const fallbackSeed = Math.floor(Math.random()*0x10000) | (Math.floor(Math.random()*0x10000)<<16);
    // tank images need to be loaded before waitForBothPlayers() below, not after - it
    // draws them on the waiting screen, not just later on the map overview
    const state = await this.connectWithPassword(fallbackSeed);
    if (!state)
      return; // user gave up on the password prompt - renderPasswordError() already ran
    this.game.seed = state.seed;
    await this.waitForBothPlayers();
    await this.game.load();
    this.running = true;
    setInterval(()=>{ this.netsync() }, 100);
  }

  // Connects with no password first (the common case: no password set on this
  // session). server.js only rejects the init packet - closing with reason "Wrong
  // spectate password" - once it's actually checked one (see handleInitMessage()), so
  // that's the one specific failure worth prompting and retrying on; anything else
  // (unknown session, network drop) is a real error and propagates. Never sends the
  // password as a URL query param - it only ever travels inside the init packet itself
  // (see netcode.js's Net.buildInitPacket()), so it's never logged/cached/left in
  // browser history the way a query string would be.
  async connectWithPassword(fallbackSeed)
  {
    let password = "";
    while (true)
    {
      try
      {
        const [state] = await Promise.all([this.net.connect(fallbackSeed, false, password), this.loadTankImages()]);
        return state;
      }
      catch (e)
      {
        if (!/wrong \w+ password/i.test(e.message))
          throw e;
        const entered = window.prompt("This session is spectate-password protected.\nEnter password:");
        if (entered === null)
        {
          this.renderPasswordError();
          return null;
        }
        password = entered;
      }
    }
  }

  renderPasswordError()
  {
    const canvas = this.ctx.canvas;
    this.ctx.fillStyle = "#000";
    this.ctx.fillRect(0, 0, canvas.width, canvas.height);
    this.ctx.fillStyle = "#fff";
    this.ctx.font = "20px sans-serif";
    this.ctx.textAlign = "center";
    this.ctx.fillText("No password entered - reload to try again.", canvas.width/2, canvas.height/2);
  }

  // The server doesn't generate a seed - i.e. there's no map, no game, nothing to
  // spectate at all - until both blue and green are connected (see startSessionIfReady()
  // in server.js). connect()'s handshake above may have come back with seed=0/started=0
  // if this spectator got here before either player did, so poll (same
  // empty-sync-request approach as tunneler.js's waitForOpponent(), which can't pollute
  // session.mergedPath) until both are in, then reInit() to fetch the now-real seed.
  async waitForBothPlayers()
  {
    this.renderWaitingMessage();
    while (true)
    {
      const resp = await this.net.sync(0, [[0, 0]]).catch(()=>null);
      if (resp && resp.blueConnected && resp.greenConnected)
        break;
      await new Promise(r => setTimeout(r, 500));
    }
    const state = await this.net.reInit(this.game.seed);
    this.game.seed = state.seed;
  }

  renderWaitingMessage()
  {
    const canvas = this.ctx.canvas;
    this.ctx.fillStyle = "#000";
    this.ctx.fillRect(0, 0, canvas.width, canvas.height);

    // green rotated 180deg (images point right by default) so the two tanks face each
    // other rather than both pointing the same way
    const drawAbove = (img, xOffset, rotate180) => {
      const w = 40, h = 40 * img.height / img.width;
      const x = canvas.width/2 + xOffset, y = canvas.height/2 - h/2 - 20;
      this.ctx.save();
      this.ctx.translate(x, y);
      if (rotate180)
        this.ctx.rotate(Math.PI);
      this.ctx.drawImage(img, -w/2, -h/2, w, h);
      this.ctx.restore();
    };
    drawAbove(this.tankImages.blue, -50, false);
    drawAbove(this.tankImages.green, 50, true);

    this.ctx.fillStyle = "#fff";
    this.ctx.font = "20px sans-serif";
    this.ctx.textAlign = "center";
    this.ctx.fillText("Waiting for players to connect…", canvas.width/2, canvas.height/2 + 16);
    this.formatScore(1, 0, 0);
  }
  async netsync()
  {
    if (this.waitSync || !this.running)
      return;
    this.waitSync = true;
    await this.net.sync(this.game.frame, [[0, 0]]).then(resp=>{
      this.waitSync = false;
      const path = resp.path;

      // unshift previous known state, so we can extract keys during simulation
      if (this.game.pathOur.length)
        path.unshift(this.game.pathOur[this.game.pathOur.length-1]);
      else
        path.unshift([0, 0]);

      // no key changes doesn't mean no time passed - keep advancing to the server's
      // ack'd frame even when path is otherwise empty (see tunneler.js's netsync)
      if (path.length == 1 && resp.frame > this.game.frame)
        path.push([resp.frame-1, path[0][1]]);

      const last = path.length ? path[path.length-1][0] : -1;
      for (let i=this.game.frame; i<=last; i++)
      {
        const keys = Path.Extract(path, i);
        if (!this.game.step(keys, 0))
        {
          this.running = false;
          break;
        }
      }
      this.renderFrame(resp.blueConnected, resp.greenConnected);
      this.renderMap();
      this.renderScore();
      this.setDisconnected(false);
    }).catch(e=>{
      // Net.sync() rejects outright while the websocket is down - without resetting
      // waitSync here, netsync() would early-return forever and never retry once
      // the socket reconnects.
      this.waitSync = false;
      this.setDisconnected(true);
    });
  }
  setDisconnected(disconnected)
  {
    const filter = disconnected ? "grayscale(1)" : "none";
    this.ctx.canvas.style.filter = filter;
    this.mapCtx.canvas.style.filter = filter;
  }
  renderFrame(blueConnected, greenConnected)
  {
    // Game.render() draws via putImageData, which ignores ctx.filter - so render the
    // full frame off-screen first, then copy each half across with filter applied.
    // blue renders on the left half, green on the right (see tunneler.js's crop).
    this.game.render(this.fullCtx);
    this.ctx.filter = blueConnected ? "none" : "grayscale(1)";
    this.ctx.drawImage(this.fullCanvas, 0, 0, 320, 400, 0, 0, 320, 400);
    this.ctx.filter = greenConnected ? "none" : "grayscale(1)";
    this.ctx.drawImage(this.fullCanvas, 320, 0, 320, 400, 320, 0, 320, 400);
    this.ctx.filter = "none";
  }
  renderMap()
  {
    if (!this.game.memoryBuffer)
      return;
    const pal = [0x000000, 0x0000b0, 0x00b000, 0x00b0b0, 0xb00000, 0xb000b0, 0xb0b000, 0xb0b0b0,
        0x808080, 0x0000ff, 0x00ff00, 0x00ffff, 0xff0000, 0xff00ff, 0xffff00, 0xffffff];
    const img = this.mapCtx.createImageData(1024, 480);
    let i = 0;
    for (let y=0; y<480; y++)
      for (let x=0; x<512; x++)
      {
        const c = this.game.memoryBuffer[64100+y*512+x];
        let cc = pal[c&15];
        img.data[i++] = (cc>>16)&255; img.data[i++] = (cc>>8)&255; img.data[i++] = cc&255; img.data[i++] = 255;
        cc = pal[c>>4];
        img.data[i++] = (cc>>16)&255; img.data[i++] = (cc>>8)&255; img.data[i++] = cc&255; img.data[i++] = 255;
      }
    this.mapCtx.putImageData(img, 0, 0);

    const s = this.game.state();
    // state().{blue,green}.x run ~8px right of their actual position on this map buffer -
    // found by testing, not derived, see CLAUDE.md
    const TANK_X_OFFSET = -8;
    const bx = s.blue.x + TANK_X_OFFSET, by = s.blue.y;
    const gx = s.green.x + TANK_X_OFFSET, gy = s.green.y;
    this.drawTank(bx, by, this.updateHeading("blue", bx, by), "blue");
    this.drawTank(gx, gy, this.updateHeading("green", gx, gy), "green");
  }
  // no facing byte is exposed by Game.state(), so heading is derived from movement
  // between samples instead - holds the last heading while stationary rather than
  // snapping to 0.
  updateHeading(key, x, y)
  {
    const prev = this.prevPos[key];
    if (prev)
    {
      const dx = x - prev.x, dy = y - prev.y;
      if (dx != 0 || dy != 0)
      {
        // movement is 8-directional - snap to the nearest 45deg step rather than
        // trust the raw angle, which can drift off-diagonal from sampling jitter
        const step = Math.PI / 4;
        this.heading[key] = Math.round(Math.atan2(dy, dx) / step) * step;
      }
    }
    this.prevPos[key] = {x:x, y:y};
    return this.heading[key];
  }
  drawTank(x, y, angle, colorKey)
  {
    // tank-{blue,green}.png (derived from tank.png) already point right (barrel at
    // angle 0), matching the atan2(dy,dx) convention updateHeading() uses.
    const img = this.tankImages[colorKey];
    const w = 8, h = 8 * img.height / img.width;
    const ctx = this.mapCtx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.drawImage(img, -w/2, -h/2, w, h);
    ctx.restore();
  }
  renderScore()
  {
    const s = this.game.state();
    this.formatScore(s.round, s.blue.score, s.green.score);
  }

  // shared by renderScore() (real values, once the game is running) and
  // waitForBothPlayers() (a "Round 1 - Blue: 0 | Green: 0" placeholder before it is).
  // blue is the left side, green the right (see tunneler.js's crop) - colors brightened
  // relative to the in-game palette so they stay legible on the banner's blue background.
  // sessionName/blueName/greenName are escaped here (not just once server-side) since
  // they're read back out of a data-* attribute and re-inserted via innerHTML - see
  // netcode.js's escapeHtml() for why that needs a second pass.
  formatScore(round, blueScore, greenScore)
  {
    this.scoreEl.innerHTML =
      `${escapeHtml(this.sessionName)} &mdash; Round ${round} &mdash; ` +
      `<span style="color:#9fcaff">${escapeHtml(this.blueName)}: ${blueScore}</span>` +
      `&nbsp;&nbsp;|&nbsp;&nbsp;` +
      `<span style="color:#7CFC00">${escapeHtml(this.greenName)}: ${greenScore}</span>`;
  }
}

const scoreEl = document.getElementById('score');
const sessionName = scoreEl.dataset.sessionName;
const blueName = scoreEl.dataset.blueName || "Blue";
const greenName = scoreEl.dataset.greenName || "Green";
const canvas = document.getElementById('canvas1');
const mapCanvas = document.getElementById('map');
const session = new SpectatorSession(canvas.getContext('2d'), mapCanvas.getContext('2d'), scoreEl, sessionName, blueName, greenName);
session.start();
