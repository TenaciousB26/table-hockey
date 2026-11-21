// TableHockey game engine — pure logic, no rendering. Units: metres / seconds.
// Rink x runs along the length, y across the width. The renderer maps (x, y) -> three.js (x, 0, y).
//
// Implemented rules: 3 periods + sudden-death overtime, faceoffs, goals, icing, offside,
// minor / major / fighting penalties with power plays (minors end on a goal), penalty box,
// goalie pulled for the extra attacker late in the 3rd, goalie freezes, puck out of play.

export const RINK = {
  L: 61, W: 26, hx: 30.5, hy: 13, R: 8.5,
  goalX: 27.1, blueX: 7.6, netHalf: 0.915, netDepth: 1.1, crossbar: 1.22,
  boardH: 1.07, glassH: 1.8, glassEndH: 2.6, creaseR: 1.8,
};
const GOAL_X = RINK.goalX, BLUE_X = RINK.blueX, NET_HALF = RINK.netHalf, NET_D = RINK.netDepth;
const G = 9.8;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const hyp = Math.hypot;

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// signed distance to the board line (negative inside)
export function rinkSDF(x, y) {
  const qx = Math.abs(x) - (RINK.hx - RINK.R), qy = Math.abs(y) - (RINK.hy - RINK.R);
  return hyp(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - RINK.R;
}
function rinkNormal(x, y) { // outward
  const qx = Math.abs(x) - (RINK.hx - RINK.R), qy = Math.abs(y) - (RINK.hy - RINK.R);
  const sx = x < 0 ? -1 : 1, sy = y < 0 ? -1 : 1;
  if (qx > 0 && qy > 0) { const l = hyp(qx, qy) || 1; return [sx * qx / l, sy * qy / l]; }
  return qx > qy ? [sx, 0] : [0, sy];
}

export const TEAMS = [
  { name: 'BLIZZARD', abbr: 'BLZ', jersey: 0x1f6bff, trim: 0xffffff, helmet: 0x0d2f7a, css: '#3b82ff' },
  { name: 'WILDFIRE', abbr: 'WLD', jersey: 0xe23b2e, trim: 0xffd34a, helmet: 0x6e130c, css: '#ff5a48' },
];

const SURNAMES = ['Kowalski', 'Lindqvist', 'Brodeur', 'Tanaka', 'Okafor', 'Petrov', 'MacAvoy', 'Dubois', 'Halvorsen',
  'Reyes', 'Sokolov', 'Gallagher', 'Nakamura', 'Vance', 'Bergstrom', 'Calloway', 'Moreau', 'Durand', 'Ivanov',
  'Fitzgerald', 'Hartley', 'Novak', 'Sullivan', 'Larkin', 'Voss', 'Kessler', 'Marchand', 'Thorne', 'Briggs',
  'Rinaldi', 'Ostrom', 'Baptiste', 'Wolfe', 'Castillo', 'Yamada', 'Haugen', 'Mercer', 'Duffy', 'Karlsson', 'Pruitt'];
const FIRST = 'ABCDEFGHJKLMNPRSTVW';
const ROLES = ['C', 'LW', 'RW', 'LD', 'RD', 'X'];
const LAT = { C: 0, LW: 8, RW: -8, LD: 5, RD: -5, X: 3 };
const FO_OFF = { C: [-1.3, 0], LW: [-3.6, 5.6], RW: [-3.6, -5.6], LD: [-9, 4.6], RD: [-9, -4.6], X: [-10.5, 0] };
const DOTS = [];
for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
  DOTS.push([sx * 21, sy * 6.7], [sx * 6.1, sy * 6.7]);
}
DOTS.push([0, 0]);

const FOULS = ['TRIPPING', 'HOOKING', 'SLASHING', 'HOLDING', 'INTERFERENCE', 'ROUGHING', 'CROSS-CHECKING', 'HIGH-STICKING'];

export class Game {
  constructor(opts = {}) {
    this.cfg = Object.assign({ periodReal: 150, seed: null, autoRestart: true }, opts);
    this.events = [];
    this.newGame();
  }

  emit(type, o = {}) { o.type = type; this.events.push(o); }
  drainEvents() { const e = this.events; this.events = []; return e; }

  // ------------------------------------------------------------------ setup
  newGame() {
    const seed = this.cfg.seed ?? ((Math.random() * 1e9) | 0);
    this.rng = mulberry32(seed);
    this.timeScale = 1200 / this.cfg.periodReal;
    this.t = 0; this.stateT = 0;
    this.period = 1; this.clock = 1200;
    this.score = [0, 0]; this.shots = [0, 0]; this.hits = [0, 0]; this.pim = [0, 0];
    this.fights = 0; this.icings = 0; this.offsides = 0;
    this.goalLight = [0, 0]; this.so = null; this.soSaved = false;
    this.players = [];
    this.teams = [0, 1].map((ti) => {
      const team = { idx: ti, dir: ti === 0 ? 1 : -1, skaters: [], goalie: null, pen: [], pulled: false, ...TEAMS[ti] };
      const nums = new Set();
      const num = () => { let n; do { n = 2 + ((this.rng() * 96) | 0); } while (nums.has(n)); nums.add(n); return n; };
      const used = new Set();
      const nm = () => { let s; do { s = SURNAMES[(this.rng() * SURNAMES.length) | 0]; } while (used.has(s)); used.add(s); return FIRST[(this.rng() * FIRST.length) | 0] + '. ' + s; };
      for (let i = 0; i < 6; i++) team.skaters.push(this.mkPlayer(team, i, false, ROLES[i], num(), nm()));
      team.goalie = this.mkPlayer(team, 6, true, 'G', 1 + ((this.rng() * 98) | 0), nm());
      team.skaters[5].onIce = false;
      return team;
    });
    this.officials = ['ref', 'ref', 'lines', 'lines'].map((role, i) => ({
      id: 200 + i, isOff: true, role, name: role === 'ref' ? 'REF' : 'LINESMAN', num: 0, team: 2, isG: false, onIce: true, box: false,
      x: (i - 1.5) * 5, y: i % 2 ? 6 : -6, vx: 0, vy: 0, h: 0, tx: 0, ty: 0, tspd: 0.6, maxSpeed: 8.4, stride: i * 1.7, fall: 0, fallDir: 1,
      windup: 0, windType: '', swing: 0, cheer: 0, punch: 0, dive: 0, fighting: false, sig: '', sigT: 0, sigDir: 0, radius: 0.5,
    }));
    this.puck = { x: 0, y: 0, z: 0.25, vx: 0, vy: 0, vz: 0, r: 0.25, carrier: null, lastTouch: null, lastTouchTeam: -1,
      lastShooter: null, shotPower: 0, shotType: '', iceTeam: -1, iceValid: false, still: 0, frozen: false, target: null };
    this.pending = null; this.fight = null; this.fo = null; this.winner = -1; this.state = 'pregame';
    this.setAttackDirs();
    this.beginFaceoff(0, 0, true);
    this.state = 'faceoff';
    this.emit('newgame', {});
    this.emit('banner', { text: 'PUCK DROP', sub: `${TEAMS[0].name} vs ${TEAMS[1].name}`, dur: 2.2, color: '#ffffff' });
  }

  mkPlayer(team, i, isG, role, num, name) {
    const r = this.rng;
    const p = {
      id: this.players.length, team: team.idx, idx: i, isG, role, num, name,
      spd: 0.93 + r() * 0.14, shot: 0.35 + r() * 0.65, pass: 0.35 + r() * 0.65, chk: 0.3 + r() * 0.7,
      tough: r() < 0.22 ? 0.75 + r() * 0.25 : r() * 0.5, skill: 0.4 + r() * 0.6,
      x: 0, y: 0, vx: 0, vy: 0, h: team.idx === 0 ? 0 : Math.PI, onIce: true, box: false, boxSlot: 0,
      fall: 0, fallDir: 1, stride: r() * 6, windup: 0, windType: '', windAim: null, swing: 0, cool: 0, dec: r() * 0.3,
      tx: 0, ty: 0, tspd: 1, maxSpeed: isG ? 5.5 : 9.4, radius: isG ? 0.7 : 0.55,
      fighting: false, punch: 0, cheer: 0, dive: 0, react: 0, reach: 0.75, gErr: 0, gSeen: 0, hitCool: 0, state: '',
    };
    p.maxSpeed *= p.spd;
    this.players.push(p);
    return p;
  }

  setAttackDirs() {
    const flip = this.period === 2 || this.period >= 4 ? -1 : 1;
    this.teams[0].dir = flip; this.teams[1].dir = -flip;
  }

  // ------------------------------------------------------------------ helpers
  iceSkaters(t) { return this.teams[t].skaters.filter((p) => p.onIce && !p.box); }
  opp(t) { return this.teams[1 - t]; }
  gauss() { return (this.rng() + this.rng() + this.rng() - 1.5) * 1.6; }
  say(text, sub = '', color = '#fff', dur = 2.4, extra = {}) { this.emit('banner', Object.assign({ text, sub, color, dur }, extra)); }

  // ------------------------------------------------------------------ states
  beginFaceoff(x, y, instant = false) {
    this.fo = { x, y, hold: 0, ready: false };
    this.state = 'faceoff'; this.stateT = 0;
    const pk = this.puck;
    pk.carrier = null; pk.x = x; pk.y = y; pk.z = pk.r; pk.vx = pk.vy = pk.vz = 0; pk.frozen = false; pk.iceValid = false;
    pk.still = 0; pk.shotPower = 0; pk.target = null;
    this.setGoaliePulls();
    for (const p of this.players) { p.windup = 0; p.fighting = false; p.punch = 0; p.cheer = 0; p.dive = 0; p.fall = 0; p.cool = 0; }
    for (const t of this.teams) {
      this.slotFaceoff(t);
      if (instant) for (const p of [...t.skaters, t.goalie]) { p.x = p.tx; p.y = p.ty; p.vx = p.vy = 0; p.h = Math.atan2(y - p.y, x - p.x); }
      if (instant) { t.goalie.x = -t.dir * (GOAL_X - 1); t.goalie.y = 0; t.goalie.h = t.dir > 0 ? 0 : Math.PI; }
    }
  }

