// Rink visuals: ice, boards, plexiglass, nets, penalty boxes, jumbotron. Sim (x, y) -> three (x, 0, y).
import * as THREE from 'three';
import { RINK, TEAMS } from './sim.js';

const { hx, hy, R, L, W, goalX, blueX, boardH, glassH, glassEndH, netHalf, netDepth, crossbar } = RINK;

export function roundedRectShape(ax, ay, r) {
  const s = new THREE.Shape();
  s.moveTo(ax - r, -ay);
  s.lineTo(-ax + r, -ay); s.absarc(-ax + r, -ay + r, r, -Math.PI / 2, -Math.PI, true);
  s.lineTo(-ax, ay - r); s.absarc(-ax + r, ay - r, r, Math.PI, Math.PI / 2, true);
  s.lineTo(ax - r, ay); s.absarc(ax - r, ay - r, r, Math.PI / 2, 0, true);
  s.lineTo(ax, -ay + r); s.absarc(ax - r, -ay + r, r, 0, -Math.PI / 2, true);
  return s;
}

// perimeter samples of the board line (counter-clockwise in sim x/y)
export function perimeter(step = 2.2, arcSeg = 14) {
  const pts = [];
  const cx = hx - R, cy = hy - R;
  const straight = (x0, y0, x1, y1, nx, ny) => {
    const len = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.round(len / step));
    for (let i = 0; i < n; i++) { const t = i / n; pts.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, nx, ny }); }
  };
  const arc = (ccx, ccy, a0) => {
    for (let i = 0; i < arcSeg; i++) { const a = a0 + (i / arcSeg) * Math.PI / 2; pts.push({ x: ccx + Math.cos(a) * R, y: ccy + Math.sin(a) * R, nx: Math.cos(a), ny: Math.sin(a) }); }
  };
  straight(hx, -cy, hx, cy, 1, 0); arc(cx, cy, 0);
  straight(cx, hy, -cx, hy, 0, 1); arc(-cx, cy, Math.PI / 2);
  straight(-hx, cy, -hx, -cy, -1, 0); arc(-cx, -cy, Math.PI);
  straight(-cx, -hy, cx, -hy, 0, -1); arc(cx, -cy, Math.PI * 1.5);
  return pts;
}

