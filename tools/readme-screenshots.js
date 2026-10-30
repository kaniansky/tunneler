// The README's screenshots (1000x820, screenshots/*.png; modern-*.png: graphics "modern") from a running server:
//   PORT=8102 node server.js &      (a fresh one: it gets a few public test games)
//   node tools/readme-screenshots.js 8102 screenshots           (graphics "original" + a few modern ones)
//   node tools/readme-screenshots.js 8103 screenshots modern    (on another fresh server: the same session in
//                                                                 the modern look, modern-<name>.png - the homepage's modern theme)
// Needs playwright-core (not a dependency: npm i --no-save playwright-core) and a Chromium - set CHROME
// to its executable (default: playwright's download in ~/.cache/ms-playwright). The browser runs with
// the GPU off (software rendering).
const { chromium } = require('playwright-core');
const CHROME = process.env.CHROME || (() => {
  const dir = require('path').join(require('os').homedir(), '.cache/ms-playwright');
  const d = require('fs').readdirSync(dir).filter(n => n.startsWith('chromium-')).sort().pop();
  return dir + '/' + d + '/chrome-linux64/chrome';
})();
const PORT = process.argv[2], OUT = process.argv[3], B = 'http://localhost:' + PORT;
const MODERN = process.argv[4] === 'modern';                   // (the whole session in the modern look)
const GFX = { 'tunneler.gfx': MODERN ? 'modern' : 'original' };   // (modern is the game's default since 5.0: say which)
const sleep = ms => new Promise(r => setTimeout(r, ms));
const api = async (body) => (await fetch(B + '/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ version: require('../package.json').version }, body)) })).json();
const S = (kind, team) => ({ kind, team });
const fill = a => { while (a.length < 8) a.push(S('closed', a.length + 1)); return a; };
(async () => {
  const b = await chromium.launch({ args: ['--disable-gpu', '--use-angle=swiftshader', '--use-gl=angle', '--disable-gpu-compositing'], executablePath: CHROME });
  const errs = [];
  const page = async (ls, url) => {
    const ctx = await b.newContext({ viewport: { width: 1000, height: 820 } });
    await ctx.addInitScript(o => { for (const k in o) localStorage.setItem(k, o[k]); }, Object.assign({}, GFX, ls || {}));
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(url + ': ' + e.message));
    await p.goto(B + url); return p;
  };
  const shot = (p, f) => p.screenshot({ path: OUT + '/' + (MODERN && !f.startsWith('modern-') ? 'modern-' : '') + f });
  const until = async (p, fn, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await p.evaluate(fn).catch(() => false)) return true; await sleep(200); } return false; };
  // keys held for ms of game time (the engine's steps of 54.9 ms; wall time off a play screen): software rendering
  // (3D) is slow, and the engine steps fewer times than the clock says
  const tick = p => p.evaluate(() => window.tunnelerEngine && tunnelerEngine() ? tunnelerEngine().tick : null).catch(() => null);
  const hold = async (p, keys, ms) => {
    const t0 = await tick(p);
    for (const k of keys) await p.keyboard.down(k);
    if (t0 == null) await sleep(ms);
    else for (const end = t0 + Math.round(ms / 54.925), t = Date.now(); Date.now() - t < 60000 && (await tick(p)) < end;) await sleep(30);
    for (const k of keys) await p.keyboard.up(k);
  };
  try {
    // home
    let p = await page({}, '/'); await sleep(1000); await shot(p, 'home.png'); await p.close();
    // vs computer: 2 v 2 against computer tanks
    p = await page({ 'tunneler.cpu.slots': JSON.stringify(fill([S('you', 1), S('hard', 2), S('normal', 1), S('hard', 2)])),
      'tunneler.cpu.view': 'team', 'tunneler.cpu.time': '3', 'tunneler.cpu.watch': 'others' }, '/');
    await sleep(800); await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); await sleep(500); await shot(p, 'vs-computer.png'); await p.close();
    // split screen, both tanks digging
    p = await page({}, '/play.html?mode=hotseat&size=medium&win=3');
    await until(p, () => tunnelerEngine().screen === 'play');
    await hold(p, ['KeyS', 'ArrowUp'], 1800); await hold(p, ['KeyD', 'ArrowLeft'], 1600); await hold(p, ['KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft'], 900);
    await sleep(300); await shot(p, 'split-screen.png'); await p.close();
    // public games for the list
    const main = await api({ name: 'Friday night', public: true, spectators: true, size: 'medium', winScore: 3, roundTime: 3, friendlyFire: false,
      visible: 'team', watchOut: 'others', seats: fill([S('open', 1), S('open', 2), S('open', 1), S('hard', 2)]) });
    await api({ name: 'Duel at dawn', public: true, spectators: true, seats: fill([S('open', 1), S('open', 2)]) });
    await api({ name: 'Team rumble', public: true, spectators: true, size: 'large', winScore: 5, seats: fill([S('open', 1), S('expert', 2), S('open', 1), S('expert', 2), S('open', 1), S('expert', 2), S('open', 1), S('expert', 2)]) });
    await api({ name: 'Żółw vs 王小明', public: true, spectators: false, size: 'small', seats: fill([S('open', 1), S('open', 2), S('normal', 3)]) });
    p = await page({ 'tunneler.name': 'Norko' }, '/games'); await sleep(1200); await shot(p, 'lobby.png');
    // the create screen
    await p.evaluate(() => { const u = tunnelerLobbyUI(); u.sel = u.spec.items.findIndex(i => /create/i.test(i.key || '') || /Create/.test(i.label || '')); u.draw(); });
    await p.keyboard.press('Enter'); await sleep(300);
    await p.keyboard.type('Friday night'); await sleep(200);
    await shot(p, 'create.png'); await p.close();
    // the online game: Norko (BLUE, host) + Petr (CYAN) against Zuzka (GREEN) + a hard computer tank (YELLOW)
    const id = main.id, url = r => '/game/' + id + '/' + r;
    const blue = await page({ ['tunneler.host.' + id]: main.hostKey, 'tunneler.name': 'Norko', 'tunneler.view': 'team', 'tunneler.ping': '1' }, url('blue'));
    await sleep(500);
    // (GREEN and CYAN aren't photographed: the original look - 4 pages in software 3D can't keep up with the match)
    const green = await page({ 'tunneler.name': 'Zuzka', 'tunneler.gfx': 'original' }, url('green'));
    await sleep(500);
    const cyan = await page({ 'tunneler.name': 'Petr', 'tunneler.gfx': 'original' }, url('cyan'));
    const spec = await page({ 'tunneler.name': 'Kiko' }, url('watch'));
    await sleep(2500);
    for (const [pg, msg] of [[green, 'gl hf!'], [cyan, 'Привет! 👋 ready when you are']]) {
      await pg.evaluate(() => { const u = tunnelerLobbyUI(); u.sel = u.spec.items.findIndex(i => i.key === 'say'); u.draw(); });
      await pg.evaluate(m => { for (const ch of m) window.dispatchEvent(new KeyboardEvent('keydown', { key: ch, code: 'KeyQ', bubbles: true })); }, msg);
      await pg.keyboard.press('Enter'); await sleep(300);
      await pg.evaluate(() => { const u = tunnelerLobbyUI(); u.sel = u.spec.items.findIndex(i => i.key === 'ready'); u.draw(); });
      await pg.keyboard.press('Enter'); await sleep(500);
    }
    await blue.evaluate(() => { const u = tunnelerLobbyUI(); u.sel = u.spec.items.findIndex(i => i.key === 'start'); u.draw(); });
    await sleep(800); await shot(blue, 'online-lobby.png');
    await blue.keyboard.press('Enter');
    await until(blue, () => tunnelerEngine().screen === 'play');
    await Promise.all([hold(blue, ['KeyS'], 2500), hold(cyan, ['ArrowDown'], 2000), hold(green, ['ArrowLeft', 'ArrowUp'], 3000)]);
    await Promise.all([hold(blue, ['KeyD', 'Space'], 2500), hold(cyan, ['ArrowRight', 'ArrowDown'], 2500), hold(green, ['KeyS'], 2000)]);
    await Promise.all([hold(blue, ['KeyS', 'KeyD'], 1500), hold(cyan, ['ArrowRight'], 1500)]);
    await until(blue, () => window.tunnelerFrames && !tunnelerFrames().catching && tunnelerFrames().queued < 4);   // (caught up)
    await sleep(500); await shot(blue, 'online-team.png');
    // (the players' windows closed - the match runs on - so the spectator's catches up: software rendering is slow)
    for (const pg of [blue, green, cyan]) await pg.close();
    await until(spec, () => window.tunnelerFrames && !tunnelerFrames().catching && tunnelerFrames().queued < 4);   // (caught up)
    await spec.keyboard.press('Digit1'); await sleep(800); await shot(spec, 'spectator-grid.png');
    await spec.keyboard.press('Digit2'); await sleep(1500); await shot(spec, 'spectator-map.png');
    // graphics "modern" (docs/GRAPHICS.md): the main menu, its settings, a skirmish of 4 (clean), the split screen (retro)
    // the map picker (the skirmish's Map row): map-picker.png / modern-map-picker.png
    p = await page({}, '/');
    await sleep(800); await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); await sleep(500);
    await p.evaluate(() => tunnelerHomeUI().spec.items.find(i => i.key === 'map').go()); await sleep(600);
    await shot(p, 'map-picker.png'); await p.close();
    if (MODERN) {
      // 3D (the default): a team game on generated caves, your teammate's triangle
      p = await page({}, '/skirmish?mode=cpu&slots=' + encodeURIComponent('0:you:1,1:hard:2,2:hard:1,3:hard:2') + '&size=small&view=team&gen=gen:caves:fair');
      await until(p, () => window.tunnelerEngine && window.tunnelerEngine().screen === 'play');
      await hold(p, ['KeyS'], 1500); await hold(p, ['KeyD'], 1500); await hold(p, ['KeyS', 'Space'], 800);
      await sleep(800); await shot(p, 'modern-3d.png'); await p.close();
    }
    if (MODERN) return;                                          // (the modern session has its own of all the above)
    // held Tab: the score mid-match (king of the hill, 4 tanks)
    p = await page({}, '/skirmish?mode=cpu&slots=' + encodeURIComponent('0:you:1,1:hard:2,2:normal:3,3:hard:4') + '&size=small&gm=hill');
    await until(p, () => window.tunnelerEngine && window.tunnelerEngine().screen === 'play');
    await hold(p, ['KeyW'], 4000);
    await p.keyboard.down('Tab'); await sleep(600); await shot(p, 'score.png'); await p.keyboard.up('Tab'); await p.close();
    const M = { 'tunneler.gfx': 'modern' };
    p = await page(M, '/'); await sleep(1500); await shot(p, 'modern-home.png');
    for (const k of ['ArrowUp', 'Enter', 'ArrowDown', 'Enter', 'ArrowDown', 'ArrowDown', 'ArrowDown']) { await p.keyboard.press(k); await sleep(150); }   // (Settings, Graphics, Terrain)
    await sleep(600); await shot(p, 'modern-settings.png'); await p.close();
    p = await page(M, '/skirmish?mode=cpu&slots=' + encodeURIComponent('0:you:1,1:hard:2,2:hard:3,3:hard:4') + '&size=small&view=everyone');
    await until(p, () => window.tunnelerEngine && window.tunnelerEngine().screen === 'play');
    await hold(p, ['ShiftLeft'], 100); await hold(p, ['KeyW'], 2500); await hold(p, ['KeyW', 'Space'], 600);
    await sleep(2000); await shot(p, 'modern-game.png'); await p.close();
    p = await page(Object.assign({ 'tunneler.gfx.modern': JSON.stringify({ style: 'retro' }) }, M), '/split?size=small');
    await until(p, () => window.tunnelerEngine && window.tunnelerEngine().screen === 'play');
    await hold(p, ['KeyW', 'ArrowUp'], 3000); await hold(p, ['Space'], 300);
    await sleep(500); await shot(p, 'modern-retro.png'); await p.close();
  } finally { console.log('errors', JSON.stringify(errs)); await b.close(); }
})();
