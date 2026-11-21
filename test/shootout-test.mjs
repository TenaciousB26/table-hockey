// Forces a tied overtime and plays the shootout (and a penalty walk to the box) headlessly.
import { Game } from '../src/sim.js';
let okAll = true;
for (const seed of [1, 2, 3, 4, 5, 6]) {
  const g = new Game({ seed, periodReal: 150, autoRestart: false });
  g.period = 4; g.clock = 1.2; g.beginFaceoff(0, 0); g.score = [2, 2];
  const ev = {}; const log = [];
  let steps = 0; const dt = 1 / 120;
  while (g.state !== 'final' && steps < 120 * 600) {
    g.step(dt); steps++;
    for (const e of g.drainEvents()) { ev[e.type] = (ev[e.type] || 0) + 1; if (e.type === 'banner' && /SHOOTOUT|GOAL|SAVE|NO GOAL|FINAL/.test(e.text)) log.push(e.text + (e.sub ? ' ' + e.sub : '')); }
    for (const p of g.players.concat(g.officials)) if (!isFinite(p.x + p.y)) throw new Error('NaN ' + p.name);
  }
  const ok = g.state === 'final' && g.so && g.score[g.winner] === 3;
  okAll = okAll && ok;
  console.log(seed, ok ? 'OK ' : 'FAIL', 'score', g.score.join('-'), 'marks', g.so && g.so.marks.join(' | '), 'secs', (steps * dt).toFixed(0), 'net', ev.net || 0, 'goalEv', ev.goal || 0);
}
// penalty walk: call a penalty and check the player ends up in the box and a faceoff follows
const g = new Game({ seed: 9, autoRestart: false });
g.state = 'play'; g.dropPuck();
const p = g.iceSkaters(0)[1]; g.callPenalty(p, 'TRIPPING', 2);
let walked = 0, steps = 0;
while (steps < 120 * 20) { g.step(1 / 120); steps++; if (g.state === 'whistle' && !p.box) walked++; if (p.box && g.state === 'play') break; }
console.log('penalty walk: steps skating to box', walked, 'inBox', p.box, 'state', g.state, 'refSig', g.officials.map((o) => o.sig || '-').join(','));
console.log(okAll && p.box ? 'ALL OK' : 'PROBLEM');
