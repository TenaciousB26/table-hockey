import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/RoomEnvironment.js';
import { Game, RINK, TEAMS } from './sim.js';
import { buildRink, roundRect } from './rink.js';
import { ActorSet } from './actors.js';
import { Particles, PuckTrail } from './fx.js';
import { Sound } from './audio.js';
import { Jumbotron, ReplaySystem, CAM_ORDER, helmetPose, povTarget } from './jumbotron.js';

const $ = (id) => document.getElementById(id);
const ui = $('ui'), menu = $('menu'), bar = $('bar'), more = $('more'), hint = $('hint'), statusEl = $('status'), povEl = $('pov'), video = $('cam');
const qs = new URLSearchParams(location.search);

// ------------------------------------------------------------------ renderer / scene
const renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.xr.enabled = true;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.02, 60);

let S = 0.0146; // metres of real space per rink-metre (rink is 61 m long -> ~0.9 m on your table)

// ------------------------------------------------------------------ game + rink
const game = new Game({ periodReal: +(qs.get('period') || 150), seed: qs.get('seed') ? +qs.get('seed') : null });
const rinkRoot = new THREE.Group(); scene.add(rinkRoot);
const rink = buildRink(game, { maxAniso: renderer.capabilities.getMaxAnisotropy() });
rinkRoot.add(rink.group);
const actors = new ActorSet(rinkRoot, game, { labels: true });
const mirror = new THREE.Group(); mirror.scale.set(1, -1, 1); rinkRoot.add(mirror);
const mirrorActors = new ActorSet(mirror, game, { labels: false });
const fxRoot = new THREE.Group(); rinkRoot.add(fxRoot);
const sparks = new Particles(fxRoot, { max: 900, size: 0.28 });
const spray = new Particles(fxRoot, { max: 700, size: 0.34 });
const confetti = new Particles(fxRoot, { max: 500, size: 0.42 });
const particleSets = [sparks, spray, confetti];
const trail = new PuckTrail(fxRoot);
const jumbo = new Jumbotron(game); rinkRoot.add(jumbo.group);
let jumboY = 36; jumbo.group.position.y = jumboY;
const replay = new ReplaySystem(game, rinkRoot, ActorSet, PuckTrail, actors);
const ARENA_BG = new THREE.Color(0x0a1020);

const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(-18, 70, 30); sun.castShadow = true; rinkRoot.add(sun); rinkRoot.add(sun.target);
const fill = new THREE.HemisphereLight(0xcfe3ff, 0x1a2540, 0.55); rinkRoot.add(fill);

// banner sprite (GOAL!, FIGHT!, PENALTY ...)
const bn = { canvas: document.createElement('canvas'), t: 0, dur: 0, shake: false, big: false };
bn.canvas.width = 1280; bn.canvas.height = 330;
bn.tex = new THREE.CanvasTexture(bn.canvas); bn.tex.colorSpace = THREE.SRGBColorSpace;
bn.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: bn.tex, transparent: true, depthTest: false, depthWrite: false, opacity: 0 }));
bn.sprite.position.set(0, 15, 0); bn.sprite.scale.set(30, 7.7, 1); bn.sprite.renderOrder = 50; rinkRoot.add(bn.sprite);
function showBanner(text, sub, color, dur, big, shake) {
  const c = bn.canvas.getContext('2d'), w = bn.canvas.width, h = bn.canvas.height;
  c.clearRect(0, 0, w, h);
  c.fillStyle = 'rgba(6,10,20,0.62)'; roundRect(c, 30, 30, w - 60, h - 60, 46); c.fill();
  c.lineWidth = 8; c.strokeStyle = color || '#fff'; roundRect(c, 30, 30, w - 60, h - 60, 46); c.stroke();
  c.textAlign = 'center'; c.textBaseline = 'middle';
  const fs = text.length > 14 ? 92 : 128;
  c.font = `900 ${fs}px Impact, "Arial Black", sans-serif`; c.lineWidth = 14; c.strokeStyle = '#000'; c.strokeText(text, w / 2, sub ? 128 : 165);
  c.fillStyle = color || '#fff'; c.fillText(text, w / 2, sub ? 128 : 165);
  if (sub) { c.font = '700 54px Arial, sans-serif'; c.fillStyle = '#fff'; c.fillText(sub, w / 2, 235); }
  bn.tex.needsUpdate = true; bn.t = 0; bn.dur = dur; bn.shake = !!shake; bn.big = !!big;
}

// placement reticle (WebXR hit-test)
const reticle = new THREE.Group(); reticle.matrixAutoUpdate = false; reticle.visible = false; scene.add(reticle);
reticle.add(new THREE.Mesh(new THREE.RingGeometry(0.10, 0.125, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffb02e })));
reticle.add(new THREE.Mesh(new THREE.RingGeometry(0.02, 0.035, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff })));