  slotFaceoff(team) {
    const a = team.dir, fo = this.fo;
    for (const p of team.skaters) {
      if (!p.onIce || p.box) continue;
      let role = p.role;
      const off = FO_OFF[role] || FO_OFF.X;
      let u = off[0], v = off[1];
      // second forward in case of an extra attacker
      if (p.idx === 5) { u = -6; v = 0; }
      p.tx = fo.x + a * u; p.ty = fo.y + v;
      const w = this.wallClamp(p.tx, p.ty, 1.2);
      p.tx = w[0]; p.ty = w[1]; p.tspd = 0.8;
    }
  }

  wallClamp(x, y, m) {
    const d = rinkSDF(x, y);
    if (d <= -m) return [x, y];
    const [nx, ny] = rinkNormal(x, y);
    const pen = d + m;
    return [x - nx * pen, y - ny * pen];
  }

  setGoaliePulls() {
    for (const t of this.teams) {
      const o = this.opp(t.idx);
      const diff = this.score[o.idx] - this.score[t.idx];
      const want = this.period === 3 && this.clock < 100 && diff >= 1 && diff <= 2 && this.winner < 0;
      const extra = t.skaters[5];
      if (want && !t.pulled && !extra.box && !extra.onIce) { t.pulled = true; t.goalie.onIce = false; extra.onIce = true; extra.x = 0; extra.y = this.benchY(); this.say('GOALIE PULLED', `${t.name} go six-on-five`, '#ffd34a', 2.2); }
      else if ((!want && t.pulled) || (t.pulled && extra.box)) { t.pulled = false; t.goalie.onIce = true; if (!extra.box) extra.onIce = false; }
    }
  }

  benchY() { return RINK.hy - 1.2; }

  whistle(reason, x, y, pen = null, delay = 1.3) {
    if (this.state !== 'play') return;
    this.state = 'whistle'; this.stateT = 0; this.pending = { x, y, pens: pen ? [pen] : [], delay, reason };
    this.puck.carrier = null;
    this.officialSignal(reason);
    this.emit('whistle', { reason });
  }

  nearestOfficial(role, x, y) {
    let best = null, bd = 1e9;
    for (const o of this.officials) { if (role && o.role !== role) continue; const d = hyp(o.x - x, o.y - y); if (d < bd) { bd = d; best = o; } }
    return best;
  }

  // the nearest official blows the whistle / raises an arm; linesmen signal offside and icing
  officialSignal(reason) {
    const pk = this.puck;
    if (reason === 'offside' || reason === 'icing') { const l = this.nearestOfficial('lines', pk.x, pk.y); if (l) { l.sig = reason === 'icing' ? 'cross' : 'flat'; l.sigT = 2.6; } }
    const r = this.nearestOfficial('ref', pk.x, pk.y);
    if (r) { r.sig = reason === 'penalty' ? 'up' : 'whistle'; r.sigT = reason === 'penalty' ? 4 : 1.4; }
  }

  walking(p) { return !!(this.pending && this.pending.pens && this.pending.pens.some((e) => e.p === p && !e.done)); }

  nearestDot(x, y, only = null) {
    let best = null, bd = 1e9;
    for (const d of DOTS) {
      if (only && !only(d)) continue;
      const dd = hyp(d[0] - x, d[1] - y);
      if (dd < bd) { bd = dd; best = d; }
    }
    return best;
  }

  // ------------------------------------------------------------------ main step
  step(dt) {
    this.t += dt; this.stateT += dt;
    for (let i = 0; i < 2; i++) this.goalLight[i] = Math.max(0, this.goalLight[i] - dt);
    const st = this.state;
    if (st === 'play') this.stepClock(dt);
    else if (st === 'faceoff') this.stepFaceoff(dt);
    else if (st === 'whistle') this.stepWhistle(dt);
    else if (st === 'goal') { if (this.stateT > 4.6) { if (this.winner >= 0) this.finish(); else this.beginFaceoff(0, 0); } }
    else if (st === 'fight') this.stepFight(dt);
    else if (st === 'intermission') this.stepIntermission(dt);
    else if (st === 'shootout') this.stepShootout(dt);
    else if (st === 'final') { if (this.cfg.autoRestart && this.stateT > 14) this.newGame(); }

    this.updateOfficials(dt);
    this.ai(dt);
    for (const p of this.players) if (p.onIce && !p.box) this.move(p, dt);
    this.collide(dt);
    this.stepPuck(dt);
  }

  stepClock(dt) {
    this.clock -= dt * this.timeScale;
    for (const t of this.teams) {
      for (let i = t.pen.length - 1; i >= 0; i--) {
        const e = t.pen[i];
        e.rem -= dt * this.timeScale;
        if (e.rem <= 0) this.releasePenalty(t, i);
      }
    }
    if (this.clock <= 0) this.endPeriod();
    // late-game goalie pull
    if (this.period === 3 && this.clock < 100 && (!this.teams[0].pulled || !this.teams[1].pulled)) {
      for (const t of this.teams) {
        const diff = this.score[1 - t.idx] - this.score[t.idx];
        const ex = t.skaters[5];
        if (!t.pulled && diff >= 1 && diff <= 2 && !ex.box && !ex.onIce && this.puck.carrier && this.puck.carrier.team === t.idx) {
          t.pulled = true; t.goalie.onIce = false; ex.onIce = true; ex.x = t.goalie.x; ex.y = this.benchY() * (t.idx ? -1 : 1);
          this.say('GOALIE PULLED', `${t.name} go six-on-five`, '#ffd34a', 2.2);
        }
      }
    }
  }

  endPeriod() {
    this.clock = 0;
    this.puck.carrier = null;
    const tied = this.score[0] === this.score[1];
    this.emit('horn', {});
    if (this.period >= 3 && !tied) { this.winner = this.score[0] > this.score[1] ? 0 : 1; this.state = 'intermission'; this.stateT = 0; this.say('FINAL', '', '#fff', 3); this.pendingNext = 'final'; return; }
    this.state = 'intermission'; this.stateT = 0;
    this.pendingNext = this.period >= 4 && tied ? 'shootout' : 'period';
    const label = this.period === 1 ? 'END OF 1ST' : this.period === 2 ? 'END OF 2ND' : this.period === 3 ? 'END OF REGULATION' : 'NO GOAL IN OT';
    this.say(label, tied && this.period >= 3 ? (this.period >= 4 ? 'TIED — HEADING TO A SHOOTOUT' : 'TIED — 5 MINUTE OVERTIME') : `${this.score[0]} – ${this.score[1]}`, '#fff', 3.4);
  }

  stepIntermission(dt) {
    if (this.stateT < 3.8) return;
    if (this.pendingNext === 'final') { this.finish(); return; }
    if (this.pendingNext === 'shootout') { this.startShootout(); return; }
    this.period++;
    this.clock = this.period >= 4 ? 300 : 1200;
    this.setAttackDirs();
    // reset penalties' players stay in the box; fresh faceoff
    this.beginFaceoff(0, 0);
    this.say(this.period === 4 ? 'OVERTIME' : this.period > 4 ? `${this.period - 3}OT` : `PERIOD ${this.period}`, this.period >= 4 ? '5 MIN · FIRST GOAL WINS · THEN SHOOTOUT' : '', '#ffd34a', 2.4);
  }

  finish() {
    this.state = 'final'; this.stateT = 0;
    if (this.winner < 0) this.winner = this.score[0] > this.score[1] ? 0 : 1;
    this.puck.carrier = null;
    this.say(this.so ? 'FINAL / SO' : 'FINAL', `${TEAMS[this.winner].name} WIN ${this.score[this.winner]} – ${this.score[1 - this.winner]}${this.so ? ' (SHOOTOUT)' : ''}`, TEAMS[this.winner].css, 12, { big: true });
    this.emit('horn', {});
  }

  stepFaceoff(dt) {
    const fo = this.fo, pk = this.puck;
    pk.x = fo.x; pk.y = fo.y; pk.z = pk.r; pk.vx = pk.vy = 0;
    let all = true;
    for (const t of this.teams) {
      this.slotFaceoff(t);
      for (const p of t.skaters) if (p.onIce && !p.box && hyp(p.tx - p.x, p.ty - p.y) > 2.2) all = false;
    }
    if ((all && this.stateT > 1.2) || this.stateT > 6) fo.hold += dt;
    if (fo.hold > 0.9) this.dropPuck();
  }

  dropPuck() {
    const pk = this.puck, fo = this.fo;
    const c0 = this.iceSkaters(0).find((p) => p.role === 'C') || this.iceSkaters(0)[0];
    const c1 = this.iceSkaters(1).find((p) => p.role === 'C') || this.iceSkaters(1)[0];
    const w = this.rng() < 0.5 + ((c0 ? c0.skill : 0.5) - (c1 ? c1.skill : 0.5)) * 0.4 ? 0 : 1;
    pk.vx = -this.teams[w].dir * (3 + this.rng() * 2); pk.vy = (this.rng() - 0.5) * 3; pk.vz = 1.2;
    this.state = 'play'; this.stateT = 0; this.emit('drop', {});
    pk.lastTouchTeam = -1;
  }

  stepWhistle(dt) {
    const pd = this.pending;
    let waiting = false;
    // penalised players skate to the penalty box gate under their own power, then take their seat
    for (const pen of pd.pens) {
      if (pen.done) continue;
      const p = pen.p;
      if (!p.onIce) { pen.done = true; continue; }
      const gx = p.team === 0 ? -2.6 : 2.6, gy = -(RINK.hy - 1.0);
      p.tx = gx; p.ty = gy; p.tspd = 0.75; p.fighting = false;
      if (hyp(p.x - gx, p.y - gy) < 1.7 || this.stateT > 8) { this.applyPenalty(pen); pen.done = true; pd.tDone = this.stateT; }
      else waiting = true;
    }
    if (waiting) return;
    const until = pd.pens.length ? (pd.tDone !== undefined ? pd.tDone : this.stateT) + 1.1 : pd.delay;
    if (this.stateT < Math.max(until, pd.delay)) return;
    this.pending = null; this.fight = null;
    this.beginFaceoff(pd.x, pd.y);
  }

