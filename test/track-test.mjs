// Renders a synthetic camera view of the marker from known poses, runs the real detector + planarPose and compares.
import { createRequire } from 'module';
import { planarPose, refineCorners } from '../src/marker.js';
const require = createRequire(import.meta.url);
const CV = require('../lib/aruco/cv.js').CV; const AR = require('../lib/aruco/aruco.js').AR;
const dict = new AR.Dictionary('ARUCO_MIP_36h12'); const code = dict.codeList[0];
const W = +(process.env.TW || 960), H = Math.round(W * 9 / 16), f = 0.832 * W, cx = W / 2, cy = H / 2, size = 0.1;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const nrm = (a) => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };

export function render(P, spinDeg = 0) {
  const zc = nrm(sub(P, [0, 0, 0])), xc = nrm(crs([0, 1, 0], zc)), yc = crs(zc, xc);
  const img = new Uint8ClampedArray(W * H * 4), sp = spinDeg * Math.PI / 180, cs = Math.cos(sp), sn = Math.sin(sp);
  const SS = 3;
  for (let v = 0; v < H; v++) for (let u = 0; u < W; u++) {
    let acc = 0;
    for (let a = 0; a < SS; a++) for (let b = 0; b < SS; b++) {
      const uu = u + (a + 0.5) / SS - 0.5, vv = v + (b + 0.5) / SS - 0.5;
      const dx = (uu - cx) / f, dy = (vv - cy) / f;
      const D = [dx * xc[0] - dy * yc[0] - zc[0], dx * xc[1] - dy * yc[1] - zc[1], dx * xc[2] - dy * yc[2] - zc[2]];
      let val = 120;
      if (D[1] < 0) {
        const s = -P[1] / D[1]; let X = P[0] + s * D[0], Z = P[2] + s * D[2];
        const X2 = X * cs - Z * sn, Z2 = X * sn + Z * cs; X = X2; Z = Z2;
        if (Math.abs(X) <= size * 0.625 && Math.abs(Z) <= size * 0.625) {
          val = 235;
          if (Math.abs(X) <= size / 2 && Math.abs(Z) <= size / 2) {
            const gx = Math.min(7, Math.floor((X / size + 0.5) * 8)), gy = Math.min(7, Math.floor((Z / size + 0.5) * 8));
            if (gx === 0 || gx === 7 || gy === 0 || gy === 7) val = 25; else val = code[(gy - 1) * 6 + (gx - 1)] === '1' ? 235 : 25;
          }
        }
      }
      acc += val;
    }
    const i = (v * W + u) * 4; img[i] = img[i + 1] = img[i + 2] = acc / (SS * SS); img[i + 3] = 255;
  }
  return { img, xc, yc, zc };
}
if (process.argv[1] && process.argv[1].endsWith('track-test.mjs')) {
  const det = new AR.Detector({ dictionaryName: 'ARUCO_MIP_36h12', maxHammingDistance: 6 });
  const cases = [[0.1, 0.5, 0.7, 0], [-0.4, 0.45, 0.5, 30], [0.5, 0.6, -0.3, 200], [0, 0.9, 0.2, 90], [0.7, 0.35, 0.7, 330], [-0.2, 0.3, 0.5, 10]];
  let worst = 0, worstAng = 0, found = 0;
  for (const [x, y, z, spin] of cases) {
    const P = [x, y, z], { img, xc, yc, zc } = render(P, spin);
    const t0 = Date.now(); const ms = det.detect({ width: W, height: H, data: img }); const dt = Date.now() - t0;
    const m = ms.find((k) => k.id === 0);
    if (!m) { console.log('P', P, 'spin', spin, 'NOT FOUND', dt + 'ms'); continue; }
    found++;
    const gray = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) gray[i] = img[i * 4];
    const pose = planarPose(process.env.NOREFINE ? m.corners : refineCorners(gray, W, H, m.corners), f, cx, cy, size);
    // the marker was spun by `spin` on the table, which is equivalent to the camera orbiting the opposite way; compare in the spun frame
    const sp = spin * Math.PI / 180, c = Math.cos(sp), s = Math.sin(sp);
    const expPos = [P[0] * c - P[2] * s, P[1], P[0] * s + P[2] * c];
    const err = Math.hypot(pose.pos[0] - expPos[0], pose.pos[1] - expPos[1], pose.pos[2] - expPos[2]);
    const rot = (a) => [a[0] * c - a[2] * s, a[1], a[0] * s + a[2] * c];
    const ax = [rot(xc), rot(yc), rot(zc)];
    let ang = 0; for (let i = 0; i < 3; i++) ang = Math.max(ang, Math.acos(Math.min(1, dot(pose.axes[i], ax[i]))) * 180 / Math.PI);
    worst = Math.max(worst, err); worstAng = Math.max(worstAng, ang);
    console.log('cam', P.map((v) => v.toFixed(2)).join(','), 'spin', spin, '-> pos err', (err * 1000).toFixed(1) + 'mm', 'axis err', ang.toFixed(2) + '°', 'detect', dt + 'ms');
  }
  console.log(found === cases.length && worst < 0.03 && worstAng < 5 ? 'TRACK OK' : 'TRACK PROBLEM', 'worst', (worst * 1000).toFixed(1) + 'mm', worstAng.toFixed(2) + '°');
}