// ------------------------------------------------------------------ state
let mode = 'menu';            // menu | preview | ar (WebXR) | vr | camar (camera + gyro, iPhone)
let locked = false, running = true, paused = false, speed = 1, bcast = false;
let session = null, hitSource = null, lastHitMatrix = null, hasHit = false;
const anchor = new THREE.Vector3(0, 0, 0); let lift = 0, yaw = 0, camDist = 1.0;
const pov = { on: false, id: -1, prevMode: 'auto' };
const sound = new Sound();
const clock = new THREE.Clock();
const H = 1 / 120;
let acc = 0, trailAcc = 0, frameN = 0, tNow = 0, excite = 0.15, flash = 0;
const prevSpeed = new Map();
const tmpV = new THREE.Vector3(), tmpD = new THREE.Vector3();
const isXR = () => renderer.xr.isPresenting;

function applyPlacement() { rinkRoot.position.set(anchor.x, anchor.y + lift, anchor.z); rinkRoot.rotation.y = yaw; rinkRoot.scale.setScalar(S); }
function applyScale() {
  const cam = sun.shadow.camera; const h = isXR() ? 1024 : 2048;
  cam.left = -40 * S; cam.right = 40 * S; cam.top = 21 * S; cam.bottom = -21 * S; cam.near = 5 * S; cam.far = 140 * S; cam.updateProjectionMatrix();
  sun.shadow.mapSize.set(h, h); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.08 * S;
  if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  for (const p of particleSets) p.points.material.size = p.baseSize * S;
  camera.near = Math.max(0.005, 0.3 * S);
  applyPlacement();
}
function setQuality(light) {
  mirror.visible = !light || qs.get('mirror') === '1'; sun.castShadow = !light || qs.get('shadows') === '1';
  actors.setLowFx(light && !sun.castShadow);
}

// world-space hint (Quest Browser has no DOM overlay, so the prompt also floats in front of the viewer)
const wh = { canvas: document.createElement('canvas') }; wh.canvas.width = 1024; wh.canvas.height = 150;
wh.tex = new THREE.CanvasTexture(wh.canvas); wh.tex.colorSpace = THREE.SRGBColorSpace;
wh.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: wh.tex, transparent: true, depthTest: false, depthWrite: false })); wh.sprite.scale.set(0.64, 0.094, 1); wh.sprite.renderOrder = 60; wh.sprite.visible = false; scene.add(wh.sprite);
let hintTimer = 0;
function setHint(t, ms = 0) {
  hint.textContent = t; hint.hidden = !t; wh.text = t;
  clearTimeout(hintTimer); if (t && ms) hintTimer = setTimeout(() => setHint(''), ms);
  if (t) {
    const c = wh.canvas.getContext('2d'), w = wh.canvas.width, h = wh.canvas.height; c.clearRect(0, 0, w, h);
    c.fillStyle = 'rgba(8,14,28,0.82)'; roundRect(c, 4, 4, w - 8, h - 8, 36); c.fill(); c.strokeStyle = '#ffb02e'; c.lineWidth = 5; roundRect(c, 4, 4, w - 8, h - 8, 36); c.stroke();
    c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = '700 40px Arial, sans-serif';
    const words = t.split(' '); let l1 = '', l2 = ''; for (const wd of words) { if ((l1 + wd).length < 36 && !l2) l1 += wd + ' '; else l2 += wd + ' '; }
    if (l2) { c.fillText(l1.trim(), w / 2, 48); c.fillText(l2.trim(), w / 2, 100); } else c.fillText(l1.trim(), w / 2, h / 2);
    wh.tex.needsUpdate = true;
  }
}

function setMode(m) {
  mode = m;
  document.body.dataset.mode = m;
  menu.hidden = m !== 'menu';
  bar.hidden = m === 'menu';
  for (const el of document.querySelectorAll('[data-m]')) el.hidden = !el.dataset.m.split(' ').includes(m);
  reticle.visible = false; hasHit = false;
  setQuality(m === 'ar' || m === 'vr' || m === 'camar');
  if (m === 'preview' || m === 'menu') { anchor.set(0, 0, 0); lift = 0; yaw = 0; locked = true; controls.enabled = !bcast && !pov.on; }
  if (m === 'vr') { anchor.set(0, 1.0, -0.95); lift = 0; yaw = 0; locked = true; }
  if (m === 'ar' || m === 'camar') { locked = false; lift = m === 'camar' ? -0.1 : 0; camDist = 1.0; }
  updateLockButton();
  applyScale(); fitCamera();
  if (m === 'ar') setHint('Aim at your table (or the air) · tap or press Lock to pin the rink there');
  else if (m === 'camar') setHint('Aim the phone where the rink should be, then tap Lock. Turn on the spot; the phone can’t track walking.');
  else setHint('');
}
function updateLockButton() { const b = document.querySelector('[data-act=lock]'); if (b) { b.textContent = locked ? '🔒 Locked' : '📌 Lock in place'; b.classList.toggle('on', locked); } }

