// Jumbotron: a 4-sided video board hung on cables. Each side shows a live camera feed (auto-director),
// slow-motion replays from several camera angles, and a scoreboard strip. Also contains the replay recorder.
import * as THREE from 'three';
import { RINK, TEAMS } from './sim.js';
import { roundRect } from './rink.js';

const GOAL_X = RINK.goalX;
const PF = 14; // floats per player in a snapshot
const CAMS = {
  broadcast: 'BROADCAST CAM', overhead: 'OVERHEAD CAM', goal: 'GOAL CAM', ice: 'ICE-LEVEL CAM', puck: 'PUCK CAM',
};
export const CAM_ORDER = ['auto', 'broadcast', 'overhead', 'goal', 'ice', 'puck', 'helmet'];

// first-person eye view from a player's helmet: head turns toward the puck, bobs with the stride, drops when knocked down
export function helmetPose(p, pk) {
  const sp = Math.hypot(p.vx, p.vy);
  let yaw = p.h;
  const dx = pk.x - p.x, dy = pk.y - p.y, d = Math.hypot(dx, dy);
  if (d > 1.5 && d < 45) { let da = Math.atan2(dy, dx) - p.h; da = Math.atan2(Math.sin(da), Math.cos(da)); yaw = p.h + Math.max(-1.25, Math.min(1.25, da)) * 0.7; }
  let eye = 2.3 + Math.sin(p.stride * Math.PI * 1.9) * 0.06 * Math.min(1, sp / 7), pitch = 0.12 + Math.min(0.12, sp * 0.008);
  if (p.fall > 0) { eye = 0.65; pitch = 0.9; }
  const ex = p.x + Math.cos(p.h) * 0.6, ez = p.y + Math.sin(p.h) * 0.6;
  return { pos: [ex, eye, ez], tgt: [ex + Math.cos(yaw) * 10, Math.max(0.15, eye - 10 * Math.tan(pitch)), ez + Math.sin(yaw) * 10] };
}
export function povTarget(game, id) {
  if (id >= 0 && game.players[id] && (game.players[id].onIce || game.players[id].box)) return game.players[id];
  if (game.puck.carrier) return game.puck.carrier;
  let best = null, bd = 1e9; for (const p of game.players) { if (!p.onIce || p.box) continue; const d = Math.hypot(p.x - game.puck.x, p.y - game.puck.y); if (d < bd) { bd = d; best = p; } }
  return best || game.players[0];
}

// ------------------------------------------------------------------ recorder + replay
export class ReplaySystem {
  constructor(game, parent, ActorSet, PuckTrail, mainActors) {
    this.game = game; this.ActorSet = ActorSet; this.mainActors = mainActors;
    this.group = new THREE.Group(); this.group.visible = false; parent.add(this.group);
    this.trail = new PuckTrail(this.group);
    this.step = 1 / 60; this.cap = 60 * 16; this.frames = new Array(this.cap); this.head = 0; this.n = 0; this.acc = 0; this.t = 0;
    this.pending = null; this.play = null; this.trailAcc = 0;
    this.rebuild();
  }

  rebuild() {
    if (this.actors) { this.group.remove(this.actors.group); this.actors.dispose && this.actors.dispose(); }
    const g = this.game;
    this.rv = { state: 'play', players: g.players.map((p) => Object.assign({}, p)), puck: Object.assign({}, g.puck, { carrier: null }) };
    this.actors = new this.ActorSet(this.group, this.rv, { labels: true });
    this.actors.setLabelMode(this.mainActors.labelMode);
    this.head = 0; this.n = 0; this.pending = null; this.play = null;
  }

  tick(dt) {
    this.t += dt; this.acc += dt;
    while (this.acc >= this.step) { this.acc -= this.step; this.push(); }
    if (this.pending && this.t >= this.pending.at) { const p = this.pending; this.pending = null; this.start(p); }
  }

