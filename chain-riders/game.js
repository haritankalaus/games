'use strict';
// Chain Riders — pseudo-3D combat motorcycle racer. No build step, no assets:
// every sprite is drawn procedurally so the whole game is this file + index.html.
(function () {
  // ----------------------------------------------------------------- config
  const TITLE = ['CHAIN', 'RIDERS']; // game name: title screen + store covers
  const params = new URLSearchParams(location.search);
  const DEBUG = params.has('debug');
  const COVER_MODE = params.has('covers');

  const canvas = document.getElementById('game');
  let ctx = canvas.getContext('2d');
  const W = 960, H = 540, HALF_W = W / 2;
  let RS = 1; // backing-store scale so the canvas stays crisp on high-DPI screens

  // ---------------------------------------------------------------- constants
  const STEP = 1 / 60;
  const SEG_LEN = 200, RUMBLE_LEN = 3, ROAD_W = 2000, LANES = 3;
  const CAM_H = 1300, CAM_DEPTH = 1 / Math.tan((100 / 2) * Math.PI / 180);
  const DRAW_DIST = 300, PLAYER_Z = CAM_H * CAM_DEPTH;
  const BASE_MAX = SEG_LEN / STEP; // 12000 world units / sec == "120 mph"
  const CENTRIFUGAL = 0.3;
  const BIKE_NW = 260 / ROAD_W; // bike width in road-normalised units
  const GRID_Z = 900; // how far the player rolls forward to reach the starting grid
  const CRASH_TIME = 2.4, RIVAL_CRASH_TIME = 2.6;
  const PRIZES = [1200, 800, 550, 350, 220, 140, 80, 40];
  const FONT = 'Impact, "Arial Black", "Haettenschweiler", sans-serif';
  const RAINBOW = ['#ff3b3b', '#ffd400', '#3bff6b', '#19e6ff', '#b84dff', '#ff4fa8'];
  const TAUNTS = ['EAT DUST!', 'TOO SLOW!', 'HA HA!', 'MOVE IT!', 'LOSER!', 'BYE BYE!'];
  const OUCHES = ['OUCH!', 'HEY!', 'NOOO!', 'OOF!', 'MY BIKE!'];

  // ------------------------------------------------------------------ utils
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeIn = (a, b, p) => a + (b - a) * p * p;
  const easeInOut = (a, b, p) => a + (b - a) * (-Math.cos(p * Math.PI) / 2 + 0.5);
  const elasticOut = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1);
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr, r = Math.random) => arr[Math.floor(r() * arr.length)];
  const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : (n % 10 < 4 ? n % 10 : 0)]);
  const fmtTime = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}.${String(Math.floor((t % 1) * 10))}`;
  function seeded(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function resize() {
    const cssW = canvas.getBoundingClientRect().width || W;
    const next = clamp(Math.round(cssW * (window.devicePixelRatio || 1) / W * 4) / 4, 1, 2);
    if (next !== RS || canvas.width !== Math.round(W * next)) {
      RS = next;
      canvas.width = Math.round(W * RS);
      canvas.height = Math.round(H * RS);
    }
  }

  // ---------------------------------------------------------- draw helpers
  function rrPath(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
  }
  function rr(x, y, w, h, r) { rrPath(x, y, w, h, r); ctx.fill(); }
  function strokeRR(x, y, w, h, r) { rrPath(x, y, w, h, r); ctx.stroke(); }
  function line(...pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.stroke();
  }
  function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, Math.max(0, r), 0, Math.PI * 2); ctx.fill(); }
  function poly(c, ...pts) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.closePath();
    ctx.fill();
  }
  function star(x, y, r, rot) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 ? r * 0.45 : r, a = rot + i * Math.PI / 5;
      ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
    }
    ctx.closePath();
    ctx.fill();
  }
  function starburst(x, y, R, r, n) {
    ctx.beginPath();
    for (let i = 0; i < n * 2; i++) {
      const rad = i % 2 ? r : R, a = i * Math.PI / n;
      ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
    }
    ctx.closePath();
    ctx.fill();
  }
  function txt(s, x, y, size, color, align = 'center', stroke = true) {
    ctx.font = `${size}px ${FONT}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    if (stroke) {
      ctx.lineWidth = Math.max(3, size / 7);
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.lineJoin = 'round';
      ctx.strokeText(s, x, y);
    }
    ctx.fillStyle = color;
    ctx.fillText(s, x, y);
  }
  // bouncy rainbow text, one hue per letter
  function waveText(s, x, y, size, t) {
    ctx.font = `${size}px ${FONT}`;
    const widths = [...s].map((ch) => ctx.measureText(ch).width);
    let cx = x - widths.reduce((a, b) => a + b, 0) / 2;
    [...s].forEach((ch, i) => {
      const dy = Math.sin(t * 7 + i * 0.7) * size * 0.14;
      txt(ch, cx + widths[i] / 2, y + dy, size, `hsl(${(t * 180 + i * 40) % 360},100%,62%)`);
      cx += widths[i];
    });
  }

  // ------------------------------------------------------------------ themes
  const THEMES = [
    {
      name: 'Pacific Coast', sky: ['#2a6fd1', '#a9dcff'], sun: '#fff6c8', fog: '#b7e1fb', fogD: 4, dust: '#9c8a5a',
      grass: ['#3a9a3f', '#338c38'], rumble: ['#f4f4f4', '#c8302b'], road: ['#6f6f73', '#69696d'], lane: '#f4f4f4',
      layers: [
        { s: 'hills', c: '#86aecf', b: 0.5, a: 120, f: [2, 5] },
        { s: 'hills', c: '#4f8e5c', b: 0.52, a: 70, f: [3, 7] },
        { s: 'hills', c: '#3e7a49', b: 0.53, a: 38, f: [5, 11] },
      ],
      sprites: ['palm', 'palm', 'bush', 'pole', 'rock', 'palm'], density: 0.28,
    },
    {
      name: 'Desert Run', sky: ['#d9652f', '#ffd39a'], sun: '#fff1c2', fog: '#f5c99a', fogD: 4, dust: '#e0c07a',
      grass: ['#dbb56c', '#d2ab62'], rumble: ['#f4f4f4', '#3a3a3a'], road: ['#7a716a', '#746b64'], lane: '#f6d10a',
      layers: [
        { s: 'hills', c: '#d99a67', b: 0.5, a: 130, f: [2, 3] },
        { s: 'hills', c: '#c27744', b: 0.52, a: 80, f: [3, 8] },
        { s: 'hills', c: '#a9623a', b: 0.535, a: 40, f: [4, 9] },
      ],
      sprites: ['cactus', 'cactus', 'rock', 'pole', 'bush'], density: 0.2,
    },
    {
      name: 'Neon City', night: true, sky: ['#070318', '#3b1659'], sun: '#ff4fa8', fog: '#2b1747', fogD: 3.5, dust: '#555566',
      grass: ['#22222b', '#1d1d25'], rumble: ['#ff2d95', '#202028'], road: ['#3b3b45', '#37373f'], lane: '#19e6ff',
      layers: [
        { s: 'city', c: '#2b1f52', b: 0.52, a: 230, n: 16, seed: 3 },
        { s: 'city', c: '#191331', b: 0.53, a: 150, n: 24, seed: 9, win: true },
      ],
      sprites: ['building', 'building', 'lamp', 'lamp', 'pole'], density: 0.45,
    },
    {
      name: 'Alpine Pass', sky: ['#3f7fc4', '#d8ecff'], sun: '#ffffff', fog: '#dcebf7', fogD: 4.5, dust: '#8a9a7a',
      grass: ['#4f8f45', '#47843e'], rumble: ['#f4f4f4', '#2b5fb0'], road: ['#6a6a70', '#646469'], lane: '#f4f4f4',
      layers: [
        { s: 'hills', c: '#e8f0fa', b: 0.5, a: 190, f: [3, 7] },
        { s: 'hills', c: '#6b8f7a', b: 0.52, a: 90, f: [4, 9] },
        { s: 'hills', c: '#3f6e4c', b: 0.535, a: 45, f: [6, 13] },
      ],
      sprites: ['pine', 'pine', 'pine', 'rock', 'pole'], density: 0.35,
    },
  ];

  // roadside sprite sizes in world units; cw = collision width (0 = pass-through)
  const SPR = {
    palm: { w: 520, h: 1150, cw: 160 }, bush: { w: 520, h: 300, cw: 0 }, pole: { w: 90, h: 900, cw: 90 },
    rock: { w: 480, h: 320, cw: 400 }, cactus: { w: 320, h: 760, cw: 200 }, building: { w: 1500, h: 2800, cw: 1500 },
    lamp: { w: 160, h: 1150, cw: 90 }, pine: { w: 560, h: 1250, cw: 200 }, billboard: { w: 1500, h: 1150, cw: 1300 },
  };
  const BILLBOARDS = ['EAT MY DUST', 'NO BRAKES', 'RIDE OR DIE', 'KICK HARDER', 'CHAINS $5'];

  const RIVAL_NAMES = ['Viper', 'Slash', 'Moose', 'Rita', 'Diesel', 'Nails', 'Spike', 'Luna', 'Tank', 'Scab', 'Blaze', 'Jinx'];
  const JACKETS = ['#c0392b', '#8e44ad', '#16a085', '#d35400', '#2c3e50', '#7f8c8d', '#27ae60', '#b8860b', '#e84393'];
  const HELMETS = ['#f1c40f', '#ecf0f1', '#e74c3c', '#3498db', '#1abc9c', '#111111', '#ff7f50', '#9b59b6'];
  const BIKES = ['#222', '#b71c1c', '#0d47a1', '#1b5e20', '#555', '#e65100', '#4a148c'];
  const CAR_COLORS = ['#c62828', '#1565c0', '#f9a825', '#2e7d32', '#eeeeee', '#6a1b9a', '#37474f', '#ef6c00'];

  // --------------------------------------------------------------- platform
  // CrazyGames SDK when the page runs on CrazyGames (the build adds its script tag); no-ops elsewhere.
  const platform = {
    sdk: null,
    playing: false,
    async init() {
      const sdk = window.CrazyGames && window.CrazyGames.SDK;
      if (!sdk) return;
      try {
        await Promise.race([sdk.init(), new Promise((_, rej) => setTimeout(() => rej(new Error('sdk timeout')), 6000))]);
        if (sdk.environment !== 'disabled') this.sdk = sdk;
      } catch (e) {
        console.warn('CrazyGames SDK unavailable', e);
      }
    },
    call(fn) { if (!this.sdk) return; try { fn(this.sdk); } catch (e) { console.warn(e); } },
    loadingStart() { this.call((s) => s.game.loadingStart()); },
    loadingStop() { this.call((s) => s.game.loadingStop()); },
    gameplayStart() { if (this.playing) return; this.playing = true; this.call((s) => s.game.gameplayStart()); },
    gameplayStop() { if (!this.playing) return; this.playing = false; this.call((s) => s.game.gameplayStop()); },
    get adsAvailable() { return !!this.sdk; },
    // Rewarded ad: reward only when the ad finishes (never on error), per CrazyGames rules.
    rewardedAd(done) {
      if (!this.sdk) { done(false); return; }
      let finished = false;
      const end = (ok) => { if (finished) return; finished = true; audio.setAdMuted(false); done(ok); };
      try {
        this.sdk.ad.requestAd('rewarded', { adStarted: () => audio.setAdMuted(true), adFinished: () => end(true), adError: () => end(false) });
      } catch (e) { end(false); }
    },
    midgameAd(done) {
      if (!this.sdk) { done(); return; }
      let finished = false;
      const end = () => { if (finished) return; finished = true; audio.setAdMuted(false); done(); };
      try {
        this.sdk.ad.requestAd('midgame', { adStarted: () => audio.setAdMuted(true), adFinished: end, adError: end });
      } catch (e) { end(); }
    },
    getItem(k) { try { return this.sdk ? this.sdk.data.getItem(k) : localStorage.getItem(k); } catch (e) { return null; } },
    setItem(k, v) { try { if (this.sdk) this.sdk.data.setItem(k, v); else localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } },
  };

  // ------------------------------------------------------------------- save
  const SAVE_KEY = 'chain-riders-save-v1';
  const DEFAULT_SAVE = { level: 1, money: 0, engine: 0, armor: 0, frame: 0, weapon: null, races: 0 };
  const save = { ...DEFAULT_SAVE };
  function loadSave() {
    try { const s = JSON.parse(platform.getItem(SAVE_KEY)); if (s) Object.assign(save, s); } catch (e) { /* corrupt save: start fresh */ }
  }
  function writeSave() { platform.setItem(SAVE_KEY, JSON.stringify(save)); }

  // ------------------------------------------------------------------ audio
  const audio = {
    ac: null, muted: false, adMuted: false,
    init() {
      if (this.ac) { if (this.ac.state === 'suspended') this.ac.resume().catch(() => {}); return; }
      const A = window.AudioContext || window.webkitAudioContext;
      if (!A) return;
      const ac = this.ac = new A();
      this.master = ac.createGain();
      this.master.connect(ac.destination);
      this.applyGain();
      const o1 = ac.createOscillator(), o2 = ac.createOscillator();
      o1.type = 'sawtooth'; o2.type = 'square';
      const f = ac.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 600;
      const g = ac.createGain();
      g.gain.value = 0;
      o1.connect(f); o2.connect(f); f.connect(g); g.connect(this.master);
      o1.start(); o2.start();
      this.o1 = o1; this.o2 = o2; this.eg = g;
      const buf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.nb = buf;
    },
    applyGain() { if (this.master) this.master.gain.value = this.muted || this.adMuted ? 0 : 0.6; },
    setMuted(m) { this.muted = m; this.applyGain(); },
    setAdMuted(m) { this.adMuted = m; this.applyGain(); },
    engine(pct, on) {
      if (!this.ac) return;
      const t = this.ac.currentTime, f = 40 + pct * 110;
      this.o1.frequency.setTargetAtTime(f, t, 0.05);
      this.o2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
      this.eg.gain.setTargetAtTime(on ? 0.05 + pct * 0.05 : 0, t, 0.08);
    },
    noise(dur, vol, freq) {
      if (!this.ac) return;
      const ac = this.ac, t = ac.currentTime;
      const s = ac.createBufferSource(); s.buffer = this.nb;
      const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 0.8;
      const g = ac.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      s.connect(f); f.connect(g); g.connect(this.master);
      s.start(t); s.stop(t + dur);
    },
    tone(freq, dur, type = 'square', vol = 0.12) {
      if (!this.ac) return;
      const ac = this.ac, t = ac.currentTime;
      const o = ac.createOscillator(); o.type = type; o.frequency.value = freq;
      const g = ac.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + dur);
    },
    hit() { this.noise(0.12, 0.7, 900); this.tone(110, 0.1, 'sine', 0.3); },
    boot() { this.noise(0.18, 0.9, 500); this.tone(70, 0.18, 'sine', 0.45); },
    whoosh() { this.noise(0.14, 0.15, 2500); },
    crash(v = 1) { this.noise(0.9, 0.8 * v, 300); this.noise(0.4, 0.5 * v, 1500); },
    cash() { this.tone(988, 0.08, 'square', 0.08); setTimeout(() => this.tone(1319, 0.15, 'square', 0.08), 80); },
  };

  // -------------------------------------------------------------- particles
  // screen-space effects: confetti, hit stars, exhaust smoke, dust, sparks
  let particles = [];
  function emit(x, y, n, kind, o = {}) {
    for (let i = 0; i < n; i++) {
      if (particles.length > 450) particles.shift();
      const a = o.angle != null ? o.angle + rand(-(o.spread || 0.5), o.spread || 0.5) : rand(0, Math.PI * 2);
      const sp = rand(o.min ?? 60, o.max ?? 260);
      particles.push({
        kind, x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0,
        max: rand(o.lmin ?? 0.5, o.lmax ?? 1.1), size: rand(o.smin ?? 4, o.smax ?? 9),
        rot: rand(0, 6.28), vr: rand(-10, 10), color: o.colors ? pick(o.colors) : (o.color || '#fff'), g: o.g ?? 600,
      });
    }
  }
  function updateParticles(dt) {
    for (const p of particles) {
      p.life += dt;
      const drag = p.kind === 'smoke' || p.kind === 'dust' ? 0.95 : 0.99;
      p.vx *= drag; p.vy *= drag;
      p.vy += p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
    particles = particles.filter((p) => p.life < p.max);
  }
  function drawParticles() {
    for (const p of particles) {
      const t = p.life / p.max;
      ctx.globalAlpha = 1 - t;
      if (p.kind === 'confetti') {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.color; ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      } else if (p.kind === 'star') {
        ctx.fillStyle = p.color; star(p.x, p.y, p.size * (1 - t * 0.4), p.rot);
      } else if (p.kind === 'smoke' || p.kind === 'dust') {
        ctx.globalAlpha = (1 - t) * 0.45; ctx.fillStyle = p.color; circle(p.x, p.y, p.size * (1 + t * 2.5));
      } else {
        ctx.strokeStyle = p.color; ctx.lineWidth = 2.5; line(p.x, p.y, p.x - p.vx * 0.03, p.y - p.vy * 0.03);
      }
    }
    ctx.globalAlpha = 1;
  }
  const confetti = (x, y, n = 40) => emit(x, y, n, 'confetti', { colors: RAINBOW, min: 150, max: 480, angle: -Math.PI / 2, spread: 1.3, lmin: 0.9, lmax: 1.7, smin: 8, smax: 14, g: 520 });
  const hitStars = (x, y, n = 8) => emit(x, y, n, 'star', { colors: ['#fff', '#ffd400', '#ff9f1a'], min: 120, max: 340, lmin: 0.3, lmax: 0.6, smin: 8, smax: 16, g: 200 });

  // ------------------------------------------------------------------ track
  let segments = [], theme = THEMES[0], finishZ = 0;

  function lastY() { return segments.length ? segments[segments.length - 1].p2.world.y : 0; }
  function addSegment(curve, y) {
    const n = segments.length;
    segments.push({
      index: n, curve, sprites: [], clip: 0, vis: false, special: null,
      p1: { world: { y: lastY(), z: n * SEG_LEN }, camera: {}, screen: {} },
      p2: { world: { y, z: (n + 1) * SEG_LEN }, camera: {}, screen: {} },
    });
  }
  function addRoad(enter, hold, leave, curve, height) {
    const startY = lastY(), endY = startY + height * SEG_LEN, total = enter + hold + leave;
    for (let n = 0; n < enter; n++) addSegment(easeIn(0, curve, n / enter), easeInOut(startY, endY, n / total));
    for (let n = 0; n < hold; n++) addSegment(curve, easeInOut(startY, endY, (enter + n) / total));
    for (let n = 0; n < leave; n++) addSegment(easeInOut(curve, 0, n / leave), easeInOut(startY, endY, (enter + hold + n) / total));
  }
  function findSegment(z) { return segments[clamp(Math.floor(z / SEG_LEN), 0, segments.length - 1)]; }

  function buildTrack(level) {
    const rng = seeded(level * 7919 + 13);
    theme = THEMES[(level - 1) % THEMES.length];
    segments = [];
    const target = 1700 + Math.min(level, 8) * 250;
    addRoad(0, 90, 0, 0, 0);
    while (segments.length < target) {
      const len = pick([25, 40, 60, 80], rng);
      const curve = rng() < 0.3 ? 0 : (rng() < 0.5 ? -1 : 1) * pick([2, 3, 4, 6], rng);
      let hill = 0;
      if (rng() < 0.6) hill = (rng() * 2 - 1) * 50 - lastY() / SEG_LEN;
      addRoad(len, len, len, curve, hill);
    }
    addRoad(40, 40, 40, 0, -lastY() / SEG_LEN);
    const finishIdx = segments.length + 20;
    addRoad(0, DRAW_DIST + 700, 0, 0, 0);
    finishZ = finishIdx * SEG_LEN;

    const startIdx = Math.floor((PLAYER_Z + GRID_Z) / SEG_LEN) + 1;
    for (let i = startIdx; i < startIdx + 2; i++) segments[i].special = 'check';
    for (let i = finishIdx; i < finishIdx + 3; i++) segments[i].special = 'check';

    for (let i = 14; i < segments.length; i++) {
      if (i % 240 === 0) {
        const side = (i / 240) % 2 ? 1 : -1;
        segments[i].sprites.push({ type: 'billboard', offset: side * 1.75, text: pick(BILLBOARDS, rng) });
        continue;
      }
      if (rng() < theme.density) {
        const side = rng() < 0.5 ? -1 : 1;
        const type = pick(theme.sprites, rng);
        const def = SPR[type];
        const sp = { type, offset: side * (1.25 + def.w / ROAD_W / 2 + rng() * 1.4) };
        if (type === 'building') {
          sp.c = pick(['#3a3350', '#2d2a44', '#4a3a5a', '#262638', '#3b2f4f'], rng);
          sp.h = 2000 + rng() * 1800;
          sp.seed = Math.floor(rng() * 1000);
        }
        segments[i].sprites.push(sp);
      }
    }
    segments[finishIdx].sprites.push({ type: 'pole', offset: -1.15 }, { type: 'pole', offset: 1.15 });
  }

  // ------------------------------------------------------------------ state
  let state = 'title'; // title | shop | race | results | ad
  let race = null, results = null;
  let attractPos = 0;
  const bg = [0, 0, 0];
  let uiButtons = [];
  let blink = 0;
  let toast = null;
  let frameNo = 0;
  let touchMode = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

  const keys = { left: false, right: false, up: false, down: false };

  // start-of-race tutorial cards (keyboard and touch variants)
  const TUT_KEYS = [
    { id: 'up', key: '↑', label: 'GAS', codes: ['ArrowUp', 'KeyW'] },
    { id: 'steer', key: '← →', label: 'STEER', codes: ['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD'] },
    { id: 'kick', key: 'SPACE', label: 'KICK!', codes: ['Space', 'KeyX', 'KeyK'], star: true, wide: true },
    { id: 'pl', key: 'Z', label: 'PUNCH ◀', codes: ['KeyZ', 'KeyJ'] },
    { id: 'pr', key: 'C', label: 'PUNCH ▶', codes: ['KeyC', 'KeyL'] },
  ];
  const TUT_TOUCH = [
    { id: 'up', key: 'AUTO', label: 'GAS', btns: [] },
    { id: 'steer', key: '◀ ▶', label: 'STEER', btns: ['left', 'right'] },
    { id: 'kick', key: 'KICK', label: 'BOOT EM!', btns: ['kick'], star: true, wide: true },
    { id: 'pl', key: '👊', label: 'PUNCH', btns: ['punchL', 'punchR'] },
  ];

  function newRace() {
    buildTrack(save.level);
    const L = save.level;
    const maxHealth = 100 + 20 * save.armor, maxBike = 100 + 25 * save.frame;
    race = {
      position: 0, speed: 0, maxSpeed: BASE_MAX * (1 + 0.06 * save.engine), playerX: 0, lean: 0,
      health: maxHealth, maxHealth, bike: maxBike, maxBike, weapon: save.weapon,
      attack: null, cooldown: 0, queued: null, invuln: 0,
      state: 'ride', crashT: 0, crashSide: 1,
      finished: false, wrecked: false, over: false, endT: 0, place: 8,
      time: 0, clock: 0, kos: 0, cash: 0, msgs: [], shake: 0, slowmo: 0, flash: 0, paused: false,
      phase: 'intro', introT: 0, countdown: 3, goT: 0, waitStart: save.races < 2, startPressed: false,
      upAt: null, boost: 0, rev: 0, combo: 0, comboT: 0, dda: L === 1 ? 0.95 : 1,
      tut: {}, rivals: [], cars: [], brake: false,
      _sy: H - 6, _s: CAM_DEPTH / PLAYER_Z * HALF_W,
    };
    save.weapon = null;
    writeSave();

    const names = RIVAL_NAMES.slice().sort(() => Math.random() - 0.5);
    for (let i = 0; i < 7; i++) {
      const maxH = 60 + 10 * L;
      const x = i % 2 ? 0.4 : -0.4;
      race.rivals.push({
        name: names[i], jacket: pick(JACKETS), helmet: pick(HELMETS), bike: pick(BIKES),
        z: PLAYER_Z + GRID_Z + 320 + Math.floor(i / 2) * 360, x, targetX: x,
        speed: 0, base: BASE_MAX * Math.min(1.08, 0.8 + 0.03 * L + Math.random() * 0.08),
        health: maxH, maxHealth: maxH, aggression: Math.min(0.95, 0.3 + Math.random() * 0.35 + 0.05 * L),
        weapon: Math.random() < 0.15 + 0.1 * L ? pick(['chain', 'club']) : null,
        state: 'ride', crashT: 0, crashSide: 1, attack: null, cooldown: rand(1.5, 3), flash: 0, lean: 0,
        finished: false, laneT: rand(1, 4), hunt: false, prefGap: rand(-250, 450), stun: 0, say: '', sayT: 0,
      });
    }
    for (let i = 0, n = Math.min(16, 4 + 2 * L); i < n; i++) {
      const c = {};
      spawnCar(c, PLAYER_Z + GRID_Z + 8000 + i * rand(9000, 14000));
      race.cars.push(c);
    }
  }

  function spawnCar(c, z) {
    c.oncoming = Math.random() < 0.35;
    c.type = Math.random() < 0.25 ? 'truck' : 'car';
    c.w = c.type === 'truck' ? 820 : 700;
    c.h = c.type === 'truck' ? 880 : 520;
    c.nw = c.w / ROAD_W;
    c.len = c.type === 'truck' ? 420 : 260;
    c.x = c.oncoming ? -0.667 : pick([0, 0.667]);
    c.speed = (c.oncoming ? -1 : 1) * BASE_MAX * rand(0.25, 0.42);
    c.color = pick(CAR_COLORS);
    c.z = z;
  }

  function addMsg(text, color = '#fff', size = 34) {
    race.msgs.push({ text, color, size, t: 1.8, age: 0 });
    if (race.msgs.length > 4) race.msgs.shift();
  }

  function say(v, lines) { v.say = pick(lines); v.sayT = 1.5; }

  function computePlace(pz) {
    let p = 1;
    for (const v of race.rivals) if (v.finished || v.z > pz) p++;
    return p;
  }

  function playerHead() { return { x: HALF_W, y: race._sy - 330 * race._s }; }
  function onScreen(v) { return v._frame === frameNo - 1 || v._frame === frameNo; }

  function crashPlayer(bikeDmg, label) {
    const r = race;
    r.state = 'crashed';
    r.crashT = CRASH_TIME;
    r.crashSide = Math.random() < 0.5 ? -1 : 1;
    r.attack = null;
    r.boost = 0;
    r.combo = 0;
    r.bike = Math.max(0, r.bike - bikeDmg * Math.min(1, 0.5 + 0.1 * save.level)); // forgiving early levels
    r.slowmo = 0.7;
    r.shake = 1;
    r.dda = Math.max(0.85, r.dda - 0.04); // ease off after every crash
    audio.crash(1);
    emit(HALF_W, r._sy - 40 * r._s, 26, 'spark', { colors: ['#ffd400', '#ff9f1a', '#fff'], min: 200, max: 600, angle: -Math.PI / 2, spread: 1.4, lmin: 0.3, lmax: 0.7, g: 900 });
    addMsg(label, '#ff4040', 44);
    if (r.bike <= 0) addMsg('BIKE WRECKED!', '#ff4040', 40);
  }

  function crashRival(v, pz) {
    v.state = 'crashed';
    v.crashT = RIVAL_CRASH_TIME;
    v.crashSide = Math.random() < 0.5 ? -1 : 1;
    v.attack = null;
    v.stun = 0;
    if (Math.abs(v.z - pz) < 3000) audio.crash(0.5);
  }

  const attackExt = (a) => { const p = a.t / a.dur; return p < 0.4 ? p / 0.4 : Math.max(0, 1 - (p - 0.4) / 0.6); };

  function playerStrike(a, pz) {
    const r = race;
    const kick = a.kind === 'kick';
    const wpn = kick ? null : r.weapon;
    const reachZ = wpn ? 380 : kick ? 320 : 280;
    const reachX = kick ? 0.42 : (wpn ? 0.52 : 0.4);
    let best = null, bd = 1e9;
    for (const v of r.rivals) {
      if (v.state !== 'ride') continue;
      const dz = Math.abs(v.z - pz), dx = (v.x - r.playerX) * a.side;
      if (dz < reachZ && dx > 0.02 && dx < reachX) {
        const d = dz / reachZ + dx;
        if (d < bd) { bd = d; best = v; }
      }
    }
    if (!best) return;
    const dmg = kick ? 14 : wpn === 'chain' ? 26 : wpn === 'club' ? 22 : 13;
    best.health -= dmg;
    best.flash = 1;
    best.x += a.side * (kick ? 0.42 : 0.07);
    best.targetX = best.x;
    if (kick) {
      best.speed *= 0.72; // a good boot knocks them back into the pack
      best.stun = 1.1;
      audio.boot();
      r.shake = Math.max(r.shake, 0.5);
    } else {
      best.speed *= 0.97;
      audio.hit();
      r.shake = Math.max(r.shake, 0.25);
    }
    if (onScreen(best)) hitStars(best._sx, best._sy, kick ? 14 : 8);

    r.combo = r.comboT > 0 ? r.combo + 1 : 1;
    r.comboT = 2;
    if (r.combo >= 2) {
      const bonus = 10 * r.combo;
      r.cash += bonus;
      addMsg(`COMBO x${r.combo}! +$${bonus}`, RAINBOW[r.combo % RAINBOW.length], 32 + Math.min(r.combo, 6) * 3);
    }

    if (best.health <= 0) {
      crashRival(best, pz);
      say(best, ['NOOOO!', 'NOT FAIR!', 'WAAAH!']);
      r.kos++;
      const bonus = 100 + 50 * save.level;
      r.cash += bonus;
      r.slowmo = 0.4;
      r.dda = Math.min(1.08, r.dda + 0.01);
      addMsg(`KNOCKED OUT ${best.name.toUpperCase()}! +$${bonus}`, '#ffd400', 34);
      audio.cash();
      if (onScreen(best)) confetti(best._sx, best._sy, 30);
      if (best.weapon && !r.weapon) {
        r.weapon = best.weapon;
        best.weapon = null;
        addMsg(`YOU GRABBED A ${r.weapon.toUpperCase()}!`, '#19e6ff', 30);
      }
    } else {
      if (kick) say(best, OUCHES);
      if (r.combo < 2) addMsg(kick ? pick(['BOOT!', 'KA-POW!', 'STOMP!']) : pick(['POW!', 'WHAM!', 'CRACK!', 'SMACK!']), '#fff', kick ? 36 : 28);
    }
  }

  function queueAttack(kind, side) {
    if (!race || state !== 'race') return;
    race.queued = { kind, side, at: race.clock };
  }

  function updatePlayerAttack(r, pz, dt, control) {
    r.cooldown = Math.max(0, r.cooldown - dt);
    if (r.queued && r.clock - r.queued.at > 0.3) r.queued = null;
    if (r.queued && control && r.cooldown <= 0 && !r.attack) {
      let side = r.queued.side;
      if (!side) { // kicks auto-aim at the nearest rival
        let best = null, bd = 1e9;
        for (const v of r.rivals) {
          const d = Math.abs(v.z - pz) / 300 + Math.abs(v.x - r.playerX);
          if (v.state === 'ride' && d < bd) { bd = d; best = v; }
        }
        side = best && best.x < r.playerX ? -1 : 1;
      }
      const kick = r.queued.kind === 'kick';
      r.attack = { kind: r.queued.kind, side, t: 0, dur: kick ? 0.32 : 0.26, hit: false };
      r.cooldown = kick ? 0.5 : 0.36;
      r.queued = null;
      audio.whoosh();
    }
    if (r.attack) {
      const a = r.attack;
      a.t += dt;
      if (!a.hit && a.t >= a.dur * 0.4) { a.hit = true; if (r.phase === 'go') playerStrike(a, pz); }
      if (a.t >= a.dur) r.attack = null;
    }
  }

  function scrollBg(seg, dist) {
    const k = seg.curve * dist / SEG_LEN;
    bg[0] = (bg[0] + 0.0004 * k + 1) % 1;
    bg[1] = (bg[1] + 0.0009 * k + 1) % 1;
    bg[2] = (bg[2] + 0.0014 * k + 1) % 1;
  }

  function tutPress(id) {
    const r = race;
    if (!r || r.phase === 'go' && r.goT > 0.6) return;
    const cards = touchMode ? TUT_TOUCH : TUT_KEYS;
    const i = cards.findIndex((c) => c.id === id);
    if (i < 0) return;
    const st = r.tut[id] || (r.tut[id] = { done: false, pop: 0 });
    st.pop = 1;
    if (!st.done) {
      st.done = true;
      const c = cards[i];
      if (c._x != null) confetti(c._x, c._y, 34);
      audio.tone(523 * Math.pow(1.26, Math.min(i, 4)), 0.18, 'square', 0.1);
    }
  }

  function exhaust(r, n) {
    emit(HALF_W + 90 * r._s, r._sy - 70 * r._s, n, 'smoke', { color: '#d8d8d8', angle: Math.PI / 2 + 0.4, spread: 0.5, min: 30, max: 90, lmin: 0.5, lmax: 1, smin: 6, smax: 11, g: -60 });
  }

  // ------------------------------------------------------------------ update
  function update(dt) {
    blink += dt;
    if (toast) { toast.t -= dt; if (toast.t <= 0) toast = null; }
    updateParticles(dt);
    if (state !== 'race') {
      if (state === 'title' || state === 'shop') {
        const d = 5500 * dt;
        scrollBg(findSegment(attractPos + PLAYER_Z), d);
        attractPos += d;
        if (attractPos > finishZ - 4000) attractPos = 0;
      }
      audio.engine(0, false);
      return;
    }
    const r = race;
    if (r.paused || portraitBlocked()) { audio.engine(0, false); return; }

    r.clock += dt;
    r.shake = Math.max(0, r.shake - dt * 2.5);
    r.flash = Math.max(0, r.flash - dt * 3);
    r.invuln = Math.max(0, r.invuln - dt);
    for (const st of Object.values(r.tut)) st.pop = Math.max(0, st.pop - dt * 4);
    for (const m of r.msgs) { m.t -= dt; m.age += dt; }
    r.msgs = r.msgs.filter((m) => m.t > 0);

    if (r.phase !== 'go') { updatePreRace(r, dt); return; }
    r.goT += dt;

    if (!r.finished && !r.wrecked) r.time += dt;
    const pz = r.position + PLAYER_Z;
    const seg = findSegment(pz);
    const spd = r.speed / r.maxSpeed;
    const control = r.state === 'ride' && !r.over;
    let steer = 0;
    r.brake = false;
    r.boost = Math.max(0, r.boost - dt);
    r.comboT = Math.max(0, r.comboT - dt);
    if (r.comboT === 0) r.combo = 0;
    const cap = r.maxSpeed * (r.boost > 0 ? 1.2 : 1);

    if (r.state === 'ride') {
      if (control) {
        if (keys.left) steer = -1; else if (keys.right) steer = 1;
        r.playerX += steer * dt * 2 * Math.min(1, spd);
        const gas = keys.up || (touchMode && !keys.down);
        if (keys.down) { r.speed -= r.maxSpeed * dt; r.brake = true; }
        else if (gas) r.speed += (r.maxSpeed / (r.boost > 0 ? 2.5 : 5)) * dt;
        else r.speed -= (r.maxSpeed / 5) * dt;
        if (gas && spd < 0.45 && Math.random() < 0.5) exhaust(r, 1);
      } else {
        r.speed -= r.maxSpeed * 0.3 * dt; // coasting after the finish line
      }
      r.playerX -= dt * 2 * spd * spd * seg.curve * CENTRIFUGAL;

      if (Math.abs(r.playerX) > 1) {
        if (r.speed > r.maxSpeed * 0.3) r.speed -= r.maxSpeed * 0.9 * dt;
        r.shake = Math.max(r.shake, 0.12 * spd);
        if (r.speed > 1000 && Math.random() < 0.7) {
          emit(HALF_W + rand(-40, 40) * r._s, r._sy - 10, 1, 'dust', { color: theme.dust, angle: -Math.PI / 2, spread: 1.2, min: 40, max: 160, smin: 8, smax: 14, g: 80 });
        }
        for (const s of [seg, segments[seg.index - 1]]) {
          if (!s) continue;
          for (const sp of s.sprites) {
            const cw = SPR[sp.type].cw / ROAD_W;
            if (cw && Math.abs(r.playerX - sp.offset) < (BIKE_NW + cw) / 2 && r.speed > r.maxSpeed * 0.1) {
              crashPlayer(22, 'WIPEOUT!');
              r.speed *= 0.3;
              break;
            }
          }
          if (r.state !== 'ride') break;
        }
      }

      updatePlayerAttack(r, pz, dt, control);

      if (r.state === 'ride' && r.invuln <= 0) {
        for (const c of r.cars) {
          if (Math.abs(c.z - pz) < c.len && Math.abs(c.x - r.playerX) < (BIKE_NW + c.nw) / 2 * 0.85) {
            crashPlayer(c.oncoming ? 30 : 18, c.oncoming ? 'HEAD-ON!' : 'REAR-ENDED!');
            r.speed *= c.oncoming ? 0.15 : 0.4;
            break;
          }
        }
      }
    } else {
      r.speed = Math.max(0, r.speed - r.maxSpeed * 1.2 * dt);
      r.crashT -= dt;
      if (r.crashT <= 0 && !r.over) {
        if (r.bike <= 0) {
          r.wrecked = true; r.over = true; r.endT = 1.2;
        } else {
          r.state = 'ride';
          r.speed = 0;
          r.playerX = clamp(r.playerX, -0.9, 0.9);
          if (r.health <= 0) r.health = Math.round(r.maxHealth * 0.6);
          r.invuln = 1.5;
        }
      }
    }

    if (r.speed > cap) r.speed = Math.max(cap, r.speed - r.maxSpeed * 0.4 * dt);
    r.speed = Math.max(0, r.speed);
    r.playerX = clamp(r.playerX, -3, 3);
    r.lean = lerp(r.lean, steer * spd, Math.min(1, dt * 8));
    const moved = r.speed * dt;
    r.position += moved;
    scrollBg(seg, moved);

    for (const c of r.cars) {
      c.z += c.speed * dt;
      if (c.z < pz - 2000 || c.z > pz + 130000) spawnCar(c, pz + rand(30000, 110000));
    }

    updateRivals(r, pz, dt);

    // winning comfortably? let the pack push a little harder
    if (r.place === 1 && r.rivals.every((v) => v.z < pz - 3000)) r.dda = Math.min(1.08, r.dda + 0.01 * dt);

    if (!r.over) r.place = computePlace(pz);
    if (!r.finished && !r.wrecked && pz >= finishZ) {
      r.finished = true;
      r.over = true;
      r.endT = 3.2;
      r.place = computePlace(pz);
      addMsg(`${ordinal(r.place).toUpperCase()} PLACE!`, r.place <= 3 ? '#7CFC00' : '#ffd400', 64);
      if (r.place <= 3) { confetti(W * 0.25, H * 0.6, 50); confetti(W * 0.75, H * 0.6, 50); }
      audio.tone(660, 0.2); setTimeout(() => audio.tone(990, 0.4), 180);
    }
    if (r.over) {
      r.endT -= dt;
      if (r.endT <= 0) toResults();
    }
    audio.engine(r.speed / BASE_MAX, r.state === 'ride');
  }

  function updatePreRace(r, dt) {
    r.introT += dt;
    const pz = r.position + PLAYER_Z;
    const revving = keys.up || (touchMode && r.phase === 'countdown');
    r.rev = lerp(r.rev, revving ? 1 : 0.15, Math.min(1, dt * 6));
    if (r.phase === 'intro') {
      const t = clamp(r.introT / 1.5, 0, 1);
      const np = GRID_Z * (1 - Math.pow(1 - t, 3)); // roll up to the grid
      r.speed = (np - r.position) / dt;
      scrollBg(findSegment(pz), np - r.position);
      r.position = np;
      r.lean = Math.sin(r.introT * 3.2) * 0.35 * (1 - t) + Math.sin(r.introT * 9) * 0.05 * r.rev;
      if (t >= 1 && (r.startPressed || r.introT > (r.waitStart ? 3.4 : 1.7))) {
        r.phase = 'countdown';
        r.countdown = 3;
        r.speed = 0;
        audio.tone(440, 0.15);
      }
    } else {
      r.speed = 0;
      r.lean = Math.sin(r.clock * 9) * 0.05 * r.rev;
      const prev = Math.ceil(r.countdown);
      r.countdown -= dt;
      const now = Math.ceil(r.countdown);
      if (now !== prev) {
        if (now > 0) audio.tone(440, 0.15);
        else startGo(r);
      }
    }
    if (Math.random() < 0.15 + r.rev * 0.5) exhaust(r, 1);
    updatePlayerAttack(r, pz, dt, true);
    audio.engine(r.phase === 'intro' ? 0.25 + r.rev * 0.3 : r.rev * 0.7, true);
  }

  function startGo(r) {
    r.phase = 'go';
    r.goT = 0;
    audio.tone(880, 0.4);
    confetti(W * 0.15, H * 0.55, 40);
    confetti(W * 0.85, H * 0.55, 40);
    const pressed = r.upAt != null && (touchMode || keys.up);
    if (pressed && r.upAt <= 0.7) {
      r.speed = r.maxSpeed * 0.5;
      r.boost = 1.8;
      addMsg('PERFECT START!', '#7CFC00', 50);
      audio.cash();
      exhaust(r, 12);
    }
  }

  function updateRivals(r, pz, dt) {
    const L = save.level;
    for (const v of r.rivals) {
      v.flash = Math.max(0, v.flash - dt * 4);
      v.cooldown = Math.max(0, v.cooldown - dt);
      v.stun = Math.max(0, v.stun - dt);
      v.sayT = Math.max(0, v.sayT - dt);
      if (v.state === 'crashed') {
        v.speed = Math.max(0, v.speed - BASE_MAX * 1.2 * dt);
        v.crashT -= dt;
        if (v.crashT <= 0) {
          v.state = 'ride';
          v.speed = 0;
          v.x = v.targetX = clamp(v.x, -0.8, 0.8);
          if (v.health <= 0) v.health = Math.round(v.maxHealth * 0.5);
        }
        v.z += v.speed * dt;
        continue;
      }
      const gap = v.z - pz;
      const dx = r.playerX - v.x;

      // Speed adapts to the player: riders far ahead ease off, riders far behind catch up,
      // and nearby riders match the player's pace so there is always someone to fight.
      const base = v.base * r.dda;
      let target;
      if (gap > 3000) target = Math.min(base * 0.8, Math.max(r.speed * 0.85, base * 0.5));
      else if (gap < -3000) target = Math.min(base * 1.2, r.maxSpeed * 1.02);
      else target = clamp(r.speed + (v.prefGap - gap) * 0.8, base * 0.72, base * 1.1);
      if (v.stun > 0) target *= 0.8;
      if (v.finished) target *= 0.5;
      v.speed += clamp(target - v.speed, -BASE_MAX * 0.6 * dt, BASE_MAX * 0.25 * dt);

      v.laneT -= dt;
      if (v.laneT <= 0) {
        v.laneT = rand(2, 5);
        v.targetX = pick([-0.6, -0.2, 0.2, 0.6]);
        v.hunt = Math.random() < v.aggression;
        v.prefGap = rand(-250, 450);
      }
      if (v.hunt && v.stun <= 0 && !r.over && r.state === 'ride' && Math.abs(gap) < 700) {
        v.targetX = clamp(r.playerX - Math.sign(dx || 1) * 0.24, -0.9, 0.9);
      }
      for (const c of r.cars) {
        const cdz = c.z - v.z;
        const closing = v.speed - c.speed;
        if (cdz > 0 && cdz < 400 + closing * 0.35 && Math.abs(c.x - v.x) < 0.33) {
          v.targetX = clamp(c.x > 0 ? c.x - 0.55 : c.x + 0.55, -0.85, 0.85);
          break;
        }
      }
      const rate = (v.stun > 0 ? 0.6 : 1.3) * dt;
      const dxT = clamp(v.targetX - v.x, -rate, rate);
      v.x += dxT;
      const wobble = v.stun > 0 ? Math.sin(r.clock * 20) * 0.5 * v.stun : 0;
      v.lean = lerp(v.lean, clamp(dxT / rate, -1, 1) * (v.speed / BASE_MAX) + wobble, Math.min(1, dt * 6));

      const reach = v.weapon ? 0.5 : 0.38;
      if (v.attack) {
        const a = v.attack;
        a.t += dt;
        if (!a.hit && a.t >= a.dur * 0.4) {
          a.hit = true;
          const ndx = (r.playerX - v.x) * a.side;
          if (Math.abs(v.z - pz) < 300 && ndx > 0.02 && ndx < reach + 0.05 && r.state === 'ride' && r.invuln <= 0) {
            const dmg = v.weapon === 'chain' ? 15 : v.weapon === 'club' ? 13 : 7;
            r.health -= dmg;
            r.flash = 1;
            r.shake = Math.max(r.shake, 0.4);
            r.playerX += a.side * 0.05;
            r.combo = 0;
            audio.hit();
            const h = playerHead();
            hitStars(h.x - a.side * 60, h.y, 7);
            if (Math.random() < 0.5) say(v, TAUNTS);
            if (r.health <= 0) { r.health = 0; crashPlayer(8, 'KNOCKED OFF!'); r.speed *= 0.5; }
          }
        }
        if (a.t >= a.dur) v.attack = null;
      } else if (!r.over && r.state === 'ride' && v.stun <= 0 && v.cooldown <= 0 && Math.abs(gap) < 240 &&
                 Math.abs(dx) > 0.04 && Math.abs(dx) < reach && Math.random() < v.aggression * dt * 2.5) {
        v.attack = { kind: 'punch', side: Math.sign(dx), t: 0, dur: 0.3, hit: false };
        v.cooldown = Math.max(0.5, rand(0.9, 1.8) - 0.05 * L);
      }

      if (r.state === 'ride' && Math.abs(gap) < 130 && Math.abs(dx) < 0.11) {
        const push = (0.11 - Math.abs(dx)) / 2 * Math.sign(dx || 1);
        v.x -= push;
        r.playerX += push;
        if (gap > 0 && r.speed > v.speed) r.speed = v.speed * 0.95;
        if (gap < 0 && v.speed > r.speed) v.speed = r.speed * 0.95;
      }

      for (const c of r.cars) {
        if (Math.abs(c.z - v.z) < c.len && Math.abs(c.x - v.x) < (BIKE_NW + c.nw) / 2 * 0.85) {
          crashRival(v, pz);
          v.speed *= 0.3;
          if (Math.abs(gap) < 2500) addMsg(`${v.name.toUpperCase()} HIT TRAFFIC!`, '#ffa040', 26);
          break;
        }
      }
      if (v.state === 'ride' && Math.abs(v.x) > 1.2) {
        crashRival(v, pz);
        if (Math.abs(gap) < 2500) {
          addMsg(`${v.name.toUpperCase()} OFF THE ROAD!`, '#ffa040', 26);
          const bonus = 50 + 25 * L;
          r.cash += bonus;
          addMsg(`+$${bonus}`, '#7CFC00', 26);
        }
      }

      v.z += v.speed * dt;
      if (!v.finished && v.z >= finishZ) v.finished = true;
    }
  }

  // ------------------------------------------------------------ flow / UI
  function toResults() {
    const r = race;
    platform.gameplayStop();
    const prize = r.wrecked ? 0 : PRIZES[r.place - 1] * save.level;
    const repair = r.wrecked ? Math.min(save.money + r.cash, 250 * save.level) : 0;
    save.money += r.cash + prize - repair;
    save.races++;
    const qualified = !r.wrecked && r.place <= 3;
    if (qualified) save.level++;
    writeSave();
    results = { place: r.place, prize, kos: r.kos, cash: r.cash, repair, qualified, wrecked: r.wrecked, time: r.time, bonusUsed: false };
    state = 'results';
  }

  // what the "watch an ad" offer pays: the race winnings again, or the repair bill back after a wreck
  function adBonus() {
    const R = results;
    if (!platform.adsAvailable || R.bonusUsed) return 0;
    return R.wrecked ? R.repair : R.prize + R.cash;
  }

  function watchAdForBonus() {
    const bonus = adBonus();
    if (!bonus || state !== 'results') return;
    state = 'ad';
    platform.rewardedAd((ok) => {
      state = 'results';
      results.bonusUsed = true; // one offer per race, win or lose
      if (ok) {
        save.money += bonus;
        writeSave();
        audio.cash();
        confetti(W / 2, 200, 60);
        toast = { text: `+$${bonus} ADDED TO YOUR BANK!`, t: 2 };
      } else {
        toast = { text: 'NO AD AVAILABLE RIGHT NOW', t: 2 };
      }
    });
  }

  function continueFromResults() {
    state = 'ad';
    platform.midgameAd(() => goShop());
  }

  function goShop() {
    state = 'shop';
    buildTrack(save.level);
    attractPos = 0;
  }

  function startFromTitle() {
    if (save.races === 0) startRace(); else goShop();
  }

  function startRace() {
    audio.init();
    newRace();
    state = 'race';
    platform.gameplayStart();
  }

  function quitToTitle() {
    platform.gameplayStop();
    state = 'title';
    buildTrack(save.level);
  }

  function setPaused(p, manual) {
    if (!race || state !== 'race' || race.paused === p) return;
    race.paused = p;
    for (const k in keys) keys[k] = false;
    activePointers.clear();
    if (manual) { if (p) platform.gameplayStop(); else platform.gameplayStart(); }
    else if (!p) platform.gameplayStart();
  }

  function portraitBlocked() { return touchMode && window.innerHeight > window.innerWidth * 1.05; }

  const SHOP = [
    { key: 'engine', name: 'ENGINE TUNE', desc: '+6% top speed', max: 6, cost: (l) => 500 * (l + 1) },
    { key: 'armor', name: 'LEATHER ARMOR', desc: '+20 rider health', max: 5, cost: (l) => 350 * (l + 1) },
    { key: 'frame', name: 'REINFORCED FRAME', desc: '+25 bike durability', max: 5, cost: (l) => 400 * (l + 1) },
    { key: 'weapon', name: 'CHAIN (NEXT RACE)', desc: 'Start armed. Hits twice as hard as fists.', max: 1, oneShot: true, cost: () => 250 + 50 * save.level },
  ];
  function shopLevel(it) { return it.oneShot ? (save.weapon ? 1 : 0) : save[it.key]; }
  function buy(i) {
    const it = SHOP[i];
    const lvl = shopLevel(it);
    const cost = it.cost(lvl);
    if (lvl >= it.max) { toast = { text: 'ALREADY MAXED', t: 1.2 }; return; }
    if (save.money < cost) { toast = { text: 'NOT ENOUGH CASH', t: 1.2 }; audio.tone(120, 0.2, 'sawtooth'); return; }
    save.money -= cost;
    if (it.oneShot) save.weapon = 'chain'; else save[it.key]++;
    writeSave();
    audio.cash();
    confetti(W / 2, 200 + i * 72, 25);
    toast = { text: `BOUGHT ${it.name}`, t: 1.2 };
  }

  const UP_CODES = ['ArrowUp', 'KeyW'];
  function onKey(code) {
    if (code === 'KeyM') { audio.setMuted(!audio.muted); toast = { text: audio.muted ? 'SOUND OFF' : 'SOUND ON', t: 1 }; return; }
    if (state === 'title') {
      if (code === 'Enter' || code === 'Space') startFromTitle();
      else if (code === 'KeyN') { Object.assign(save, DEFAULT_SAVE); writeSave(); toast = { text: 'PROGRESS RESET', t: 1.5 }; buildTrack(1); }
    } else if (state === 'shop') {
      if (code === 'Enter' || code === 'Space') startRace();
      else {
        const i = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(code);
        if (i >= 0) buy(i);
      }
    } else if (state === 'race') {
      const r = race;
      if (code === 'KeyP') { setPaused(!r.paused, true); return; } // not Esc: it exits fullscreen on portals
      if (r.paused) { if (code === 'KeyQ') quitToTitle(); return; }
      if (r.phase === 'intro' && (UP_CODES.includes(code) || code === 'Enter')) r.startPressed = true;
      if (r.phase === 'countdown' && UP_CODES.includes(code) && r.upAt == null) r.upAt = r.countdown;
      const card = TUT_KEYS.find((c) => c.codes.includes(code));
      if (card) tutPress(card.id);
      const map = { KeyZ: ['punch', -1], KeyJ: ['punch', -1], KeyC: ['punch', 1], KeyL: ['punch', 1], KeyX: ['kick', 0], KeyK: ['kick', 0], Space: ['kick', 0] };
      if (map[code]) queueAttack(map[code][0], map[code][1]);
    } else if (state === 'results') {
      if (code === 'Enter' || code === 'Space') continueFromResults();
      else if (code === 'KeyD') watchAdForBonus();
    }
  }

  const KEYMAP = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down' };
  window.addEventListener('keydown', (e) => {
    audio.init();
    if (touchMode && !e.repeat) touchMode = false; // a real keyboard is being used
    const k = KEYMAP[e.code];
    if (k) { keys[k] = true; e.preventDefault(); }
    if (e.code === 'Space') e.preventDefault();
    if (!e.repeat) onKey(e.code);
  });
  window.addEventListener('keyup', (e) => {
    const k = KEYMAP[e.code];
    if (k) keys[k] = false;
    if (race && race.phase === 'countdown' && UP_CODES.includes(e.code)) race.upAt = null;
  });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; setPaused(true, false); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { setPaused(true, false); if (audio.ac) audio.ac.suspend().catch(() => {}); }
    else if (audio.ac) audio.ac.resume().catch(() => {});
  });
  // iOS only lets audio start from a user gesture
  ['touchend', 'click'].forEach((ev) => window.addEventListener(ev, () => audio.init(), { passive: true }));

  // ------------------------------------------------------------ touch input
  const activePointers = new Map(); // pointerId -> touch button id
  function touchButtons() {
    return [
      { id: 'left', x: 80, y: H - 80, r: 58, label: '◀' },
      { id: 'right', x: 212, y: H - 80, r: 58, label: '▶' },
      { id: 'punchL', x: W - 302, y: H - 62, r: 44, label: '👊', sub: 'LEFT' },
      { id: 'kick', x: W - 182, y: H - 88, r: 62, label: 'KICK' },
      { id: 'punchR', x: W - 62, y: H - 62, r: 44, label: '👊', sub: 'RIGHT' },
      { id: 'brake', x: W - 182, y: H - 206, r: 36, label: 'BRAKE' },
    ];
  }
  const PAUSE_BTN = { x: W - 36, y: 118, r: 24 };
  function canvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * W / rect.width, y: (e.clientY - rect.top) * H / rect.height };
  }
  function hitTouchButton(x, y) {
    let best = null, bd = 1e9;
    for (const b of touchButtons()) {
      const d = Math.hypot(x - b.x, y - b.y);
      if (d < b.r * 1.35 && d < bd) { bd = d; best = b; }
    }
    return best;
  }
  function syncTouchKeys() {
    keys.left = keys.right = keys.down = false;
    for (const id of activePointers.values()) {
      if (id === 'left') keys.left = true;
      if (id === 'right') keys.right = true;
      if (id === 'brake') keys.down = true;
    }
  }
  canvas.addEventListener('pointerdown', (e) => {
    audio.init();
    if (e.pointerType === 'touch') touchMode = true;
    const { x, y } = canvasPoint(e);
    if (state === 'race' && touchMode && !race.paused && !portraitBlocked()) {
      e.preventDefault();
      if (Math.hypot(x - PAUSE_BTN.x, y - PAUSE_BTN.y) < PAUSE_BTN.r * 1.5) { setPaused(true, true); return; }
      const r = race;
      if (r.phase === 'intro') r.startPressed = true;
      if (r.phase === 'countdown' && r.upAt == null) r.upAt = r.countdown;
      const b = hitTouchButton(x, y);
      if (b) {
        activePointers.set(e.pointerId, b.id);
        if (b.id === 'kick') queueAttack('kick', 0);
        else if (b.id === 'punchL') queueAttack('punch', -1);
        else if (b.id === 'punchR') queueAttack('punch', 1);
        const card = TUT_TOUCH.find((c) => c.btns.includes(b.id));
        if (card) tutPress(card.id);
        syncTouchKeys();
        try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* not supported */ }
      }
      return;
    }
    for (const b of uiButtons) if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) { b.fn(); return; }
    if (state === 'title') startFromTitle();
    else if (state === 'results') continueFromResults();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!activePointers.has(e.pointerId)) return;
    const { x, y } = canvasPoint(e);
    const b = hitTouchButton(x, y);
    const cur = activePointers.get(e.pointerId);
    if (b && ['left', 'right', 'brake'].includes(b.id) && ['left', 'right', 'brake'].includes(cur)) {
      activePointers.set(e.pointerId, b.id);
      syncTouchKeys();
    }
  });
  const releasePointer = (e) => { if (activePointers.delete(e.pointerId)) syncTouchKeys(); };
  canvas.addEventListener('pointerup', releasePointer);
  canvas.addEventListener('pointercancel', releasePointer);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // ------------------------------------------------------------------ render
  function project(p, camX, camY, camZ) {
    p.camera.x = -camX;
    p.camera.y = p.world.y - camY;
    p.camera.z = p.world.z - camZ;
    const s = p.screen.scale = CAM_DEPTH / p.camera.z;
    p.screen.x = Math.round(HALF_W + s * p.camera.x * HALF_W);
    p.screen.y = Math.round(H / 2 - s * p.camera.y * H / 2);
    p.screen.w = Math.round(s * ROAD_W * HALF_W);
  }

  function drawLayer(L, off) {
    const base = L.b * H;
    ctx.fillStyle = L.c;
    if (L.s === 'hills') {
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += 8) {
        const t = (x / W + off) * Math.PI * 2;
        ctx.lineTo(x, base - L.a * (0.55 + 0.3 * Math.sin(t * L.f[0]) + 0.15 * Math.sin(t * L.f[1] + 1.3)));
      }
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fill();
    } else {
      const N = L.n, cw = W / N, shift = off * N, start = Math.floor(shift), frac = shift - start;
      for (let i = -1; i <= N; i++) {
        const col = ((start + i) % N + N) % N;
        const h = L.a * (0.3 + 0.7 * hash(col * 13 + L.seed));
        const x = (i - frac) * cw;
        ctx.fillStyle = L.c;
        ctx.fillRect(x, base - h, cw + 1, h + H);
        if (L.win) {
          for (let wy = base - h + 10; wy < base - 8; wy += 14) {
            for (let wx = 6; wx < cw - 6; wx += 12) {
              if (hash(col * 97 + wx * 3 + wy) < 0.3) {
                ctx.fillStyle = hash(col + wy) < 0.5 ? '#ffd86b' : '#ff6fc1';
                ctx.fillRect(x + wx, wy, 5, 6);
              }
            }
          }
        }
      }
    }
  }

  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, H * 0.55);
    g.addColorStop(0, theme.sky[0]);
    g.addColorStop(1, theme.sky[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    if (theme.night) {
      ctx.fillStyle = '#fff';
      for (let i = 0; i < 90; i++) {
        const x = (((hash(i) - bg[0]) % 1) + 1) % 1 * W, y = hash(i + 50) * H * 0.4;
        ctx.globalAlpha = 0.3 + 0.7 * hash(i + 99);
        ctx.fillRect(x, y, 2, 2);
      }
      ctx.globalAlpha = 1;
    }
    const sx = (((0.72 - bg[0]) % 1) + 1) % 1 * W, sy = H * 0.2;
    const sg = ctx.createRadialGradient(sx, sy, 10, sx, sy, 120);
    sg.addColorStop(0, theme.sun);
    sg.addColorStop(0.3, theme.sun + '88');
    sg.addColorStop(1, theme.sun + '00');
    ctx.fillStyle = sg;
    ctx.fillRect(sx - 120, sy - 120, 240, 240);
    ctx.fillStyle = theme.sun;
    circle(sx, sy, 34);
    theme.layers.forEach((L, i) => drawLayer(L, bg[Math.min(i, 2)]));
  }

  function drawSegment(seg, fog) {
    const a = seg.p1.screen, b = seg.p2.screen, alt = Math.floor(seg.index / RUMBLE_LEN) % 2;
    ctx.fillStyle = theme.grass[alt];
    ctx.fillRect(0, b.y, W, a.y - b.y);
    const r1 = a.w / 10, r2 = b.w / 10;
    poly(theme.rumble[alt], a.x - a.w - r1, a.y, a.x - a.w, a.y, b.x - b.w, b.y, b.x - b.w - r2, b.y);
    poly(theme.rumble[alt], a.x + a.w + r1, a.y, a.x + a.w, a.y, b.x + b.w, b.y, b.x + b.w + r2, b.y);
    if (seg.special) {
      const cols = 12;
      for (let i = 0; i < cols; i++) {
        const t1 = i / cols, t2 = (i + 1) / cols;
        poly((i + seg.index) % 2 ? '#f4f4f4' : '#111',
          lerp(a.x - a.w, a.x + a.w, t1), a.y, lerp(a.x - a.w, a.x + a.w, t2), a.y,
          lerp(b.x - b.w, b.x + b.w, t2), b.y, lerp(b.x - b.w, b.x + b.w, t1), b.y);
      }
    } else {
      poly(theme.road[alt], a.x - a.w, a.y, a.x + a.w, a.y, b.x + b.w, b.y, b.x - b.w, b.y);
      if (alt) {
        const l1 = a.w / 50, l2 = b.w / 50;
        for (let ln = 1; ln < LANES; ln++) {
          const t = ln / LANES;
          const xa = lerp(a.x - a.w, a.x + a.w, t), xb = lerp(b.x - b.w, b.x + b.w, t);
          poly(theme.lane, xa - l1, a.y, xa + l1, a.y, xb + l2, b.y, xb - l2, b.y);
        }
      }
    }
    if (fog > 0.01) {
      ctx.globalAlpha = fog;
      ctx.fillStyle = theme.fog;
      ctx.fillRect(0, b.y, W, a.y - b.y);
      ctx.globalAlpha = 1;
    }
  }

  const fogAt = (n) => 1 - Math.exp(-Math.pow(n / DRAW_DIST, 2) * theme.fogD);

  function entScreen(seg, z, xoff) {
    const pct = clamp((z - seg.p1.world.z) / SEG_LEN, 0, 1);
    const sc = lerp(seg.p1.screen.scale, seg.p2.screen.scale, pct);
    return {
      x: lerp(seg.p1.screen.x, seg.p2.screen.x, pct) + sc * xoff * ROAD_W * HALF_W,
      y: lerp(seg.p1.screen.y, seg.p2.screen.y, pct),
      s: sc * HALF_W,
    };
  }

  // draw fn(pixelScale) in world units, origin at bottom-centre, clipped to the hill line
  function drawAt(pos, clipY, w, h, alpha, fn) {
    if (pos.s <= 0 || w * pos.s < 1) return false;
    if (pos.y - h * pos.s > clipY) return false;
    if (pos.x + w * pos.s < 0 || pos.x - w * pos.s > W) return false;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, clipY);
    ctx.clip();
    ctx.globalAlpha = alpha;
    ctx.translate(pos.x, pos.y);
    ctx.scale(pos.s, pos.s);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    fn(pos.s);
    ctx.restore();
    return true;
  }

  // ------------------------------------------------------ roadside sprites
  const SPRITE_DRAW = {
    palm() {
      ctx.strokeStyle = '#7a5230'; ctx.lineWidth = 70;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(90, -520, 20, -1000); ctx.stroke();
      ctx.fillStyle = '#2e8b3e';
      for (let i = 0; i < 7; i++) {
        ctx.save(); ctx.translate(20, -1000); ctx.rotate(i / 7 * Math.PI * 2);
        ctx.beginPath(); ctx.ellipse(170, 40, 200, 50, 0.35, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = '#5a3a1e'; circle(20, -1000, 45);
    },
    bush() {
      ctx.fillStyle = '#2f7a35'; circle(-130, -110, 130); circle(130, -110, 130);
      ctx.fillStyle = '#3a9140'; circle(0, -170, 150);
    },
    pole() {
      ctx.fillStyle = '#9aa0a6'; ctx.fillRect(-20, -900, 40, 900);
      ctx.fillStyle = '#e53935'; ctx.fillRect(-45, -900, 90, 60);
      ctx.fillStyle = '#fff'; ctx.fillRect(-45, -840, 90, 25);
    },
    rock() {
      poly('#8a8580', -240, 0, -200, -200, -60, -320, 150, -280, 240, -120, 220, 0);
      poly('#a29d97', -200, -200, -60, -320, 40, -290, -80, -180);
    },
    cactus() {
      ctx.fillStyle = '#3e8e41';
      rr(-50, -760, 100, 760, 50);
      rr(-160, -520, 60, 260, 30); ctx.fillRect(-150, -300, 120, 50);
      rr(100, -620, 60, 260, 30); ctx.fillRect(40, -400, 100, 50);
    },
    pine() {
      ctx.fillStyle = '#5a3a1e'; ctx.fillRect(-35, -250, 70, 250);
      poly('#1f5a32', -280, -220, 280, -220, 0, -700);
      poly('#226638', -230, -520, 230, -520, 0, -1000);
      poly('#267040', -170, -800, 170, -800, 0, -1250);
    },
    lamp() {
      ctx.fillStyle = '#555c66'; ctx.fillRect(-18, -1100, 36, 1100); ctx.fillRect(-18, -1100, 160, 26);
      if (theme.night) {
        const g = ctx.createRadialGradient(130, -1060, 5, 130, -1060, 260);
        g.addColorStop(0, 'rgba(255,230,160,0.9)'); g.addColorStop(1, 'rgba(255,230,160,0)');
        ctx.fillStyle = g; ctx.fillRect(-130, -1320, 520, 520);
      }
      ctx.fillStyle = '#ffe9a8'; ctx.fillRect(90, -1076, 90, 22);
    },
    building(sp, s) {
      const w = 750, h = sp.h;
      ctx.fillStyle = sp.c; ctx.fillRect(-w, -h, 2 * w, h);
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(-w, -h, 2 * w, 70);
      if (s * w < 25) return;
      const cols = 6, rows = Math.floor((h - 300) / 170), cw = (2 * w - 160) / cols;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const hv = hash(sp.seed + r * 31 + c * 7);
          if (hv < 0.5) continue;
          ctx.fillStyle = theme.night ? (hv > 0.9 ? '#ff6fc1' : '#ffd86b') : '#9cc3e6';
          ctx.fillRect(-w + 80 + c * cw + 20, -h + 140 + r * 170, cw - 40, 110);
        }
      }
    },
    billboard(sp) {
      ctx.fillStyle = '#444'; ctx.fillRect(-520, -700, 60, 700); ctx.fillRect(460, -700, 60, 700);
      ctx.fillStyle = '#111'; ctx.fillRect(-750, -1150, 1500, 480);
      ctx.fillStyle = '#e0201c'; ctx.fillRect(-720, -1120, 1440, 420);
      ctx.font = `bold 230px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff'; ctx.fillText(sp.text, 0, -905, 1360);
    },
  };

  // ---------------------------------------------------------- bikes & cars
  function drawBikeBody(color, brake) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(0, 0, 160, 30, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#1b1b1b'; ctx.lineWidth = 18;
    line(-150, -350, 150, -350);
    ctx.fillStyle = '#333'; circle(-160, -405, 24); circle(160, -405, 24);
    ctx.lineWidth = 8; line(-150, -350, -160, -390); line(150, -350, 160, -390);
    ctx.fillStyle = '#111'; rr(-40, -175, 80, 175, 32);
    poly(color, -82, -170, 82, -170, 64, -255, -64, -255);
    ctx.fillStyle = brake ? '#ff3b3b' : '#9e1010'; rr(-36, -236, 72, 24, 6);
    if (brake) { ctx.fillStyle = 'rgba(255,60,60,0.35)'; circle(0, -224, 70); }
    ctx.fillStyle = '#a7adb3'; rr(72, -150, 36, 95, 14);
    ctx.fillStyle = '#222'; circle(90, -60, 14);
  }

  function drawWeapon(kind, hx, hy, sd, e) {
    if (kind === 'chain') {
      ctx.fillStyle = '#c8ccd0';
      for (let i = 1; i <= 7; i++) {
        const t = i / 7;
        circle(hx + sd * i * 34 * (0.4 + 0.6 * e), hy + Math.sin(t * Math.PI) * 60 * (1 - e) + t * 20, 12);
      }
    } else {
      ctx.strokeStyle = '#7b4a22'; ctx.lineWidth = 30;
      line(hx, hy, hx + sd * (60 + 150 * e), hy - 190 + 120 * e);
    }
  }

  function drawRiderBody(o) {
    const jacket = o.flash > 0.4 ? '#ffffff' : o.jacket;
    const a = o.attack;
    const e = a ? attackExt(a) : 0;
    ctx.lineWidth = 46;
    for (const sd of [-1, 1]) {
      ctx.strokeStyle = '#26344f';
      if (a && a.kind === 'kick' && a.side === sd) {
        const fx = sd * (130 + 290 * e), fy = -250 + 30 * e;
        line(sd * 45, -260, fx, fy);
        ctx.fillStyle = '#111'; circle(fx, fy, 34);
      } else {
        line(sd * 45, -255, sd * 98, -200, sd * 90, -140);
        ctx.fillStyle = '#111'; rr(sd * 90 - 30, -150, 60, 44, 12);
      }
    }
    ctx.fillStyle = jacket; rr(-82, -445, 164, 205, 52);
    ctx.fillStyle = 'rgba(0,0,0,0.22)'; rr(-12, -432, 24, 180, 10);
    ctx.lineWidth = 40;
    for (const sd of [-1, 1]) {
      ctx.strokeStyle = jacket;
      if (a && a.kind !== 'kick' && a.side === sd) {
        const hx = sd * (150 + 300 * e), hy = -420 + 40 * (1 - e);
        line(sd * 72, -415, hx, hy);
        ctx.fillStyle = '#1a1a1a'; circle(hx, hy, 30);
        if (o.weapon) drawWeapon(o.weapon, hx, hy, sd, e);
      } else {
        line(sd * 72, -415, sd * 150, -358);
        ctx.fillStyle = '#1a1a1a'; circle(sd * 150, -355, 25);
        if (o.weapon && sd === 1 && !a) drawWeapon(o.weapon, 150, -355, 1, 0);
      }
    }
    ctx.fillStyle = o.helmet; circle(0, -495, 64);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.ellipse(-22, -522, 24, 15, -0.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(-8, -558, 16, 126);
  }

  function drawRider(o) {
    if (o.crashT != null) {
      const t = clamp(o.crashT, 0, 1), sd = o.crashSide;
      ctx.save();
      ctx.translate(sd * t * 260, 0);
      ctx.rotate(sd * Math.min(1, t * 4) * Math.PI / 2 * 0.95);
      drawBikeBody(o.bike, false);
      ctx.restore();
      const hop = Math.sin(Math.min(1, t * 1.4) * Math.PI) * 420;
      ctx.save();
      ctx.translate(sd * (160 + t * 700), -hop - 330);
      ctx.rotate(sd * Math.min(t, 0.75) * 10);
      ctx.translate(0, 330);
      drawRiderBody({ ...o, attack: null, weapon: null });
      ctx.restore();
      return;
    }
    ctx.rotate(o.lean * 0.32);
    drawBikeBody(o.bike, o.brake);
    drawRiderBody(o);
  }

  function drawCar(c) {
    const w = c.w / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(0, 0, w + 20, 40, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#111';
    rr(-w + 30, -125, 110, 125, 20); rr(w - 140, -125, 110, 125, 20);
    const lights = c.oncoming ? '#fff6c0' : '#e01818';
    if (c.type === 'truck') {
      ctx.fillStyle = '#d7d7d2'; rr(-w, -c.h, 2 * w, c.h - 110, 16);
      ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.fillRect(-4, -c.h + 20, 8, c.h - 150);
      ctx.fillStyle = c.color; ctx.fillRect(-w, -c.h + 40, 2 * w, 70);
      ctx.fillStyle = lights; rr(-w + 20, -220, 100, 50, 10); rr(w - 120, -220, 100, 50, 10);
      ctx.fillStyle = '#333'; rr(-w + 10, -140, 2 * w - 20, 40, 10);
    } else {
      poly(shade(c.color), -w + 70, -320, w - 70, -320, w - 140, -500, -w + 140, -500);
      poly(c.oncoming ? '#2a3d52' : '#1c2a3a', -w + 105, -335, w - 105, -335, w - 160, -480, -w + 160, -480);
      ctx.fillStyle = c.color; rr(-w, -340, 2 * w, 230, 44);
      ctx.fillStyle = lights; rr(-w + 22, -300, 120, 52, 12); rr(w - 142, -300, 120, 52, 12);
      ctx.fillStyle = '#eee'; rr(-65, -250, 130, 55, 8);
      ctx.fillStyle = '#2b2b2b'; rr(-w + 10, -140, 2 * w - 20, 42, 12);
    }
    if (c.oncoming && theme.night) {
      ctx.fillStyle = 'rgba(255,246,190,0.25)'; circle(-w + 70, -260, 160); circle(w - 70, -260, 160);
    }
  }
  const shadeCache = {};
  function shade(hex) {
    if (shadeCache[hex]) return shadeCache[hex];
    const n = parseInt(hex.slice(1).padEnd(6, hex.slice(-1)), 16);
    const f = (v) => Math.floor(v * 0.72);
    return (shadeCache[hex] = `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`);
  }

  function riderPose(v, isPlayer) {
    return {
      jacket: isPlayer ? '#101010' : v.jacket, helmet: isPlayer ? '#e0201c' : v.helmet, bike: isPlayer ? '#e0201c' : v.bike,
      lean: v.lean, attack: v.attack, weapon: v.weapon, flash: isPlayer ? race.flash : v.flash,
      brake: isPlayer ? race.brake : false,
      crashT: v.state === 'crashed' ? 1 - v.crashT / (isPlayer ? CRASH_TIME : RIVAL_CRASH_TIME) : null,
      crashSide: v.crashSide,
    };
  }

  function speechBubble(x, y, s, text) {
    const size = clamp(s * 70, 13, 24);
    ctx.font = `${size}px ${FONT}`;
    const w = ctx.measureText(text).width + size, h = size * 1.5;
    ctx.fillStyle = '#fff';
    rr(x - w / 2, y - h, w, h, h / 2);
    poly('#fff', x - 6, y - 2, x + 6, y - 2, x - 2, y + 10);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#111';
    ctx.fillText(text, x, y - h * 0.28);
  }

  function renderWorld(view) {
    const baseSeg = findSegment(view.position);
    const basePct = (view.position % SEG_LEN) / SEG_LEN;
    const pz = view.position + PLAYER_Z;
    const pSeg = findSegment(pz);
    const pPct = (pz % SEG_LEN) / SEG_LEN;
    const playerY = lerp(pSeg.p1.world.y, pSeg.p2.world.y, pPct);

    drawBackground();

    let maxy = H, x = 0, dx = -(baseSeg.curve * basePct);
    const n0 = baseSeg.index;
    for (let n = 0; n < DRAW_DIST; n++) {
      const idx = n0 + n;
      if (idx >= segments.length) break;
      const seg = segments[idx];
      seg.clip = maxy;
      project(seg.p1, view.playerX * ROAD_W - x, playerY + CAM_H, view.position);
      project(seg.p2, view.playerX * ROAD_W - x - dx, playerY + CAM_H, view.position);
      x += dx;
      dx += seg.curve;
      seg.vis = seg.p1.camera.z > CAM_DEPTH;
      if (!seg.vis || seg.p2.screen.y >= seg.p1.screen.y || seg.p2.screen.y >= maxy) continue;
      drawSegment(seg, fogAt(n));
      maxy = seg.p2.screen.y;
    }

    const buckets = [];
    const add = (e, kind) => {
      const si = Math.floor(e.z / SEG_LEN), n = si - n0;
      if (n >= 0 && n < DRAW_DIST && si < segments.length) (buckets[n] || (buckets[n] = [])).push({ e, kind });
    };
    view.cars.forEach((c) => add(c, 'car'));
    view.rivals.forEach((v) => add(v, 'rival'));
    const playerN = pSeg.index - n0;

    const drawEnt = (seg, o, fog) => {
      const e = o.e;
      const pos = entScreen(seg, e.z, e.x);
      if (o.kind === 'car') { drawAt(pos, seg.clip, e.w, e.h, 1 - fog, () => drawCar(e)); return; }
      if (drawAt(pos, seg.clip, 900, 700, 1 - fog, () => drawRider(riderPose(e, false)))) {
        e._sx = pos.x; e._sy = pos.y - 330 * pos.s; e._frame = frameNo;
        if (e.sayT > 0 && pos.s > 0.08 && !COVER_MODE) speechBubble(pos.x, pos.y - 600 * pos.s, pos.s, e.say);
      }
    };

    for (let n = DRAW_DIST - 1; n >= 0; n--) {
      const idx = n0 + n;
      if (idx >= segments.length) continue;
      const seg = segments[idx];
      const b = buckets[n];
      if (seg.vis) {
        const fog = fogAt(n);
        for (const sp of seg.sprites) {
          const def = SPR[sp.type];
          const pos = entScreen(seg, seg.p1.world.z, sp.offset);
          drawAt(pos, seg.clip, def.w, sp.h || def.h, 1 - fog, (s) => SPRITE_DRAW[sp.type](sp, s));
        }
        if (b) {
          b.sort((p, q) => q.e.z - p.e.z);
          for (const o of b) if (n !== playerN || o.e.z >= pz) drawEnt(seg, o, fog);
        }
      }
      if (n === playerN && view.player) {
        drawPlayer(view.player, pSeg, pPct);
        if (b && seg.vis) for (const o of b) if (o.e.z < pz) drawEnt(seg, o, 0);
      }
    }
  }

  function drawPlayer(r, pSeg, pPct) {
    const sc = CAM_DEPTH / PLAYER_Z;
    const camY = lerp(pSeg.p1.camera.y, pSeg.p2.camera.y, pPct);
    let y = H / 2 - sc * camY * H / 2 - 6;
    r._sy = y;
    r._s = sc * HALF_W;
    if (r.invuln > 0 && Math.floor(r.invuln * 12) % 2) return;
    if (Math.abs(r.playerX) > 1 && r.speed > 0 && r.state === 'ride') y += (Math.random() * 2 - 1) * 4;
    if (r.phase !== 'go') y += (Math.random() * 2 - 1) * 2.5 * r.rev; // engine rumble while revving
    ctx.save();
    ctx.translate(HALF_W, y);
    ctx.scale(sc * HALF_W, sc * HALF_W);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    drawRider(riderPose(r, true));
    ctx.restore();
  }

  // -------------------------------------------------------------------- HUD
  function bar(x, y, w, h, pct, color, label) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; rr(x - 3, y - 3, w + 6, h + 6, 6);
    ctx.fillStyle = '#333'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = pct < 0.3 ? '#e53935' : color; ctx.fillRect(x, y, w * clamp(pct, 0, 1), h);
    txt(label, x + 6, y + h - 3, h - 2, '#fff', 'left', false);
  }

  function drawSpeedLines(k) {
    if (k <= 0) return;
    ctx.strokeStyle = `rgba(255,255,255,${0.4 * k})`;
    ctx.lineWidth = 2;
    const cx = W / 2, cy = H * 0.45;
    for (let i = 0; i < 6 + 16 * k; i++) {
      const a = Math.random() * Math.PI * 2;
      const r0 = rand(200, 300), r1 = r0 + rand(60, 200);
      line(cx + Math.cos(a) * r0 * 1.7, cy + Math.sin(a) * r0, cx + Math.cos(a) * r1 * 1.7, cy + Math.sin(a) * r1);
    }
  }

  function drawIntro(r) {
    const cards = touchMode ? TUT_TOUCH : TUT_KEYS;
    const fade = r.phase === 'go' ? clamp(1 - r.goT * 2, 0, 1) : 1;
    if (fade <= 0) return;
    const t = r.introT;
    ctx.save();
    ctx.globalAlpha = fade;
    if (r.phase === 'intro') {
      const allDone = cards.every((c) => r.tut[c.id] && r.tut[c.id].done);
      waveText(allDone ? "YOU'RE A PRO!" : "LET'S RIDE!", W / 2, 140, 66, t);
    }
    const widths = cards.map((c) => (c.wide ? 172 : 118)), gap = 18;
    let x = W / 2 - (widths.reduce((a, b) => a + b, 0) + gap * (cards.length - 1)) / 2;
    cards.forEach((c, i) => {
      const w = widths[i], h = 104, cx = x + w / 2, cy = 250;
      x += w + gap;
      const st = r.tut[c.id] || (r.tut[c.id] = { done: false, pop: 0 });
      const appear = clamp((t - 0.25 - i * 0.14) / 0.6, 0, 1);
      if (appear <= 0) return;
      const sc = elasticOut(appear) * (1 + st.pop * 0.35);
      const bob = Math.sin(t * 4 + i * 1.3) * 6, rot = Math.sin(t * 3 + i) * 0.07;
      const hue = (t * 160 + i * 60) % 360;
      c._x = cx; c._y = cy + bob;
      ctx.save();
      ctx.translate(cx, cy + bob);
      ctx.rotate(rot);
      ctx.scale(sc, sc);
      if (c.star) {
        ctx.save();
        ctx.rotate(t * 1.5);
        ctx.fillStyle = `hsla(${(hue + 180) % 360},100%,60%,0.9)`;
        starburst(0, 0, w * 0.66, w * 0.44, 14);
        ctx.restore();
      }
      ctx.shadowColor = `hsl(${hue},100%,60%)`;
      ctx.shadowBlur = 26;
      ctx.fillStyle = st.done ? '#1f8f3a' : '#15151f';
      rr(-w / 2, -h / 2, w, h, 18);
      ctx.shadowBlur = 0;
      ctx.lineWidth = 5;
      ctx.strokeStyle = st.done ? '#7CFC00' : `hsl(${hue},100%,60%)`;
      strokeRR(-w / 2, -h / 2, w, h, 18);
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      rr(-w / 2 + 8, -h / 2 + 8, w - 16, h * 0.5, 10);
      txt(c.key, 0, 6, c.key.length > 3 ? 32 : 44, '#fff');
      txt(c.label, 0, h / 2 - 12, 20, st.done ? '#fff' : '#ffd400');
      if (st.done) {
        ctx.fillStyle = '#7CFC00'; circle(w / 2 - 6, -h / 2 + 6, 17);
        txt('✓', w / 2 - 6, -h / 2 + 14, 24, '#0b3d12', 'center', false);
      }
      ctx.restore();
    });
    if (r.phase === 'intro' && r.waitStart && r.introT > 1.2) {
      const p = 1 + Math.sin(t * 8) * 0.08;
      ctx.save();
      ctx.translate(W / 2, 372);
      ctx.scale(p, p);
      txt(touchMode ? 'TAP TO GO!' : 'PRESS ↑ TO GO!', 0, 0, 42, `hsl(${(t * 200) % 360},100%,65%)`);
      ctx.restore();
    } else if (r.phase === 'countdown') {
      txt(touchMode ? 'Tap just before GO for a PERFECT START!' : 'Hit ↑ just before GO for a PERFECT START!', W / 2, 368, 22, '#fff');
    }
    ctx.restore();
  }

  function drawCountdown(r) {
    if (r.phase === 'countdown') {
      const n = Math.ceil(r.countdown), frac = n - r.countdown;
      const k = Math.min(1, frac * 4);
      const color = { 3: '#ff3b3b', 2: '#ffd400', 1: '#3bff6b' }[n] || '#fff';
      ctx.save();
      ctx.globalAlpha = 1 - frac;
      ctx.strokeStyle = color;
      ctx.lineWidth = 8;
      ctx.beginPath(); ctx.arc(W / 2, 110, 50 + frac * 260, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.translate(W / 2, 150);
      ctx.rotate((1 - k) * 0.6);
      ctx.scale(2.4 - 1.4 * k, 2.4 - 1.4 * k);
      txt(String(n), 0, 0, 120, color);
      ctx.restore();
    } else if (r.phase === 'go' && r.goT < 1.1) {
      ctx.save();
      ctx.globalAlpha = clamp((1.1 - r.goT) * 3, 0, 1);
      ctx.translate(W / 2, 108);
      const s = elasticOut(clamp(r.goT * 2, 0, 1));
      ctx.scale(s, s);
      waveText('GO!', 0, 0, 130, r.goT * 3);
      ctx.restore();
    }
  }

  function drawTouchControls(r) {
    for (const b of touchButtons()) {
      const held = [...activePointers.values()].includes(b.id);
      ctx.globalAlpha = held ? 0.75 : 0.42;
      ctx.fillStyle = b.id === 'kick' ? '#e0201c' : b.id === 'brake' ? '#555' : '#111';
      circle(b.x, b.y, b.r * (held ? 0.92 : 1));
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r * (held ? 0.92 : 1), 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
      const size = b.label.length > 2 ? (b.id === 'kick' ? 28 : 18) : 36;
      txt(b.label, b.x, b.y + size * 0.36 - (b.sub ? 6 : 0), size, '#fff', 'center', false);
      if (b.sub) txt(b.sub, b.x, b.y + 26, 13, '#ddd', 'center', false);
    }
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = '#111'; circle(PAUSE_BTN.x, PAUSE_BTN.y, PAUSE_BTN.r);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff';
    ctx.fillRect(PAUSE_BTN.x - 8, PAUSE_BTN.y - 9, 6, 18);
    ctx.fillRect(PAUSE_BTN.x + 2, PAUSE_BTN.y - 9, 6, 18);
  }

  function drawHUD() {
    const r = race, pz = r.position + PLAYER_Z;
    const spd = r.speed / r.maxSpeed;
    drawSpeedLines(r.boost > 0 ? 1 : clamp((spd - 0.93) * 12, 0, 0.7));
    drawParticles();

    const bx = 200, bw = W - 400, by = 22;
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; rr(bx - 10, by - 10, bw + 20, 20, 10);
    ctx.fillStyle = '#888'; ctx.fillRect(bx, by - 1, bw, 2);
    for (let i = 0; i < 6; i++) { ctx.fillStyle = i % 2 ? '#fff' : '#111'; ctx.fillRect(bx + bw - 6 + (i % 2) * 3, by - 8 + Math.floor(i / 2) * 5, 3, 5); }
    for (const v of r.rivals) {
      ctx.fillStyle = v.state === 'crashed' ? '#777' : v.jacket;
      circle(bx + bw * clamp(v.z / finishZ, 0, 1), by, 5);
    }
    ctx.fillStyle = '#ffd400';
    const px = bx + bw * clamp(pz / finishZ, 0, 1);
    poly('#ffd400', px, by - 2, px - 7, by - 13, px + 7, by - 13);
    circle(px, by, 6);

    txt(String(r.place), 24, 86, 72, '#ffd400', 'left');
    const pw = ctx.measureText(String(r.place)).width;
    txt(ordinal(r.place).replace(/\d+/, '').toUpperCase() + ' / 8', 30 + pw, 60, 24, '#fff', 'left');
    txt(fmtTime(r.time), 30 + pw, 86, 22, '#ddd', 'left');

    txt(`$${save.money}`, W - 24, 58, 30, '#7CFC00', 'right');
    if (r.cash) txt(`+$${r.cash} this race`, W - 24, 82, 18, '#bfffa0', 'right');

    const speedTxt = String(Math.round(r.speed / BASE_MAX * 120));
    const wpnTxt = r.weapon ? r.weapon.toUpperCase() : 'FISTS';
    if (touchMode) {
      bar(24, 104, 180, 14, r.health / r.maxHealth, '#35d04a', 'RIDER');
      bar(24, 128, 180, 14, r.bike / r.maxBike, '#f0a020', 'BIKE');
      txt(speedTxt, W - 128, 164, 40, '#fff', 'right');
      txt('MPH', W - 74, 164, 18, '#ffd400', 'right');
      txt(wpnTxt, W - 74, 186, 18, r.weapon ? '#19e6ff' : '#bbb', 'right');
    } else {
      bar(24, H - 76, 220, 18, r.health / r.maxHealth, '#35d04a', 'RIDER');
      bar(24, H - 46, 220, 18, r.bike / r.maxBike, '#f0a020', 'BIKE');
      txt(speedTxt, W - 90, H - 28, 64, '#fff', 'right');
      txt('MPH', W - 24, H - 30, 22, '#ffd400', 'right');
      txt(wpnTxt, W - 24, H - 100, 22, r.weapon ? '#19e6ff' : '#bbb', 'right');
    }
    if (r.boost > 0) txt('BOOST!', W / 2, H - 24, 30, `hsl(${(r.clock * 400) % 360},100%,60%)`);

    let near = null, nd = 1e9;
    for (const v of r.rivals) {
      const d = Math.abs(v.z - pz);
      if (v.state === 'ride' && d < 900 && d < nd) { nd = d; near = v; }
    }
    if (near && r.phase === 'go') {
      const x = W / 2 - 120, y = 44;
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; rr(x, y, 240, 46, 8);
      txt(near.name.toUpperCase() + (near.weapon ? ` · ${near.weapon.toUpperCase()}` : ''), W / 2, y + 20, 18, '#fff');
      ctx.fillStyle = '#333'; ctx.fillRect(x + 12, y + 28, 216, 9);
      ctx.fillStyle = '#e53935'; ctx.fillRect(x + 12, y + 28, 216 * clamp(near.health / near.maxHealth, 0, 1), 9);
    }

    r.msgs.forEach((m, i) => {
      ctx.save();
      ctx.globalAlpha = clamp(m.t * 2, 0, 1);
      const pop = 1 + 0.4 * Math.max(0, 1 - m.age * 6);
      ctx.translate(W / 2, 160 + i * 46);
      ctx.scale(pop, pop);
      txt(m.text, 0, 0, m.size, m.color);
      ctx.restore();
    });

    drawIntro(r);
    drawCountdown(r);

    if (r.flash > 0) {
      const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.8);
      g.addColorStop(0, 'rgba(255,0,0,0)'); g.addColorStop(1, `rgba(255,0,0,${r.flash * 0.45})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    if (touchMode && !r.paused) drawTouchControls(r);
    if (r.paused) {
      ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(0, 0, W, H);
      txt('PAUSED', W / 2, H / 2 - 60, 80, '#ffd400');
      button(W / 2 - 150, H / 2 - 20, 300, 52, 'RESUME', () => setPaused(false, true));
      button(W / 2 - 150, H / 2 + 46, 300, 52, 'QUIT RACE', quitToTitle, '#444');
      if (!touchMode) txt('P resume  ·  Q quit  ·  M sound', W / 2, H / 2 + 136, 20, '#ccc');
    }
  }

  function panel(x, y, w, h, stroke) {
    ctx.fillStyle = 'rgba(12,12,20,0.88)'; rr(x, y, w, h, 12);
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; strokeRR(x, y, w, h, 12); }
  }
  function button(x, y, w, h, label, fn, color = '#e0201c') {
    ctx.fillStyle = color; rr(x, y, w, h, 10);
    let size = 28;
    ctx.font = `${size}px ${FONT}`;
    while (size > 14 && ctx.measureText(label).width > w - 24) { size -= 2; ctx.font = `${size}px ${FONT}`; }
    txt(label, x + w / 2, y + h / 2 + size * 0.36, size, '#fff');
    uiButtons.push({ x, y, w, h, fn });
  }

  function drawLogo(cx, cy, k) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(k, k);
    ctx.rotate(-0.04);
    txt(TITLE[0], 0, 0, 104, '#f0f0f0');
    txt(TITLE[1], 0, 110, 132, '#e0201c');
    ctx.restore();
  }

  function drawTitle() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,0.65)'); g.addColorStop(0.6, 'rgba(0,0,0,0.25)'); g.addColorStop(1, 'rgba(0,0,0,0.75)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    drawLogo(W / 2, 150, 1 + Math.sin(blink * 3) * 0.02);
    txt('combat motorcycle racing', W / 2, 300, 24, '#ffd400');
    if (Math.floor(blink * 2) % 2 === 0) txt(touchMode ? 'TAP TO RIDE' : 'PRESS ENTER TO RIDE', W / 2, 360, 34, '#fff');
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; rr(W / 2 - 300, 390, 600, 110, 10);
    if (touchMode) {
      txt('Gas is automatic  ·  ◀ ▶ steer  ·  BRAKE to slow down', W / 2, 422, 20, '#fff', 'center', false);
      txt('KICK and 👊 PUNCH buttons to fight', W / 2, 452, 20, '#ffd400', 'center', false);
    } else {
      txt('↑ gas   ↓ brake   ← → steer   (or WASD)', W / 2, 422, 20, '#fff', 'center', false);
      txt('SPACE kick   ·   Z punch left   ·   C punch right', W / 2, 452, 20, '#ffd400', 'center', false);
    }
    txt('Knock rivals out to steal their weapons · Top 3 advances', W / 2, 482, 18, '#bbb', 'center', false);
    txt(`LEVEL ${save.level}  ·  $${save.money}`, 20, 34, 22, '#7CFC00', 'left');
    if (!touchMode) txt('N = new game   ·   M = sound', W - 20, 34, 18, '#ccc', 'right');
  }

  function drawShop() {
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, W, H);
    txt('THE GARAGE', W / 2, 68, 56, '#ffd400');
    txt(`CASH  $${save.money}`, W / 2, 106, 28, '#7CFC00');
    txt(`NEXT: ${theme.name.toUpperCase()}  ·  RACE ${save.level}`, W / 2, 140, 22, '#fff');
    SHOP.forEach((it, i) => {
      const y = 162 + i * 72, x = W / 2 - 310, w = 620, h = 62;
      const lvl = shopLevel(it), maxed = lvl >= it.max, cost = it.cost(lvl), can = !maxed && save.money >= cost;
      panel(x, y, w, h, can ? '#ffd400' : '#444');
      txt(String(i + 1), x + 32, y + 43, 34, '#ffd400');
      txt(it.name, x + 64, y + 28, 22, '#fff', 'left', false);
      txt(it.desc, x + 64, y + 50, 16, '#aab', 'left', false);
      if (!it.oneShot) {
        for (let k = 0; k < it.max; k++) { ctx.fillStyle = k < lvl ? '#ffd400' : '#3a3a44'; ctx.fillRect(x + 330 + k * 26, y + 22, 20, 18); }
      }
      txt(maxed ? (it.oneShot ? 'EQUIPPED' : 'MAXED') : `$${cost}`, x + w - 20, y + 42, 28, maxed ? '#19e6ff' : can ? '#7CFC00' : '#d55', 'right');
      uiButtons.push({ x, y, w, h, fn: () => buy(i) });
    });
    button(W / 2 - 150, 462, 300, 52, touchMode ? 'RACE!' : 'RACE!  (ENTER)', startRace);
    if (toast) txt(toast.text, W / 2, H - 10, 20, '#fff');
  }

  function drawResults() {
    ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(0, 0, W, H);
    const R = results;
    panel(W / 2 - 280, 60, 560, 420, R.qualified ? '#7CFC00' : '#e0201c');
    if (R.wrecked) txt('WRECKED!', W / 2, 140, 78, '#e0201c');
    else txt(`${ordinal(R.place).toUpperCase()} PLACE`, W / 2, 140, 78, R.qualified ? '#7CFC00' : '#ffd400');
    const rows = [
      ['Time', fmtTime(R.time)],
      ['Prize money', `$${R.prize}`],
      [`Knockouts (${R.kos}) & combos`, `$${R.cash}`],
    ];
    if (R.repair) rows.push(['Bike repairs', `-$${R.repair}`]);
    rows.push(['Bank', `$${save.money}`]);
    rows.forEach(([k, v], i) => {
      txt(k, W / 2 - 220, 200 + i * 38, 24, '#ddd', 'left', false);
      txt(v, W / 2 + 220, 200 + i * 38, 24, '#fff', 'right', false);
    });
    txt(R.qualified ? `QUALIFIED! Next up: race ${save.level}` : 'Finish top 3 to advance. Upgrade and try again!', W / 2, 396, 22, R.qualified ? '#7CFC00' : '#ffd400');
    const bonus = adBonus();
    if (bonus) {
      // the ad offer and the plain continue button are the same size, so skipping is just as easy
      const label = R.wrecked ? `▶ AD: FREE REPAIR +$${bonus}` : `▶ AD: DOUBLE IT +$${bonus}`;
      button(W / 2 - 262, 414, 256, 50, label, watchAdForBonus, '#1f8f3a');
      button(W / 2 + 6, 414, 256, 50, 'CONTINUE', continueFromResults, '#444');
      if (!touchMode) txt('D = watch ad   ·   ENTER = continue', W / 2, 500, 18, '#ccc');
    } else {
      button(W / 2 - 128, 414, 256, 50, 'CONTINUE', continueFromResults, '#444');
      if (!touchMode) txt('ENTER to continue', W / 2, 500, 18, '#ccc');
    }
  }

  function drawRotateHint() {
    ctx.fillStyle = 'rgba(0,0,0,0.9)'; ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.translate(W / 2, H / 2 - 40);
    ctx.rotate(Math.sin(blink * 3) * 0.8 - 0.8);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 8;
    strokeRR(-40, -70, 80, 140, 14);
    ctx.restore();
    txt('ROTATE YOUR PHONE', W / 2, H / 2 + 110, 48, '#ffd400');
  }

  function render() {
    frameNo++;
    uiButtons = [];
    ctx.setTransform(RS, 0, 0, RS, 0, 0);
    ctx.save();
    if (state === 'race' && race.shake > 0) ctx.translate((Math.random() * 2 - 1) * race.shake * 10, (Math.random() * 2 - 1) * race.shake * 10);
    if (state === 'race' || state === 'results' || state === 'ad') {
      renderWorld({ position: race.position, playerX: race.playerX, rivals: race.rivals, cars: race.cars, player: race });
    } else {
      renderWorld({ position: attractPos, playerX: 0, rivals: [], cars: [], player: null });
    }
    ctx.restore();
    if (state === 'race') drawHUD();
    else {
      if (state === 'title') drawTitle();
      else if (state === 'shop') drawShop();
      else if (state === 'results') drawResults();
      else { ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(0, 0, W, H); }
      drawParticles();
    }
    if (toast && state !== 'shop') txt(toast.text, W / 2, H - 20, 22, '#fff');
    if (portraitBlocked()) drawRotateHint();
  }

  // ------------------------------------------------------------------ loop
  let last = performance.now(), acc = 0;
  function frame(now) {
    const real = Math.min(0.1, (now - last) / 1000);
    last = now;
    try {
      let scale = 1;
      if (state === 'race' && race.slowmo > 0 && !race.paused) { race.slowmo -= real; scale = 0.35; }
      acc += real * scale;
      while (acc >= STEP) { update(STEP); acc -= STEP; }
      render();
    } catch (e) {
      console.error(e); // keep the loop alive; one bad frame should not freeze the game
      acc = 0;
    }
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------ store covers
  // Open index.html?covers to render the store images (only the title as text, per CrazyGames rules).
  async function makeCovers() {
    document.body.style.cssText = 'display:block;overflow:auto;height:auto;background:#222;color:#fff;font:14px sans-serif;padding:12px';
    save.level = 1;
    newRace();
    for (const s of segments) s.sprites = s.sprites.filter((sp) => sp.type !== 'billboard');
    const r = race;
    r.phase = 'go'; r.goT = 9; r.introT = 9;
    let idx = 300;
    for (let i = 200; i < 1200; i++) if (segments[i].curve >= 2 && segments[i + 15].curve >= 2) { idx = i; break; }
    r.position = idx * SEG_LEN;
    const pz = r.position + PLAYER_Z;
    r.playerX = 0.08; r.lean = 0.25; r.speed = r.maxSpeed;
    r.attack = { kind: 'kick', side: 1, t: 0.12, dur: 0.32 };
    const rv = r.rivals;
    Object.assign(rv[0], { z: pz + 70, x: 0.5, lean: -0.3, flash: 0 });
    Object.assign(rv[1], { z: pz + 150, x: -0.42, weapon: 'chain', attack: { kind: 'punch', side: 1, t: 0.11, dur: 0.3 } });
    Object.assign(rv[2], { z: pz + 1500, x: 0.15 });
    Object.assign(rv[3], { z: pz + 2800, x: -0.3, state: 'crashed', crashT: 1.3, crashSide: -1 });
    Object.assign(rv[4], { z: pz + 4400, x: 0.55 });
    Object.assign(rv[5], { z: pz + 7000, x: -0.1 });
    Object.assign(rv[6], { z: pz + 9500, x: 0.35 });
    r.cars.forEach((c, i) => spawnCar(c, pz + 40000 + i * 6000));
    Object.assign(r.cars[0], { z: pz + 6000, x: -0.667, oncoming: true, speed: -4000 });
    Object.assign(r.cars[1], { z: pz + 12000, x: 0.667, oncoming: false, speed: 4000 });

    RS = 2;
    canvas.width = W * 2; canvas.height = H * 2;
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    frameNo = 5;
    renderWorld({ position: r.position, playerX: r.playerX, rivals: r.rivals, cars: r.cars, player: r });
    const kicked = rv[0];
    ctx.fillStyle = '#ffd400';
    for (let i = 0; i < 6; i++) star(kicked._sx - 60 + Math.cos(i) * 55, kicked._sy + Math.sin(i * 2) * 45, 14 + (i % 3) * 5, i);

    const shots = [
      ['cover-landscape.png', 1920, 1080, 0.2, 1.7],
      ['cover-portrait.png', 800, 1200, 0.16, 1.0],
      ['cover-square.png', 800, 800, 0.2, 0.95],
      ['cover-itch.png', 630, 500, 0.22, 0.72],
      // itch.io page theme: banner above the game, and the backdrop behind its "Run game" button
      ['itch-banner.png', 960, 300, 0.25, 0.8, 0.6],
      ['itch-embed-bg.png', 1920, 1080, 0, 0, 1, 0.45],
    ];
    const main = canvas, mainCtx = ctx;
    for (const [name, w, h, logoY, k, cropY = 1, dim = 0] of shots) {
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const c2 = cv.getContext('2d');
      const sw = main.width, sh = main.height, ta = w / h;
      let cw = sw, ch = sh;
      if (ta < sw / sh) cw = sh * ta; else ch = sw / ta;
      c2.drawImage(main, (sw - cw) / 2, (sh - ch) * cropY, cw, ch, 0, 0, w, h);
      if (dim) { c2.fillStyle = `rgba(0,0,0,${dim})`; c2.fillRect(0, 0, w, h); }
      const g = c2.createLinearGradient(0, 0, 0, h * 0.5);
      g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      c2.fillStyle = g; c2.fillRect(0, 0, w, h * 0.5);
      if (k) {
        ctx = c2;
        drawLogo(w / 2, h * logoY + 60 * k, k);
        ctx = mainCtx;
      }
      const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
      const img = document.createElement('img');
      img.src = URL.createObjectURL(blob);
      img.style.cssText = 'max-width:100%;display:block;margin:8px 0;border:1px solid #555';
      const a = document.createElement('a');
      a.href = img.src; a.download = name; a.textContent = `Download ${name} (${w}x${h})`; a.style.color = '#7cf';
      document.body.append(a, img);
      fetch(`/__save?name=${name}`, { method: 'POST', body: blob }).catch(() => { /* only the dev server accepts saves */ });
    }
    canvas.style.display = 'none';
  }

  // --------------------------------------------------------------------- boot
  async function boot() {
    resize();
    window.addEventListener('resize', resize);
    await platform.init();
    platform.loadingStart();
    loadSave();
    buildTrack(save.level);
    platform.loadingStop();
    if (DEBUG) {
      window.__brawl = {
        get race() { return race; }, get state() { return state; }, save,
        // advance the simulation by hand (works even when the tab isn't painting frames)
        tick(seconds) { for (let i = 0; i < Math.round(seconds / STEP); i++) update(STEP); render(); },
        // renders the current frame at 1920x1080 and saves it via the dev server
        async capture(name) {
          const prev = RS;
          RS = 2; canvas.width = W * 2; canvas.height = H * 2;
          render();
          const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
          RS = prev; resize();
          await fetch(`/__save?name=${name}`, { method: 'POST', body: blob });
        },
      };
    }
    if (COVER_MODE) { makeCovers(); return; }
    requestAnimationFrame(frame);
  }
  boot();
})();