// ------------------------------------------------------------------ preview controls (desktop / fallback)
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.04, 0); controls.enableDamping = true; controls.minDistance = 0.25; controls.maxDistance = 4; controls.maxPolarAngle = Math.PI * 0.495;
camera.position.set(0.12, 0.72, 1.18); controls.update();
const savedView = { pos: new THREE.Vector3(), tgt: new THREE.Vector3() };

function fitCamera() {
  camera.aspect = innerWidth / innerHeight;
  if (!isXR()) {
    if (mode === 'camar') camera.fov = camera.aspect < 1 ? 62 : 2 * Math.atan(Math.tan(31 * Math.PI / 180) / camera.aspect) * 180 / Math.PI; // phone back camera ≈ 62°
    else if (pov.on) camera.fov = 80;
    else camera.fov = camera.aspect < 1 ? Math.min(105, 2 * Math.atan(Math.tan(25 * Math.PI / 180) / camera.aspect) * 180 / Math.PI) : 50;
  }
  camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', fitCamera);

// ------------------------------------------------------------------ UI actions
const LABEL_NAMES = ['names', 'numbers', 'off'], SPEEDS = [0.5, 1, 2, 4];
const btn = (a) => document.querySelector(`[data-act=${a}]`);
function povIds() { return [-1].concat(game.players.filter((p) => p.onIce || p.box).map((p) => p.id)); }
function setPov(on) {
  pov.on = on; povEl.hidden = !on; document.body.classList.toggle('pov', on);
  const b = btn('helmet'); if (b) b.classList.toggle('on', on);
  if (isXR()) { if (on) { pov.prevMode = jumbo.mode; jumbo.mode = 'helmet'; } else jumbo.mode = pov.prevMode || 'auto'; jumbo.povId = pov.id; jumbo.snap = true; setHint(on ? 'Helmet cam is on the jumbotron · use ◀ ▶ (or tap Helmet) to change player' : '', 3500); return; }
  if (on) { savedView.pos.copy(camera.position); savedView.tgt.copy(controls.target); controls.enabled = false; }
  else { camera.position.copy(savedView.pos); controls.target.copy(savedView.tgt); controls.enabled = !bcast; if (mode === 'preview' || mode === 'menu') controls.update(); }
  fitCamera();
}
function povStep(d) {
  const ids = povIds(); let i = ids.indexOf(pov.id); i = (i + d + ids.length) % ids.length; pov.id = ids[i]; jumbo.povId = pov.id; jumbo.snap = true;
  if (!pov.on) setPov(true);
}
function act(a) {
  sound.init();
  if (a === 'more') { more.hidden = !more.hidden; btn('more').classList.toggle('on', !more.hidden); }
  else if (a === 'lock') { locked = !locked; updateLockButton(); if (locked) setHint('Locked in place. Size, Height and Rotate still adjust it.', 3500); else setHint('Aim again, then Lock.', 2500); }
  else if (a === 'labels') { const m = (actors.labelMode + 1) % 3; actors.setLabelMode(m); btn('labels').textContent = 'Labels: ' + LABEL_NAMES[m]; }
  else if (a === 'speed') { speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]; btn('speed').textContent = `Speed ${speed}×`; }
  else if (a === 'sound') { sound.setMuted(!sound.muted); btn('sound').textContent = sound.muted ? 'Sound off' : 'Sound on'; }
  else if (a === 'cam') { bcast = !bcast; controls.enabled = !bcast && !pov.on; btn('cam').classList.toggle('on', bcast); }
  else if (a === 'bigger') { S = Math.min(0.06, S * 1.1); applyScale(); }
  else if (a === 'smaller') { S = Math.max(0.003, S / 1.1); applyScale(); }
  else if (a === 'up') lift += Math.max(0.01, S * 2.2);
  else if (a === 'down') lift -= Math.max(0.01, S * 2.2);
  else if (a === 'near') camDist = Math.max(0.3, camDist - 0.1);
  else if (a === 'far') camDist = Math.min(4, camDist + 0.1);
  else if (a === 'rotate') yaw += Math.PI / 12;
  else if (a === 'newgame') { game.newGame(); rink.clearScratch(); trail.clear(); replay.stop(); }
  else if (a === 'pause') paused = !paused;
  else if (a === 'replay') replay.trigger('manual');
  else if (a === 'boardup') { jumboY = Math.min(110, jumboY + 4); jumbo.group.position.y = jumboY; }
  else if (a === 'boarddown') { jumboY = Math.max(14, jumboY - 4); jumbo.group.position.y = jumboY; }
  else if (a === 'board') { jumbo.group.visible = !jumbo.group.visible; btn('board').textContent = jumbo.group.visible ? 'Jumbotron on' : 'Jumbotron off'; }
  else if (a === 'scam') { const i = (CAM_ORDER.indexOf(jumbo.mode) + 1) % CAM_ORDER.length; jumbo.mode = CAM_ORDER[i]; jumbo.snap = true; btn('scam').textContent = 'Screen: ' + jumbo.mode; }
  else if (a === 'helmet') setPov(!pov.on);
  else if (a === 'hnext') povStep(1);
  else if (a === 'hprev') povStep(-1);
  else if (a === 'hauto') { pov.id = -1; jumbo.povId = -1; }
  else if (a === 'exit') { if (session) session.end(); else if (mode === 'camar') stopCamAR(); }
  if (a === 'bigger' || a === 'smaller' || a === 'up' || a === 'down' || a === 'rotate') applyPlacement();
}
ui.addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b) act(b.dataset.act); });
for (const el of [bar, hint, povEl]) el.addEventListener('beforexrselect', (e) => e.preventDefault());
addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'l') act('labels'); else if (k === 'c') act('cam'); else if (k === ' ') { e.preventDefault(); act('pause'); }
  else if (k === 's') act('sound'); else if (k === 'r') act('newgame'); else if (k === 'p') act('replay'); else if (k === 'j') act('board'); else if (k === 'v') act('scam');
  else if (k === 'h') act('helmet'); else if (k === 'n') act('hnext'); else if (k === 'b') act('hprev'); else if (k === 'k') act('lock');
  else if (k === ']') act('boardup'); else if (k === '[') act('boarddown');
  else if (k === '1') speed = 0.5; else if (k === '2') speed = 1; else if (k === '3') speed = 2;
  else if (k === '=' || k === '+') act('bigger'); else if (k === '-') act('smaller');
  btn('speed').textContent = `Speed ${speed}×`;
});