  push() {
    const g = this.game, f = new Float32Array(g.players.length * PF + 8); let k = 0;
    for (const p of g.players) {
      f[k++] = p.x; f[k++] = p.y; f[k++] = p.h; f[k++] = p.vx; f[k++] = p.vy; f[k++] = p.fall; f[k++] = p.fallDir; f[k++] = p.stride;
      f[k++] = p.windup; f[k++] = p.swing; f[k++] = p.cheer; f[k++] = p.punch; f[k++] = p.dive;
      f[k++] = (p.onIce ? 1 : 0) | (p.box ? 2 : 0) | (p.fighting ? 4 : 0) | (p.windType === 'slap' ? 8 : 0);
    }
    const pk = g.puck;
    f[k++] = pk.x; f[k++] = pk.y; f[k++] = pk.z; f[k++] = pk.vx; f[k++] = pk.vy; f[k++] = pk.vz; f[k++] = pk.carrier ? pk.carrier.id : -1; f[k++] = pk.shotType === 'slap' ? 1 : 0;
    this.frames[this.head] = f; this.head = (this.head + 1) % this.cap; this.n = Math.min(this.n + 1, this.cap);
  }

  // kind: 'goal' | 'fight' | 'manual'
  trigger(kind, info = {}) {
    if (kind === 'goal') this.pending = { at: this.t + 0.9, len: 5.6, kind, label: 'GOAL', end: info.end || 1, plan: 'goal' };
    else if (kind === 'fight') { if (this.pending && this.pending.kind === 'goal') return; this.pending = { at: this.t + 5.6, len: 6.5, kind, label: 'FIGHT', plan: 'fight' }; }
    else this.pending = { at: this.t, len: 8, kind: 'manual', label: 'INSTANT REPLAY', plan: 'manual', end: Math.sign(this.game.puck.x) || 1 };
  }

  start(p) {
    const m = Math.min(this.n, Math.round(p.len / this.step)); if (m < 30) return;
    const clip = []; for (let i = 0; i < m; i++) clip.push(this.frames[(this.head - m + i + this.cap) % this.cap]);
    const L = (m - 1) * this.step;
    let segs;
    if (p.plan === 'goal') segs = [{ from: 0, to: L, rate: 0.7, cam: 'broadcast' }, { from: Math.max(0, L - 3.2), to: L, rate: 0.28, cam: 'goal' }, { from: Math.max(0, L - 2.2), to: L, rate: 0.22, cam: 'puck' }];
    else if (p.plan === 'fight') segs = [{ from: 0, to: L, rate: 0.5, cam: 'ice' }];
    else segs = [{ from: 0, to: L, rate: 0.5, cam: 'broadcast' }, { from: Math.max(0, L - 3), to: L, rate: 0.3, cam: 'overhead' }];
    this.play = { clip, segs, seg: 0, pos: segs[0].from, label: p.label, end: p.end || 1 };
    this.trail.clear(); this.trailAcc = 0; this.cutT = 0;
  }

  stop() { this.play = null; }

  advance(dt) {
    const pl = this.play; if (!pl) return;
    const sg = pl.segs[pl.seg];
    pl.pos += dt * sg.rate;
    if (pl.pos >= sg.to) {
      pl.seg++;
      if (pl.seg >= pl.segs.length) { this.play = null; return; }
      pl.pos = pl.segs[pl.seg].from; this.trail.clear(); this.cutT = 0;
    }
    this.cutT = (this.cutT || 0) + dt;
  }

  view() {
    const pl = this.play; if (!pl) return { playing: false };
    const sg = pl.segs[pl.seg];
    return { playing: true, cam: sg.cam, rate: sg.rate, label: pl.label, end: pl.end, seg: pl.seg, segs: pl.segs.length };
  }

