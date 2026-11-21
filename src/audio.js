// All sound is synthesised with WebAudio — no asset files.
export class Sound {
  constructor() { this.ctx = null; this.muted = false; this.crowdLevel = 0.15; }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      const c = this.ctx = new AC();
      this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : 0.7; this.master.connect(c.destination);
      const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
      // crowd bed: band-passed noise whose level follows the action
      const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 520; bp.Q.value = 0.6;
      this.crowd = c.createGain(); this.crowd.gain.value = 0.03;
      src.connect(bp); bp.connect(this.crowd); this.crowd.connect(this.master); src.start();
      this.crowdBp = bp;
    } catch (e) { this.ctx = null; }
  }

  setMuted(m) { this.muted = m; if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.7, this.ctx.currentTime, 0.05); }
  setCrowd(level) {
    this.crowdLevel = level;
    if (!this.ctx) return;
    this.crowd.gain.setTargetAtTime(0.025 + level * 0.11, this.ctx.currentTime, 0.4);
    this.crowdBp.frequency.setTargetAtTime(420 + level * 500, this.ctx.currentTime, 0.4);
  }

  noise(dur, freq, q, gain, type = 'bandpass', attack = 0.003) {
    const c = this.ctx; if (!c) return;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.playbackRate.value = 0.8 + Math.random() * 0.5;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(), t = c.currentTime;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  tone(freq, dur, type, gain, slideTo, delay = 0) {
    const c = this.ctx; if (!c) return;
    const o = c.createOscillator(), g = c.createGain(), t = c.currentTime + delay;
    o.type = type; o.frequency.setValueAtTime(freq, t); if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }

  shot(power = 25, slap = false) {
    this.noise(0.12, 2200, 0.8, 0.25 + power * 0.006); this.tone(slap ? 150 : 210, 0.14, 'triangle', 0.35, 60);
    if (slap) { this.noise(0.25, 900, 0.5, 0.2); this.tone(80, 0.3, 'sine', 0.3, 40); }
  }
  pass() { this.noise(0.06, 3000, 1.2, 0.12); this.tone(300, 0.06, 'triangle', 0.12, 160); }
  tink() { this.tone(1800, 0.06, 'square', 0.05, 900); }
  board(power = 8, glass = false) {
    const p = Math.min(1, power / 22);
    this.noise(0.18, glass ? 1800 : 380, 0.7, 0.12 + p * 0.45); this.tone(glass ? 420 : 95, 0.18, 'sine', 0.1 + p * 0.3, 50);
  }
  hit(power = 0.7) { this.noise(0.2, 260, 0.6, 0.35 * power + 0.15); this.tone(70, 0.25, 'sine', 0.4 * power + 0.1, 35); this.noise(0.07, 2500, 1, 0.12); }
  punch() { this.noise(0.09, 500, 0.8, 0.22); this.tone(110, 0.1, 'sine', 0.18, 60); }
  net(power = 8) { const p = Math.min(1, power / 24); this.noise(0.45, 900, 0.4, 0.1 + p * 0.3, 'lowpass', 0.01); this.noise(0.25, 3000, 1.5, 0.05 + p * 0.1); this.tone(150, 0.3, 'sine', 0.08 + p * 0.12, 70); }
  post() { this.tone(1100, 0.9, 'sine', 0.25, 1050); this.tone(2200, 0.6, 'sine', 0.1, 2100); this.noise(0.08, 3500, 2, 0.2); }
  save() { this.noise(0.14, 700, 0.6, 0.35); this.tone(120, 0.15, 'sine', 0.3, 60); }
  whistle() { for (let i = 0; i < 2; i++) { this.tone(2750, 0.32, 'sine', 0.2, 2900, i * 0.4); this.tone(2900, 0.32, 'sine', 0.12, 3050, i * 0.4); } }
  horn() { this.tone(196, 1.6, 'sawtooth', 0.22); this.tone(247, 1.6, 'sawtooth', 0.14); this.tone(98, 1.6, 'square', 0.12); }
  cheer() { this.noise(2.8, 900, 0.5, 0.5, 'bandpass', 0.35); this.noise(2.4, 1800, 0.4, 0.22, 'bandpass', 0.5); }
  drop() { this.tone(700, 0.05, 'square', 0.1); }
}