// tap a player to see through their helmet (on-screen modes)
const ptr = { down: null, pts: new Map(), pinch: 0 };
renderer.domElement.addEventListener('pointerdown', (e) => { ptr.pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); ptr.down = ptr.pts.size === 1 ? { x: e.clientX, y: e.clientY, t: performance.now() } : null; if (ptr.pts.size === 2) { const [a, b] = [...ptr.pts.values()]; ptr.pinch = Math.hypot(a.x - b.x, a.y - b.y); } });
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!ptr.pts.has(e.pointerId)) return; ptr.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (mode === 'camar' && ptr.pts.size === 2 && ptr.pinch) { const [a, b] = [...ptr.pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); S = THREE.MathUtils.clamp(S * (d / ptr.pinch), 0.003, 0.06); ptr.pinch = d; applyScale(); }
  else if (mode === 'camar' && !cam.got && ptr.pts.size === 1 && ptr.down) { cam.dyaw -= (e.movementX || 0) * 0.005; cam.dpitch = THREE.MathUtils.clamp(cam.dpitch - (e.movementY || 0) * 0.005, -1.5, 1.5); }
});
const endPtr = (e) => {
  const d = ptr.down; ptr.pts.delete(e.pointerId); if (ptr.pts.size < 2) ptr.pinch = 0;
  if (d && ptr.pts.size === 0 && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 8 && performance.now() - d.t < 450 && !isXR() && !pov.on) pickPlayer(e.clientX, e.clientY);
  if (ptr.pts.size === 0) ptr.down = null;
};
renderer.domElement.addEventListener('pointerup', endPtr); renderer.domElement.addEventListener('pointercancel', endPtr);
function pickPlayer(cx, cy) {
  let best = null, bd = 56;
  for (const p of game.players) {
    if (!p.onIce && !p.box) continue;
    tmpV.set(p.x, 2.4, p.y); rinkRoot.localToWorld(tmpV); tmpV.project(camera); if (tmpV.z > 1) continue;
    const d = Math.hypot((tmpV.x * 0.5 + 0.5) * innerWidth - cx, (-tmpV.y * 0.5 + 0.5) * innerHeight - cy);
    if (d < bd) { bd = d; best = p; }
  }
  if (best) { pov.id = best.id; jumbo.povId = best.id; setPov(true); }
}