  // fill the replay world from the clip at the current position (interpolated for smooth slow-mo)
  sync(dt, tNow) {
    const pl = this.play; if (!pl) return;
    const sg = pl.segs[pl.seg];
    const fi = Math.min(pl.clip.length - 2, Math.max(0, pl.pos / this.step)), i0 = Math.floor(fi), a = fi - i0;
    const A = pl.clip[i0], B = pl.clip[i0 + 1] || A, rv = this.rv;
    const lerp = (x, y) => x + (y - x) * a;
    rv.players.forEach((p, i) => {
      const k = i * PF;
      const jump = Math.hypot(B[k] - A[k], B[k + 1] - A[k + 1]) > 4;
      const t = jump ? 0 : a;
      p.x = A[k] + (B[k] - A[k]) * t; p.y = A[k + 1] + (B[k + 1] - A[k + 1]) * t;
      let dh = B[k + 2] - A[k + 2]; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); p.h = A[k + 2] + dh * t;
      p.vx = lerp(A[k + 3], B[k + 3]); p.vy = lerp(A[k + 4], B[k + 4]);
      p.fall = lerp(A[k + 5], B[k + 5]); p.fallDir = A[k + 6]; p.stride = lerp(A[k + 7], B[k + 7]);
      p.windup = lerp(A[k + 8], B[k + 8]); p.swing = lerp(A[k + 9], B[k + 9]); p.cheer = lerp(A[k + 10], B[k + 10]); p.punch = lerp(A[k + 11], B[k + 11]); p.dive = lerp(A[k + 12], B[k + 12]);
      const fl = A[k + 13] | 0; p.onIce = !!(fl & 1); p.box = !!(fl & 2); p.fighting = !!(fl & 4); p.windType = fl & 8 ? 'slap' : 'wrist';
    });
    const k = rv.players.length * PF, pk = rv.puck;
    pk.x = lerp(A[k], B[k]); pk.y = lerp(A[k + 1], B[k + 1]); pk.z = lerp(A[k + 2], B[k + 2]);
    pk.vx = lerp(A[k + 3], B[k + 3]); pk.vy = lerp(A[k + 4], B[k + 4]); pk.vz = lerp(A[k + 5], B[k + 5]);
    const cid = A[k + 6]; pk.carrier = cid >= 0 ? rv.players[cid] : null; pk.shotType = A[k + 7] ? 'slap' : '';
    this.actors.update(dt * sg.rate, tNow);
    this.trailAcc += dt * sg.rate;
    while (this.trailAcc > 1 / 90) { this.trailAcc -= 1 / 90; this.trail.push(pk.x, pk.y, pk.z, pk.carrier ? 0 : Math.hypot(pk.vx, pk.vy), pk.shotType === 'slap'); }
  }

  // focus point for cameras: fighters if any, else puck
  focus() {
    const rv = this.rv; const f = rv.players.filter((p) => p.fighting && p.onIce);
    if (f.length) return { x: f.reduce((s, p) => s + p.x, 0) / f.length, y: f.reduce((s, p) => s + p.y, 0) / f.length, fight: true };
    return { x: rv.puck.x, y: rv.puck.y, fight: false };
  }
}

// ------------------------------------------------------------------ the board itself
export class Jumbotron {
  constructor(game, { size = 18 } = {}) {
    this.game = game; this.group = new THREE.Group(); this.size = size;
    const JW = size, VH = JW * 9 / 16, SH = JW * 0.2, FR = 0.55;
    this.total = VH + SH + FR * 2;
    this.rt = new THREE.WebGLRenderTarget(768, 432, { samples: 2 });
    this.rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
    this.cam = new THREE.PerspectiveCamera(48, 16 / 9, 0.05, 100);
    this.ticker = { text: '', t: -99 };
    this.mode = 'auto'; this.cur = 'broadcast'; this.hold = 0; this.povId = -1;
    this.camPos = new THREE.Vector3(0, 20, 33); this.camTgt = new THREE.Vector3(); this.camFov = 48; this.snap = true;

    const mk = (w, h, draw) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h; const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
      return { c, t, draw, key: '' };
    };
    this.strip = mk(1536, Math.round(1536 * SH / JW)); this.badge = mk(1536, Math.round(1536 * 1.2 / JW));

