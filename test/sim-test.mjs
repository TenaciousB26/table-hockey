// Headless sanity run: plays full games and prints rule / stat summaries.
import { Game } from '../src/sim.js';
const games = +(process.argv[2] || 4), periodReal = +(process.argv[3] || 150);
const tot = {};
for (let g = 0; g < games; g++) {
  const game = new Game({ seed: 1000 + g * 77, periodReal, autoRestart: false });
  const ev = {};
  let steps = 0;
  const dt = 1 / 120;
  while (game.state !== 'final' && steps < 120 * 60 * 40) {
    game.step(dt); steps++;
    for (const e of game.drainEvents()) ev[e.type] = (ev[e.type] || 0) + 1;
    for (const p of game.players) if (!isFinite(p.x + p.y)) throw new Error('NaN player ' + p.name);
    for (const k of ['x', 'y', 'z']) if (!isFinite(game.puck[k])) throw new Error('NaN puck');
  }
  const o = { 'secs': (steps * dt).toFixed(0), score: game.score.join('-'), shots: game.shots.join('-'), per: game.period,
    hits: game.hits.join('-'), pim: game.pim.join('-'), ice: game.icings, off: game.offsides, fights: game.fights, state: game.state };
  console.log(JSON.stringify(o), JSON.stringify({ goal: ev.goal, save: ev.save, penalty: ev.penalty, slap: ev.slap, shot: ev.shot, pass: ev.pass, post: ev.post, whistle: ev.whistle, hit: ev.hit, punch: ev.punch }));
}