  // ------------------------------------------------------------------ penalties
  callPenalty(p, label, mins, kind = 'minor') {
    if (this.state !== 'play' || p.box || !p.onIce) return;
    const pk = this.puck;
    const dot = this.nearestDot(pk.x, pk.y);
    this.whistle('penalty', dot[0], dot[1], { p, label, mins, kind });
    this.say('PENALTY', `#${p.num} ${p.name} · ${label} · ${mins}:00`, '#ff6a5c', 3);
    this.emit('penalty', { p });
  }

  applyPenalty(pen) {
    const p = pen.p, t = this.teams[p.team];
    if (p.box || !p.onIce) return;
    p.onIce = false; p.box = true; p.fall = 0; p.fighting = false;
    p.boxSlot = t.pen.length;
    const mins = pen.mins;
    t.pen.push({ p, rem: mins * 60, kind: pen.kind, label: pen.label });
    this.pim[p.team] += mins;
    // returning a pulled-goalie skater? put goalie back if the extra is the offender
    if (t.pulled && p.idx === 5) { t.pulled = false; t.goalie.onIce = true; }
    this.placeInBox(p);
  }

  placeInBox(p) {
    const t = this.teams[p.team];
    p.x = (p.team === 0 ? -2.6 : 2.6) + (p.boxSlot % 2 ? (p.team ? 1.2 : -1.2) : 0);
    p.y = -(RINK.hy + 2.3); p.vx = p.vy = 0; p.h = Math.PI / 2;
  }

  releasePenalty(t, i) {
    const e = t.pen.splice(i, 1)[0];
    const p = e.p;
    p.box = false; p.onIce = true;
    p.x = t.idx === 0 ? -2.6 : 2.6; p.y = -(RINK.hy - 1.2); p.vx = p.vy = 0; p.h = Math.PI / 2;
    if (t.pen.length) t.pen.forEach((x, k) => { x.p.boxSlot = k; this.placeInBox(x.p); });
  }

  // ------------------------------------------------------------------ fights
  startFight(a, b) {
    if (this.state !== 'play' || this.fights >= 3) return;
    this.fights++;
    this.puck.carrier = null;
    this.state = 'fight'; this.stateT = 0;
    const pa = 0.5 + (a.tough - b.tough) * 0.5 + (this.rng() - 0.5) * 0.3;
    this.fight = { a, b, t: 0, win: this.rng() < pa ? a : b, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, over: false };
    const w = this.wallClamp(this.fight.mx, this.fight.my, 3.5);
    this.fight.mx = w[0]; this.fight.my = w[1];
    a.fighting = b.fighting = true;
    this.emit('fight', { a, b }); this.emit('whistle', { reason: 'fight' });
    for (const o of this.officials) if (o.role === 'ref') { o.sig = 'whistle'; o.sigT = 1.5; }
    this.say('FIGHT!', `#${a.num} ${a.name}  vs  #${b.num} ${b.name}`, '#ff4d3d', 4.6, { shake: true });
  }

  stepFight(dt) {
    const f = this.fight; f.t += dt;
    const { a, b } = f;
    for (const p of [a, b]) {
      const o = p === a ? b : a;
      const dx = o.x - p.x, dy = o.y - p.y, d = hyp(dx, dy) || 1;
      p.h = Math.atan2(dy, dx);
      if (f.t < 1.1) { p.tx = f.mx - dx / d * 0.5 * 0; p.ty = f.my; p.tspd = 0.85; p.tx = f.mx; }
      else if (p.fall <= 0) {
        // lock into a slow circling grapple
        const ang = f.t * 1.4 + (p === a ? 0 : Math.PI);
        p.x += ((f.mx + Math.cos(ang) * 0.62) - p.x) * Math.min(1, dt * 8);
        p.y += ((f.my + Math.sin(ang) * 0.62) - p.y) * Math.min(1, dt * 8);
        p.vx = p.vy = 0; p.tx = p.x; p.ty = p.y;
        p.h = Math.atan2(f.my - p.y, f.mx - p.x);
        p.punch = Math.max(0, p.punch - dt);
        if (p.punch <= 0 && f.t < 4.4 && this.rng() < dt * 3.2) { p.punch = 0.28; this.emit('punch', { p }); }
      }
    }
    if (f.t > 4.4 && !f.over) {
      f.over = true;
      const loser = f.win === a ? b : a;
      loser.fall = 2.6; loser.fallDir = 1; loser.vx = loser.vy = 0;
      f.win.cheer = 1.5;
      this.emit('hit', { x: loser.x, y: loser.y, power: 1 });
      this.say(`#${f.win.num} ${f.win.name} WINS THE FIGHT`, '', '#ffd34a', 2.2);
    }
    if (f.t > 6.2) {
      const dot = this.nearestDot(f.mx, f.my, (d) => Math.abs(d[0]) < 7);
      for (const p of [a, b]) p.fighting = false;
      // 5 minute fighting majors for both, served after they skate to the box
      this.state = 'whistle'; this.stateT = 0;
      this.pending = { x: dot[0], y: dot[1], delay: 1.3, reason: 'fight', pens: [a, b].map((p) => ({ p, label: 'FIGHTING', mins: 5, kind: 'major' })) };
      this.fight = null;
    }
  }

  // ------------------------------------------------------------------ goals / rules
  goal(s, scorer, empty) {
    // s = which end the puck went into (+1 or -1); attacker is the team whose dir === s
    const att = this.teams[this.teams[0].dir === s ? 0 : 1];
    const def = this.opp(att.idx);
    this.score[att.idx]++;
    const who = (scorer && scorer.team === att.idx) ? scorer : (att.skaters.find((p) => p.onIce && !p.box) || att.skaters[0]);
    this.state = 'goal'; this.stateT = 0;
    this.goalLight[s === 1 ? 0 : 1] = 5; this.lastGoalEnd = s; this.scorer = who;
    this.puck.carrier = null;
    // minor penalty ends on a power-play goal
    if (def.pen.length > att.pen.length) {
      const k = def.pen.findIndex((e) => e.kind === 'minor');
      if (k >= 0) { const ent = def.pen[k]; this.releasePenaltyQuiet(def, k); void ent; }
    }
    const otherEnd = this.period >= 4;
    if (otherEnd) this.winner = att.idx;
    { const r = this.nearestOfficial('ref', s * GOAL_X, 0); if (r) { r.sig = 'point'; r.sigT = 3.2; r.sigDir = s > 0 ? 0 : Math.PI; } }
    this.emit('goal', { team: att.idx, scorer: who, empty, end: s });
    this.say(empty ? 'EMPTY-NET GOAL!' : 'GOAL!', `#${who.num} ${who.name} · ${att.name} ${this.score[att.idx]} – ${this.score[def.idx]}`, att.css, 4.4, { big: true });
    for (const p of att.skaters) if (p.onIce && !p.box) p.cheer = 3;
    who.cheer = 4;
    this.shots[att.idx] = this.shots[att.idx]; // (shot already counted on release)
  }

  releasePenaltyQuiet(t, i) { this.releasePenalty(t, i); }

  checkRules(prevX, prevY) {
    const pk = this.puck;
    // ---- goal / crossbar / posts at each net
    for (const s of [-1, 1]) {
      const gx = s * GOAL_X;
      const crossing = (prevX * s < GOAL_X) && (pk.x * s >= GOAL_X);
      if (crossing) {
        const f = (gx - prevX) / (pk.x - prevX || 1e-9);
        const yAt = prevY + (pk.y - prevY) * f;
        if (Math.abs(yAt) < NET_HALF - 0.02) {
          if (pk.z < RINK.crossbar - 0.02) {
            if (this.state === 'shootout') { this.soGoal(s); return; }
            const att = this.teams[0].dir === s ? this.teams[0] : this.teams[1];
            const def = this.opp(att.idx);
            this.goal(s, pk.lastShooter && pk.lastShooter.team === att.idx ? pk.lastShooter : pk.lastTouch, !def.goalie.onIce);
            return;
          } else if (pk.z < RINK.crossbar + 0.14) {
            pk.vx = -Math.abs(pk.vx) * s * 0.45; pk.x = gx - s * 0.1; pk.vz = Math.abs(pk.vz) * 0.4 + 1.5;
            this.emit('post', { x: gx, y: yAt, z: RINK.crossbar });
          }
        } else if (pk.z < 1.5) {
          // icing: shot / pass from own half, no touch, over the far goal line, not a goal
          const att = this.teams[0].dir === s ? 0 : 1;
          if (this.state === 'play' && pk.iceValid && pk.iceTeam === att && !pk.carrier) {
            this.icings++;
            const dot = this.nearestDot(-s * 21, pk.y >= 0 ? 6.7 : -6.7, (d) => Math.abs(d[0]) > 15 && d[0] * s < 0);
            this.whistle('icing', dot[0], dot[1]);
            this.say('ICING', `${TEAMS[att].name}`, '#ffffff', 2);
          }
        }
      }
    }
    this.checkOffside(prevX);
  }

  checkOffside(prevX) {
    const pk = this.puck;
    if (this.state !== 'play') return;
    for (const s of [-1, 1]) {
      if (!(prevX * s < BLUE_X && pk.x * s >= BLUE_X)) continue;
      const att = this.teams[this.teams[0].dir === s ? 0 : 1];
      if (pk.lastTouchTeam !== att.idx) continue;
      const offender = this.iceSkaters(att.idx).find((p) => p !== pk.carrier && p.x * s > BLUE_X + 0.8);
      if (!offender) continue;
      this.offsides++;
      const nd = this.nearestDot(s * 6.1, pk.y >= 0 ? 6.7 : -6.7, (d) => Math.abs(d[0] - s * 6.1) < 0.2);
      this.whistle('offside', nd[0], nd[1]);
      this.say('OFFSIDE', `#${offender.num} ${offender.name}`, '#ffffff', 2);
      return;
    }
  }

