// Skaters, goalies, puck, labels. One ActorSet drives one copy of the on-ice actors
// (a second, mirrored copy under the ice gives the reflection).
import * as THREE from 'three';
import { TEAMS } from './sim.js';
import { glowTex, roundRect } from './rink.js';

const VIS = 1.4; // skaters drawn larger than life so they read on a tabletop
const geoCache = new Map();
const box = (w, h, d) => { const k = `${w},${h},${d}`; if (!geoCache.has(k)) geoCache.set(k, new THREE.BoxGeometry(w, h, d)); return geoCache.get(k); };
const sph = (r) => { const k = 's' + r; if (!geoCache.has(k)) geoCache.set(k, new THREE.SphereGeometry(r, 14, 10)); return geoCache.get(k); };
const cyl = (r, h) => { const k = `c${r},${h}`; if (!geoCache.has(k)) geoCache.set(k, new THREE.CylinderGeometry(r, r, h, 12)); return geoCache.get(k); };

const matCache = new Map();
function std(color, rough = 0.6, metal = 0) { const k = `${color}|${rough}|${metal}`; if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal })); return matCache.get(k); }

const numTex = new Map();
function numberTexture(num, team) {
  const k = num + '|' + team; if (numTex.has(k)) return numTex.get(k);
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  x.font = '900 100px Arial Black, Impact, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineWidth = 12; x.strokeStyle = '#' + TEAMS[team].helmet.toString(16).padStart(6, '0'); x.strokeText(String(num), 64, 68);
  x.fillStyle = '#' + TEAMS[team].trim.toString(16).padStart(6, '0'); x.fillText(String(num), 64, 68);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; numTex.set(k, t); return t;
}

const OFF_T = { jersey: 0x222222, trim: 0xffffff, helmet: 0x0a0a0a, css: '#ffffff' };
let _stripe;
function stripeMat() {
  if (_stripe) return _stripe;
  const c = document.createElement('canvas'); c.width = 128; c.height = 64; const x = c.getContext('2d');
  for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? '#f4f4f4' : '#101010'; x.fillRect(i * 16, 0, 16, 64); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping;
  _stripe = new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 }); return _stripe;
}

