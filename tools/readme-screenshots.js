// The README's screenshots (1000x820, screenshots/*.png) from a running server:
//   PORT=8102 node server.js &      (a fresh one: it gets a few public test games)
//   node tools/readme-screenshots.js 8102 screenshots
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
const sleep = ms => new Promise(r => setTimeout(r, ms));
const api = async (body) => (await fetch(B + '/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ version: require('../package.json').version }, body)) })).json();
const S = (kind, team) => ({ kind, team });
const fill = a => { while (a.length < 8) a.push(S('closed', a.length + 1)); return a; };
(async () => {
  const b = await chromium.launch({ args: ['--disable-gpu', '--use-angle=swiftshader', '--use-gl=angle', '--disable-gpu-compositing'], executablePath: CHROME });
  const errs = [];
  const page = async (ls, url) => {
    const ctx = await b.newContext({ viewport: { width: 1000, height: 820 } });
    await ctx.addInitScript(o => { for (const k in o) localStorage.setItem(k, o[k]); }, ls || {});
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(url + ': ' + e.message));
    await p.goto(B + url); return p;
  };
  const shot = (p, f) => p.screenshot({ path: OUT + '/' + f });
  const until = async (p, fn, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await p.evaluate(fn).catch(() => false)) return true; await sleep(200); } return false; };
  const hold = async (p, keys, ms) => { for (const k of keys) await p.keyboard.down(k); await sleep(ms); for (const k of keys) await p.keyboard.up(k); };
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
    const green = await page({ 'tunneler.name': 'Zuzka' }, url('green'));
    await sleep(500);
    const cyan = await page({ 'tunneler.name': 'Petr' }, url('cyan'));
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
    await sleep(500); await shot(blue, 'online-team.png');
    await spec.keyboard.press('Digit1'); await sleep(800); await shot(spec, 'spectator-grid.png');
    await spec.keyboard.press('Digit2'); await sleep(1200); await shot(spec, 'spectator-map.png');
    console.log('errors', JSON.stringify(errs));
  } finally { await b.close(); }
})();