function ribbon(pts, off, y0, y1Fn, uScale, closed = true) {
  const pos = [], uv = [], idx = [];
  let d = 0;
  const n = pts.length, cnt = closed ? n + 1 : n;
  for (let i = 0; i < cnt; i++) {
    const p = pts[i % n];
    if (i > 0) { const q = pts[(i - 1) % n]; d += Math.hypot(p.x - q.x, p.y - q.y); }
    const x = p.x + p.nx * off, z = p.y + p.ny * off;
    const y1 = typeof y1Fn === 'function' ? y1Fn(p) : y1Fn;
    pos.push(x, y0, z, x, y1, z);
    uv.push(d * uScale, 0, d * uScale, 1);
    if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

function canvasTex(w, h, draw, repeat = false) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d'); draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (repeat) { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; }
  return t;
}

// ------------------------------------------------------------------ ice
function iceTexture() {
  const w = 3072, h = Math.round(w * W / L), k = w / L;
  const X = (x) => (x + hx) * k, Y = (y) => (y + hy) * k;
  return canvasTex(w, h, (c) => {
    // base — slightly blue, cloudy
    const g = c.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#eaf6ff'); g.addColorStop(0.5, '#f4fbff'); g.addColorStop(1, '#e3f1fb');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) { // soft cloudy patches
      const x = Math.random() * w, y = Math.random() * h, r = 40 + Math.random() * 220;
      const rg = c.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, `rgba(${180 + Math.random() * 50 | 0},${215 + Math.random() * 30 | 0},255,0.10)`); rg.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = rg; c.fillRect(x - r, y - r, r * 2, r * 2);
    }
    c.strokeStyle = 'rgba(120,170,215,0.07)'; c.lineWidth = 1; // fine old cuts
    for (let i = 0; i < 520; i++) { c.beginPath(); const x = Math.random() * w, y = Math.random() * h, a = Math.random() * 6.28, l = 20 + Math.random() * 160; c.moveTo(x, y); c.quadraticCurveTo(x + Math.cos(a) * l * .5 + 8, y + Math.sin(a) * l * .5 + 8, x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke(); }

    const RED = '#d3262f', BLUE = '#1c4fb5';
    const line = (x0, y0, x1, y1, wd, col) => { c.strokeStyle = col; c.lineWidth = wd * k; c.beginPath(); c.moveTo(X(x0), Y(y0)); c.lineTo(X(x1), Y(y1)); c.stroke(); };
    const circ = (x, y, r, wd, col, fill) => { c.beginPath(); c.arc(X(x), Y(y), r * k, 0, 6.2832); if (fill) { c.fillStyle = fill; c.fill(); } if (wd) { c.strokeStyle = col; c.lineWidth = wd * k; c.stroke(); } };
    // clip to the rounded rink
    c.save(); c.beginPath();
    const cx = hx - R, cy = hy - R;
    c.moveTo(X(-cx), Y(-hy)); c.lineTo(X(cx), Y(-hy)); c.arc(X(cx), Y(-cy), R * k, -Math.PI / 2, 0); c.lineTo(X(hx), Y(cy)); c.arc(X(cx), Y(cy), R * k, 0, Math.PI / 2);
    c.lineTo(X(-cx), Y(hy)); c.arc(X(-cx), Y(cy), R * k, Math.PI / 2, Math.PI); c.lineTo(X(-hx), Y(-cy)); c.arc(X(-cx), Y(-cy), R * k, Math.PI, Math.PI * 1.5); c.closePath(); c.clip();
    // centre-ice logo ring + text
    circ(0, 0, 4.5, 0.13, BLUE, 'rgba(120,170,235,0.10)');
    c.save(); c.translate(X(0), Y(0)); c.fillStyle = 'rgba(25,70,160,0.55)'; c.font = `900 ${1.35 * k}px Impact, Arial Black, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('TABLE', 0, -0.95 * k); c.fillText('HOCKEY', 0, 0.55 * k); c.restore();
    // blue lines & red centre line
    line(-blueX, -hy, -blueX, hy, 0.3, BLUE); line(blueX, -hy, blueX, hy, 0.3, BLUE);
    line(0, -hy, 0, hy, 0.3, RED);
    c.save(); c.setLineDash([0.5 * k, 0.5 * k]); line(0, -hy, 0, hy, 0.08, '#ffffff'); c.restore();
    line(-goalX, -hy, -goalX, hy, 0.07, RED); line(goalX, -hy, goalX, hy, 0.07, RED);
    // end-zone circles, dots, hash marks
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const ex = sx * 21, ey = sy * 6.7;
      circ(ex, ey, 4.5, 0.09, RED); circ(ex, ey, 0.6, 0, RED, RED);
      for (const hx2 of [-0.9, 0.9]) for (const hy2 of [-1, 1]) line(ex + hx2, ey + hy2 * 4.5, ex + hx2, ey + hy2 * 5.2, 0.09, RED);
      circ(sx * 6.1, sy * 6.7, 0.32, 0, RED, RED); // neutral zone dots
    }
    circ(0, 0, 0.35, 0, BLUE, BLUE);
    // creases + trapezoid
    for (const s of [-1, 1]) {
      c.beginPath(); c.arc(X(s * goalX), Y(0), RINK.creaseR * k, s > 0 ? Math.PI / 2 : -Math.PI / 2, s > 0 ? -Math.PI / 2 : Math.PI / 2, s < 0 ? false : false);
      c.fillStyle = 'rgba(110,170,240,0.55)'; c.fill(); c.strokeStyle = RED; c.lineWidth = 0.09 * k; c.stroke();
      line(s * goalX, -3.35, s * (hx - 1.0), -4.3, 0.07, RED); line(s * goalX, 3.35, s * (hx - 1.0), 4.3, 0.07, RED);
    }
    c.restore();
  });
}

function adsTexture() {
  const names = ['ICE·O·RAMA', 'PUCK & CO', 'FROSTBITE', 'ZAMBONI', 'TAPE BLADE', 'POLAR POP', 'SLAP SHOT', 'GLOVES OFF'];
  const cols = ['#0e2a6b', '#a8171f', '#102e22', '#2a1745', '#b2570a', '#0a5a6e', '#1e1e1e', '#6d1330'];
  return canvasTex(2048, 128, (c, w, h) => {
    const pw = w / names.length;
    names.forEach((n, i) => {
      const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, cols[i]); g.addColorStop(1, '#000000aa');
      c.fillStyle = cols[i]; c.fillRect(i * pw, 0, pw, h); c.fillStyle = g; c.globalAlpha = 0.5; c.fillRect(i * pw, 0, pw, h); c.globalAlpha = 1;
      c.fillStyle = '#fff'; c.font = '900 52px Impact, Arial Black, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(n, i * pw + pw / 2, h * 0.5);
      c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(i * pw, 0, 3, h);
    });
    c.fillStyle = '#f4c20d'; c.fillRect(0, h - 14, w, 14); // kick plate
  }, true);
}

function glassTexture() {
  return canvasTex(512, 256, (c, w, h) => {
    c.fillStyle = 'rgba(175,215,255,0.10)'; c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(255,255,255,0.20)';
    for (const [x, wd] of [[60, 34], [170, 12], [330, 46], [430, 10]]) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x + wd, 0); c.lineTo(x + wd - 90, h); c.lineTo(x - 90, h); c.closePath(); c.fill(); }
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(255,255,255,0.0)'); g.addColorStop(1, 'rgba(180,215,255,0.16)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  }, true);
}

function netTexture() {
  return canvasTex(128, 128, (c, w, h) => {
    c.clearRect(0, 0, w, h); c.strokeStyle = 'rgba(255,255,255,0.9)'; c.lineWidth = 5;
    for (let i = 0; i <= 4; i++) { c.beginPath(); c.moveTo(i * w / 4, 0); c.lineTo(i * w / 4, h); c.stroke(); c.beginPath(); c.moveTo(0, i * h / 4); c.lineTo(w, i * h / 4); c.stroke(); }
  }, true);
}

// ------------------------------------------------------------------ build
export function buildRink(game, opts = {}) {
  const group = new THREE.Group(); group.name = 'rink';
  const maxAniso = opts.maxAniso || 8;

  // ---- ice
  const iceTex = iceTexture(); iceTex.anisotropy = maxAniso;
  const iceGeo = (() => {
    const pts = perimeter(1, 20), pos = [0, 0, 0], uv = [0.5, 0.5], idx = [];
    for (const p of pts) { pos.push(p.x, 0, p.y); uv.push((p.x + hx) / L, 1 - (p.y + hy) / W); }
    for (let i = 1; i <= pts.length; i++) idx.push(0, (i % pts.length) + 1, i); // CCW seen from +Y
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((v, i) => (i % 3 === 1 ? 1 : 0)), 3)); g.setIndex(idx);
    return g;
  })();
  const iceMat = new THREE.MeshPhysicalMaterial({ map: iceTex, roughness: 0.09, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.035, envMapIntensity: 1.1, emissive: 0xcfe4ff, emissiveIntensity: 0.22, transparent: true, opacity: 0.93 });
  const ice = new THREE.Mesh(iceGeo, iceMat); ice.receiveShadow = true; ice.renderOrder = 1; group.add(ice);


  // ---- skate scratches (dynamic overlay)
  const sc = document.createElement('canvas'); sc.width = 1536; sc.height = Math.round(1536 * W / L);
  const sctx = sc.getContext('2d'); sctx.lineCap = 'round';
  const scTex = new THREE.CanvasTexture(sc); scTex.colorSpace = THREE.SRGBColorSpace; scTex.anisotropy = maxAniso;
  const scratch = new THREE.Mesh(iceGeo, new THREE.MeshBasicMaterial({ map: scTex, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  scratch.position.y = 0.012; scratch.renderOrder = 2; group.add(scratch);
  const sk = sc.width / L;
  let scDirty = false, scFade = 0;
  const last = new Map();
  function scratchSkater(p, speed) {
    const px = (p.x + hx) * sk, py = (p.y + hy) * sk, l = last.get(p.id);
    if (l && speed > 2.5 && Math.hypot(px - l[0], py - l[1]) < 60) {
      sctx.strokeStyle = `rgba(255,255,255,${Math.min(0.22, 0.04 + speed * 0.014)})`; sctx.lineWidth = 1.1;
      const nx = -Math.sin(p.h) * 2.2, ny = Math.cos(p.h) * 2.2;
      for (const s of [-1, 1]) { sctx.beginPath(); sctx.moveTo(l[0] + nx * s, l[1] + ny * s); sctx.lineTo(px + nx * s, py + ny * s); sctx.stroke(); }
      scDirty = true;
    }
    last.set(p.id, [px, py]);
  }
  function scratchPuck(x, y, px, py, pw) {
    sctx.strokeStyle = `rgba(255,255,255,${0.2})`; sctx.lineWidth = 0.9; sctx.beginPath(); sctx.moveTo((px + hx) * sk, (py + hy) * sk); sctx.lineTo((x + hx) * sk, (y + hy) * sk); sctx.stroke(); scDirty = true;
  }
  function stopScratch(p, power) { // hockey stop — spray + a wide scrape
    const px = (p.x + hx) * sk, py = (p.y + hy) * sk;
    sctx.strokeStyle = 'rgba(255,255,255,0.35)'; sctx.lineWidth = 1.6;
    for (let i = 0; i < 4; i++) { const a = p.h + Math.PI / 2 + (Math.random() - 0.5) * 0.4, l = 8 + Math.random() * 20 * power; sctx.beginPath(); sctx.moveTo(px, py); sctx.lineTo(px + Math.cos(a) * l * (i % 2 ? 1 : -1), py + Math.sin(a) * l * (i % 2 ? 1 : -1)); sctx.stroke(); }
    scDirty = true;
  }
  function flushScratch(dt) {
    scFade += dt;
    if (scFade > 2.5) { scFade = 0; sctx.globalCompositeOperation = 'destination-out'; sctx.fillStyle = 'rgba(0,0,0,0.045)'; sctx.fillRect(0, 0, sc.width, sc.height); sctx.globalCompositeOperation = 'source-over'; scDirty = true; }
    if (scDirty) { scTex.needsUpdate = true; scDirty = false; }
  }
  function clearScratch() { sctx.clearRect(0, 0, sc.width, sc.height); scTex.needsUpdate = true; last.clear(); }

  // ---- boards, glass, stanchions
  const pts = perimeter(2.2, 14);
  const adsTex = adsTexture(); adsTex.repeat.set(1, 1);
  const boardsIn = new THREE.Mesh(ribbon(pts, 0, 0, boardH, 1 / 24), new THREE.MeshStandardMaterial({ map: adsTex, roughness: 0.45, side: THREE.DoubleSide }));
  const boardsOut = new THREE.Mesh(ribbon(pts, 0.14, 0, boardH, 1 / 24), new THREE.MeshStandardMaterial({ color: 0x1b2230, roughness: 0.5, side: THREE.DoubleSide }));
  // top cap as a flat strip
  const capGeo = (() => {
    const pos = [], idx = []; const n = pts.length;
    for (let i = 0; i <= n; i++) { const p = pts[i % n]; pos.push(p.x - p.nx * 0.02, boardH, p.y - p.ny * 0.02, p.x + p.nx * 0.16, boardH, p.y + p.ny * 0.16); if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
  })();
  const cap = new THREE.Mesh(capGeo, new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.35, side: THREE.DoubleSide }));
  [boardsIn, boardsOut, cap].forEach((m) => { m.castShadow = false; m.receiveShadow = true; group.add(m); });
  adsTex.repeat.x = 1;

  const gH = (p) => boardH + glassH + (glassEndH - glassH) * Math.min(1, Math.max(0, (Math.abs(p.x) - 19) / 8));
  const glassTex = glassTexture(); glassTex.repeat.set(1, 1);
  const glassMat = new THREE.MeshPhysicalMaterial({ map: glassTex, color: 0xffffff, transparent: true, opacity: 1, roughness: 0.04, metalness: 0, clearcoat: 1, envMapIntensity: 2.2, side: THREE.DoubleSide, depthWrite: false });
  const glass = new THREE.Mesh(ribbon(pts, 0.12, boardH, gH, 1 / 9), glassMat); glass.renderOrder = 5; group.add(glass);
  const post = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 1, 0.16), new THREE.MeshStandardMaterial({ color: 0xcfd6df, roughness: 0.35, metalness: 0.7 }), pts.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3();
  let pi = 0;
  pts.forEach((p, i) => {
    const isArc = Math.abs(Math.abs(p.nx) - 1) > 0.01 && Math.abs(Math.abs(p.ny) - 1) > 0.01;
    if (isArc && i % 2) return;
    const h = gH(p) - boardH; sv.set(1, h, 1); pv.set(p.x + p.nx * 0.12, boardH + h / 2, p.y + p.ny * 0.12);
    m4.compose(pv, q, sv); post.setMatrixAt(pi++, m4);
  });
  post.count = pi; group.add(post);
  // glass top frame
  const frameLine = (() => {
    const v = []; for (let i = 0; i <= pts.length; i++) { const p = pts[i % pts.length]; v.push(new THREE.Vector3(p.x + p.nx * 0.12, gH(p), p.y + p.ny * 0.12)); }
    const curve = new THREE.CatmullRomCurve3(v, true); return new THREE.Mesh(new THREE.TubeGeometry(curve, 220, 0.07, 6, true), new THREE.MeshStandardMaterial({ color: 0xcfd6df, roughness: 0.3, metalness: 0.8 }));
  })(); group.add(frameLine);

  // ---- goals
  const netTex = netTexture();
  const goalLightMats = [];
  const goals = [];
  const netObjs = [];
  for (const s of [-1, 1]) {
    const g = new THREE.Group();
    const red = new THREE.MeshStandardMaterial({ color: 0xe3262f, roughness: 0.35, metalness: 0.2, emissive: 0x330404 });
    const cyl = (r, len, x, y, z, rx, rz) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), red); m.position.set(x, y, z); m.rotation.x = rx || 0; m.rotation.z = rz || 0; m.castShadow = true; g.add(m); return m; };
    cyl(0.1, crossbar, s * goalX, crossbar / 2, -netHalf); cyl(0.1, crossbar, s * goalX, crossbar / 2, netHalf);
    cyl(0.1, netHalf * 2, s * goalX, crossbar, 0, Math.PI / 2);
    // net: four subdivided faces so it can bulge when the puck hits it
    const bx = s * (goalX + netDepth), tx = s * (goalX + netDepth * 0.55);
    const V = { F1: [s * goalX, 0, -netHalf], F2: [s * goalX, 0, netHalf], T1: [s * goalX, crossbar, -netHalf], T2: [s * goalX, crossbar, netHalf], B1: [bx, 0, -netHalf], B2: [bx, 0, netHalf], U1: [tx, crossbar * 0.92, -netHalf], U2: [tx, crossbar * 0.92, netHalf] };
    const faces = [
      { c: ['F1', 'T1', 'U1', 'B1'], out: [0, 0, -1], sz: [netDepth, crossbar] }, { c: ['F2', 'T2', 'U2', 'B2'], out: [0, 0, 1], sz: [netDepth, crossbar] },
      { c: ['B1', 'U1', 'U2', 'B2'], out: [s, 0.25, 0], sz: [netHalf * 2, crossbar] }, { c: ['T1', 'T2', 'U2', 'U1'], out: [0, 1, 0], sz: [netHalf * 2, netDepth] },
    ];
    const NU = 7, NV = 6, pos = [], uvs = [], idx = [], outN = [];
    faces.forEach((f) => {
      const [a, b, c, d] = f.c.map((k) => V[k]); const o0 = pos.length / 3;
      for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) {
        const u = i / NU, v = j / NV;
        for (let k = 0; k < 3; k++) pos.push(a[k] * (1 - u) * (1 - v) + d[k] * u * (1 - v) + c[k] * u * v + b[k] * (1 - u) * v);
        uvs.push(u * f.sz[0] * 2.2, v * f.sz[1] * 2.2); outN.push(...f.out);
      }
      for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) { const q = o0 + j * (NU + 1) + i; idx.push(q, q + 1, q + NU + 1, q + 1, q + NU + 2, q + NU + 1); }
    });
    const ng = new THREE.BufferGeometry(); ng.setAttribute('position', new THREE.Float32BufferAttribute(pos.slice(), 3)); ng.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); ng.setIndex(idx);
    const nm = new THREE.MeshBasicMaterial({ map: netTex, transparent: true, side: THREE.DoubleSide, depthWrite: false, opacity: 0.85 });
    g.add(new THREE.Mesh(ng, nm));
    netObjs.push({ geom: ng, base: Float32Array.from(pos), out: Float32Array.from(outN), ripples: [], dirty: false });
    // goal light
    const lm = new THREE.MeshBasicMaterial({ color: 0x400808 });
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 10), lm); lamp.position.set(s * (goalX + netDepth * 0.4), crossbar + 0.75, 0); g.add(lamp);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xff2a1a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
    glow.scale.set(5, 5, 1); glow.position.copy(lamp.position); g.add(glow);
    goals.push({ lm, glow, lamp, s });
    group.add(g);
  }

  // ---- penalty boxes (one per team, far side)
  for (const ti of [0, 1]) {
    const bxp = ti === 0 ? -2.9 : 2.9, bz = -(hy + 2.35);
    const bg = new THREE.Group(); bg.position.set(bxp, 0, bz);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.12, 3.1), new THREE.MeshStandardMaterial({ color: TEAMS[ti].jersey, roughness: 0.6 })); floor.position.y = 0.06; bg.add(floor);
    const w = new THREE.Mesh(new THREE.BoxGeometry(5.2, 1.6, 0.08), new THREE.MeshPhysicalMaterial({ color: 0xcfe6ff, transparent: true, opacity: 0.16, roughness: 0.05, depthWrite: false }));
    w.position.set(0, 0.9, -1.55); bg.add(w); const w2 = w.clone(); w2.position.z = 1.55; bg.add(w2);
    const w3 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.6, 3.1), w.material); w3.position.set(-2.6, 0.9, 0); bg.add(w3); const w4 = w3.clone(); w4.position.x = 2.6; bg.add(w4);
    const sign = makeTextSprite('PENALTY BOX', 1.0, '#ffffff', TEAMS[ti].css, 7.2, 1.35); sign.position.set(0, 2.6, 0); bg.add(sign);
    group.add(bg);
  }

  // a puck (or shot) hitting the netting sends a damped ripple through it
  function netHit(end, x, y, z, power) {
    const n = netObjs[end === -1 ? 0 : 1]; if (!n) return;
    if (n.ripples.length > 5) n.ripples.shift();
    n.ripples.push({ px: x, py: z, pz: y, amp: Math.min(0.85, 0.1 + power * 0.04), t: 0 });
  }
  function updateNets(dt) {
    for (const n of netObjs) {
      if (!n.ripples.length) { if (n.dirty) { n.geom.attributes.position.array.set(n.base); n.geom.attributes.position.needsUpdate = true; n.dirty = false; } continue; }
      for (const r of n.ripples) r.t += dt;
      n.ripples = n.ripples.filter((r) => r.t < 2.4);
      const P = n.geom.attributes.position.array, B = n.base, O = n.out;
      for (let i = 0; i < B.length; i += 3) {
        let disp = 0;
        for (const r of n.ripples) {
          const dx = B[i] - r.px, dy = B[i + 1] - r.py, dz = B[i + 2] - r.pz, d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > 5) continue;
          disp += r.amp * Math.exp(-d2 / 0.7) * Math.cos(r.t * 21 - Math.sqrt(d2) * 7) * Math.exp(-r.t * 2.7);
        }
        P[i] = B[i] + O[i] * disp; P[i + 1] = B[i + 1] + O[i + 1] * disp; P[i + 2] = B[i + 2] + O[i + 2] * disp;
      }
      n.geom.attributes.position.needsUpdate = true; n.dirty = true;
    }
  }

  function updateGoalLights() {
    for (const gl of goals) {
      const idx = gl.s === 1 ? 0 : 1; const t = game.goalLight[idx];
      const on = t > 0 && Math.floor(t * 6) % 2 === 0;
      gl.lm.color.setHex(on ? 0xff2a1a : 0x400808); gl.glow.material.opacity = on ? 1 : 0;
    }
  }

  return { group, ice, iceMat, scratchSkater, scratchPuck, stopScratch, flushScratch, clearScratch, updateGoalLights, netHit, updateNets };
}

let _glow;
export function glowTex() {
  if (_glow) return _glow;
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.6)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128); _glow = new THREE.CanvasTexture(c); return _glow;
}

export function makeTextSprite(text, _s, fg, bg, w, h) {
  const c = document.createElement('canvas'); c.width = 512; c.height = Math.round(512 * h / w); const x = c.getContext('2d');
  x.fillStyle = bg; x.globalAlpha = 0.85; roundRect(x, 4, 4, c.width - 8, c.height - 8, 28); x.fill(); x.globalAlpha = 1;
  x.fillStyle = fg; x.font = `900 ${c.height * 0.5}px Arial Black, Impact, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, c.width / 2, c.height / 2 + 3);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false })); s.scale.set(w, h, 1); return s;
}
export function roundRect(x, X, Y, w, h, r) { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r); x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath(); }