// ------------------------------------------------------------------ camera AR (iPhone & any phone): camera feed + gyro
const cam = { stream: null, o: null, got: false, dyaw: 0, dpitch: 0, has: false };
const _e = new THREE.Euler(), _q0 = new THREE.Quaternion(), _q1 = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2), _z = new THREE.Vector3(0, 0, 1);
const onOrient = (e) => { if (e.alpha == null) return; cam.got = true; cam.o = { a: e.alpha * Math.PI / 180, b: e.beta * Math.PI / 180, g: e.gamma * Math.PI / 180 }; };
async function startCamAR() {
  sound.init();
  try { if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') { const r = await DeviceOrientationEvent.requestPermission(); if (r !== 'granted') statusEl.textContent = 'Motion access denied — drag to look around instead'; } } catch (e) { statusEl.textContent = 'Motion sensors unavailable — drag to look around'; }
  addEventListener('deviceorientation', onOrient, true);
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('Camera needs https (or this browser blocks it)');
    cam.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
    video.srcObject = cam.stream; await video.play(); document.body.classList.add('camfeed');
  } catch (e) { statusEl.textContent = 'No camera: ' + (e.message || e.name) + ' — showing the rink on black'; }
  cam.has = false; cam.dyaw = 0; cam.dpitch = 0; camera.position.set(0, 0, 0);
  setMode('camar');
}
function stopCamAR() {
  removeEventListener('deviceorientation', onOrient, true);
  if (cam.stream) for (const t of cam.stream.getTracks()) t.stop();
  cam.stream = null; video.srcObject = null; document.body.classList.remove('camfeed'); cam.got = false;
  if (pov.on) setPov(false);
  camera.position.set(0.12, 0.72, 1.18); controls.target.set(0, 0.04, 0); setMode('menu'); controls.update();
}
function updateCamAR() {
  camera.position.set(0, 0, 0);
  if (cam.got && cam.o) {
    const orient = ((screen.orientation && screen.orientation.angle) || window.orientation || 0) * Math.PI / 180;
    _e.set(cam.o.b, cam.o.a, -cam.o.g, 'YXZ'); const q = new THREE.Quaternion().setFromEuler(_e); q.multiply(_q1); q.multiply(_q0.setFromAxisAngle(_z, -orient));
    if (!cam.has) { camera.quaternion.copy(q); cam.has = true; } else camera.quaternion.slerp(q, 0.4);
  } else { camera.rotation.set(cam.dpitch, cam.dyaw, 0, 'YXZ'); }
}

// ------------------------------------------------------------------ WebXR (Android Chrome, Quest)
async function supports(m) { try { return !!navigator.xr && await navigator.xr.isSessionSupported(m); } catch (e) { return false; } }
(async () => {
  const [ar, vr] = await Promise.all([supports('immersive-ar'), supports('immersive-vr')]);
  const bAR = $('btnAR'), bVR = $('btnVR'), bCam = $('btnCam');
  bAR.disabled = !ar; bVR.disabled = !vr;
  bAR.textContent = ar ? 'Enter AR (surface tracking)' : 'WebXR AR: not on this device';
  const camOk = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext && window.top === window.self;
  bCam.disabled = !camOk;
  if (!camOk) bCam.textContent = 'Camera AR: open the standalone https link';
  statusEl.textContent = ar ? 'AR ready' : (camOk ? 'Camera AR ready' : '');
  bAR.onclick = () => startXR('immersive-ar'); bVR.onclick = () => startXR('immersive-vr'); bCam.onclick = startCamAR;
})();
$('btnPreview').onclick = () => { sound.init(); setMode('preview'); };

async function startXR(m) {
  sound.init();
  try {
    const init = m === 'immersive-ar'
      ? { requiredFeatures: ['hit-test'], optionalFeatures: ['dom-overlay', 'local-floor'], domOverlay: { root: ui } }
      : { optionalFeatures: ['local-floor', 'bounded-floor'] };
    session = await navigator.xr.requestSession(m, init);
  } catch (e) { statusEl.textContent = 'Could not start ' + m + ': ' + (e.message || e); return; }
  renderer.xr.setReferenceSpaceType(m === 'immersive-ar' ? 'local' : 'local-floor');
  await renderer.xr.setSession(session);
  setMode(m === 'immersive-ar' ? 'ar' : 'vr');
  if (m === 'immersive-ar') { const viewer = await session.requestReferenceSpace('viewer'); hitSource = await session.requestHitTestSource({ space: viewer }); }
  session.addEventListener('end', () => {
    hitSource = null; session = null; reticle.visible = false; if (pov.on) setPov(false);
    S = 0.0146; camera.position.set(0.12, 0.72, 1.18); controls.target.set(0, 0.04, 0); setMode('menu'); controls.update();
  });
}
for (const i of [0, 1]) {
  const c = renderer.xr.getController(i); scene.add(c);
  c.addEventListener('select', () => { if (mode === 'ar') act('lock'); });
  c.addEventListener('squeeze', () => { if (mode === 'ar') act('lock'); });
}
const padEdge = { a: false, b: false };
function pollPads(dt) {
  if (!session) return;
  for (const src of session.inputSources) {
    const gp = src.gamepad; if (!gp) continue;
    const x = gp.axes[2] || 0, y = gp.axes[3] || 0;
    if (src.handedness === 'right') { if (Math.abs(y) > 0.35) lift -= y * dt * 0.35; if (Math.abs(x) > 0.35) yaw -= x * dt * 1.4; }
    else { if (Math.abs(y) > 0.35) { S = THREE.MathUtils.clamp(S * (1 - y * dt * 0.9), 0.003, 0.06); applyScale(); } if (Math.abs(x) > 0.35) yaw -= x * dt * 1.4; }
    const a = gp.buttons[4] && gp.buttons[4].pressed, b = gp.buttons[5] && gp.buttons[5].pressed;
    if (a && !padEdge.a && mode === 'ar') act('lock'); if (b && !padEdge.b) act('helmet');
    padEdge.a = !!a; padEdge.b = !!b;
  }
}