  // ------------------------------------------------------------------ puck
  stepPuck(dt) {
    const pk = this.puck;
    if (pk.carrier) {
      const c = pk.carrier;
      if (!c.onIce || c.box || c.fall > 0 && !c.isG) { pk.carrier = null; }
      else {
        const prevCX = pk.x;
        const sway = c.windup > 0 ? 0 : Math.sin(this.t * 5.5 + c.id) * 0.4;
        const ang = c.h + sway;
        const off = c.isG ? 0.95 : 1.05;
        pk.x = c.x + Math.cos(ang) * off; pk.y = c.y + Math.sin(ang) * off;
        pk.vx = c.vx; pk.vy = c.vy; pk.z = pk.r; pk.vz = 0; pk.still = 0;
        pk.lastTouch = c; pk.lastTouchTeam = c.team; pk.iceValid = false;
        if (this.state === 'play') this.checkOffside(prevCX);
        return;
      }
    }
    if (this.state === 'faceoff') return;
    const prevX = pk.x, prevY = pk.y;
    pk.x += pk.vx * dt; pk.y += pk.vy * dt;
    pk.vz -= G * dt; pk.z += pk.vz * dt;
    if (pk.z <= pk.r) {
      pk.z = pk.r;
      if (pk.vz < -1.6) { pk.vz = -pk.vz * 0.38; pk.vx *= 0.97; pk.vy *= 0.97; this.emit('ice', { x: pk.x, y: pk.y, power: -pk.vz }); }
      else pk.vz = 0;
    }
    const sp = hyp(pk.vx, pk.vy);
    if (pk.z <= pk.r + 0.02 && sp > 0) {
      const dec = (0.45 + sp * 0.012) * dt;
      const ns = Math.max(0, sp - dec);
      pk.vx *= ns / sp; pk.vy *= ns / sp;
    }
    pk.still = sp < 0.4 ? pk.still + dt : 0;

    // ---- boards and glass
    const d = rinkSDF(pk.x, pk.y);
    if (d > -pk.r) {
      const [nx, ny] = rinkNormal(pk.x, pk.y);
      const endH = Math.abs(pk.x) > 20 ? RINK.glassEndH : RINK.glassH;
      if (pk.z > endH + 0.4 && this.state === 'play') {
        // over the glass: out of play
        const dot = this.nearestDot(pk.x * 0.8, pk.y * 0.8);
        this.whistle('out', dot[0], dot[1]);
      }
      const pen = d + pk.r;
      pk.x -= nx * pen; pk.y -= ny * pen;
      const vn = pk.vx * nx + pk.vy * ny;
      if (vn > 0) {
        const e = pk.z < RINK.boardH ? 0.62 : 0.5;
        pk.vx -= (1 + e) * vn * nx; pk.vy -= (1 + e) * vn * ny;
        pk.vx *= 0.94; pk.vy *= 0.94;
        this.emit('board', { x: pk.x, y: pk.y, z: pk.z, power: vn, glass: pk.z > RINK.boardH });
      }
    }
    // ---- net: posts ping, netting swallows the puck (drag, slanted back, roof), sides and back bulge
    if (pk.z < RINK.crossbar + 0.25) {
      for (const s of [-1, 1]) {
        for (const py of [-NET_HALF, NET_HALF]) this.puckPoint(pk, s * GOAL_X, py, 0.07 + pk.r, 0.7);
        const bx = s * (GOAL_X + NET_D);
        for (const py of [-1, 1]) this.puckSeg(pk, s * GOAL_X, py * NET_HALF, bx, py * NET_HALF, 0.1 + pk.r * 0.5, 0.15, 'net', s);
        this.puckSeg(pk, bx, -NET_HALF, bx, NET_HALF, 0.1 + pk.r * 0.5, 0.15, 'net', s);
        this.netInside(pk, s, dt);
      }
    }
    // ---- goalies
    const live = this.state === 'play' || (this.state === 'shootout' && this.so && this.so.phase === 'attempt' && !this.so.result);
    if (live && !pk.frozen) this.goalieSaves(prevX, prevY);
    if (live) this.checkRules(prevX, prevY);
    // stoppage if nothing is happening
    if (this.state === 'play' && pk.still > 4.5 && !pk.carrier) {
      const dot = this.nearestDot(pk.x, pk.y); this.whistle('stopped', dot[0], dot[1]);
    }
    // pickups
    if (this.state === 'play') this.pickups(dt);
    if (!isFinite(pk.x) || !isFinite(pk.y)) { pk.x = 0; pk.y = 0; pk.vx = pk.vy = 0; }
  }

  // puck inside the net mouth: roof, slanted back wall and netting drag (side walls come from puckSeg)
  netInside(pk, s, dt) {
    const depth = s * pk.x - GOAL_X;
    if (depth < -0.05 || depth > NET_D + 0.3 || Math.abs(pk.y) > NET_HALF + 0.02) return;
    const bar = RINK.crossbar;
    const roof = bar * 0.96;
    if (depth > 0.05 && pk.z > roof) { pk.z = roof; if (pk.vz > 0) { this.emit('net', { x: pk.x, y: pk.y, z: pk.z, power: pk.vz * 2 + 2, end: s }); pk.vz *= -0.12; } }
    const back = NET_D * (1 - 0.45 * Math.min(1, pk.z / bar)) - 0.15;
    if (depth > back) {
      pk.x = s * (GOAL_X + back);
      const vn = pk.vx * s;
      if (vn > 0) { this.emit('net', { x: pk.x, y: pk.y, z: pk.z, power: vn, end: s }); pk.vx = -pk.vx * 0.09; pk.vy *= 0.5; pk.vz *= 0.5; }
    }
    const k = Math.exp(-1.6 * dt); pk.vx *= k; pk.vy *= k;
  }

  puckPoint(pk, px, py, rad, e, evt = 'post', end = 0) {
    const dx = pk.x - px, dy = pk.y - py, d = hyp(dx, dy);
    if (d >= rad || d < 1e-6) return;
    const nx = dx / d, ny = dy / d;
    pk.x = px + nx * rad; pk.y = py + ny * rad;
    const vn = pk.vx * nx + pk.vy * ny;
    if (vn < 0) { pk.vx -= (1 + e) * vn * nx; pk.vy -= (1 + e) * vn * ny; if (evt === 'net') { if (-vn > 2.5) this.emit('net', { x: pk.x, y: pk.y, z: pk.z, power: -vn, end }); } else this.emit('post', { x: px, y: py, z: pk.z, power: -vn }); }
  }

  puckSeg(pk, ax, ay, bx, by, rad, e, evt = 'post', end = 0) {
    const abx = bx - ax, aby = by - ay, l2 = abx * abx + aby * aby;
    const t = clamp(((pk.x - ax) * abx + (pk.y - ay) * aby) / l2, 0, 1);
    this.puckPoint(pk, ax + abx * t, ay + aby * t, rad, e, evt, end);
  }

  // pads are wide, torso narrower, shoulders/glove-side top corner narrowest; a dive takes time to extend
  goalieReach(g, z) {
    const base = z < 0.45 ? 0.62 : z < 0.92 ? 0.47 : 0.34;
    const ext = g.dive > 0 ? 0.55 * (1 - g.dive / 0.5) : 0;
    return base + ext;
  }

  goalieSaves(prevX, prevY) {
    const pk = this.puck;
    if (this.state === 'shootout' && this.so && this.so.beaten) return; // goalie fooled by the deke / pick of the corner
    for (const t of this.teams) {
      const g = t.goalie;
      if (!g.onIce) continue;
      const s = -t.dir; // my net is at x = s*GOAL_X
      // puck crossing the goalie's plane moving towards the net
      const gx = g.x;
      const toward = pk.vx * s > 0.5;
      const crossed = (prevX - gx) * s <= 0 && (pk.x - gx) * s > 0 && toward;
      const inBody = toward && Math.abs(pk.x - gx) < 0.5;
      if ((crossed || inBody) && pk.z < (g.dive > 0 ? 1.7 : 1.5) && Math.abs(pk.y - g.y) < this.goalieReach(g, pk.z)) {
        const sp = hyp(pk.vx, pk.vy);
        const covered = this.rng() < 0.42 && sp < 30 || sp < 5;
        pk.x = gx - s * 0.55; this.soSaved = true;
        this.emit('save', { x: pk.x, y: pk.y, z: pk.z, power: sp });
        if (covered) {
          pk.vx = pk.vy = pk.vz = 0; pk.frozen = true; pk.carrier = null;
          const dot = this.nearestDot(s * 21, pk.y >= 0 ? 6.7 : -6.7, (d) => Math.abs(d[0]) > 15 && d[0] * s > 0);
          this.whistle('save', dot[0], dot[1], null, 1.8);
          this.say('SAVE', `#${g.num} ${g.name}`, '#ffffff', 1.4);
        } else {
          const ang = Math.atan2(0, -s) + this.gauss() * 0.9;
          const rs = 3 + this.rng() * 6;
          pk.vx = Math.cos(ang) * rs; pk.vy = Math.sin(ang) * rs; pk.vz = 1 + this.rng() * 2.5;
          pk.lastTouch = g; pk.lastTouchTeam = g.team; pk.iceValid = false; pk.shotPower = 0;
          g.cool = 0.4;
        }
        return;
      }
    }
  }

