// Particles + puck power trail.
import * as THREE from 'three';
import { glowTex } from './rink.js';

export class Particles {
  constructor(parent, { max = 700, size = 0.3, additive = true } = {}) {
    this.max = max; this.n = 0; this.head = 0; this.baseSize = size;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.ttl = new Float32Array(max);
    this.base = new Float32Array(max * 3); this.grav = new Float32Array(max);
    for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -999;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.geo = g;
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size, map: glowTex(), vertexColors: true, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, sizeAttenuation: true }));
    this.points.frustumCulled = false; this.points.renderOrder = 10; parent.add(this.points);
  }
  emit(x, y, z, vx, vy, vz, life, r, g, b, grav = -9) {
    const i = this.head; this.head = (this.head + 1) % this.max;
    const k = i * 3;
    this.pos[k] = x; this.pos[k + 1] = y; this.pos[k + 2] = z;
    this.vel[k] = vx; this.vel[k + 1] = vy; this.vel[k + 2] = vz;
    this.base[k] = r; this.base[k + 1] = g; this.base[k + 2] = b;
    this.life[i] = life; this.ttl[i] = life; this.grav[i] = grav;
  }
  update(dt) {
    for (let i = 0; i < this.max; i++) {
      const k = i * 3;
      if (this.life[i] <= 0) { this.col[k] = this.col[k + 1] = this.col[k + 2] = 0; continue; }
      this.life[i] -= dt;
      this.vel[k + 1] += this.grav[i] * dt;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      if (this.pos[k + 1] < 0.05 && this.vel[k + 1] < 0) { this.pos[k + 1] = 0.05; this.vel[k + 1] *= -0.3; this.vel[k] *= 0.7; this.vel[k + 2] *= 0.7; }
      const f = Math.max(0, this.life[i] / this.ttl[i]);
      this.col[k] = this.base[k] * f; this.col[k + 1] = this.base[k + 1] * f; this.col[k + 2] = this.base[k + 2] * f;
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.color.needsUpdate = true;
  }
}

// Palette: saturated colours that stay readable on white ice. Slap shots burn electric blue, hard wrist shots burn orange/red.
const PAL = {
  fire: [[0, [1, 0.88, 0.3]], [0.25, [1, 0.5, 0.06]], [0.6, [0.92, 0.12, 0.08]], [1, [0.5, 0.05, 0.4]]],
  plasma: [[0, [0.25, 0.95, 1]], [0.2, [0.05, 0.55, 1]], [0.55, [0.12, 0.2, 0.95]], [1, [0.45, 0.1, 0.85]]],
};
function sample(pal, t) {
  for (let i = 1; i < pal.length; i++) if (t <= pal[i][0]) { const a = pal[i - 1], b = pal[i], f = (t - a[0]) / (b[0] - a[0]); return [0, 1, 2].map((c) => a[1][c] + (b[1][c] - a[1][c]) * f); }
  return pal[pal.length - 1][1];
}

export class PuckTrail {
  constructor(parent, N = 44) {
    this.N = N; this.pts = [];
    const mk = (additive) => {
      const g = new THREE.BufferGeometry();
      const pos = new Float32Array(N * 2 * 3), col = new Float32Array(N * 2 * 4), idx = [];
      for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 4)); g.setIndex(idx);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
      m.frustumCulled = false; m.renderOrder = additive ? 9 : 8; parent.add(m); return m;
    };
    // [mesh, widthMultiplier, alphaMultiplier, vertical?]
    this.layers = [[mk(false), 1.1, 1.0, false], [mk(false), 1, 0.9, true], [mk(true), 1.9, 0.1, false], [mk(true), 1.9, 0.08, true]];
  }
  push(x, y, z, speed, slap) {
    const power = THREE.MathUtils.clamp((speed - 15) / 22, 0, 1);
    this.pts.unshift({ x, y, z, power, slap });
    if (this.pts.length > this.N) this.pts.pop();
    this.build();
  }
  clear() { this.pts.length = 0; this.build(); }
  build() {
    const N = this.N, pts = this.pts;
    for (const [m, wm, am, vert] of this.layers) {
      const pa = m.geometry.attributes.position, ca = m.geometry.attributes.color, pp = pa.array, cc = ca.array;
      pp.fill(0); cc.fill(0);
      for (let i = 0; i < N; i++) {
        const live = i < pts.length;
        const p = pts[Math.min(i, pts.length - 1)] || { x: 0, y: -99, z: 0, power: 0 };
        const q = pts[i + 1] || p, pr = pts[i - 1] || p;
        let dx = pr.x - q.x, dz = pr.y - q.y; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
        const f = i / (N - 1);
        const w = (0.14 + 0.5 * p.power) * (1 - f * 0.8) * wm;
        const col = sample(p.slap ? PAL.plasma : PAL.fire, Math.min(1, f * 0.95));
        const a = live ? Math.min(1, Math.pow(1 - f, 1.1) * (0.25 + p.power * 1.1)) * am * (p.power > 0.02 ? 1 : 0) : 0;
        const y0 = p.z * 0.9 + 0.04, k = i * 6, k4 = i * 8;
        if (!vert) { pp[k] = p.x - dz * w; pp[k + 1] = y0; pp[k + 2] = p.y + dx * w; pp[k + 3] = p.x + dz * w; pp[k + 4] = y0; pp[k + 5] = p.y - dx * w; }
        else { pp[k] = p.x; pp[k + 1] = y0 + w * 0.9; pp[k + 2] = p.y; pp[k + 3] = p.x; pp[k + 4] = Math.max(0.02, y0 - w * 0.9); pp[k + 5] = p.y; }
        for (let v = 0; v < 2; v++) { cc[k4 + v * 4] = col[0]; cc[k4 + v * 4 + 1] = col[1]; cc[k4 + v * 4 + 2] = col[2]; cc[k4 + v * 4 + 3] = a; }
      }
      pa.needsUpdate = true; ca.needsUpdate = true;
    }
  }
}