// aim the rink at the view centre while unlocked
function aimPlacement(xrFrame) {
  camera.getWorldPosition(tmpV); camera.getWorldDirection(tmpD);
  if (mode === 'ar') {
    if (xrFrame && hitSource) {
      const res = xrFrame.getHitTestResults(hitSource);
      if (res.length) { const pose = res[0].getPose(renderer.xr.getReferenceSpace()); if (pose) { reticle.matrix.fromArray(pose.transform.matrix); lastHitMatrix = reticle.matrix.clone(); hasHit = true; } } else hasHit = false;
    }
    if (hasHit && lastHitMatrix) { anchor.setFromMatrixPosition(lastHitMatrix); reticle.visible = true; }
    else { anchor.copy(tmpV).addScaledVector(tmpD, 0.9); anchor.y = tmpV.y - 0.25; reticle.visible = false; }
  } else if (mode === 'camar') { anchor.copy(tmpV).addScaledVector(tmpD, camDist); }
  const hx = tmpD.x, hz = tmpD.z;
  if (Math.hypot(hx, hz) > 0.25) yaw = Math.atan2(-hx, -hz); // rink's near side faces the viewer
}

// ------------------------------------------------------------------ effects from game events
function burstSpray(x, y, z, n, spd, dx = 0, dy = 0, col = [0.85, 0.95, 1]) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.283, s = spd * (0.3 + Math.random());
    spray.emit(x, z, y, Math.cos(a) * s + dx * spd * 0.4, 1.2 + Math.random() * spd * 0.35, Math.sin(a) * s + dy * spd * 0.4, 0.5 + Math.random() * 0.5, col[0], col[1], col[2], -9);
  }
}
function burstSparks(x, y, z, n, spd, col) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.283, e = Math.random() * 3.14 - 0.3, s = spd * (0.4 + Math.random());
    sparks.emit(x, z, y, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s + 1, Math.sin(a) * Math.cos(e) * s, 0.35 + Math.random() * 0.5, col[0], col[1], col[2], -6);
  }
}
function handleEvents(list) {
  for (const e of list) {
    const pk = game.puck;
    switch (e.type) {
      case 'banner': showBanner(e.text, e.sub, e.color, e.dur, e.big, e.shake); jumbo.tickerSet(e.text, e.sub); break;
      case 'newgame': actors.rebuild(); mirrorActors.rebuild(); replay.rebuild(); trail.clear(); break;
      case 'shot': case 'slap': {
        const slap = e.type === 'slap'; sound.shot(e.power, slap); excite = Math.min(1, excite + 0.25);
        burstSpray(e.p.x, e.p.y, 0.2, slap ? 22 : 10, slap ? 7 : 4, Math.cos(e.p.h), Math.sin(e.p.h));
        if (slap) burstSparks(pk.x, pk.y, 0.5, 26, 9, [0.5, 0.9, 1]);
        break;
      }
      case 'windup': sound.tone(300, 0.5, 'sawtooth', 0.05, 900); break;
      case 'pass': sound.pass(); break;
      case 'tink': case 'stick': sound.tink(); break;
      case 'board': sound.board(e.power, e.glass); burstSpray(e.x, e.y, Math.min(e.z, 1.2), Math.min(14, 3 + e.power * 0.5), 3, 0, 0); if (e.power > 10) excite = Math.min(1, excite + 0.1); break;
      case 'net': rink.netHit(e.end, e.x, e.y, e.z, e.power); sound.net(e.power); break;
      case 'hit': sound.hit(e.power); burstSpray(e.x, e.y, 0.3, 24, 6 * e.power + 2, 0, 0); burstSparks(e.x, e.y, 1, 8, 4, [1, 0.9, 0.7]); excite = Math.min(1, excite + 0.2); break;
      case 'punch': sound.punch(); burstSparks(e.p.x + Math.cos(e.p.h) * 0.7, e.p.y + Math.sin(e.p.h) * 0.7, 1.6, 5, 3, [1, 0.6, 0.4]); break;
      case 'fight': excite = 1; sound.cheer(); replay.trigger('fight'); break;
      case 'post': sound.post(); burstSparks(e.x, e.y, e.z, 30, 8, [1, 0.95, 0.7]); excite = Math.min(1, excite + 0.3); break;
      case 'save': sound.save(); burstSpray(e.x, e.y, 0.5, 20, 6, 0, 0); excite = Math.min(1, excite + 0.2); break;
      case 'whistle': sound.whistle(); break;
      case 'horn': sound.horn(); break;
      case 'drop': sound.drop(); trail.clear(); break;
      case 'goal': {
        sound.horn(); sound.cheer(); excite = 1; replay.trigger('goal', { end: e.end });
        const gx = e.end * RINK.goalX, col = TEAMS[e.team].jersey;
        const c = [((col >> 16) & 255) / 255, ((col >> 8) & 255) / 255, (col & 255) / 255];
        for (let i = 0; i < 260; i++) {
          const a = Math.random() * 6.283, s = 4 + Math.random() * 12, cc = Math.random() < 0.5 ? c : [1, 0.85, 0.3];
          confetti.emit(gx, 3, 0, Math.cos(a) * s, 8 + Math.random() * 10, Math.sin(a) * s, 1.6 + Math.random() * 1.6, cc[0], cc[1], cc[2], -9);
        }
        burstSparks(gx, 0, 1, 60, 12, [1, 0.8, 0.4]);
        flash = 1; break;
      }
    }
  }
}

