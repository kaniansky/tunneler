"use strict"

class KeyFilter
{
  constructor()
  {
    this.localKeys = 0;
    this.localKeysBuf = [];
    this.localKeysFilter = 0;
  }
  put(keys)
  {
    this.localKeysBuf.push(keys);
    this.localKeys = 0;
    if (this.localKeysBuf.length > 10)
      this.localKeysBuf.shift();
    this.localKeysFilter = this.localKeysBuf.reduce((a, b) => a | b, 0);
  }
  get()
  {
    return this.localKeysFilter;
  }
}

class Session
{
  // first to this many round wins takes the match - once either score reaches it, the
  // WASM engine shows a full-screen map reveal instead of split-screen gameplay (see
  // render() below).
  static WIN_SCORE = 3;

  // role: 0 (bare tunneler.html) and "play" (/play) show the full split screen and
  // run fully local/offline, no networking at all. "blue"/"green" crop to that player's
  // own half and talk to the server, so remote players can't see their opponent's side.
  //
  // blueName/greenName: cosmetic display names (default "Blue"/"Green") shown in the
  // scoreboard/title instead of the role names - see the bootstrap code at the bottom of
  // this file for where they come from.
  constructor(ctx, role, offline, scoreEl, blueName, greenName)
  {
    this.ctx = ctx;
    this.role = role;
    this.offline = offline;
    this.scoreEl = scoreEl;
    this.blueName = blueName;
    this.greenName = greenName;
    this.net = new Net();
    this.gameLocal = new Game();
    this.gameRemote = new Game();
    this.keyEstimate = 0;
    this.keyState = 0;
    this.keyFilter = new KeyFilter();
    this.waitSync = false;
    this.running = false;
    this.matchEnded = false;
    if (role == "blue" || role == "green")
    {
      this.fullCanvas = document.createElement('canvas');
      this.fullCanvas.width = 640;
      this.fullCanvas.height = 400;
      this.fullCtx = this.fullCanvas.getContext('2d');
      // shown above the "Waiting for opponent..." message - own tank, matching own role
      this.tankImage = new Image();
      this.tankImage.src = "/assets/tank-" + role + ".png";
    }
  }
  loadTankImage()
  {
    if (!this.tankImage)
      return Promise.resolve();
    return this.tankImage.complete ? Promise.resolve() : new Promise(r => { this.tankImage.onload = r; });
  }
  async start()
  {
    // load before waitForOpponent() so it's ready the instant it needs to draw it, not
    // partway through the wait
    await this.loadTankImage();
    const state = await this.connectWithPassword();
    if (!state)
      return; // user gave up on the password prompt - renderPasswordError() already ran
    this.gameRemote.seed = this.gameLocal.seed = state.seed;
    await this.waitForOpponent();
    await Promise.all([this.gameLocal.load(), this.gameRemote.load()]);
    this.running = true;
    setInterval(()=>{
      this.iterate();
    }, 1000/this.net.fps);
    setInterval(async ()=>{
      await this.netsync();
    }, 100);
  }

