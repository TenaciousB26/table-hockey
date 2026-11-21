// Marker tracking for iPhone/iPad "Camera AR": finds a printed ArUco marker in the camera feed and
// recovers the camera pose relative to it, so the rink stays glued to the table while you walk around.
// Pure maths (no three.js / DOM) so it can be tested in node. Frames: marker frame = x right, y up (out of the paper),
// z toward the person reading the marker. Camera = three.js convention (x right, y up, looking down -z).

// Solve 8x8 linear system (Gaussian elimination, partial pivoting)
function solve(A, b) {
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
    const d = A[i][i]; if (Math.abs(d) < 1e-12) return null;
    for (let r = i + 1; r < n; r++) { const f = A[r][i] / d; for (let c = i; c < n; c++) A[r][c] -= f * A[i][c]; b[r] -= f * b[i]; }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { let s = b[i]; for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c]; x[i] = s / A[i][i]; }
  return x;
}

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

// corners: 4 {x,y} in pixels, clockwise from the marker's top-left (as js-aruco returns them). size: black-square side in metres.
// f: focal length in px, (cx, cy): principal point. Returns camera position + rotation in the marker frame, or null.
export function planarPose(corners, f, cx, cy, size) {
  const h = size / 2;
  const model = [[-h, -h], [h, -h], [h, h], [-h, h]]; // (a: along marker x, b: along marker z)
  const A = [], B = [];
  for (let i = 0; i < 4; i++) {
    const [a, b] = model[i], u = (corners[i].x - cx) / f, v = (corners[i].y - cy) / f;
    A.push([a, b, 1, 0, 0, 0, -u * a, -u * b]); B.push(u);
    A.push([0, 0, 0, a, b, 1, -v * a, -v * b]); B.push(v);
  }
  const s = solve(A, B); if (!s) return null;
  const h1 = [s[0], s[3], s[6]], h2 = [s[1], s[4], s[7]], h3 = [s[2], s[5], 1];
  const lam = 2 / (norm(h1) + norm(h2));
  let r1 = scale(h1, lam), r2 = scale(h2, lam), t = scale(h3, lam);
  if (t[2] < 0) { r1 = scale(r1, -1); r2 = scale(r2, -1); t = scale(t, -1); }
  // orthonormalise
  const n1 = norm(r1); r1 = scale(r1, 1 / n1);
  const k = dot(r1, r2); r2 = [r2[0] - k * r1[0], r2[1] - k * r1[1], r2[2] - k * r1[2]]; r2 = scale(r2, 1 / norm(r2));
  const r3 = cross(r1, r2);
  // marker axes in OpenCV camera coords (x right, y down, z forward): X=r1, Y(up out of paper)=-r3, Z=r2
  const X = r1, Y = scale(r3, -1), Z = r2;
  // marker->camera(three) = diag(1,-1,-1) * [X Y Z | t]
  const C = (v) => [v[0], -v[1], -v[2]];
  const cX = C(X), cY = C(Y), cZ = C(Z), cT = C(t);
  // camera orientation in marker frame is the inverse rotation: rows of [cX cY cZ] become the camera axes expressed in marker coords
  // R_mc (camera->marker) columns = camera x,y,z axes in marker coords = rows of [cX cY cZ]^T... compute explicitly:
  const camX = [cX[0], cY[0], cZ[0]], camY = [cX[1], cY[1], cZ[1]], camZ = [cX[2], cY[2], cZ[2]];
  // camera position in marker frame: -R^T * t = -(cX*t.x + ... ) using marker->camera matrix M=[cX cY cZ]: p = -M^T cT
  const p = [-dot(cX, cT), -dot(cY, cT), -dot(cZ, cT)];
  return { pos: p, axes: [camX, camY, camZ], dist: norm(t) };
}


