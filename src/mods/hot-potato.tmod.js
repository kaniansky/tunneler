// @name    Hot potato
// @by      Norko
// @about   One tank carries the bomb; shoot another tank (with teams: an enemy) to pass it on. Holding it when it goes off: out. Shots do no harm.
// @name:sk Horúci zemiak
// @about:sk Jeden tank nesie bombu; zasiahni iný tank (s tímami nepriateľa) a odovzdáš mu ju. Kto ju drží, keď vybuchne: koniec. Strely neubližujú.
// @name:cs Horký brambor
// @about:cs Jeden tank nese bombu; zasáhni jiný tank (s týmy nepřítele) a předáš mu ji. Kdo ji drží, když vybuchne: konec. Střely neubližují.
// @name:uk Гаряча картопля
// @about:uk Один танк несе бомбу; влуч в інший танк (з командами - у ворога), щоб передати її. Хто тримає її, коли вона вибухне, - вибуває. Постріли не шкодять.
// @name:ru Горячая картошка
// @about:ru Один танк несёт бомбу; попади в другой танк (с командами - во врага), чтобы передать её. Кто держит её, когда она взорвётся, - выбывает. Выстрелы не вредят.
// @game    1.5+
// @version 1.0
// @tanks   3 - 8
// @hide    roundTime
// (an example mod - docs/MODS.md; the API: src/js/game/mods.js)

const FUSE = 30 * 18;          // ~30 seconds (18.2 frames a second)

mod({
  rules: { hitDamage: 0 },     // shots don't hurt here
  texts: { en: { boom: "BOOM!" }, sk: { boom: "BUM!" }, cs: { boom: "BUM!" }, uk: { boom: "БАХ!" }, ru: { boom: "БАХ!" } },

  round(g) { g.state.bomb = 0; g.state.timer = FUSE; },

  frame(g) {
    const S = g.state;
    // (a new bomb when there is none - the last one went off, or its tank is gone)
    if (!S.bomb || !g.tank(S.bomb).alive) { S.bomb = g.randomTank(); S.since = g.frame; S.timer = FUSE; return; }
    if (--S.timer > 0) return;
    g.destroy(S.bomb);
    g.say({ t: "boom" });
    S.bomb = 0;
  },

  // the bomb's tank hits another one: it has the bomb now - only with a shot fired since it got the bomb (one fired
  // before, still flying, doesn't pass it back)
  onHit(g, shooter, target, fired) {
    const S = g.state;
    if (shooter === S.bomb && fired > S.since) { S.bomb = target; S.since = g.frame; }
  },

  hud(g, p) { return p === g.state.bomb ? { value: Math.ceil(g.state.timer / 18), color: 12 } : null; },

  draw(g) {
    const t = g.state.bomb && g.tank(g.state.bomb);
    if (t && t.alive) g.mark(t.x, t.y - 6, (g.state.timer >> 2) & 1 ? 12 : 14);
  },

  // computer tanks: the bomb's tank hunts the nearest enemy to pass it on (the built-in AI drives and shoots; a
  // teammate it can't pass it to - shots hit teammates like a wall). The others hold their fire (their shots do
  // nothing): its enemies flee it - hidden behind their base's walls, off the other way when it comes close; its
  // teammates wait at their base
  aiGoal(g, p) {
    const me = g.tank(p), bomb = g.state.bomb;
    if (p !== bomb) return bomb && g.enemies(p, bomb) ? { flee: bomb, hold: true }
      : { x: me.base.x, y: me.base.y, dig: false, always: true, hold: true };
    let best = null, bestD = Infinity;
    for (const t of g.tanks()) {
      if (!g.enemies(p, t.p)) continue;
      const d = Math.max(Math.abs(t.x - me.x), Math.abs(t.y - me.y));
      if (d < bestD) { bestD = d; best = t; }
    }
    return best ? { x: best.x, y: best.y, dig: bestD < 100 } : null;
  },
});