// ------------------------------------------------------------------ jumbotron screen pass
function renderJumbotron(dt) {
  if (!jumbo.group.visible) return;
  const every = isXR() || mode === 'camar' ? 3 : 2;
  if (frameN % every !== 0) return;
  const d = dt * every, rp = replay.view();
  jumbo.aim(rinkRoot, replay, d, S); jumbo.updateGraphics();
  const sv = { jg: jumbo.group.visible, bn: bn.sprite.visible, mi: mirror.visible, ac: actors.group.visible, re: reticle.visible, wh: wh.sprite.visible,
    fx: particleSets.map((p) => p.points.visible), tr: trail.layers.map((l) => l[0].visible), rg: replay.group.visible, bg: scene.background };
  jumbo.group.visible = false; bn.sprite.visible = false; mirror.visible = false; reticle.visible = false; wh.sprite.visible = false;
  if (rp.playing) {
    actors.group.visible = false; particleSets.forEach((p) => { p.points.visible = false; }); trail.layers.forEach((l) => { l[0].visible = false; });
    replay.group.visible = true; replay.actors.setLabelMode(actors.labelMode); replay.sync(d, tNow);
  }
  scene.background = ARENA_BG;
  const cur = renderer.getRenderTarget(), xr = renderer.xr.enabled, sa = renderer.shadowMap.autoUpdate;
  renderer.xr.enabled = false; renderer.shadowMap.autoUpdate = false;
  renderer.setRenderTarget(jumbo.rt); renderer.state.buffers.depth.setMask(true); renderer.clear();
  renderer.render(scene, jumbo.cam);
  renderer.xr.enabled = xr; renderer.shadowMap.autoUpdate = sa; renderer.setRenderTarget(cur);
  jumbo.group.visible = sv.jg; bn.sprite.visible = sv.bn; mirror.visible = sv.mi; actors.group.visible = sv.ac; reticle.visible = sv.re; wh.sprite.visible = sv.wh;
  particleSets.forEach((p, i) => { p.points.visible = sv.fx[i]; }); trail.layers.forEach((l, i) => { l[0].visible = sv.tr[i]; });
  replay.group.visible = sv.rg; scene.background = sv.bg;
}