function makeRig(p) {
  const T = p.isOff ? OFF_T : TEAMS[p.team], isG = p.isG;
  const jersey = p.isOff ? stripeMat() : std(T.jersey, 0.55), trim = std(T.trim, 0.55), dark = std(T.helmet, 0.5), black = std(0x15161a, 0.5), skin = std(0xe0b090, 0.7), steel = std(0xd7dde6, 0.2, 0.9), wood = std(0xc9a063, 0.6);
  const pads = std(0xf2f2f2, 0.5);
  const root = new THREE.Group();
  const body = new THREE.Group(); body.scale.setScalar(VIS * (isG ? 1.08 : 1)); root.add(body);
  const add = (parent, geo, mat, x, y, z, shadow = true) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = shadow; parent.add(m); return m; };

  // legs (pivot at hip)
  const legs = [];
  for (const z of [-0.15, 0.15]) {
    const leg = new THREE.Group(); leg.position.set(0, 0.95, z); body.add(leg);
    if (isG) {
      add(leg, box(0.3, 0.86, 0.36), pads, 0, -0.44, 0); add(leg, box(0.31, 0.2, 0.37), trim, 0, -0.18, 0);
    } else {
      add(leg, box(0.2, 0.52, 0.19), dark, 0, -0.26, 0); add(leg, box(0.17, 0.34, 0.16), trim, 0, -0.67, 0);
    }
    add(leg, box(0.36, 0.13, 0.13), black, 0.07, -0.88, 0); add(leg, box(0.46, 0.035, 0.03), steel, 0.06, -0.97, 0);
    legs.push(leg);
  }
  // upper body (pivot at hip, leans)
  const lean = new THREE.Group(); lean.position.y = 0.95; body.add(lean);
  const tw = isG ? 0.8 : 0.58, td = isG ? 0.52 : 0.36;
  add(lean, box(td, 0.58, tw), jersey, 0, 0.33, 0);
  add(lean, box(td + 0.01, 0.09, tw + 0.01), trim, 0, 0.1, 0); add(lean, box(td + 0.01, 0.07, tw + 0.01), trim, 0, 0.42, 0);
  for (const z of [-1, 1]) add(lean, box(0.3, 0.16, 0.2), jersey, 0, 0.6, z * (tw / 2 + 0.01));
  const numMat = p.isOff ? null : new THREE.MeshBasicMaterial({ map: numberTexture(p.num, p.team), transparent: true, depthWrite: false });
  if (numMat) { const num = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.46), numMat); num.rotation.y = -Math.PI / 2; num.position.set(-td / 2 - 0.012, 0.33, 0); lean.add(num); }
  const head = new THREE.Group(); head.position.y = 0.78; lean.add(head);
  add(head, sph(0.115), skin, 0.02, 0, 0);
  const helmet = add(head, sph(isG ? 0.17 : 0.15), isG ? trim : dark, 0, 0.03, 0); helmet.scale.set(1, 0.9, 1);
  if (isG) { add(head, box(0.05, 0.2, 0.26), black, 0.14, -0.02, 0); }
  else add(head, box(0.07, 0.05, 0.24), std(0xbfe4ff, 0.1, 0.1), 0.12, 0.0, 0);
  // arms
  const arms = [];
  for (const z of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(0, 0.58, z * (tw / 2 + 0.07)); lean.add(arm);
    add(arm, box(0.13, 0.46, 0.13), jersey, 0, -0.23, 0); add(arm, box(0.15, 0.15, 0.15), black, 0.03, -0.5, 0);
    if (p.isOff && p.role === 'ref') add(arm, box(0.15, 0.09, 0.15), std(0xff7a00, 0.5), 0, -0.1, 0);
    arms.push(arm);
  }
  // stick: pivots at the hands, blade rests at the puck's carry position (sim carries it 1.05 m ahead)
  const stick = new THREE.Group(); stick.position.set(0.22, 0.12, 0.2); lean.add(stick);
  const shaft = add(stick, cyl(0.022, 1.15), wood, 0.2, -0.515, 0, false); shaft.rotation.z = 0.3705;
  if (isG) { add(stick, box(0.5, 0.12, 0.05), wood, 0.52, -1.0, 0); add(stick, box(0.22, 0.66, 0.05), wood, 0.36, -0.66, 0).rotation.z = 0.37; }
  else add(stick, box(0.3, 0.035, 0.085), black, 0.52, -1.03, 0);
  const whistle = p.isOff ? add(head, sph(0.035), steel, 0.2, -0.06, 0, false) : null; if (whistle) whistle.visible = false;
  return { root, body, legs, lean, arms, stick, head, helmet, numMat, whistle, noStick: !!p.isOff, fallT: 0, swingAmp: 0.6, shadowMeshes: [] };
}