  // Connects with no password first (the common case: this role has none set).
  // server.js only rejects the init packet - closing with reason "Wrong <role>
  // password" (see handleInitMessage()) - once it's actually checked one, so that's the
  // one specific failure worth prompting and retrying on; anything else (unknown
  // session, network drop) is a real error and propagates. Never sends the password as
  // a URL query param - it only travels inside the init packet itself (see netcode.js's
  // Net.buildInitPacket()). offline modes never reject at all, so this resolves
  // immediately for them without ever prompting.
  async connectWithPassword()
  {
    let password = "";
    while (true)
    {
      try
      {
        return await this.net.connect(this.gameLocal.seed, this.offline, password);
      }
      catch (e)
      {
        if (!/wrong \w+ password/i.test(e.message))
          throw e;
        const entered = window.prompt(`This ${this.role} slot is password-protected.\nEnter password:`);
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

  // blue/green shouldn't be able to move before the other player has joined - the game
  // clock (Net.currentFrame()) runs off wall-clock time from when the server actually
  // seeds the session regardless, so starting solo would give whoever arrives first a
  // head start once the other catches up. Poll with empty sync requests (frame 0, no
  // path - Path.Sub against lastFrame=0 always encodes nothing, so this can't pollute
  // session.mergedPath) until the server reports both roles connected. Hotseat/offline
  // modes have no "opponent" concept, so skip this.
  async waitForOpponent()
  {
    if (this.role != "blue" && this.role != "green")
      return;
    this.renderWaitingMessage();
    this.formatScore(1, 0, 0);
    while (true)
    {
      const resp = await this.net.sync(0, [[0, 0]]).catch(()=>null);
      if (resp && resp.blueConnected && resp.greenConnected)
        break;
      await new Promise(r => setTimeout(r, 500));
    }
    // the server doesn't generate a real seed until both roles are connected (see
    // startSessionIfReady() in server.js) - connect()'s original handshake may have come
    // back with seed=0/started=0 if we got here first, so fetch it again now that it's
    // guaranteed to exist.
    const state = await this.net.reInit(this.gameLocal.seed);
    this.gameRemote.seed = this.gameLocal.seed = state.seed;
  }

  renderWaitingMessage()
  {
    const canvas = this.ctx.canvas;
    this.ctx.fillStyle = "#000";
    this.ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (this.tankImage)
    {
      const w = 48, h = 48 * this.tankImage.height / this.tankImage.width;
      this.ctx.drawImage(this.tankImage, canvas.width/2 - w/2, canvas.height/2 - h - 20, w, h);
    }
    this.ctx.fillStyle = "#fff";
    this.ctx.font = "20px sans-serif";
    this.ctx.textAlign = "center";
    this.ctx.fillText("Waiting for opponent…", canvas.width/2, canvas.height/2 + 16);
  }

  render()
  {
    if (this.role != "blue" && this.role != "green")
    {
      this.gameLocal.render(this.ctx);
      return;
    }
    // once someone's won the match (first to WIN_SCORE round wins), the engine reveals
    // the whole map on its own frame - showing just this player's half-crop of that
    // would cut off half of a screen that's no longer split-screen gameplay at all.
    const s = this.gameLocal.state();
    const gameOver = s.blue.score >= Session.WIN_SCORE || s.green.score >= Session.WIN_SCORE;
    if (gameOver)
    {
      if (this.ctx.canvas.width != 640)
        this.ctx.canvas.width = 640;
      if (!this.matchEnded)
      {
        // the server has nothing left to relay once the match is decided - tell it to
        // drop the session rather than waiting out the normal empty-socket grace period
        this.matchEnded = true;
        const sid = document.location.pathname.split("/").filter(Boolean)[0];
        fetch("/" + sid + "/end").catch(()=>{});
      }
      this.gameLocal.render(this.ctx);
      return;
    }
    if (this.ctx.canvas.width != 320)
      this.ctx.canvas.width = 320;
    this.gameLocal.render(this.fullCtx);
    this.ctx.drawImage(this.fullCanvas, this.role == "blue" ? 0 : 320, 0, 320, 400, 0, 0, 320, 400);
  }

  iterate()
  {
    if (!this.running)
      return

    const netFrame = this.net.currentFrame()
    while (this.gameLocal.frame < netFrame)
      if (!this.gameLocal.step(this.keyState, this.keyEstimate))
      {
        // this could be a local glitch
        this.running = false;
        break;
      }
    this.render();
    this.renderScore();
  }

  renderScore()
  {
    const s = this.gameLocal.state();
    this.formatScore(s.round, s.blue.score, s.green.score);
  }

  // shared by renderScore() (real values, once the game is running) and
  // waitForOpponent() (a "Round 1 - Blue: 0 | Green: 0" placeholder before it is).
  // blueName/greenName are escaped here (not just once server-side) since they're
  // read back out of a data-* attribute and re-inserted via innerHTML - see
  // netcode.js's escapeHtml() for why that needs a second pass.
  formatScore(round, blueScore, greenScore)
  {
    this.scoreEl.innerHTML =
      `Round ${round} &mdash; ` +
      `<span style="color:#9fcaff">${escapeHtml(this.blueName)}: ${blueScore}</span>` +
      `&nbsp;&nbsp;|&nbsp;&nbsp;` +
      `<span style="color:#7CFC00">${escapeHtml(this.greenName)}: ${greenScore}</span>`;
  }

  async netsync()
  {
    if (this.waitSync)
      return;
    if (!this.running)
      return;

    this.waitSync = true;
    await this.net.sync(this.gameLocal.frame, this.gameLocal.pathOur).then(resp=>{
      this.waitSync = false;
      const path = resp.path;
      if (path.length)
        this.keyEstimate = path[path.length-1][1] & ~this.keyFilter.get();

      // unshift previous state, so we can extract keys in simulation
      if (this.gameRemote.pathOur.length)
        path.unshift(this.gameRemote.pathOur[this.gameRemote.pathOur.length-1]);
      else
        path.unshift([0, 0]);

      // keep remote instance in sync with slowest client
      if (path.length == 1 && resp.frame > this.gameRemote.frame)
        path.push([resp.frame-1, path[0][1]]);

      const needsRecalc = this.simulate(path)
      if (needsRecalc)
        this.recalc();

      this.keyFilter.put(this.localKeys);
      this.localKeys = 0;
    }).catch(e=>{});
  }

  simulate(path)
  {
    // we got new path from server which represents source of truth, during
    // simulation into gameRemote instance check if we need to rerun our local instance
    let recalc = false;
    const last = path.length ? path[path.length-1][0] : -1
    for (let i=this.gameRemote.frame; i<=last; i++)
    {
      // TODO: slow!
      const keys = Path.Extract(path, i);
      if (keys != (Path.Extract(this.gameLocal.pathOur, i) | Path.Extract(this.gameLocal.pathTheir, i)))
        recalc = true;
      if (!this.gameRemote.step(keys, 0)) // should be local=0, theirs=key
      {
        this.running = false;
        console.log("Game finished");
      }
    }
    return recalc;
  }
  recalc()
  {
    const extend = [];
    // these are our local frames which we need to append to gameRemote instance
    for (let i=this.gameRemote.frame; i<this.gameLocal.frame; i++)
      extend.push(Path.Extract(this.gameLocal.pathOur, i));
    // copy gameRemote to gameLocal, both represent source of truth
    this.gameLocal.copy(this.gameRemote);
    for (let i=0; i<extend.length; i++)
      this.gameLocal.step(extend[i], i > 3 ? this.keyEstimate : 0);
  }
  onKey(key, pressed)
  {
    this.keyEstimate &= ~(1<<key);
    this.localKeys |= 1<<key;
    if (pressed)
      this.keyState |= 1<<key;
    else
      this.keyState &= ~(1<<key);
  }
}

const pathSegments = document.location.pathname.split("/").filter(Boolean);
let role = 0;
if (pathSegments[0] == "play")
  role = "play";
else if (pathSegments[1] == "blue")
  role = "blue";
else if (pathSegments[1] == "green")
  role = "green";
// role 0 (bare tunneler.html) and "play" (/play, no id) are local hotseat - no server
// session, no websocket at all.
const isOffline = role == 0 || role == "play";

// role 0 and "play" keep the hardcoded "Blue"/"Green" labels - they're pure hotseat
// with no session/settings to pull custom names from at all. blue/green's names (and
// display name) come from #score's data-* attributes, server-templated by
// sendWithSessionName() the same way lobby.html/spectator.html get theirs - not the URL
// slug, which may not match the name's original casing/spacing.
let blueName = "Blue", greenName = "Green";
if (role == "blue" || role == "green")
{
  const scoreEl = document.getElementById("score");
  blueName = scoreEl.dataset.blueName || "Blue";
  greenName = scoreEl.dataset.greenName || "Green";
  document.title = `${scoreEl.dataset.sessionName} - ${role == "blue" ? blueName : greenName} - Tunneler`;
}
else if (role == "play")
{
  document.title = "Split screen - Tunneler";
  // only /play has a restart concept - it's the one fully local/offline mode with no
  // opponent to disrupt by reloading; a reload is enough to reset it since all its
  // state (both Game instances) lives in this page, nothing on the server.
  const restartBtn = document.getElementById("restartBtn");
  restartBtn.hidden = false;
  restartBtn.addEventListener("click", () => document.location.reload());
}

const canvas = document.getElementById('canvas1');
if (role == "blue" || role == "green")
  canvas.width = 320;
const session = new Session(canvas.getContext('2d'), role, isOffline, document.getElementById('score'), blueName, greenName)
session.start();

// bit index within the 11-bit keyState for each logical action, per tank/role.
// role 0 and "play" (both hotseat) keep two disjoint key sets live simultaneously, since
// one physical keyboard is shared by two people - only the fire key differs between them
// (see onKey below).
const KEYMAPS = {
  blue: { up:6, down:7, left:8, right:9, fire:10 },
  green: { up:0, right:1, down:2, left:3, fire:4, esc:5 }
};

function onKey(e, pressed)
{
  let consumed = true;

  if (role == "blue" || role == "green")
  {
    // each remote player may use either arrows or WASD to move, and any of
    // space/enter/ctrl to fire - only their own tank's bits ever get set.
    const map = KEYMAPS[role];
    let action = null;
    switch (e.keyCode)
    {
      case 38: case 87: action = "up"; break;
      case 40: case 83: action = "down"; break;
      case 37: case 65: action = "left"; break;
      case 39: case 68: action = "right"; break;
      case 32: case 13: case 17: action = "fire"; break;
      case 27: action = "esc"; break;
      default: consumed = false;
    }
    if (action && map[action] !== undefined)
      session.onKey(map[action], pressed);
    else if (action)
      consumed = false;
  }
  else if (role == "play")
  {
    // classic single-browser split-screen: arrows+Enter for one tank, WASD+Space for the other
    const tbit = (n, p) => session.onKey(n, p)
    switch (e.keyCode)
    {
      case 38: tbit(0, pressed); break; // up arrow
      case 39: tbit(1, pressed); break; // right arrow
      case 40: tbit(2, pressed); break; // down arrow
      case 37: tbit(3, pressed); break; // left arrow
      case 13: tbit(4, pressed); break; // enter -> fire
      case 27: tbit(5, pressed); break; // esc
      case 87: tbit(6, pressed); break; // w
      case 83: tbit(7, pressed); break; // s
      case 65: tbit(8, pressed); break; // a
      case 68: tbit(9, pressed); break; // d
      case 32: tbit(10, pressed); break; // space -> fire
      default: consumed = false;
    }
  }
  else
  {
    // bare tunneler.html (no /<id> at all) - original hotseat bindings, kept as-is
    const tbit = (n, p) => session.onKey(n, p)
    switch (e.keyCode)
    {
      case 38: tbit(0, pressed); break;
      case 39: tbit(1, pressed); break;
      case 40: tbit(2, pressed); break;
      case 37: tbit(3, pressed); break;
      case 32: tbit(4, pressed); break;
      case 27: tbit(5, pressed); break;
      case 87: tbit(6, pressed); break;
      case 83: tbit(7, pressed); break;
      case 65: tbit(8, pressed); break;
      case 68: tbit(9, pressed); break;
      case 16: tbit(10, pressed); break;
      default: consumed = false;
    }
  }
  if (consumed)
    e.preventDefault();
}
document.onkeydown = evt => onKey(evt, 1);
document.onkeyup = evt => onKey(evt, 0);