// ------------------------------------------------------------------ frame
const povPos = new THREE.Vector3(), povTgt = new THREE.Vector3(); let povInit = false;
function frame(_t, xrFrame) {
  const dt = Math.min(0.05, clock.getDelta()); tNow += dt; frameN++;
  if (mode === 'camar' && !pov.on) updateCamAR();
  if ((mode === 'ar' || mode === 'camar') && !locked) aimPlacement(xrFrame);
  pollPads(dt);
  applyPlacement();
  wh.sprite.visible = !!wh.text && isXR();
  if (wh.sprite.visible) { camera.getWorldPosition(tmpV); camera.getWorldDirection(tmpD); wh.sprite.position.copy(tmpV).addScaledVector(tmpD, 0.85); wh.sprite.position.y -= 0.2; }

  let advanced = false;
  if (running && !paused) {
    acc += dt * speed; let n = 0; advanced = true;
    while (acc >= H && n < 10) { game.step(H); replay.tick(H); acc -= H; n++; }
    if (n === 10) acc = 0;
    handleEvents(game.drainEvents());
  }
  if (frameN % 2 === 0) {
    for (const p of game.players) {
      if (!p.onIce || p.box || p.isG) continue;
      const sp = Math.hypot(p.vx, p.vy); rink.scratchSkater(p, sp);
      const pv = prevSpeed.get(p.id) || 0;
      if (pv - sp > 3.2 && pv > 6) { rink.stopScratch(p, Math.min(1.5, (pv - sp) / 6)); burstSpray(p.x, p.y, 0.2, 14, 4, -Math.cos(p.h), -Math.sin(p.h)); }
      prevSpeed.set(p.id, sp);
    }
  }
  const pk = game.puck, psp = Math.hypot(pk.vx, pk.vy);
  if (advanced) trailAcc += dt * Math.min(speed, 1.5);
  while (trailAcc > 1 / 90) { trailAcc -= 1 / 90; trail.push(pk.x, pk.y, pk.z, pk.carrier ? 0 : psp, pk.shotType === 'slap'); }
  if (!pk.carrier && psp > 27) { const col = pk.shotType === 'slap' ? [0.5, 0.9, 1] : [1, 0.7, 0.3]; for (let i = 0; i < 2; i++) sparks.emit(pk.x + (Math.random() - 0.5) * 0.3, pk.z, pk.y + (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2, 0.35, col[0], col[1], col[2], -3); }

  excite = Math.max(0.12, excite - dt * 0.12); if (frameN % 20 === 0) sound.setCrowd(excite);
  flash = Math.max(0, flash - dt * 1.2); fill.intensity = 0.55 + flash * 1.4;

  actors.povId = pov.on && !isXR() ? povTarget(game, pov.id).id : -1;
  actors.update(dt, tNow); if (mirror.visible) mirrorActors.update(dt, tNow);
  for (const p of particleSets) p.update(dt);
  rink.updateGoalLights(); rink.flushScratch(dt); rink.updateNets(dt);
  if (!paused) replay.advance(dt);
  renderJumbotron(dt);

  // banner
  if (bn.dur > 0) {
    bn.t += dt; const k = bn.t / bn.dur;
    if (k >= 1) { bn.sprite.material.opacity = 0; bn.dur = 0; }
    else {
      const pop = k < 0.1 ? 0.6 + 4 * k : 1; bn.sprite.material.opacity = k < 0.08 ? k / 0.08 : k > 0.82 ? (1 - k) / 0.18 : 1;
      const sc = (bn.big ? 1.2 : 1) * pop; bn.sprite.scale.set(30 * sc, 7.7 * sc, 1);
      bn.sprite.position.set(bn.shake ? Math.sin(bn.t * 60) * 0.5 : 0, 15 + Math.sin(bn.t * 2) * 0.3, 0);
    }
  }

  // on-screen cameras
  if (!isXR()) {
    if (pov.on) {
      const pl = povTarget(game, pov.id), hp = helmetPose(pl, pk);
      tmpV.set(...hp.pos); tmpD.set(...hp.tgt);
      if (!povInit) { povPos.copy(tmpV); povTgt.copy(tmpD); povInit = true; } else { const k = Math.min(1, dt * 12); povPos.lerp(tmpV, k); povTgt.lerp(tmpD, k); }
      camera.position.copy(povPos); rinkRoot.localToWorld(camera.position);
      const tw = povTgt.clone(); rinkRoot.localToWorld(tw); camera.lookAt(tw);
      camera.near = Math.max(0.002, 0.12 * S); camera.updateProjectionMatrix();
      $('povName').textContent = `HELMET CAM  #${pl.num} ${pl.name}${pov.id < 0 ? '  (auto: puck carrier)' : ''}`;
    } else {
      povInit = false; camera.near = Math.max(0.005, 0.3 * S);
      if (mode === 'preview' || mode === 'menu') {
        if (bcast) {
          tmpV.set(THREE.MathUtils.clamp(pk.x * 0.6, -24, 24), 24, 40).multiplyScalar(S).add(rinkRoot.position);
          camera.position.lerp(tmpV, Math.min(1, dt * 2.5));
          const tgt = new THREE.Vector3(pk.x * 0.85, 0, pk.y * 0.6).multiplyScalar(S).add(rinkRoot.position);
          controls.target.lerp(tgt, Math.min(1, dt * 4)); camera.lookAt(controls.target);
        } else controls.update();
      }
    }
  }
  if (mode !== 'menu') statusEl.textContent = `${TEAMS[0].abbr} ${game.score[0]} – ${game.score[1]} ${TEAMS[1].abbr}`;
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(frame);

setMode('menu');
if (qs.get('preview') === '1') setMode('preview');
window.__th = { jumbo, replay, trail, setPaused: (v) => { paused = v; }, setSpeed: (v) => { speed = v; }, game, THREE, scene, camera, rinkRoot, act, setMode, controls, renderer, rink, actors, pov, setPov, get S() { return S; }, showBanner, handleEvents };