// ---- sub-pixel corner refinement: fit a line to each marker edge from intensity profiles, intersect adjacent lines
function sampleGray(g, w, h, x, y) {
  if (x < 0 || y < 0 || x >= w - 1 || y >= h - 1) return -1;
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * w + x0;
  return (g[i] * (1 - fx) + g[i + 1] * fx) * (1 - fy) + (g[i + w] * (1 - fx) + g[i + w + 1] * fx) * fy;
}
function fitLine(pts) { // total least squares -> point + unit direction
  let mx = 0, my = 0; for (const p of pts) { mx += p[0]; my += p[1]; } mx /= pts.length; my /= pts.length;
  let sxx = 0, sxy = 0, syy = 0; for (const p of pts) { const dx = p[0] - mx, dy = p[1] - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy); return { x: mx, y: my, dx: Math.cos(th), dy: Math.sin(th) };
}
function intersect(a, b) {
  const det = a.dx * b.dy - a.dy * b.dx; if (Math.abs(det) < 1e-6) return null;
  const t = ((b.x - a.x) * b.dy - (b.y - a.y) * b.dx) / det; return { x: a.x + a.dx * t, y: a.y + a.dy * t };
}
export function refineCorners(gray, w, h, corners) {
  const lines = [];
  for (let e = 0; e < 4; e++) {
    const A = corners[e], B = corners[(e + 1) % 4], ex = B.x - A.x, ey = B.y - A.y, len = Math.hypot(ex, ey);
    if (len < 24) return corners;
    const ux = ex / len, uy = ey / len; let nx = -uy, ny = ux; // normal; orient it away from the quad centre
    const cxm = (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4, cym = (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4;
    if ((A.x - cxm) * nx + (A.y - cym) * ny < 0) { nx = -nx; ny = -ny; }
    const R = Math.max(2.5, Math.min(5, len / 14)), pts = [], N = 14;
    for (let k = 0; k < N; k++) {
      const t = 0.14 + 0.72 * k / (N - 1), px = A.x + ex * t, py = A.y + ey * t;
      let prof = [], lo = 1e9, hi = -1e9;
      for (let o = -R; o <= R + 1e-6; o += 0.5) { const v = sampleGray(gray, w, h, px + nx * o, py + ny * o); if (v < 0) { prof = null; break; } prof.push(v); lo = Math.min(lo, v); hi = Math.max(hi, v); }
      if (!prof || hi - lo < 40) continue;
      const mid = (lo + hi) / 2; let pos = null;
      for (let i = 0; i < prof.length - 1; i++) { if (prof[i] < mid && prof[i + 1] >= mid) { pos = -R + 0.5 * (i + (mid - prof[i]) / (prof[i + 1] - prof[i])); } } // dark inside -> bright margin outside
      if (pos === null) continue;
      pts.push([px + nx * pos, py + ny * pos]);
    }
    if (pts.length < 6) return corners;
    lines.push(fitLine(pts));
  }
  const out = [];
  for (let i = 0; i < 4; i++) { const c = intersect(lines[(i + 3) % 4], lines[i]); if (!c || Math.hypot(c.x - corners[i].x, c.y - corners[i].y) > 6) return corners; out.push(c); }
  return out;
}

// Wraps the worker that runs the ArUco detector off the main thread.
export class MarkerTracker {
  constructor(video, { markerId = 0, size = 0.1, workerUrl = new URL('./markerworker.js', import.meta.url) } = {}) {
    this.video = video; this.markerId = markerId; this.size = size;
    this.worker = new Worker(workerUrl); this.busy = false; this.last = null; this.lastSeen = -1e9; this.canvas = document.createElement('canvas'); this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.fps = 0; this._t = 0; this.onPose = null; this.failed = false;
    this.worker.onmessage = (e) => {
      this.busy = false;
      const ms = e.data.markers || []; const m = ms.find((k) => k.id === this.markerId);
      if (!m) return;
      const W = e.data.w, Hh = e.data.h, f = Math.max(W, Hh) * 0.832; // ~62° across the long side
      const corners = this.gray && this.gw === W ? refineCorners(this.gray, W, Hh, m.corners) : m.corners;
      const pose = planarPose(corners, f, W / 2, Hh / 2, this.size);
      if (pose && isFinite(pose.pos[0]) && pose.dist > 0.05 && pose.dist < 8) { this.last = pose; this.lastSeen = performance.now(); if (this.onPose) this.onPose(pose); }
      const now = performance.now(); if (this._t) this.fps = 0.8 * this.fps + 0.2 * (1000 / (now - this._t)); this._t = now;
    };
    this.worker.onerror = () => { this.failed = true; this.busy = false; };
  }
  pump() {
    const v = this.video; if (this.busy || this.failed || !v.videoWidth) return;
    const nowT = performance.now(); if (nowT - (this.lastPump || 0) < 55) return; this.lastPump = nowT;
    const long = 960, k = long / Math.max(v.videoWidth, v.videoHeight), w = Math.round(v.videoWidth * k), h = Math.round(v.videoHeight * k);
    if (this.canvas.width !== w) { this.canvas.width = w; this.canvas.height = h; }
    this.ctx.drawImage(v, 0, 0, w, h);
    const img = this.ctx.getImageData(0, 0, w, h), d = img.data;
    if (!this.gray || this.gray.length !== w * h) this.gray = new Uint8Array(w * h);
    for (let i = 0, j = 0; j < this.gray.length; i += 4, j++) this.gray[j] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
    this.gw = w; this.gh = h;
    this.busy = true; this.worker.postMessage({ w, h, buf: d.buffer }, [d.buffer]);
  }
  seenRecently(ms = 700) { return performance.now() - this.lastSeen < ms; }
  stop() { this.worker.terminate(); }
}