  pickups(dt) {
    const pk = this.puck;
    if (pk.carrier || pk.z > 0.5 || pk.frozen) return;
    let best = null, bd = 1e9;
    const sp = hyp(pk.vx, pk.vy);
    for (const p of this.players) {
      if (!p.onIce || p.box || p.isG || p.fall > 0 || p.cool > 0 || p.fighting) continue;
      const d = hyp(pk.x - p.x, pk.y - p.y);
      const rel = hyp(pk.vx - p.vx, pk.vy - p.vy);
      const reach = 1.05 + Math.min(0.5, p.skill * 0.3);
      if (d < reach && rel < 24 && d < bd) { bd = d; best = p; }
    }
    if (best) {
      const rel = hyp(pk.vx - best.vx, pk.vy - best.vy);
      if (rel > 13 && this.rng() < (rel - 13) / 22 * (1.15 - best.skill * 0.5)) {
        // deflected off the stick
        pk.vx += this.gauss() * 4; pk.vy += this.gauss() * 4; pk.vx *= 0.6; pk.vy *= 0.6;
        pk.lastTouch = best; pk.lastTouchTeam = best.team; pk.iceValid = false;
        best.cool = 0.3; this.emit('tink', { x: pk.x, y: pk.y }); return;
      }
      pk.carrier = best; pk.lastTouch = best; pk.lastTouchTeam = best.team; pk.iceValid = false; pk.target = null;
      best.dec = 0.15; best.swing = 0.2;
      this.emit('pickup', { p: best });
    }
  }

  // ------------------------------------------------------------------ shooting / passing
  release(p, ang, sp, vz, kind) {
    const pk = this.puck;
    pk.carrier = null;
    pk.x = p.x + Math.cos(p.h) * 1.0; pk.y = p.y + Math.sin(p.h) * 1.0;
    pk.vx = Math.cos(ang) * sp + p.vx * 0.25; pk.vy = Math.sin(ang) * sp + p.vy * 0.25; pk.vz = vz; pk.z = pk.r + 0.02;
    p.cool = 0.5; p.swing = 0.4; p.windup = 0;
    pk.lastShooter = p; pk.lastTouch = p; pk.lastTouchTeam = p.team; pk.shotType = kind;
    if (this.state === 'shootout' && this.so) { this.so.shot = true; this.so.shotT = this.so.t; this.so.beaten = this.rng() < 0.42 + (p.shot - 0.6) * 0.3; }
    pk.shotPower = hyp(pk.vx, pk.vy);
    // icing eligibility: released from own half
    const own = p.x * this.teams[p.team].dir < -0.5;
    pk.iceValid = own; pk.iceTeam = p.team;
  }

  shoot(p, type, aimY) {
    const a = this.teams[p.team].dir;
    const nx = a * GOAL_X;
    const corner = this.rng() < 0.5 ? -1 : 1;
    const hi = aimY !== undefined ? this.rng() < 0.75 : this.rng() < 0.45;
    const ty = aimY !== undefined ? aimY : corner * (0.6 + this.rng() * 0.22), th = hi ? (aimY !== undefined ? 1.0 + this.rng() * 0.14 : 0.9 + this.rng() * 0.15) : 0.12 + this.rng() * 0.3;
    const sx = p.x + Math.cos(p.h), sy = p.y + Math.sin(p.h); // the puck leaves from the blade
    const dx = nx - sx, dy = ty - sy, d = hyp(dx, dy);
    let sp = type === 'slap' ? 34 + p.shot * 8 : type === 'wrist' ? 23 + p.shot * 8 : 19 + p.shot * 5;
    sp *= 0.95 + this.rng() * 0.08;
    const press = this.nearestOpp(p, 3.5) ? 1 : 0;
    const err = (0.034 + press * 0.026) * (1.45 - p.shot * 0.55) * (type === 'slap' ? 1.15 : 1);
    const ang = Math.atan2(dy, dx) + this.gauss() * err;
    const tt = Math.max(0.05, d / sp);
    let vz = (th - 0.25 + 0.5 * G * tt * tt) / tt + this.gauss() * 0.5;
    vz = clamp(vz, 0, 10);
    // aim for the final velocity: release() adds 25% of the shooter's own velocity, so take it off first
    const lx = Math.cos(ang) * sp - p.vx * 0.25, ly = Math.sin(ang) * sp - p.vy * 0.25;
    this.release(p, Math.atan2(ly, lx), hyp(lx, ly), vz, type);
    this.shots[p.team]++;
    this.emit(type === 'slap' ? 'slap' : 'shot', { p, power: sp });
  }

  passTo(p, r) {
    const dx0 = r.x - p.x, dy0 = r.y - p.y, d0 = hyp(dx0, dy0);
    const sp = clamp(13 + d0 * 0.55, 13, 24) * (0.92 + p.pass * 0.12);
    const lead = clamp(d0 / sp, 0.1, 1.0) * 0.85;
    const tx = r.x + r.vx * lead, ty = r.y + r.vy * lead;
    const ang = Math.atan2(ty - p.y, tx - p.x) + this.gauss() * 0.045 * (1.4 - p.pass * 0.6);
    this.release(p, ang, sp, 0, 'pass');
    this.puck.iceValid = false; // a pass between teammates — not icing unless shot; keep eligibility only for long clears
    this.puck.target = r;
    this.emit('pass', { p, power: sp });
  }

  clearPuck(p, tx, ty, sp) {
    const ang = Math.atan2(ty - p.y, tx - p.x) + this.gauss() * 0.06;
    this.release(p, ang, sp, 0.4, 'clear');
    this.emit('shot', { p, power: sp });
  }