    const dark = new THREE.MeshStandardMaterial({ color: 0x0d1016, roughness: 0.45, metalness: 0.6 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(JW, this.total, JW), dark); this.group.add(body);
    const trim = new THREE.MeshStandardMaterial({ color: 0xb08a4a, roughness: 0.3, metalness: 0.9 });
    const videoMat = new THREE.MeshBasicMaterial({ map: this.rt.texture, toneMapped: false, color: new THREE.Color(1.15, 1.15, 1.15) });
    const stripMat = new THREE.MeshBasicMaterial({ map: this.strip.t, toneMapped: false });
    const badgeMat = new THREE.MeshBasicMaterial({ map: this.badge.t, toneMapped: false, transparent: true, depthWrite: false });
    const vy = this.total / 2 - FR - VH / 2, sy = -this.total / 2 + FR + SH / 2;
    for (let k = 0; k < 4; k++) {
      const side = new THREE.Group(); side.rotation.y = k * Math.PI / 2; this.group.add(side);
      const z = JW / 2 + 0.03;
      const v = new THREE.Mesh(new THREE.PlaneGeometry(JW - 1.1, VH), videoMat); v.position.set(0, vy, z); side.add(v);
      const b = new THREE.Mesh(new THREE.PlaneGeometry(JW - 1.1, 1.2), badgeMat); b.position.set(0, vy + VH / 2 - 0.6, z + 0.02); b.renderOrder = 30; side.add(b);
      const s = new THREE.Mesh(new THREE.PlaneGeometry(JW - 1.1, SH), stripMat); s.position.set(0, sy, z); side.add(s);
      for (const [w, h, x, y] of [[JW, 0.25, 0, this.total / 2 - 0.12], [JW, 0.25, 0, -this.total / 2 + 0.12], [0.25, this.total, -JW / 2 + 0.12, 0], [0.25, this.total, JW / 2 - 0.12, 0]]) {
        const f = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.3), trim); f.position.set(x, y, JW / 2 + 0.05); side.add(f);
      }
    }
    // underside light so it reads from below
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(JW - 1, JW - 1), new THREE.MeshBasicMaterial({ color: 0x9fc4ff })); glow.rotation.x = Math.PI / 2; glow.position.y = -this.total / 2 - 0.02; this.group.add(glow);

  }

  tickerSet(text, sub) { this.ticker = { text: `${text}${sub ? '  ·  ' + sub : ''}`, t: this.game.t }; }

  // ---- camera choice
  pose(name, f, vel, end) {
    const v = new THREE.Vector3(), t = new THREE.Vector3(); let fov = 48;
    if (name === 'overhead') { v.set(f.x * 0.6, 54, 7); t.set(f.x * 0.6, 0, 0); fov = 38; }
    else if (name === 'goal') { const e = end || (Math.sign(f.x) || 1); v.set(e * (GOAL_X + 8.2), 3.2, THREE.MathUtils.clamp(f.y * 0.25, -3, 3)); t.set(f.x * 0.85 + e * 4, 0.6, f.y * 0.8); fov = 52; }
    else if (name === 'ice') { v.set(f.x * 0.9, 1.9, 14.6); t.set(f.x, 0.6, f.y); fov = f.fight ? 36 : 46; }
    else if (name === 'puck') { const sp = Math.hypot(vel.x, vel.y) || 1; const dx = vel.x / sp, dy = vel.y / sp; v.set(f.x - dx * 6.5, 2.8, f.y - dy * 6.5); t.set(f.x + dx * 7, 0.5, f.y + dy * 7); fov = 62; }
    else { v.set(THREE.MathUtils.clamp(f.x * 0.65, -21, 21), 20, 34); t.set(f.x * 0.85, 0, f.y * 0.5); fov = 48; }
    return { v, t, fov };
  }

  // choose + place the screen camera (world space, because the rink root is scaled)
  aim(root, replay, dt, S) {
    const rp = replay.view(), g = this.game;
    let name, f, vel, end;
    if (rp.playing) { name = this.mode === 'auto' ? rp.cam : this.mode; f = replay.focus(); vel = replay.rv.puck; end = rp.end; }
    else {
      const pk = g.puck; vel = pk; f = { x: pk.x, y: pk.y, fight: false };
      if (this.mode !== 'auto') name = this.mode;
      else {
        this.hold -= dt;
        if (this.hold <= 0) {
          const sp = Math.hypot(pk.vx, pk.vy);
          let want = 'broadcast';
          if (g.state === 'shootout') want = 'goal';
          else if (g.state === 'fight' && g.fight) want = 'ice';
          else if (g.state === 'faceoff' && g.stateT > 0.5) want = 'overhead';
          else if (!pk.carrier && sp > 22 && Math.abs(pk.x) > 12 && pk.vx * Math.sign(pk.x) > 0) want = 'goal';
          if (want !== this.cur) { this.cur = want; this.hold = 2.2; this.snap = true; }
        }
        name = this.cur;
      }
      if (g.state === 'fight' && g.fight) { f = { x: (g.fight.a.x + g.fight.b.x) / 2, y: (g.fight.a.y + g.fight.b.y) / 2, fight: true }; }
      end = g.state === 'shootout' && g.so ? g.teams[g.so.team].dir : (Math.sign(pk.x) || 1);
    }
    if (name !== this.shown) { this.shown = name; this.snap = true; }
    let p, k;
    if (name === 'helmet') {
      const src = rp.playing ? { players: replay.rv.players, puck: replay.rv.puck } : g;
      const pl = rp.playing ? (this.povId >= 0 && replay.rv.players[this.povId] ? replay.rv.players[this.povId] : (replay.rv.puck.carrier || replay.rv.players[0])) : povTarget(g, this.povId);
      const hp = helmetPose(pl, src.puck);
      p = { v: new THREE.Vector3(...hp.pos), t: new THREE.Vector3(...hp.tgt), fov: 80 }; this.helmetName = `HELMET CAM  #${pl.num} ${pl.name}`;
      k = this.snap ? 1 : Math.min(1, dt * 12); this.snap = false;
    } else { p = this.pose(name, f, vel, end); k = this.snap ? 1 : Math.min(1, dt * 3.2); this.snap = false; }
    this.camPos.lerp(p.v, k); this.camTgt.lerp(p.t, name === 'helmet' ? k : Math.min(1, k * 1.6)); this.camFov += (p.fov - this.camFov) * k;
    this.cam.position.copy(this.camPos); root.localToWorld(this.cam.position);
    const tw = this.camTgt.clone(); root.localToWorld(tw); this.cam.lookAt(tw);
    this.cam.fov = this.camFov; this.cam.near = Math.max(0.002, (name === 'helmet' ? 0.12 : 0.8) * S); this.cam.far = 400 * S; this.cam.updateProjectionMatrix();
    this.shownName = name === 'helmet' ? this.helmetName : (CAMS[name] || '');
    this.rp = rp;
  }

  // redraw the 2D parts when something changed
  updateGraphics() {
    const g = this.game, rp = this.rp || { playing: false };
    const per = g.state === 'shootout' ? 'SO' : g.period <= 3 ? ['1ST', '2ND', '3RD'][g.period - 1] : g.period === 4 ? 'OT' : `${g.period - 3}OT`;
    const m = Math.max(0, Math.floor(g.clock / 60)), s = Math.max(0, Math.floor(g.clock % 60));
    const pp = (t) => t.pen.slice(0, 2).map((e) => Math.floor(e.rem / 60) + ':' + String(Math.floor(e.rem % 60)).padStart(2, '0')).join(' ');
    const tick = g.t - this.ticker.t < 6 ? this.ticker.text : '';
    const key = [g.score, per, m, s, pp(g.teams[0]), pp(g.teams[1]), g.shots, g.teams[0].pulled, g.teams[1].pulled, tick, g.state === 'play', g.so ? g.so.marks.join() : ''].join('|');
    if (key !== this.strip.key) {
      this.strip.key = key;
      const c = this.strip.c.getContext('2d'), w = this.strip.c.width, h = this.strip.c.height;
      c.fillStyle = '#06080d'; c.fillRect(0, 0, w, h);
      const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(70,90,130,0.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = gr; c.fillRect(0, 0, w, h);
      c.textBaseline = 'middle';
      [0, 1].forEach((ti) => {
        const t = g.teams[ti], left = ti === 0, x0 = left ? 30 : w - 30;
        c.fillStyle = TEAMS[ti].css; c.fillRect(left ? 0 : w - 18, 14, 18, h - 70);
        c.textAlign = left ? 'left' : 'right';
        c.fillStyle = '#eef3ff'; c.font = '900 56px "Arial Black", Impact, sans-serif'; c.fillText(TEAMS[ti].name, x0 + (left ? 14 : -14), 52);
        c.fillStyle = '#9fb2d6'; c.font = '600 34px Arial, sans-serif'; c.fillText(`SHOTS ${g.shots[ti]}`, x0 + (left ? 14 : -14), 215);
        const oth = g.teams[1 - ti];
        if (oth.pen.length > t.pen.length) { c.fillStyle = '#ffd34a'; c.font = '800 34px Arial'; c.fillText('POWER PLAY ' + pp(oth), x0 + (left ? 14 : -14), 168); }
        if (t.pulled) { c.fillStyle = '#ff6a5c'; c.font = '800 34px Arial'; c.fillText('EMPTY NET', x0 + (left ? 14 : -14), 168); }
        c.textAlign = 'center'; c.fillStyle = '#ffd34a'; c.font = '900 190px "Arial Black", Impact, sans-serif'; c.fillText(String(g.score[ti]), left ? 360 : w - 360, 128);
      });
      c.textAlign = 'center'; c.fillStyle = '#ff8a2a'; c.font = '900 56px "Arial Black", Impact, sans-serif'; c.fillText(per, w / 2, 40);
      c.fillStyle = '#ff3b2f'; c.font = '900 120px "Courier New", monospace'; c.fillText(`${m}:${String(s).padStart(2, '0')}`, w / 2, 135);
      c.fillStyle = '#7e8ba6'; c.font = '600 28px Arial'; c.fillText(g.state === 'shootout' && g.so ? `${g.so.marks[0] || '–'}   vs   ${g.so.marks[1] || '–'}` : g.state === 'play' ? '' : g.state.toUpperCase(), w / 2, 200);
      if (tick) { c.fillStyle = 'rgba(255,211,74,0.12)'; c.fillRect(0, h - 52, w, 52); c.fillStyle = '#ffd34a'; c.font = '800 32px Arial'; c.fillText(tick, w / 2, h - 26); }
      this.strip.t.needsUpdate = true;
    }
    const bkey = [rp.playing, rp.label, rp.rate, this.shownName, Math.floor(g.t * 1.5) % 2 === 0].join('|');
    if (bkey !== this.badge.key) {
      this.badge.key = bkey;
      const c = this.badge.c.getContext('2d'), w = this.badge.c.width, h = this.badge.c.height; c.clearRect(0, 0, w, h);
      const on = Math.floor(g.t * 1.5) % 2 === 0;
      c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(0, 0, w, h);
      c.fillStyle = rp.playing ? '#d91f2a' : '#1a8a3c'; c.fillRect(0, 0, 330, h);
      c.fillStyle = '#fff'; c.textBaseline = 'middle'; c.textAlign = 'left'; c.font = '900 52px "Arial Black", Impact, sans-serif';
      c.fillText((rp.playing ? (on ? '▶ ' : '  ') + 'REPLAY' : (on ? '● ' : '  ') + 'LIVE'), 24, h / 2 + 2);
      c.font = '800 44px Arial, sans-serif'; c.fillStyle = '#e8eefc'; c.fillText(this.shownName, 360, h / 2 + 2);
      if (rp.playing) { c.textAlign = 'right'; c.fillStyle = '#ffd34a'; c.fillText(`${rp.label}  ·  SLOW-MO ${rp.rate}×`, w - 24, h / 2 + 2); }
      this.badge.t.needsUpdate = true;
    }
  }
}