// ---------------------------------------------------------------- labels
function labelTexture(p, mode, hot) {
  const T = TEAMS[p.team];
  const c = document.createElement('canvas'); c.width = 320; c.height = 120; const x = c.getContext('2d');
  const bg = '#' + T.helmet.toString(16).padStart(6, '0');
  x.globalAlpha = 0.9; x.fillStyle = bg; roundRect(x, 6, 6, 308, 108, 26); x.fill(); x.globalAlpha = 1;
  x.lineWidth = hot ? 9 : 5; x.strokeStyle = hot ? '#ffd34a' : T.css; roundRect(x, 6, 6, 308, 108, 26); x.stroke();
  x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#fff';
  if (mode === 0) {
    x.font = '900 54px Arial Black, Impact, sans-serif'; x.fillText((p.isG ? 'G ' : '#') + p.num, 160, 42);
    x.font = '700 34px Arial, sans-serif'; x.fillStyle = '#e8eefc'; x.fillText(p.name.split('. ')[1].toUpperCase(), 160, 88);
  } else { x.font = '900 82px Arial Black, Impact, sans-serif'; x.fillText((p.isG ? 'G' : '') + p.num, 160, 64); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

const BLOB_GEO = new THREE.CircleGeometry(0.85, 16).rotateX(-Math.PI / 2);
const BLOB_MAT = new THREE.MeshBasicMaterial({ color: 0x0a1020, transparent: true, opacity: 0.32, depthWrite: false });

export class ActorSet {
  constructor(parent, game, { labels = true } = {}) {
    this.game = game; this.group = new THREE.Group(); parent.add(this.group); this.labelsOn = labels; this.rigs = new Map();
    this.labelMode = 0; this.lowFx = false; this.povId = -1;
    this.buildRigs();
    // puck
    this.puck = new THREE.Group(); this.group.add(this.puck);
    const pm = new THREE.Mesh(cyl(0.44, 0.24), std(0x0b0b0d, 0.3, 0.2)); pm.castShadow = true; this.puck.add(pm);
    const rim = new THREE.Mesh(cyl(0.455, 0.05), std(0x8a8f99, 0.3, 0.6)); this.puck.add(rim);
    this.puckBody = pm;
    if (labels) {
      this.ring = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.2, 40), new THREE.MeshBasicMaterial({ color: 0xff9a2e, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      this.ring.rotation.x = -Math.PI / 2; this.ring.position.y = 0.03; this.ring.renderOrder = 3; this.group.add(this.ring);
      this.blob = new THREE.Mesh(new THREE.CircleGeometry(0.6, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
      this.blob.rotation.x = -Math.PI / 2; this.blob.position.y = 0.025; this.blob.renderOrder = 3; this.group.add(this.blob);
      this.carrierRing = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.05, 32), new THREE.MeshBasicMaterial({ color: 0xffd34a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      this.carrierRing.rotation.x = -Math.PI / 2; this.carrierRing.renderOrder = 3; this.group.add(this.carrierRing);
      this.charge = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0x9fe8ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 })); this.charge.scale.set(2, 2, 1); this.group.add(this.charge);
    }
  }

  everyone() { return this.game.officials ? this.game.players.concat(this.game.officials) : this.game.players; }

  buildRigs() {
    for (const p of this.everyone()) {
      const rig = makeRig(p); this.group.add(rig.root); this.rigs.set(p.id, rig);
      if (this.labelsOn && !p.isOff) {
        rig.blob = new THREE.Mesh(BLOB_GEO, BLOB_MAT); rig.blob.position.y = 0.035; rig.blob.visible = false; rig.blob.renderOrder = 3; this.group.add(rig.blob);
        rig.tex = [[labelTexture(p, 0, false), labelTexture(p, 0, true)], [labelTexture(p, 1, false), labelTexture(p, 1, true)]];
        rig.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: rig.tex[0][0], transparent: true, depthWrite: false, depthTest: false })); rig.label.renderOrder = 20;
        rig.label.scale.set(3.7, 1.4, 1); this.group.add(rig.label);
        rig.labelState = '';
      }
    }
  }

  rebuild() {
    for (const r of this.rigs.values()) { this.group.remove(r.root); if (r.label) { this.group.remove(r.label); r.label.material.dispose(); } if (r.blob) this.group.remove(r.blob); }
    this.rigs.clear(); this.buildRigs(); this.setLowFx(this.lowFx);
  }
  dispose() { this.group.parent && this.group.parent.remove(this.group); }
  setLabelMode(m) { this.labelMode = m; }
  setLowFx(v) { this.lowFx = v; for (const r of this.rigs.values()) r.root.traverse((o) => { if (o.isMesh && o.geometry && o.geometry.type !== 'PlaneGeometry') o.castShadow = !v; }); }

  update(dt, t) {
    const g = this.game, pk = g.puck;
    const pv = this.povId >= 0 ? g.players[this.povId] : null; // helmet cam: shrink labels of players close to the lens
    for (const p of this.everyone()) {
      const rig = this.rigs.get(p.id);
      const visible = p.onIce || p.box;
      rig.root.visible = visible;
      if (rig.label) rig.label.visible = visible && this.labelMode < 2 && p.id !== this.povId;
      if (rig.blob) { rig.blob.visible = this.lowFx && visible && !p.box; rig.blob.position.set(p.x, 0.035, p.y); }
      if (!visible) continue;
      const sp = Math.hypot(p.vx, p.vy);
      rig.root.position.set(p.x, 0, p.y); rig.root.rotation.y = -p.h;
      rig.fallT = p.fall > 0 ? rig.fallT + dt : 0;
      const fall = p.fall > 0 ? Math.min(1, rig.fallT / 0.14) * Math.min(1, p.fall / 0.5) : 0;
      const body = rig.body;
      body.rotation.x = fall * p.fallDir * 1.38; body.position.y = fall * 0.2;
      const amp = Math.min(0.8, sp * 0.075) * (p.isG ? 0.25 : 1) * (1 - fall);
      const ph = p.stride * 1.9;
      rig.legs[0].rotation.z = Math.sin(ph) * amp; rig.legs[1].rotation.z = -Math.sin(ph) * amp;
      rig.lean.rotation.z = -Math.min(0.5, sp * 0.04) * (1 - fall) - (p.isG ? 0.25 : 0);
      rig.lean.position.y = p.isG ? 0.8 : 0.95;
      rig.arms[0].rotation.z = -Math.sin(ph) * amp * 0.8 - 0.05; rig.arms[1].rotation.z = Math.sin(ph) * amp * 0.5 - 0.3;
      rig.arms[0].rotation.x = 0; rig.arms[1].rotation.x = 0;
      rig.helmet.visible = !p.fighting; rig.stick.visible = !p.fighting && !rig.noStick;
      rig.head.visible = p.id !== this.povId;
      // stick
      const carrying = pk.carrier === p;
      let sz = 0, sy = 0;
      if (p.windup > 0) {
        const total = p.windType === 'slap' ? 0.5 : 0.14, pr = 1 - Math.max(0, p.windup) / total;
        sz = -2.1 * pr * (p.windType === 'slap' ? 1 : 0.5); rig.swingAmp = p.windType === 'slap' ? 2.1 : 0.9;
      } else if (p.swing > 0) { const f = p.swing / 0.4; sz = -rig.swingAmp * f * f * f; if (p.swing > 0.39) rig.swingAmp = pk.shotType === 'slap' ? 2.1 : pk.shotType === 'pass' ? 0.5 : 1.0; }
      else if (carrying) sy = -Math.sin(t * 5.5 + p.id) * 0.4 * 0.9;
      rig.stick.rotation.z = sz; rig.stick.rotation.y = sy;
      if (p.cheer > 0) { rig.arms[0].rotation.z = -2.8 + Math.sin(t * 14 + p.id) * 0.35; rig.arms[1].rotation.z = -2.8 + Math.cos(t * 14 + p.id) * 0.35; rig.stick.rotation.z = -2.3 + Math.sin(t * 10) * 0.3; }
      if (p.fighting && p.fall <= 0) { const k = Math.sin(t * 22 + p.id) * 0.5 + 0.5; rig.arms[0].rotation.z = -1.5 * (p.punch > 0 ? 1 : 0.3) * k - 0.4; rig.arms[1].rotation.z = -1.3 * (p.punch > 0 ? 1 - k : 0.3) - 0.4; rig.lean.rotation.z = -0.35; }
      if (p.isOff) {
        if (rig.whistle) rig.whistle.visible = p.sig === 'whistle';
        if (p.sig === 'whistle') { rig.arms[0].rotation.z = -2.3; rig.arms[0].rotation.x = 0.35; }
        else if (p.sig === 'up') { rig.arms[0].rotation.z = -3.05; rig.arms[0].rotation.x = 0; }
        else if (p.sig === 'flat') { rig.arms[1].rotation.x = -1.5; rig.arms[1].rotation.z = 0; }
        else if (p.sig === 'cross') { rig.arms[0].rotation.z = -3.0; rig.arms[1].rotation.z = -3.0; rig.arms[0].rotation.x = 0.35; rig.arms[1].rotation.x = -0.35; }
        else if (p.sig === 'point') { rig.arms[1].rotation.z = -1.55; }
      }
      if (p.box) { rig.body.position.y = -0.0; rig.legs[0].rotation.z = rig.legs[1].rotation.z = -1.35; rig.lean.rotation.z = 0.1; }
      if (p.isG && p.dive > 0) { rig.body.rotation.x = Math.sign(p.vy || 1) * 0.95; rig.body.position.y = 0.2; }
      // label
      if (rig.label) {
        const hot = carrying ? 1 : 0, mode = Math.min(1, this.labelMode), key = mode * 2 + hot;
        if (rig.labelState !== key) { rig.label.material.map = rig.tex[mode][hot]; rig.label.material.needsUpdate = true; rig.labelState = key; }
        rig.label.position.set(p.x, 3.5 + (carrying ? 0.3 : 0), p.y);
        const s = carrying ? 1.2 : 1; const base = mode === 0 ? [3.7, 1.4] : [2.3, 1.0];
        const near = pv && pv !== p ? Math.min(1, 0.2 + Math.hypot(p.x - pv.x, p.y - pv.y) / 16) : 1; rig.label.scale.set(base[0] * s * near, base[1] * s * near, 1);
      }
    }
    // puck
    const ph = pk.z;
    this.puck.position.set(pk.x, Math.max(0.12, ph), pk.y);
    this.puck.rotation.y += dt * (2 + Math.hypot(pk.vx, pk.vy) * 0.6);
    this.puck.rotation.z = Math.min(0.6, pk.vz * 0.05);
    if (this.ring) {
      const showRing = g.state !== 'faceoff' || true;
      this.ring.visible = showRing; this.ring.position.set(pk.x, 0.03, pk.y);
      const pulse = 1 + Math.sin(t * 6) * 0.12 + Math.min(0.4, pk.z * 0.3);
      this.ring.scale.setScalar(pulse * (pk.carrier ? 0.65 : 1));
      this.ring.material.opacity = pk.carrier ? 0.35 : 0.8;
      this.blob.position.set(pk.x, 0.025, pk.y); this.blob.scale.setScalar(1 + pk.z * 0.4); this.blob.material.opacity = Math.max(0.05, 0.38 - pk.z * 0.15);
      const c = pk.carrier;
      this.carrierRing.visible = !!c && this.labelMode < 2;
      if (c) { this.carrierRing.position.set(c.x, 0.04, c.y); this.carrierRing.scale.setScalar(1 + Math.sin(t * 8) * 0.08); this.carrierRing.material.color.setHex(TEAMS[c.team].jersey === 0x1f6bff ? 0x6fb0ff : 0xff8070); }
      const w = g.players.find((p) => p.windup > 0 && p.windType === 'slap' && pk.carrier === p);
      if (w) { const pr = 1 - w.windup / 0.5; this.charge.position.set(w.x + Math.cos(w.h) * 1.1, 0.7, w.y + Math.sin(w.h) * 1.1); this.charge.scale.setScalar(1 + pr * 3.2); this.charge.material.opacity = 0.3 + pr * 0.7; }
      else this.charge.material.opacity = 0;
    }
  }
}