  nearestOpp(p, maxD = 99) {
    let best = null, bd = maxD;
    for (const o of this.iceSkaters(1 - p.team)) {
      if (o.fall > 0) continue;
      const d = hyp(o.x - p.x, o.y - p.y);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  // ------------------------------------------------------------------ AI
  ai(dt) {
    const st = this.state;
    for (const p of this.players) { p.cool = Math.max(0, p.cool - dt); p.swing = Math.max(0, p.swing - dt); p.cheer = Math.max(0, p.cheer - dt); p.hitCool = Math.max(0, p.hitCool - dt); }
    if (st === 'play') this.aiPlay(dt);
    else if (st === 'shootout') this.aiShootout(dt);
    else if (st === 'faceoff') {
      for (const t of this.teams) this.goalieHome(t.goalie, dt);
    } else if (st === 'goal') {
      const sc = this.scorer;
      for (const t of this.teams) {
        this.goalieHome(t.goalie, dt, true);
        for (const p of this.iceSkaters(t.idx)) {
          if (t.idx === sc.team && p !== sc && p.fall <= 0) { p.tx = sc.x; p.ty = sc.y; p.tspd = 0.7; }
          else if (p === sc) { p.tspd = 0.3; p.tx = p.x + p.vx; p.ty = p.y + p.vy; }
          else { p.tspd = 0.15; p.tx = p.x; p.ty = p.y; }
        }
      }
    } else {
      for (const t of this.teams) {
        this.goalieHome(t.goalie, dt, true);
        if (st === 'whistle' || st === 'intermission' || st === 'final') for (const p of this.iceSkaters(t.idx)) { if (!p.fighting && !this.walking(p)) { p.tspd = 0.25; p.tx = p.x + p.vx * 0.6; p.ty = p.y + p.vy * 0.6; } }
        if (st === 'fight') for (const p of this.iceSkaters(t.idx)) if (!p.fighting) { p.tspd = 0.1; p.tx = p.x; p.ty = p.y; }
      }
    }
  }

  aiPlay(dt) {
    const pk = this.puck, carrier = pk.carrier;
    const ice = [this.iceSkaters(0), this.iceSkaters(1)];
    // chasers
    const chaser = [null, null];
    const px = carrier ? carrier.x : pk.x + pk.vx * 0.18, py = carrier ? carrier.y : pk.y + pk.vy * 0.18;
    for (const t of [0, 1]) {
      if (carrier && carrier.team === t) continue;
      let best = null, bd = 1e9;
      for (const p of ice[t]) {
        if (p.fall > 0 || p.cool > 0.2) continue;
        const d = hyp(px - p.x, py - p.y) / p.maxSpeed;
        if (d < bd) { bd = d; best = p; }
      }
      chaser[t] = best;
    }
    for (const t of this.teams) {
      this.goalieAI(t.goalie, dt);
      const a = t.dir, o = this.opp(t.idx);
      const hasPuck = carrier ? carrier.team === t.idx : pk.lastTouchTeam === t.idx;
      // marking assignment for the defending posture
      const marks = new Map();
      if (!hasPuck) {
        const targets = ice[o.idx].filter((x) => x !== carrier);
        const used = new Set();
        const mine = ice[t.idx].filter((p) => p !== chaser[t.idx]).sort((p, q) => (q.role[1] === 'D') - (p.role[1] === 'D'));
        for (const p of mine) {
          let best = null, bc = 1e9;
          for (const x of targets) {
            if (used.has(x)) continue;
            const c = hyp(x.x - p.x, x.y - p.y) + 0.35 * hyp(x.x + a * GOAL_X, x.y);
            if (c < bc) { bc = c; best = x; }
          }
          if (best) { used.add(best); marks.set(p, best); }
        }
      }
      for (const p of ice[t.idx]) {
        if (p.fall > 0) continue;
        if (p === carrier) this.carrierAI(p, dt, ice);
        else if (p === chaser[t.idx]) this.chase(p, px, py, carrier && carrier.team !== t.idx);
        else if (hasPuck) this.support(p, t, ice);
        else this.mark(p, t, marks.get(p), px, py);
        if (p !== carrier) p.windup = 0;
      }
    }
  }

  chase(p, px, py, hit) {
    p.tx = px; p.ty = py; p.tspd = 1;
    if (hit) {
      const d = hyp(px - p.x, py - p.y);
      p.tspd = 1.05;
      // stick lift / poke: handled in the carrier's AI (needs to know about defenders nearby)
      void d;
    }
  }

  support(p, t, ice) {
    const a = t.dir, pk = this.puck;
    const u = pk.x * a;
    const inZone = u > BLUE_X + 0.8;
    const isD = p.role === 'LD' || p.role === 'RD';
    let tu, tv = LAT[p.role] + Math.sin(this.t * 0.7 + p.id) * 2.2;
    if (isD) {
      tu = inZone ? 5.6 : clamp(u - 9, -24, 5.6);
      tv = LAT[p.role] * (inZone ? 1.8 : 1.1);
    } else if (inZone) {
      if (p.role === 'C' || p.idx === 5) { tu = 21.5; tv = Math.sin(this.t * 0.9 + p.id) * 2.6; }
      else { tu = 17 + Math.sin(this.t * 0.8 + p.id) * 3; tv = LAT[p.role] * 1.1; }
    } else {
      tu = clamp(u + 9, -14, BLUE_X - 1.3);
      if (u < 0) tu = clamp(u + 8, -22, -1);
      tv = LAT[p.role] * 1.15;
    }
    // stay onside until the puck is in
    if (!inZone && !(pk.carrier === p)) {
      tu = Math.min(tu, BLUE_X - 1.4);
      const pu = p.x * a + p.vx * a * 0.4;
      if (pu > BLUE_X - 2.2) tu = Math.min(tu, 2.5);
    }
    p.tx = tu * a; p.ty = clamp(tv, -11.5, 11.5); p.tspd = 0.95;
  }

  mark(p, t, target, px, py) {
    const a = t.dir, pk = this.puck;
    const ownX = -a * GOAL_X;
    if (target) {
      const dx = ownX - target.x, dy = -target.y, d = hyp(dx, dy) || 1;
      const off = p.role[1] === 'D' ? 2.4 : 3.3;
      let tx = target.x + dx / d * off, ty = target.y + dy / d * off;
      // don't hang too far up-ice
      p.tx = tx; p.ty = ty;
    } else {
      p.tx = -a * (GOAL_X - 7); p.ty = LAT[p.role] * 0.4;
    }
    // defenders hold between puck and net when the puck is deep
    if (p.role[1] === 'D') {
      const u = pk.x * a;
      if (u < -10) { p.tx = ownX + a * 6 + (p.tx - ownX) * 0.15; }
    }
    p.tspd = 0.95;
  }

  carrierAI(p, dt, ice) {
    const t = this.teams[p.team], a = t.dir, pk = this.puck;
    const o = this.opp(p.team);
    const nx = a * GOAL_X;
    const u = p.x * a;
    const d = hyp(nx - p.x, -p.y);
    // stick checks from nearby defenders
    for (const e of ice ? this.iceSkaters(o.idx) : []) {
      if (e.fall > 0) continue;
      const ed = hyp(e.x - p.x, e.y - p.y);
      if (ed < 1.6) {
        if (this.rng() < dt * 0.95 * e.chk * (1.15 - p.skill * 0.55)) {
          const ang = Math.atan2(e.y - p.y, e.x - p.x) + this.gauss() * 1.2;
          pk.carrier = null; pk.vx = Math.cos(ang) * (3 + this.rng() * 4) + e.vx * 0.5; pk.vy = Math.sin(ang) * (3 + this.rng() * 4) + e.vy * 0.5; pk.vz = 0;
          pk.lastTouch = e; pk.lastTouchTeam = e.team; pk.iceValid = false;
          p.cool = 0.7; this.emit('stick', { x: pk.x, y: pk.y });
          if (this.rng() < 0.03) this.callPenalty(e, FOULS[(this.rng() * FOULS.length) | 0], 2);
          return;
        }
      }
    }
    // wind-up in progress
    if (p.windup > 0) {
      p.windup -= dt;
      p.tspd = 0.4;
      if (p.windup <= 0) { this.shoot(p, p.windType); }
      return;
    }
    p.dec -= dt;
    // skating target
    const defn = this.nearestOpp(p, 6);
    if (u < 9) {
      let lane = clamp(p.y + (defn ? (p.y >= defn.y ? 1 : -1) * 4 : (this.rng() - 0.5) * 2), -9, 9);
      p.tx = p.x + a * 12; p.ty = lane;
    } else {
      p.tx = nx - a * 7.5; p.ty = clamp(p.y * 0.55, -6, 6);
      if (defn && hyp(defn.x - p.x, defn.y - p.y) < 3.2) p.ty += (p.y >= defn.y ? 1 : -1) * 3;
    }
    p.tspd = 0.95;
    if (p.dec > 0) return;
    p.dec = 0.22 + this.rng() * 0.2;
    const press = this.nearestOpp(p, 3.4);
    // -------- shoot?
    const inRange = u > 9.5 && d < 25 && p.x * a < GOAL_X - 1.8;
    if (inRange) {
      const lane = this.laneBlocked(p, nx, 0, o.idx);
      let ps = 0.2 + 0.5 * (1 - d / 25) + (press ? 0.04 : 0);
      if (lane) ps *= 0.45;
      if (Math.abs(p.y) > 10.5) ps *= 0.5;
      if (this.rng() < ps) {
        const slap = d > 12 && !press && this.rng() < 0.62;
        if (slap) { p.windup = 0.5; p.windType = 'slap'; this.emit('windup', { p }); }
        else if (this.rng() < 0.15) { this.shoot(p, 'backhand'); }
        else { p.windup = 0.14; p.windType = 'wrist'; }
        return;
      }
    }
    // -------- pass?
    const mates = ice.length ? this.iceSkaters(p.team).filter((m) => m !== p && m.fall <= 0) : [];
    let best = null, bs = -1e9;
    for (const m of mates) {
      const mu = m.x * a, dd = hyp(m.x - p.x, m.y - p.y);
      if (dd < 3 || dd > 34) continue;
      if (pk.x * a < BLUE_X && mu > BLUE_X - 0.6) continue; // would be offside
      const blocked = this.laneBlocked(p, m.x, m.y, o.idx);
      const nearOpp = this.nearestOpp(m, 8);
      const open = nearOpp ? hyp(nearOpp.x - m.x, nearOpp.y - m.y) : 8;
      const sc = (mu - u) * 0.5 + open * 0.9 - dd * 0.12 - (blocked ? 9 : 0) + this.rng() * 2.2 + (m.role === 'C' && mu > 14 ? 3 : 0);
      if (sc > bs) { bs = sc; best = m; }
    }
    const wantPass = (press && best && bs > 1.5 && this.rng() < 0.7) || (best && bs > 5 && this.rng() < 0.18 && u > 2);
    if (wantPass) { this.passTo(p, best); return; }
    // -------- clear / dump
    if (press && u < -14 && this.rng() < 0.55) {
      const side = p.y >= 0 ? 1 : -1;
      const far = this.rng() < 0.07;
      this.clearPuck(p, a * (far ? GOAL_X + 3 : 4), side * 11.5, far ? 26 : 19);
      return;
    }
    if (press && u > -2 && u < 8.6 && this.rng() < 0.4) {
      const side = p.y >= 0 ? 1 : -1;
      this.clearPuck(p, a * 24, side * 11, 23);
    }
  }

  laneBlocked(p, tx, ty, oppTeam) {
    const dx = tx - p.x, dy = ty - p.y, l2 = dx * dx + dy * dy || 1;
    for (const e of this.iceSkaters(oppTeam)) {
      const t = ((e.x - p.x) * dx + (e.y - p.y) * dy) / l2;
      if (t < 0.08 || t > 0.96) continue;
      const cx = p.x + dx * t, cy = p.y + dy * t;
      if (hyp(e.x - cx, e.y - cy) < 1.15) return true;
    }
    return false;
  }

  goalieHome(g, dt, calm = false) {
    if (!g.onIce) return;
    const t = this.teams[g.team], s = -t.dir;
    g.tx = s * (GOAL_X - 0.95); g.ty = 0;
    this.goalieMove(g, g.tx, g.ty, 3, dt);
    g.h = s > 0 ? Math.PI : 0; g.h = s > 0 ? Math.PI : 0;
    g.dive = Math.max(0, g.dive - dt); g.reach = 0.46;
  }

  goalieAI(g, dt) {
    if (!g.onIce) return;
    const pk = this.puck, t = this.teams[g.team], s = -t.dir;
    const nx = s * GOAL_X;
    const depth = GOAL_X - 0.95;
    let ty, tx = s * depth;
    const ux = pk.x - nx, uy = pk.y, ul = hyp(ux, uy) || 1;
    // angle play along an arc in front of the net
    const arc = clamp(1.05 + clamp(ul, 4, 20) * 0.02, 1.0, 1.4);
    tx = nx + ux / ul * arc; ty = uy / ul * arc * 1.25;
    tx = s * Math.min(Math.abs(tx), GOAL_X - 0.35); if ((tx - nx) * s > 0) tx = nx - s * 0.4;
    ty = clamp(ty, -1.45, 1.45);
    const sof = this.state === 'shootout';
    if (sof) ty *= 0.45;
    // incoming shot?
    const closing = pk.vx * s;
    let spd = sof ? 3.0 : 4.6;
    g.dive = Math.max(0, g.dive - dt);
    if (!pk.carrier && closing > 7 && pk.shotPower > 9) {
      const tt = (nx - pk.x) / (pk.vx || 1e-6);
      if (tt > 0 && tt < 1.4) {
        const yc = pk.y + pk.vy * tt;
        if (Math.abs(yc) < NET_HALF + 1.1 && g.gSeen !== pk.shotPower) {
          g.gSeen = pk.shotPower;
          const sp = hyp(pk.vx, pk.vy);
          g.gErr = this.gauss() * (0.78 + (sp - 18) * 0.028) * (1.4 - g.skill * 0.55) * (sof ? 1.5 : 1);
          g.react = (0.16 + this.rng() * 0.14) * (sof ? 1.6 : 1) + (sof ? 0.08 : 0);
        }
        if (g.react > 0) g.react -= dt;
        if (Math.abs(yc) < NET_HALF + 1.1 && g.react <= 0) {
          ty = clamp(yc + g.gErr, -2.2, 2.2); tx = s * (GOAL_X - 0.55); spd = 5.6;
          if (Math.abs(ty - g.y) > 0.8 && tt < 0.5 && g.dive <= 0) { g.dive = 0.5; }
        }
      }
    }
    g.reach = g.dive > 0 ? 0.95 : 0.46;
    this.goalieMove(g, tx, ty, spd, dt);
    g.h = s > 0 ? Math.PI : 0;
    // glove / trapper on loose pucks in the crease
    if (!pk.carrier && !pk.frozen && hyp(pk.x - g.x, pk.y - g.y) < 1.1 && hyp(pk.vx, pk.vy) < 3.2 && pk.z < 0.5 && (this.state === 'play' || this.state === 'shootout')) {
      pk.frozen = true; pk.vx = pk.vy = 0; this.soSaved = true;
      const dot = this.nearestDot(s * 21, pk.y >= 0 ? 6.7 : -6.7, (d) => Math.abs(d[0]) > 15 && d[0] * s > 0);
      this.whistle('freeze', dot[0], dot[1], null, 1.6);
      this.say('FROZEN', `#${g.num} ${g.name}`, '#ffffff', 1.4);
    }
  }

  goalieMove(g, tx, ty, spd, dt) {
    const dx = tx - g.x, dy = ty - g.y;
    const d = hyp(dx, dy);
    if (d > 0.01) {
      const m = Math.min(spd * dt, d);
      g.vx = dx / d * m / dt; g.vy = dy / d * m / dt;
      g.x += dx / d * m; g.y += dy / d * m;
    } else { g.vx = g.vy = 0; }
  }

  // ------------------------------------------------------------------ motion + collisions
  move(p, dt) {
    if (p.isG) return;
    if (p.fall > 0) {
      p.fall -= dt;
      const k = Math.pow(0.25, dt);
      p.vx *= k; p.vy *= k;
      p.x += p.vx * dt; p.y += p.vy * dt;
      return;
    }
    const maxS = p.maxSpeed * p.tspd * (this.puck.carrier === p ? 0.94 : 1) * (p.windup > 0 ? 0.6 : 1);
    const dx = p.tx - p.x, dy = p.ty - p.y, d = hyp(dx, dy);
    let dvx = 0, dvy = 0;
    if (d > 0.08) { const sp = Math.min(maxS, d * 2.4); dvx = dx / d * sp; dvy = dy / d * sp; }
    let ax = dvx - p.vx, ay = dvy - p.vy;
    const al = hyp(ax, ay), lim = 15 * dt;
    if (al > lim) { ax *= lim / al; ay *= lim / al; }
    p.vx += ax; p.vy += ay;
    p.x += p.vx * dt; p.y += p.vy * dt;
    const sp = hyp(p.vx, p.vy);
    p.stride += sp * dt * 0.55;
    if (sp > 1.3) {
      let da = Math.atan2(p.vy, p.vx) - p.h; da = Math.atan2(Math.sin(da), Math.cos(da));
      p.h += clamp(da, -9 * dt, 9 * dt);
    } else if (this.puck) {
      let da = Math.atan2(this.puck.y - p.y, this.puck.x - p.x) - p.h; da = Math.atan2(Math.sin(da), Math.cos(da));
      p.h += clamp(da, -5 * dt, 5 * dt);
    }
  }

  collide(dt) {
    const on = this.players.filter((p) => p.onIce && !p.box);
    for (const p of on) {
      // boards
      const d = rinkSDF(p.x, p.y);
      if (d > -p.radius) {
        const [nx, ny] = rinkNormal(p.x, p.y);
        const pen = d + p.radius;
        p.x -= nx * pen; p.y -= ny * pen;
        const vn = p.vx * nx + p.vy * ny;
        if (vn > 0) {
          p.vx -= vn * nx * 1.25; p.vy -= vn * ny * 1.25;
          if (vn > 5.5 && p.hitCool <= 0) { p.hitCool = 0.6; this.emit('board', { x: p.x, y: p.y, z: 1, power: vn * 0.6, body: true }); }
        }
      }
      // nets
      if (!p.isG) for (const s of [-1, 1]) {
        const bx = s * (GOAL_X + NET_D);
        for (const py of [-NET_HALF, NET_HALF]) this.skPoint(p, s * GOAL_X, py, 0.12 + p.radius);
        for (const py of [-1, 1]) this.skSeg(p, s * GOAL_X, py * NET_HALF, bx, py * NET_HALF, 0.1 + p.radius);
        this.skSeg(p, bx, -NET_HALF, bx, NET_HALF, 0.1 + p.radius);
        this.skSeg(p, s * GOAL_X, -NET_HALF, s * GOAL_X, NET_HALF, 0.1 + p.radius); // keep skaters out of the crease mouth/net
      }
    }
    // player vs player
    for (let i = 0; i < on.length; i++) for (let j = i + 1; j < on.length; j++) {
      const a = on[i], b = on[j];
      if (a.isG && b.isG) continue;
      let dx = b.x - a.x, dy = b.y - a.y; const dd = hyp(dx, dy), rr = a.radius + b.radius;
      if (dd >= rr || dd < 1e-6) continue;
      dx /= dd; dy /= dd;
      const pen = rr - dd;
      const wa = a.isG ? 0.1 : 0.5, wb = b.isG ? 0.1 : 0.5;
      const sum = wa + wb;
      if (a.isG) { /* goalie is a mover — push the skater only */ }
      a.x -= dx * pen * (wa / sum); a.y -= dy * pen * (wa / sum);
      b.x += dx * pen * (wb / sum); b.y += dy * pen * (wb / sum);
      // closing velocity along the normal
      const vn = (a.vx - b.vx) * dx + (a.vy - b.vy) * dy;
      if (vn > 0 && !a.isG && !b.isG) {
        a.vx -= dx * vn * 0.6; a.vy -= dy * vn * 0.6; b.vx += dx * vn * 0.6; b.vy += dy * vn * 0.6;
        if (a.team !== b.team && this.state === 'play') this.bodyCheck(a, b, dx, dy, vn);
      }
    }
  }

  skPoint(p, px, py, rad) {
    const dx = p.x - px, dy = p.y - py, d = hyp(dx, dy);
    if (d >= rad || d < 1e-6) return;
    p.x = px + dx / d * rad; p.y = py + dy / d * rad;
    const vn = p.vx * dx / d + p.vy * dy / d; if (vn < 0) { p.vx -= vn * dx / d; p.vy -= vn * dy / d; }
  }
  skSeg(p, ax, ay, bx, by, rad) {
    const abx = bx - ax, aby = by - ay, l2 = abx * abx + aby * aby;
    const t = clamp(((p.x - ax) * abx + (p.y - ay) * aby) / l2, 0, 1);
    this.skPoint(p, ax + abx * t, ay + aby * t, rad);
  }

  bodyCheck(a, b, dx, dy, vn) {
    // a -> b direction is (dx, dy). Whoever carries more momentum into the other is the hitter.
    const sa = a.vx * dx + a.vy * dy, sb = -(b.vx * dx + b.vy * dy);
    const hitter = sa >= sb ? a : b, vic = hitter === a ? b : a;
    if (vn < 7.4 || hitter.hitCool > 0 || vic.fall > 0 || hitter.fall > 0) return;
    if (this.rng() > 0.3 + hitter.chk * 0.3) return;
    hitter.hitCool = 3.5;
    vic.fall = 0.9 + vn * 0.1 + this.rng() * 0.5; vic.fallDir = this.rng() < 0.5 ? 1 : -1;
    vic.vx += -(hitter === a ? -dx : dx) * 0 + (hitter === a ? dx : -dx) * vn * 0.5;
    vic.vy += (hitter === a ? dy : -dy) * vn * 0.5;
    hitter.vx *= 0.55; hitter.vy *= 0.55;
    this.hits[hitter.team]++;
    if (this.puck.carrier === vic) {
      this.puck.carrier = null; this.puck.vx = vic.vx * 0.9 + this.gauss() * 3; this.puck.vy = vic.vy * 0.9 + this.gauss() * 3;
      this.puck.lastTouch = hitter; this.puck.lastTouchTeam = hitter.team; this.puck.iceValid = false;
    }
    this.emit('hit', { x: vic.x, y: vic.y, power: Math.min(1.4, vn / 10), a: hitter, b: vic });
    // fouls
    const nearWall = rinkSDF(vic.x, vic.y) > -2.6;
    const r = this.rng();
    if (nearWall && vn > 8.2 && r < 0.12) this.callPenalty(hitter, 'BOARDING', 2);
    else if (r < 0.035) this.callPenalty(hitter, FOULS[(this.rng() * FOULS.length) | 0], 2);
    else if (vn > 8.4 && this.fights < 2 && this.rng() < 0.16) {
      // somebody takes exception
      const pals = this.iceSkaters(vic.team).filter((p) => p.fall <= 0 && hyp(p.x - hitter.x, p.y - hitter.y) < 9);
      pals.sort((p, q) => q.tough - p.tough);
      const fighter = (pals[0] && pals[0].tough > vic.tough) ? pals[0] : (vic.tough > 0.35 ? vic : pals[0]);
      if (fighter && fighter.tough > 0.3 && hitter.tough > 0.2) {
        if (fighter.fall > 0) fighter.fall = 0;
        this.startFight(hitter, fighter);
      }
    }
  }
  // ------------------------------------------------------------------ officials
  moveOfficial(o, dt, maxS) {
    const dx = o.tx - o.x, dy = o.ty - o.y, d = hyp(dx, dy);
    let dvx = 0, dvy = 0;
    if (d > 0.3) { const sp = Math.min(maxS, d * 1.6); dvx = dx / d * sp; dvy = dy / d * sp; }
    let ax = dvx - o.vx, ay = dvy - o.vy; const al = hyp(ax, ay), lim = 9 * dt;
    if (al > lim) { ax *= lim / al; ay *= lim / al; }
    o.vx += ax; o.vy += ay; o.x += o.vx * dt; o.y += o.vy * dt;
    const sp = hyp(o.vx, o.vy); o.stride += sp * dt * 0.55;
    const want = sp > 1.2 ? Math.atan2(o.vy, o.vx) : Math.atan2(this.puck.y - o.y, this.puck.x - o.x);
    let da = want - o.h; da = Math.atan2(Math.sin(da), Math.cos(da)); o.h += clamp(da, -6 * dt, 6 * dt);
    const w = this.wallClamp(o.x, o.y, 0.9); if (w[0] !== o.x || w[1] !== o.y) { o.x = w[0]; o.y = w[1]; }
  }

  updateOfficials(dt) {
    const pk = this.puck, st = this.state, hy = RINK.hy;
    const [r1, r2, l1, l2] = this.officials;
    for (const o of this.officials) { o.sigT = Math.max(0, o.sigT - dt); if (o.sigT <= 0) o.sig = ''; }
    const px = pk.x, py = pk.y;
    // default: referees trail the play on opposite sides of the puck, linesmen work the boards
    r1.tx = clamp(px - 9, -26, 26); r1.ty = clamp(py * 0.4, -5, 5) + 5;
    r2.tx = clamp(px + 9, -26, 26); r2.ty = clamp(py * 0.4, -5, 5) - 5;
    l1.tx = clamp(px + 5, -26, 26); l1.ty = hy - 1.2;
    l2.tx = clamp(px - 5, -26, 26); l2.ty = -(hy - 1.2);
    let sp = 0.75;
    if (st === 'faceoff' && this.fo) {
      const f = this.fo; r1.tx = f.x; r1.ty = f.y + (f.y >= 0 ? -3.4 : 3.4); r2.tx = f.x * 0.4; r2.ty = f.y >= 0 ? -6 : 6;
      l1.tx = f.x + 5; l2.tx = f.x - 5; sp = 0.9;
    } else if (st === 'whistle' && this.pending) {
      const pn = this.pending;
      if (pn.pens && pn.pens.length) { r1.tx = pn.pens[0].p.team === 0 ? -1.6 : 1.6; r1.ty = -(hy - 3.2); if (r1.sig === '') { r1.sig = 'up'; r1.sigT = 1; } }
      sp = 1;
    } else if (st === 'fight' && this.fight) {
      const f = this.fight; r1.tx = clamp(f.mx - 9, -26, 26); r1.ty = clamp(-f.my * 0.5, -8, 8); r2.tx = clamp(f.mx + 9, -26, 26); r2.ty = r1.ty * -1 - 3;
      l1.tx = f.mx - 2.6; l1.ty = f.my + 2.4; l2.tx = f.mx + 2.6; l2.ty = f.my - 2.4; sp = 0.9;
    } else if (st === 'goal') {
      const e = this.lastGoalEnd || 1; r1.tx = e * (GOAL_X - 4); r1.ty = 3; r2.tx = 0; r2.ty = 0; sp = 0.8;
    } else if (st === 'intermission' || st === 'final') {
      this.officials.forEach((o, i) => { o.tx = -6 + i * 4; o.ty = -(hy - 2); });
    } else if (st === 'shootout' && this.so) {
      r1.tx = 0; r1.ty = hy - 2.5; r2.tx = 0; r2.ty = -(hy - 2.5);
      l1.tx = 8; l1.ty = hy - 1.2; l2.tx = -8; l2.ty = -(hy - 1.2);
    }
    for (const o of this.officials) this.moveOfficial(o, dt, o.maxSpeed * (o.role === 'lines' ? 0.9 : sp));
    // point arm along the stored direction for goals
    for (const o of this.officials) if (o.sig === 'point') o.h = o.sigDir;
  }

  // ------------------------------------------------------------------ shootout
  startShootout() {
    this.state = 'shootout'; this.stateT = 0;
    this.so = { n: 0, first: 1, att: [0, 0], goals: [0, 0], marks: ['', ''], team: 1, shooter: null, phase: 'setup', t: 0, result: null, shot: false, shotT: 0, side: 1, deke: '', dekeT: 0 };
    this.so.team = this.so.first;
    for (const t of this.teams) { for (const p of t.skaters) { p.onIce = false; p.box = false; p.fight = 0; } for (const e of t.pen) e.p.box = false; t.pen = []; t.pulled = false; t.goalie.onIce = true; }
    this.say('SHOOTOUT', 'THREE ROUNDS · THEN SUDDEN DEATH', '#ffd34a', 2.6, { big: true });
    this.emit('horn', {});
    this.setupAttempt();
  }

  setupAttempt() {
    const so = this.so, t = this.teams[so.team];
    const p = t.skaters.slice(0, 5)[Math.floor(so.n / 2) % 5];
    so.shooter = p; so.phase = 'setup'; so.t = 0; so.result = null; so.shot = false; so.deke = ''; so.dekeT = 0; so.side = this.rng() < 0.5 ? -1 : 1;
    for (const q of t.skaters) q.onIce = q === p;
    for (const q of this.opp(so.team).skaters) q.onIce = false;
    p.box = false; p.fall = 0; p.fighting = false; p.windup = 0;
    p.x = 0; p.y = 0; p.vx = p.vy = 0; p.h = t.dir > 0 ? 0 : Math.PI; p.tx = 0; p.ty = 0; p.tspd = 0; p.cool = 0;
    const pk = this.puck; pk.carrier = null; pk.frozen = false; pk.x = p.x + Math.cos(p.h) * 1.1; pk.y = 0; pk.z = pk.r; pk.vx = pk.vy = pk.vz = 0; pk.still = 0; pk.shotPower = 0; pk.iceValid = false;
    this.soSaved = false;
    this.say(`SHOOTOUT · ${t.name}`, `#${p.num} ${p.name}`, t.css, 2.0);
  }

  soDecided() {
    const [a0, a1] = this.so.att, [g0, g1] = this.so.goals;
    if (a0 >= 3 && a1 >= 3) return a0 === a1 && g0 !== g1;
    const r0 = Math.max(0, 3 - a0), r1 = Math.max(0, 3 - a1);
    return g0 > g1 + r1 || g1 > g0 + r0;
  }

  soGoal(s) {
    const so = this.so; if (so.result) return;
    const p = so.shooter; if (this.teams[p.team].dir !== s) return;
    so.result = 'goal'; this.goalLight[s === 1 ? 0 : 1] = 4; this.lastGoalEnd = s; this.scorer = p;
    { const r = this.nearestOfficial('ref', s * GOAL_X, 0); if (r) { r.sig = 'point'; r.sigT = 2.5; r.sigDir = s > 0 ? 0 : Math.PI; } }
    p.cheer = 2.5;
    this.emit('goal', { team: p.team, scorer: p, empty: false, end: s, so: true });
    this.say('GOAL!', `#${p.num} ${p.name} · SHOOTOUT`, TEAMS[p.team].css, 2.3, { big: true });
  }

  stepShootout(dt) {
    const so = this.so, pk = this.puck; so.t += dt;
    if (so.phase === 'setup') {
      if (so.t > 1.8) { so.phase = 'attempt'; so.t = 0; pk.carrier = so.shooter; so.shooter.dec = 0; so.shooter.tspd = 0.85; this.emit('drop', {}); this.emit('whistle', { reason: 'shootout' }); }
    } else if (so.phase === 'attempt') {
      if (!so.result) {
        if (this.soSaved) so.result = 'save';
        else if (so.shot && (pk.still > 0.9 || so.t > so.shotT + 3.2)) so.result = 'miss';
        else if (so.t > 10) so.result = 'miss';
        if (so.result && so.result !== 'goal') this.say(so.result === 'save' ? 'SAVE!' : 'NO GOAL', `#${so.shooter.num} ${so.shooter.name}`, '#ffffff', 1.4);
      }
      if (so.result) { so.phase = 'result'; so.t = 0; const ti = so.shooter.team; so.att[ti]++; if (so.result === 'goal') so.goals[ti]++; so.marks[ti] += so.result === 'goal' ? '●' : '✗'; }
    } else if (so.phase === 'result') {
      if (so.t > 2.4) {
        if (this.soDecided()) {
          this.winner = so.goals[0] > so.goals[1] ? 0 : 1; this.score[this.winner]++;
          this.finish();
        } else {
          so.n++; so.team = so.n % 2 === 0 ? so.first : 1 - so.first; this.setupAttempt();
        }
      }
    }
  }

  aiShootout(dt) {
    const so = this.so, pk = this.puck;
    for (const tm of this.teams) { if (so.phase === 'attempt' && !so.result) this.goalieAI(tm.goalie, dt); else this.goalieHome(tm.goalie, dt, true); }
    const p = so.shooter; if (!p || !p.onIce) return;
    const a = this.teams[p.team].dir, nx = a * GOAL_X;
    if (so.phase !== 'attempt' || so.result) { p.tx = p.x + p.vx * 0.5; p.ty = p.y + p.vy * 0.5; p.tspd = so.result ? 0.3 : 0; return; }
    if (pk.carrier !== p) { p.tx = pk.x; p.ty = pk.y; p.tspd = 0.5; return; }
    const d = hyp(nx - p.x, p.y);
    if (!so.deke) { so.deke = this.rng() < 0.6 ? 'deke' : 'shoot'; }
    if (d > 11.5) { p.tx = nx - a * 10; p.ty = Math.sin(so.t * 3.2) * 1.4; p.tspd = 0.9; return; }
    if (so.deke === 'deke') {
      so.dekeT += dt; p.tx = nx - a * 4.5; p.ty = so.side * (so.dekeT < 0.4 ? 1.7 : -1.3); p.tspd = 0.85;
      if (so.dekeT > 0.7 || d < 5.6) this.shoot(p, this.rng() < 0.2 ? 'backhand' : 'wrist', this.soAim(p));
    } else {
      p.tx = nx - a * 5; p.ty = so.side * 0.9; p.tspd = 0.85;
      if (d < 9) this.shoot(p, 'wrist', this.soAim(p));
    }
  }

  // read the goalie: go to the side he is leaning away from (sometimes guess the other way)
  soAim(p) {
    const g = this.opp(p.team).goalie;
    let side = g.y >= 0 ? -1 : 1;
    if (this.rng() < 0.3) side = -side;
    return side * (0.76 + this.rng() * 0.12);
  }
}
