'use strict';
// Rocket Skyway — sky-highway rocket racer against bot pilots (inspired by SkyRoads).
// No build step, no assets: every ship, tile and star is drawn in code,
// so the whole game is this file + index.html.
(function () {
  // ----------------------------------------------------------------- config
  const TITLE = ['ROCKET', 'SKYWAY']; // game name: title screen + store covers
  const params = new URLSearchParams(location.search);
  const DEBUG = params.has('debug');
  const COVER_MODE = params.has('covers');
  const OFF = DEBUG ? (window.__off = {}) : {}; // debug: switch render layers off to profile them

  const canvas = document.getElementById('game');
  let ctx = canvas.getContext('2d');
  const W = 960, H = 540;
  let RS = 1; // backing-store scale so the canvas stays crisp on high-DPI screens

  // ---------------------------------------------------------------- constants
  const STEP = 1 / 60;
  const LANES = 7, MID = 3;          // lanes are 1 unit wide; lane l is centred on x = l - MID
  const ROW_D = 1.6;                 // world depth of one track row (z is measured in rows)
  const SLAB = 0.32, BLOCK_H = 0.62;  // tile thickness, raised-block height
  const GRAV = 16, JUMP_V = 7.2, PAD_V = 9.6;                 // low gravity: floaty, moon-like jumps
  const JUMP_T = 2 * JUMP_V / GRAV, PAD_T = 2 * PAD_V / GRAV; // air time over flat ground
  const GAP_T = 0.667;                                         // gap sizing in track pieces (kept from the snappier jump)
  const IDLE = 0.6;                                            // player speed with the gas released, vs. cruise
  const SPEED_TO_MPH = 62, MAX_SPEED = 977 / SPEED_TO_MPH;
  const MAX_CRUISE = MAX_SPEED / 1.2; // Leave room for several boosts, even on later courses.
  const STEER = 8.5;                 // lanes per second
  const FOCAL = 560, CY = H * 0.42, PITCH = 0.25, COSP = Math.cos(PITCH), SINP = Math.sin(PITCH);
  const CAM_BACK = 4.6, CAM_UP = 2.0, NEAR = 0.4, DRAW_ROWS = 56; // chase camera: centred right behind the player
  const GAP_X = 0.035, GAP_Z = 0.05; // seams between tiles
  const RESPAWN_T = 1.1, GHOST_T = 1.6, BOOST_T = 1.6, FUEL_TIME = 38;
  const FONT = 'Impact, "Arial Black", "Haettenschweiler", sans-serif';
  const RAINBOW = ['#ff3b3b', '#ffd400', '#3bff6b', '#19e6ff', '#b84dff', '#ff4fa8'];
  const PLACE_COINS = [40, 25, 15, 5, 0];
  const PASSING = ['ZOOM!', 'SEE YA!', 'BEEP BEEP!', 'WHEEE!', 'TOO SLOW!'];
  const PASSED = ['HEY!', 'NO FAIR!', 'WOW!', 'COME BACK!', 'HOW?!'];
  const OOPS = ['OOPS!', 'UH-OH!', 'NOOO!', 'MY SHIP!'];
  const SHOVES = ['BONK!', 'MOVE!', 'COMING THRU!'];
  const BUDDY_PASSING = ['RACE YOU!', 'CATCH ME!', 'WHEEE!', 'COME ON!'];
  const BUDDY_PASSED = ['NICE ONE!', 'WOW!', 'GO GO GO!', 'SO FAST!'];
  const BUDDY_WAIT = ["I'LL WAIT!", 'YOU GOT THIS!', 'TRY AGAIN!'];

  // ------------------------------------------------------------------ utils
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const elasticOut = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1);
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr, r = Math.random) => arr[Math.floor(r() * arr.length)];
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
  const rgbCache = {};
  function rgb(hex) {
    let c = rgbCache[hex];
    if (!c) { const n = parseInt(hex.slice(1), 16); c = rgbCache[hex] = [n >> 16 & 255, n >> 8 & 255, n & 255]; }
    return c;
  }
  let FOG = [0, 0, 0];
  // colour * light, blended toward the fog colour
  function shade(c, k, fog) {
    const r = c[0] * k, g = c[1] * k, b = c[2] * k;
    return `rgb(${(r + (FOG[0] - r) * fog) | 0},${(g + (FOG[1] - g) * fog) | 0},${(b + (FOG[2] - b) * fog) | 0})`;
  }

  function resize() {
    const cssW = canvas.getBoundingClientRect().width || W;
    const next = clamp(Math.round(cssW * (window.devicePixelRatio || 1) / W * 4) / 4, 1, 1.5); // capped: fill rate matters on phones
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
  function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, Math.max(0, r), 0, Math.PI * 2); ctx.fill(); }
  function star(x, y, r, rot) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 ? r * 0.45 : r, a = rot + i * Math.PI / 5;
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
      name: 'MOON', sky: ['#010208', '#070b1c'], glow: '#6b7dff',
      planet: { x: 0.8, y: 0.17, r: 70, c: ['#f4f6ff', '#9aa3c6', '#1a1d2e'], ring: null },
      neb: [[0.25, 0.2, 280, 'rgba(70,90,200,0.09)'], [0.7, 0.35, 240, 'rgba(130,80,200,0.07)']],
      tiles: ['#59617f', '#4d5573', '#646d8c', '#525a79'], block: '#d3dbf5',
    },
    {
      name: 'MARS', sky: ['#030104', '#120709'], glow: '#ff6a3a',
      planet: { x: 0.2, y: 0.2, r: 105, c: ['#ffb27a', '#b84a22', '#1e0805'], ring: '#d8b090' },
      neb: [[0.7, 0.18, 280, 'rgba(200,90,50,0.08)'], [0.4, 0.4, 220, 'rgba(180,40,70,0.06)']],
      tiles: ['#7d5446', '#704a3d', '#8a5f50', '#755043'], block: '#f6bd8a',
    },
    {
      name: 'NEBULA', sky: ['#020108', '#0d0618'], glow: '#ff4fd8',
      planet: { x: 0.76, y: 0.15, r: 58, c: ['#b5f6ff', '#4f7fff', '#0c0a26'], ring: '#c8a0e0' },
      neb: [[0.3, 0.22, 320, 'rgba(200,60,170,0.13)'], [0.65, 0.3, 260, 'rgba(60,150,220,0.09)']],
      tiles: ['#5f5280', '#544873', '#6b5d8d', '#584c78'], block: '#f8ccff',
    },
    {
      name: 'ICE RINGS', sky: ['#010307', '#051220'], glow: '#7fe8ff',
      planet: { x: 0.28, y: 0.22, r: 125, c: ['#ffffff', '#8cc4dc', '#0b2232'], ring: '#b8dcec' },
      neb: [[0.75, 0.2, 280, 'rgba(90,190,230,0.08)'], [0.45, 0.38, 220, 'rgba(130,140,230,0.06)']],
      tiles: ['#61808f', '#567584', '#6d8c9b', '#5b7a89'], block: '#ffffff',
    },
  ];
  let theme = THEMES[0];
  // neon hover-track look per theme: dark track body, faint lane lines, and glowing edge colours (one per track section)
  const TRACK_STYLE = {
    MOON: { base: '#2b3150', line: '#4a5478', neons: ['#6cc8f0', '#9b94e8', '#6ce0c8', '#b49ae0'] },
    MARS: { base: '#3e2722', line: '#6a4238', neons: ['#f09a5a', '#e8c25a', '#e86a6a', '#f0b088'] },
    NEBULA: { base: '#2e2644', line: '#4f4270', neons: ['#e070c8', '#70c8e8', '#a88ae8', '#e890c8'] },
    'ICE RINGS': { base: '#2a3e4a', line: '#4a6878', neons: ['#a0e8f8', '#e0f4ff', '#88c8e8', '#b0f0e0'] },
  };

  const LEVEL_NAMES = ['MOON HOP', 'CRATER DASH', 'LUNAR LOOP', 'RED DUST', 'MARS MAZE', 'DUST DEVIL',
    'PINK NEBULA', 'STAR NURSERY', 'COMET TAIL', 'ICE RINGS', 'FROZEN LANES', 'FINAL ORBIT'];
  const LEVELS = LEVEL_NAMES.length;
  function levelDef(i) {
    const skill = (i - 1) / (LEVELS - 1);
    return {
      i, name: LEVEL_NAMES[i - 1], theme: THEMES[Math.min(THEMES.length - 1, Math.floor((i - 1) / 3))],
      seed: 1000 + i * 97, rows: 400 + i * 60, cruise: Math.min(MAX_CRUISE, 10.5 + (i - 1) * 0.38), maxD: Math.min(5, Math.ceil(i / 2.4)), skill,
    };
  }

  const SKINS = [
    { name: 'SKYHAWK', color: '#ffc81f', trail: '#ffb03b', cost: 0 },
    { name: 'RED ROCKET', color: '#ff3b3b', trail: '#ffb03b', cost: 150 },
    { name: 'GREEN GECKO', color: '#36d66b', trail: '#c4ff6b', cost: 300 },
    { name: 'BLUE COMET', color: '#2f8bff', trail: '#7fd8ff', cost: 500 },
    { name: 'PINK NOVA', color: '#ff5fc8', trail: '#ffc0f0', cost: 800 },
    { name: 'RAINBOW', color: '#ffffff', trail: 'rainbow', cost: 1500 },
  ];
  const PILOTS = [
    { name: 'NOVA', color: '#ff4fa8', trail: '#ffb0d8' }, { name: 'ZIP', color: '#ffd400', trail: '#fff0a0' },
    { name: 'COMET', color: '#3bff6b', trail: '#b0ffc0' }, { name: 'ORBIT', color: '#b84dff', trail: '#e0b0ff' },
    { name: 'PIXEL', color: '#ff8a1f', trail: '#ffd0a0' }, { name: 'BLIP', color: '#19e6ff', trail: '#b0f6ff' },
    { name: 'ROCKO', color: '#ff3b3b', trail: '#ffb0a0' }, { name: 'LUNA', color: '#e8e8ff', trail: '#ffffff' },
  ];

  // ------------------------------------------------------------- track tiles
  const T_GAP = 0, T_FLOOR = 1, T_BOOST = 2, T_STICKY = 3, T_BURN = 4, T_FUEL = 5, T_PAD = 6, T_BLOCK = 7, T_FINISH = 8;
  const CHAR_TILE = { '.': T_GAP, '=': T_FLOOR, o: T_FLOOR, B: T_BOOST, S: T_STICKY, X: T_BURN, F: T_FUEL, J: T_PAD, '#': T_BLOCK };
  const WALK = [false, true, true, true, false, true, true, false, true]; // safe to drive onto
  const AI_COST = [0, 0, -0.5, 2.5, 0, -2.5, 0.2, 0, 0];               // bots like boosts and fuel, avoid goo

  // Track pieces, 7 lanes wide. The FIRST string is the row you reach first.
  // . gap   = floor   o floor+coin   B boost   S sticky goo   X burning   F fuel   J jump pad   # raised block
  // d = difficulty 1-5, gap = longest gap (only used when the level is fast enough to clear it).
  const CHUNKS = [
    { d: 1, rows: ['=======', '..===..', '..=o=..', '..=o=..', '..=o=..', '..===..', '======='] },
    { d: 1, gap: 2, rows: ['=======', '===o===', '.......', '.......', '===o===', '======='] },
    { d: 1, rows: ['==...==', 'o=...=o', 'o=...=o', 'o=...=o', '==...==', '==...=='] },
    { d: 1, rows: ['===B===', '===B===', '===B===', '===B===', '===B===', '======='] },
    { d: 1, rows: ['=======', '=#===#=', '=======', '===o===', '===#===', '=======', '=#=o=#=', '======='] },
    { d: 1, rows: ['===....', 'o==....', '===....', '..===..', '..=o=..', '..===..', '....===', '....==o', '....===', '..===..', '..===..'] },
    { d: 1, rows: ['=======', 'B=====B', 'B==S==B', 'B=SSS=B', 'B==S==B', 'B=====B', '======='] },
    { d: 2, gap: 3, rows: ['=======', '==B=B==', '.......', '.......', '.......', '=======', '===o===', '======='] },
    { d: 2, rows: ['=======', '=X===X=', '=X=o=X=', '===X===', '=o=X=o=', '=X===X=', '=X===X=', '======='] },
    { d: 2, rows: ['SSS=SSS', 'SSSBSSS', 'SSS=SSS', 'SSSBSSS', 'SSS=SSS', '=======', '=======', '======='] },
    { d: 2, rows: ['=======', '##=####', '=======', '=======', '=======', '=======', '####=##', '=======', '=======', '=======', '=======', '#=###=#', '======='] },
    { d: 2, gap: 2, rows: ['=======', '..===..', '.......', '.......', '..===..', '..===..', '..=o=..', '..=o=..', '..===..', '..===..', '..===..', '======='] },
    { d: 2, rows: ['=.....=', '=.....=', 'B.....B', '=.....=', '=.....=', '=..=..=', '======='] },
    { d: 2, rows: ['==.....', '==.....', '.==....', '.==....', '..==...', '..==...', '...==..', '...==..', '..===..', '======='] },
    { d: 3, gap: 4, rows: ['=======', '===B===', '.......', '.......', '.......', '.......', '=======', '=======', '======='] },
    { d: 3, rows: ['..===..', '...=...', '...=...', '...o...', '...=...', '...=...', '...=...', '..===..', '======='] },
    { d: 3, rows: ['XX===XX', 'XX=o=XX', 'XXX=XXX', 'XXX=XXX', 'XX===XX', 'X==X==X', 'X=XXX=X', '=======', '======='] },
    { d: 3, rows: ['=======', '=======', 'J=J=J=J', '.......', '.......', '.......', '.......', '.......', '.......', '.......', '=======', '=======', '======='] },
    { d: 3, rows: ['=======', '=#=#=#=', '=======', '=======', '=======', '#=#=#=#', '=======', '=======', '=======', '=#=#=#=', '======='] },
    { d: 3, rows: ['=======', '=======', '#######', '=======', '=======', '#######', '=======', '======='] },
    { d: 3, gap: 3, rows: ['=======', '=======', '=======', '.......', '.......', '.......', '==...==', '==...==', 'o=...=o', '==...==', '==...==', '==...==', '==...==', '==...==', '.......', '.......', '.......', '======='] },
    { d: 4, gap: 5, rows: ['=======', '=======', '.......', '.......', '.......', '.......', '.......', '..===..', '..===..', '..=o=..', '..===..', '======='] },
    { d: 4, rows: ['=X=X=X=', '=X=X=X=', '=X=X=X=', '=X=X=X=', '=X=X=X=', '======='] },
    { d: 4, rows: ['=======', 'XX=====', 'XX==###', '=====XX', '###==XX', '==XX===', '=======', '======='] },
    { d: 4, gap: 3, rows: ['...=...', '...=...', '.......', '.......', '.......', '...=...', '...=...', '...o...', '...=...', '...=...', '...=...', '...=...', '...=...', '...=...', '..===..', '======='] },
    { d: 5, gap: 6, rows: ['=======', '==BBB==', '.......', '.......', '.......', '.......', '.......', '.......', '=======', '=======', '======='] },
    { d: 5, rows: ['...=...', '..X=X..', '..X=X..', '...=...', '...=...', '..X=X..', '...=...', '..===..', '======='] },
    { d: 5, rows: ['=#=X=#=', '=#=X=#=', '=======', 'X=#=#=X', 'X=#=#=X', '=======', '#=X=X=#', '======='] },
  ];
  const FUEL_CHUNKS = [
    { rows: ['=======', '=F===F=', '=F===F=', '======='] },
    { rows: ['=======', '===F===', '===F===', '======='] },
    { rows: ['F=====F', 'F=====F', '=======', '======='] },
    { rows: ['=======', '==F=F==', '=======', '======='] },
  ];

  // ------------------------------------------------------------------ track
  let track = null;
  function tileAt(r, l) {
    if (l < 0 || l >= LANES) return T_GAP;
    if (r < 0) return T_FLOOR;
    const row = track.rows[r];
    return row ? row[l] : T_GAP;
  }
  const walk = (r, l) => WALK[tileAt(r, l)];
  const laneOf = (x) => Math.floor(x + MID + 0.5);
  function heightAt(x, z) {
    const t = tileAt(Math.floor(z), laneOf(x));
    return t === T_GAP ? -Infinity : t === T_BLOCK ? BLOCK_H : 0;
  }

  function newTrack() { return { rows: [], tint: [], coins: [], n: 0, finish: Infinity, P: null, V: null }; }
  function addRow(tr, s, tint, flip) {
    const row = new Uint8Array(LANES);
    let coins = 0;
    for (let l = 0; l < LANES; l++) {
      const ch = s[flip ? LANES - 1 - l : l];
      row[l] = CHAR_TILE[ch] || T_GAP;
      if (ch === 'o') coins |= 1 << l;
    }
    tr.rows.push(row); tr.tint.push(tint); tr.coins.push(coins);
    tr.n = tr.rows.length;
  }
  function addConnector(tr, gen, len) {
    const rnd = gen.rnd;
    const shape = rnd() < 0.65 ? '=======' : '.=====.';
    const coinLane = rnd() < 0.55 ? 1 + Math.floor(rnd() * 5) : -1;
    for (let i = 0; i < len; i++) {
      const s = coinLane >= 0 && i >= 1 && i <= 3 ? shape.slice(0, coinLane) + 'o' + shape.slice(coinLane + 1) : shape;
      addRow(tr, s, gen.tint, false);
    }
  }
  function addChunk(tr, gen, c) {
    const flip = gen.rnd() < 0.5;
    gen.tint = (gen.tint + 1 + Math.floor(gen.rnd() * 2)) % 4;
    for (const s of c.rows) addRow(tr, s, gen.tint, flip);
  }
  // appends connectors + pieces until the track is untilRow long
  function genRows(tr, gen, untilRow) {
    while (tr.n < untilRow) {
      const cruise = gen.cruiseAt(tr.n);
      const maxGap = Math.floor(cruise * GAP_T * 0.62);
      const maxD = gen.maxDAt(tr.n);
      addConnector(tr, gen, 4 + Math.floor(gen.rnd() * 4));
      if (tr.n - gen.lastFuel > cruise * 20) {
        gen.lastFuel = tr.n;
        addChunk(tr, gen, pick(FUEL_CHUNKS, gen.rnd));
        continue;
      }
      const pool = CHUNKS.filter((c) => c.d <= maxD && c.d >= maxD - 2 && (c.gap || 0) <= maxGap);
      addChunk(tr, gen, pick(pool, gen.rnd));
    }
  }
  function startRows(tr) { for (let i = 0; i < 18; i++) addRow(tr, '=======', 0, false); }

  // TRAINING: a short hand-made course that teaches one thing at a time
  function buildTutorialTrack() {
    const tr = track = newTrack(), steps = [];
    const add = (str, n = 1, tint = 0) => { for (let i = 0; i < n; i++) addRow(tr, str, tint, false); };
    const step = (o, len) => steps.push(Object.assign({ from: tr.n, to: tr.n + len, done: false }, o));
    startRows(tr);
    steps.push({ id: 'gas', from: 0, to: tr.n + 16, done: false, key: '↑', text: 'HOLD TO SPEED UP', touchText: 'YOUR ROCKET SPEEDS UP BY ITSELF' });
    add('=======', 16);
    step({ id: 'steer', key: '← →', touchKey: '◀ ▶', text: 'STEER AND GRAB THE COINS' }, 34);
    add('=======', 3); add('=o=====', 5, 1); add('=======', 4, 1); add('=====o=', 5, 2); add('=======', 4, 2); add('==o====', 5, 3); add('=======', 8);
    step({ id: 'jump', key: 'SPACE', touchKey: 'JUMP', text: 'JUMP OVER THE GAP!', gap: tr.n + 9 }, 23);
    add('=======', 9); add('.......', 3); add('=======', 11, 1);
    step({ id: 'boost', key: '', text: 'GREEN PADS = SUPER SPEED!' }, 16);
    add('=======', 3); add('==BBB==', 4, 2); add('=======', 9, 2);
    step({ id: 'wall', key: 'SPACE', touchKey: 'JUMP', text: 'JUMP OVER THE BARRIER!', gap: tr.n + 9 }, 18);
    add('=======', 9); add('#######', 1, 3); add('=======', 8, 3);
    step({ id: 'red', key: '← →', touchKey: '◀ ▶', text: 'STEER AROUND THE RED PADS!' }, 18);
    add('=======', 5); add('==XXX==', 6, 1); add('=======', 7, 1);
    step({ id: 'fuel', key: '', text: 'BLUE PADS REFILL YOUR FUEL' }, 14);
    add('=======', 3); add('FFFFFFF', 2, 2); add('=======', 9, 2);
    step({ id: 'finish', key: '', text: 'GREAT! NOW CROSS THE FINISH LINE!' }, 14);
    add('=======', 14);
    tr.finish = tr.n;
    for (let i = 0; i < 2; i++) { addRow(tr, '=======', 0, false); tr.rows[tr.n - 1].fill(T_FINISH); }
    for (let i = 0; i < 90; i++) addRow(tr, '=======', 0, false);
    tr.steps = steps;
    return tr;
  }

  function buildLevelTrack(def) {
    for (let attempt = 0; ; attempt++) {
      const tr = track = newTrack();
      const gen = {
        rnd: seeded(def.seed + attempt * 7919), tint: 0, lastFuel: 0,
        cruiseAt: () => def.cruise,
        maxDAt: (n) => (n < def.rows * 0.3 ? Math.max(1, def.maxD - 1) : def.maxD),
      };
      startRows(tr);
      genRows(tr, gen, def.rows);
      addConnector(tr, gen, 6);
      tr.finish = tr.n;
      for (let i = 0; i < 2; i++) { addRow(tr, '=======', 0, false); tr.rows[tr.n - 1].fill(T_FINISH); }
      for (let i = 0; i < 90; i++) addRow(tr, '=======', 0, false);
      buildPlans(tr, def.cruise);
      // every level must be beatable by the (cautious) bot line from every grid slot
      const ok = [1, 2, 3, 4, 5].every((l) => isFinite(tr.V[2 * LANES + l]));
      if (ok || attempt >= 12) {
        if (!ok) console.warn('level may be unsolvable', def.i);
        return tr;
      }
    }
  }
  const endlessCruise = (z) => Math.min(MAX_CRUISE, 11 + z / 260);
  function buildEndlessTrack(seed) {
    const tr = track = newTrack();
    tr.gen = {
      rnd: seeded(seed), tint: 0, lastFuel: 0,
      cruiseAt: (n) => endlessCruise(n), maxDAt: (n) => Math.min(5, 1 + Math.floor(n / 320)),
    };
    startRows(tr);
    genRows(tr, tr.gen, 300);
    return tr;
  }

  // Racing lines for the bots, one per jump length (= speed), so a slowed-down bot still jumps right.
  const jumpRows = (v) => Math.floor(0.6 + v * JUMP_T);
  function buildPlans(tr, cruise) {
    tr.jMin = jumpRows(cruise * 0.4); tr.jMax = jumpRows(cruise * 1.65);
    tr.plans = [];
    for (let j = tr.jMin; j <= tr.jMax; j++) tr.plans[j] = computePlan(tr, j);
    Object.assign(tr, tr.plans[jumpRows(cruise)]);
  }
  // Dynamic programming from the finish backwards.
  // P[row*LANES+lane] = lane to drive into next, or 10+lane for "jump and land in lane".
  function computePlan(tr, J) {
    const n = tr.n;
    const JP = Math.round(J * PAD_T / JUMP_T);
    const K = Math.max(1, Math.ceil((J - 0.1) / JUMP_T * 0.2 + 0.3)); // rows it takes to slide over one lane at this speed
    const V = new Float32Array(n * LANES).fill(Infinity), P = new Int8Array(n * LANES).fill(-1);
    const Vat = (r, l) => (r < n && l >= 0 && l < LANES ? V[r * LANES + l] : Infinity);
    for (let r = n - 1; r >= 0; r--) {
      for (let l = 0; l < LANES; l++) {
        if (!walk(r, l)) continue;
        const i = r * LANES + l;
        if (r >= tr.finish) { V[i] = 0; P[i] = l; continue; }
        const t = tileAt(r, l);
        let best = Infinity, act = -1;
        if (t !== T_PAD) {
          if (walk(r + 1, l)) { best = 1 + AI_COST[tileAt(r + 1, l)] + Vat(r + 1, l); act = l; }
          // sliding into a neighbouring lane: both lanes must be drivable while we cross
          for (const m of [l - 1, l + 1]) {
            let ok = true, c = K + 0.15;
            for (let k = 1; k <= K && ok; k++) {
              ok = walk(r + k, l) && walk(r + k, m);
              c += AI_COST[tileAt(r + k, m)];
            }
            if (!ok) continue;
            c += Vat(r + K, m);
            if (c < best) { best = c; act = m; }
          }
        }
        const jr = r + (t === T_PAD ? JP : J);
        for (let m = Math.max(0, l - 2); m <= Math.min(LANES - 1, l + 2); m++) {
          if (!walk(jr, m) || !walk(jr + 1, m) || !arcClear(r, jr, l, m)) continue;
          // we may touch down late in the landing row, so carry on from the row after it
          const c = (jr + 1 - r) + (t === T_PAD ? 0 : 0.8) + AI_COST[tileAt(jr, m)] + Vat(jr + 1, m);
          if (c < best) { best = c; act = 10 + m; }
        }
        V[i] = best; P[i] = act;
      }
    }
    return { P, V, K };
  }
  // right after take-off and right before landing the ship is too low to clear a block
  function arcClear(r, jr, l, m) {
    const lo = Math.min(l, m), hi = Math.max(l, m);
    for (let k = r + 1; k < jr; k++) {
      if (k > r + 2 && k < jr - 1) continue;
      for (let q = lo; q <= hi; q++) if (tileAt(k, q) === T_BLOCK) return false;
    }
    return true;
  }
  let plan = null; // the plan matching the bot currently thinking
  function planFor(v) { return track.plans ? track.plans[clamp(jumpRows(v), track.jMin, track.jMax)] : null; }
  function planAt(r, l) {
    if (!plan || r < 0 || r >= track.n || l < 0 || l >= LANES) return -1;
    return plan.P[r * LANES + l];
  }
  const landOK = (r, l) => walk(r, l) && walk(r + 1, l);

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
    happytime() { this.call((s) => s.game.happytime()); },
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
  const SAVE_KEY = 'rocket-skyway-save-v1';
  const DEFAULT_SAVE = { unlocked: 1, stars: [], coins: 0, skin: 0, owned: [0], best: 0, races: 0, trained: false };
  const save = JSON.parse(JSON.stringify(DEFAULT_SAVE));
  function loadSave() {
    try { const s = JSON.parse(platform.getItem(SAVE_KEY)); if (s) Object.assign(save, s); } catch (e) { /* corrupt save: start fresh */ }
  }
  function writeSave() { platform.setItem(SAVE_KEY, JSON.stringify(save)); }
  const nextLevel = () => Math.min(save.unlocked, LEVELS);

  // ------------------------------------------------------------------ audio
  const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const audio = {
    ac: null, muted: false, adMuted: false,
    init() {
      if (this.ac) { if (this.ac.state === 'suspended') this.ac.resume().catch(() => {}); return; }
      const A = window.AudioContext || window.webkitAudioContext;
      if (!A) return;
      const ac = this.ac = new A();
      // everything goes through a compressor so effects and music stay punchy without clipping
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
      comp.connect(ac.destination);
      this.master = ac.createGain();
      this.master.connect(comp);
      this.mus = ac.createGain();
      this.mus.gain.value = 0.5;
      this.mus.connect(this.master);
      this.applyGain();
      // engine hum
      const o1 = ac.createOscillator(), o2 = ac.createOscillator();
      o1.type = 'sawtooth'; o2.type = 'triangle';
      const f = ac.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 400;
      const g = ac.createGain();
      g.gain.value = 0;
      o1.connect(f); o2.connect(f); f.connect(g); g.connect(this.master);
      o1.start(); o2.start();
      this.o1 = o1; this.o2 = o2; this.ef = f; this.eg = g;
      const buf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.nb = buf;
    },
    applyGain() { if (this.master) this.master.gain.value = this.muted || this.adMuted ? 0 : 0.7; },
    setMuted(m) { this.muted = m; this.applyGain(); },
    setAdMuted(m) { this.adMuted = m; this.applyGain(); },
    // briefly lower the music so a big moment (crash, win) cuts through
    duck(amount, dur) {
      if (!this.ac) return;
      const t = this.ac.currentTime, gn = this.mus.gain;
      gn.cancelScheduledValues(t); gn.setValueAtTime(0.5 * amount, t); gn.linearRampToValueAtTime(0.5, t + dur);
    },
    engine(pct, on) {
      if (!this.ac) return;
      const t = this.ac.currentTime, f = 50 + pct * 70;
      this.o1.frequency.setTargetAtTime(f, t, 0.05);
      this.o2.frequency.setTargetAtTime(f * 2.01, t, 0.05);
      this.ef.frequency.setTargetAtTime(250 + pct * 700, t, 0.05);
      this.eg.gain.setTargetAtTime(on ? 0.03 + pct * 0.025 : 0, t, 0.08);
    },
    noise(dur, vol, freq, at, dest, endFreq, type = 'bandpass') {
      if (!this.ac) return;
      const ac = this.ac, t = at || ac.currentTime;
      const s = ac.createBufferSource(); s.buffer = this.nb;
      const f = ac.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = 0.8;
      if (endFreq) f.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
      const g = ac.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      s.connect(f); f.connect(g); g.connect(dest || this.master);
      s.start(t); s.stop(t + dur);
    },
    tone(freq, dur, type = 'square', vol = 0.12, at, endFreq, dest, attack = 0) {
      if (!this.ac) return;
      const ac = this.ac, t = at || ac.currentTime;
      const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
      if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
      const g = ac.createGain();
      if (attack) { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + attack); } else g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(dest || this.master);
      o.start(t); o.stop(t + dur + 0.02);
    },
    now() { return this.ac ? this.ac.currentTime : 0; },
    jump() {
      const t = this.now();
      this.tone(240, 0.2, 'square', 0.05, t, 640);
      this.tone(480, 0.24, 'sine', 0.1, t + 0.02, 1300);
      this.noise(0.18, 0.12, 900, t, null, 4000);
    },
    pad() { const t = this.now(); this.tone(180, 0.45, 'square', 0.06, t, 1400); this.tone(360, 0.5, 'sine', 0.1, t, 2400); this.noise(0.4, 0.15, 600, t, null, 5000); },
    land(p = 1) { const t = this.now(); this.tone(150, 0.16, 'sine', 0.4 * p, t, 45); this.noise(0.14, 0.28 * p, 600, t, null, 200); },
    boost() { const t = this.now(); this.noise(0.6, 0.3, 500, t, null, 6000); this.tone(220, 0.5, 'sawtooth', 0.05, t, 1760); this.tone(440, 0.4, 'square', 0.03, t + 0.08, 1760); },
    fuel() { const t = this.now(); [784, 988, 1319, 1568].forEach((f, i) => this.tone(f, 0.16, 'triangle', 0.1, t + i * 0.06)); },
    coin(chain = 0) {
      const t = this.now(), f = 1319 * Math.pow(2, Math.min(chain, 12) / 12);
      this.tone(f, 0.07, 'square', 0.045, t); this.tone(f * 1.5, 0.16, 'triangle', 0.09, t + 0.05);
    },
    bigAir(mega) { const t = this.now(); (mega ? [784, 988, 1175, 1568, 1976] : [784, 988, 1175, 1568]).forEach((f, i) => this.tone(f, 0.14, 'square', 0.06, t + i * 0.07)); },
    overtake() { const t = this.now(); [1046, 1319, 1568].forEach((f, i) => this.tone(f, 0.12, 'triangle', 0.1, t + i * 0.05)); },
    whoosh() { this.noise(0.35, 0.18, 400, 0, null, 3000); },
    bump() { this.noise(0.12, 0.6, 900); this.tone(140, 0.1, 'sine', 0.3); },
    crash(v = 1) {
      const t = this.now();
      this.noise(1.0, 0.8 * v, 900, t, null, 120, 'lowpass'); this.tone(110, 0.7, 'sine', 0.5 * v, t, 28); this.noise(0.3, 0.35 * v, 2500, t);
      if (v > 0.5) this.duck(0.2, 1.2);
    },
    beep(hi) { this.tone(hi ? 1046 : 523, hi ? 0.45 : 0.18, 'square', 0.09); if (hi) this.tone(2093, 0.45, 'triangle', 0.06); },
    fanfare() { const t = this.now(); this.duck(0.3, 2); [523, 659, 784, 1046, 784, 1046].forEach((f, i) => this.tone(f, i >= 3 ? 0.5 : 0.14, 'square', 0.07, t + i * 0.11)); },
    ding() { this.tone(1568, 0.15, 'triangle', 0.12); },
    click() { this.tone(660, 0.06, 'square', 0.05); this.tone(1320, 0.08, 'triangle', 0.05, this.now() + 0.03); },
    hover() { this.tone(1760, 0.04, 'sine', 0.035); },
  };

  // synthwave loop at 128 bpm: Am F C G with kick, snare, hats, bass, pad and arpeggio
  const music = {
    next: 0, step: 0,
    CHORDS: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]],
    ARP: [0, 1, 2, 1, 2, 0, 1, 2, 0, 2, 1, 2, 0, 1, 2, 1],
    tick() {
      const a = audio;
      if (!a.ac || a.muted || a.adMuted || a.ac.state !== 'running') return;
      const ac = a.ac, dur = 60 / 128 / 4, M = a.mus;
      if (this.next < ac.currentTime) this.next = ac.currentTime + 0.05;
      while (this.next < ac.currentTime + 0.15) {
        const s = this.step % 64, ch = this.CHORDS[Math.floor(s / 16)], i = s % 16, t = this.next;
        if (i % 4 === 0) a.tone(150, 0.18, 'sine', 0.42, t, 40, M);
        if (i === 4 || i === 12) { a.noise(0.18, 0.22, 1800, t, M); a.tone(200, 0.09, 'triangle', 0.08, t, 120, M); }
        if (i % 2 === 1) a.noise(0.035, 0.08, 9000, t, M, 0, 'highpass');
        if (i % 2 === 0) {
          const n = midiHz(ch[0] - 24 + (i % 4 === 2 ? 12 : 0));
          a.tone(n, dur * 1.7, 'triangle', 0.12, t, 0, M);
          a.tone(n * 1.005, dur * 1.2, 'sawtooth', 0.025, t, 0, M);
        }
        if (i === 0) for (const m of ch) a.tone(midiHz(m), dur * 15, 'sine', 0.035, t, 0, M, 0.25);
        a.tone(midiHz(ch[this.ARP[i]] + 12 + (s >= 32 && i >= 8 ? 12 : 0)), dur * 0.8, 'square', 0.02, t, 0, M);
        this.next += dur;
        this.step++;
      }
    },
  };

  // -------------------------------------------------------------- particles
  // screen-space confetti for the UI
  let particles = [];
  function confetti(x, y, n) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(120, 420);
      particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 200, life: 0, max: rand(0.7, 1.4), size: rand(5, 10), rot: rand(0, 6), vr: rand(-10, 10), color: pick(RAINBOW) });
    }
  }
  function updateParticles(dt) {
    for (const p of particles) {
      p.life += dt;
      p.vx *= 0.99; p.vy = p.vy * 0.99 + 700 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
    }
    particles = particles.filter((p) => p.life < p.max);
  }
  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = 1 - p.life / p.max;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.color; ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
  // world-space particles (z in world units): 'glow' soft additive light, 'spark' streak, 'smoke', ring
  let wparts = [];
  const glowCache = {};
  // soft round light, cached per colour
  function glowSprite(color) {
    let cv = glowCache[color];
    if (cv) return cv;
    cv = glowCache[color] = document.createElement('canvas');
    cv.width = cv.height = 64;
    const c = cv.getContext('2d'), [r, g, b] = rgb(color);
    const gr = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, `rgba(${r},${g},${b},1)`); gr.addColorStop(0.25, `rgba(${r},${g},${b},0.55)`); gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
    c.fillStyle = gr; c.fillRect(0, 0, 64, 64);
    return cv;
  }
  function ringFx(x, y, z, color, size = 0.3, grow = 1.4, life = 0.45) {
    wparts.push({ x, y, z, vx: 0, vy: 0, vz: 0, life: 0, max: life, size, grow, color, g: 0, cap: 999, ring: true });
  }
  function wemit(x, y, z, n, o) {
    for (let i = 0; i < n; i++) {
      if (wparts.length > 600) wparts.shift();
      const sp = rand(o.min || 0, o.max || 3), a = rand(0, Math.PI * 2), b = rand(-1, 1);
      wparts.push({
        x, y, z, vx: Math.cos(a) * sp * Math.sqrt(1 - b * b), vy: b * sp + (o.up || 0), vz: Math.sin(a) * sp * Math.sqrt(1 - b * b) + (o.vz || 0),
        life: 0, max: rand(o.lmin || 0.3, o.lmax || 0.6), size: rand(o.smin || 0.04, o.smax || 0.1),
        color: o.colors ? pick(o.colors) : o.color, g: o.g || 0, cap: o.cap || 40, smoke: !!o.smoke,
        kind: o.smoke ? 'smoke' : o.kind || 'glow', grow: o.grow || 0,
      });
    }
  }
  function updateWParts(dt) {
    for (const p of wparts) {
      p.life += dt; p.vy -= p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    }
    wparts = wparts.filter((p) => p.life < p.max);
  }

  // -------------------------------------------------------------- game state
  let state = 'title'; // title | levels | hangar | race | results | ad
  let race = null;
  let blink = 0, frameNo = 0, toast = null, touchMode = false, uiButtons = [], demoN = 0, results = null;
  let mouse = { x: -1, y: -1 }, hoverNow = null, hoverLast = null, fade = 1, lastState = null;
  const keys = { left: false, right: false, down: false, up: false };
  const cam = { pitch: PITCH, cosp: COSP, sinp: SINP, x: 0, y: CAM_UP, z: -CAM_BACK, f: FOCAL, roll: 0, flash: 0, dip: 0 };

  function makeRacer(o) {
    return Object.assign({
      x: 0, y: 0, z: 0, v: 0, vx: 0, bump: 0, vy: 0, grounded: true, coyote: 0, jumpBuf: 0, gh: 0,
      alive: true, deadT: 0, ghostT: 0, fuel: 100, boostT: 0, boostPower: 0, boostRow: -1, stickyT: 0, fuelRow: -1, roll: 0,
      finished: false, finishTime: 0, safeZ: 0, safeL: MID, speedMul: 1, base: 1, bumpCd: 0,
      input: { dir: 0, jump: false, brake: false, gas: true }, target: MID, commitZ: 0, landLane: MID, thinkT: 0, lead: 0.3,
      react: 0.1, mistake: 0, aggro: 0, ahead: false, say: '', sayT: 0, sx: -999, sy: -999, isPlayer: false,
    }, o);
  }
  function say(rc, lines) { rc.say = pick(lines); rc.sayT = 1.4; }
  function vignette(rgbStr, a) { race.vig = { c: rgbStr, a }; }
  function floater(text, x, y, color = '#ffd84a', size = 26) { race.floaters.push({ text, x, y, color, size, t: 0 }); }
  function bigAir(n) {
    const mega = n >= 6, bonus = mega ? 5 : 2;
    race.coins += bonus; race.coinPop = 1;
    addMsg(mega ? 'MEGA AIR!' : 'BIG AIR!', mega ? '#ff4fd8' : '#ffd84a', mega ? 58 : 50);
    floater(`+${bonus}`, W - 60, 128);
    audio.bigAir(mega);
    confetti(W / 2, H * 0.26, mega ? 40 : 18);
  }
  function addMsg(text, color = '#fff', size = 40) {
    race.msgs = [{ text, color, size, t: 0 }]; // One clear callout; new events replace the old one.
  }

  // mode: 'level' | 'endless' | 'demo'
  function newRace(mode, lvl) {
    const def = mode === 'endless' ? { name: 'ENDLESS', theme: THEMES[(save.races + 2) % THEMES.length], cruise: 11, skill: 0.5 }
      : mode === 'tutorial' ? { name: 'TRAINING', theme: THEMES[0], cruise: 9.5, skill: 0 } : levelDef(lvl);
    theme = def.theme;
    if (mode === 'endless') buildEndlessTrack(Date.now() & 0xffff);
    else if (mode === 'tutorial') buildTutorialTrack();
    else buildLevelTrack(def);
    const r = race = {
      mode, def, lvl, t: 0, goT: 0, phase: mode === 'demo' ? 'go' : 'countdown', count: 3.2, racers: [], bots: [], player: null, focus: null,
      cruise: def.cruise, msgs: [], shake: 0, coins: 0, finishOrder: [], paused: false, endT: 0, place: 1, placeT: 0,
      upAt: null, deaths: 0, boostView: 0, speedView: 0, demo: mode === 'demo',
      floaters: [], vig: null, coinPop: 0, chain: 0, chainT: 0, slowmo: 0, fireworks: 0,
      tut: mode === 'level' && !save.trained && save.races < 3 ? { gas: 0, steer: 0, jump: 0 } : null,
      step: null, stepT: 0, stepCoins: 0,
    };
    const rnd = seeded((lvl || 7) * 31 + save.races);
    const pilots = PILOTS.slice().sort(() => rnd() - 0.5);
    const slots = [[3, 3], [1, 6], [5, 6], [2, 9], [4, 9]];
    if (mode !== 'demo') {
      const skin = SKINS[save.skin] || SKINS[0];
      r.player = makeRacer({ name: 'YOU', color: skin.color, trail: skin.trail, isPlayer: true, x: 0, z: 3, safeZ: 3 });
      r.racers.push(r.player);
    }
    if (mode === 'level' || mode === 'demo') {
      const nBots = mode === 'demo' ? 5 : 4;
      for (let i = 0; i < nBots; i++) {
        const [l, z] = mode === 'demo' ? slots[i] : slots[i + 1];
        const p = pilots[i];
        const b = makeRacer({
          name: p.name, color: p.color, trail: p.trail, x: l - MID, z, safeZ: z, safeL: l, target: l, num: String(11 + i * 11).padStart(2, '0'),
          base: mode === 'demo' ? 1 : 0.87 + def.skill * 0.08 + rnd() * 0.08,
          mistake: 0.14 - def.skill * 0.1, react: 0.14 - def.skill * 0.07, aggro: i % 2 ? 0.25 + def.skill * 0.2 : 0,
        });
        if (mode === 'level' && i === 0) Object.assign(b, { buddy: true, aggro: 0, mistake: b.mistake * 0.5 });
        r.bots.push(b); r.racers.push(b);
      }
    }
    r.focus = r.player || r.bots[0];
    cam.x = r.focus.x * 0.8; cam.y = CAM_UP; cam.z = r.focus.z * ROW_D - CAM_BACK; cam.roll = 0; cam.pitch = PITCH; cam.cosp = COSP; cam.sinp = SINP;
    wparts = [];
    return r;
  }
  function newDemo() {
    demoN++;
    newRace('demo', 2 + ((demoN * 3) % LEVELS));
  }

  // ---------------------------------------------------------------- physics
  function kill(rc, why) {
    const r = race;
    rc.alive = false; rc.deadT = RESPAWN_T;
    rc.deathZ = why === 'fall' && rc.airZ != null ? rc.airZ : rc.z; // for falls: where we left the ground
    rc.deathL = clamp(laneOf(rc.x), 0, LANES - 1); rc.v = 0; rc.vx = 0; rc.bump = 0; rc.boostT = 0; rc.boostPower = 0; rc.boostRow = -1;
    if (why !== 'fall') {
      const Z = rc.z * ROW_D;
      // fireball, flying sparks and rising smoke
      wemit(rc.x, rc.y + 0.3, Z, 1, { max: 0, lmin: 0.3, lmax: 0.3, smin: 1.2, smax: 1.2, grow: 1.5, color: '#fff2c0', cap: 400 });
      wemit(rc.x, rc.y + 0.3, Z, 8, { min: 0.5, max: 2.5, up: 1, lmin: 0.35, lmax: 0.6, smin: 0.35, smax: 0.6, grow: 0.6, colors: ['#ffb040', '#ff6a1a', '#ffd84a'], cap: 200 });
      wemit(rc.x, rc.y + 0.3, Z, 36, { kind: 'spark', min: 3, max: 10, up: 2, g: 10, lmin: 0.35, lmax: 0.8, smin: 0.05, smax: 0.09, colors: ['#ffffff', '#ffd84a', '#ff9a3a', rc.color] });
      wemit(rc.x, rc.y + 0.4, Z, 8, { smoke: true, min: 0.3, max: 1.2, up: 1.4, lmin: 0.8, lmax: 1.4, smin: 0.3, smax: 0.5, grow: 1.2, color: '#5a5e68', cap: 120 });
    }
    if (rc.isPlayer) {
      r.shake = why === 'fall' ? 0.15 : 0.6;
      if (why !== 'fall') r.slowmo = 0.45;
      vignette('255,60,40', 0.7);
      r.deaths++;
      if (why !== 'fall') audio.crash(); else audio.tone(500, 0.6, 'sawtooth', 0.08, 0, 80);
      const buddy = r.bots.find((b) => b.buddy);
      if (buddy && buddy.alive && Math.random() < 0.6) say(buddy, BUDDY_WAIT);
      addMsg(why === 'fall' ? 'WHOOPS!' : why === 'burn' ? 'HAZARD HIT!' : 'CRASH!', '#ff6a3a', 56);
      if (r.mode === 'endless') r.endT = 1.4;
    } else {
      if (!r.demo && why !== 'fall' && Math.abs(rc.z - r.focus.z) < 20) audio.crash(0.35);
      say(rc, OOPS);
    }
  }
  // nearest spot behind where we died with a clear straight run ahead, preferring our own lane
  function respawnPoint(rc) {
    const lanes = [0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5, -6, 6].map((d) => rc.deathL + d).filter((l) => l >= 0 && l < LANES);
    for (let row = Math.floor(rc.deathZ) - 1; row >= 0; row--) {
      for (const l of lanes) if (walk(row, l) && tileAt(row, l) !== T_PAD && clearAhead(row, l, 5)) return [row + 0.5, l];
    }
    return [3, MID];
  }
  function respawn(rc) {
    [rc.safeZ, rc.safeL] = respawnPoint(rc);
    // a bot that keeps dying from the same spot skips ahead past the trouble
    if (!rc.isPlayer) {
      rc.stuck = rc.lastSafe === rc.safeZ ? (rc.stuck || 0) + 1 : 0;
      rc.lastSafe = rc.safeZ;
      if (rc.stuck >= 2) {
        for (let row = Math.floor(rc.deathZ) + 1; row < track.n - 8; row++) {
          const l = [MID, MID - 1, MID + 1, MID - 2, MID + 2, 0, LANES - 1].find((q) => walk(row, q) && tileAt(row, q) !== T_PAD && clearAhead(row, q, 6));
          if (l !== undefined) { rc.safeZ = row + 0.5; rc.safeL = l; break; }
        }
        rc.stuck = 0;
      }
    }
    Object.assign(rc, {
      alive: true, x: rc.safeL - MID, y: 0, z: rc.safeZ, vy: 0, vx: 0, bump: 0, grounded: true, ghostT: GHOST_T,
      boostT: 0, boostPower: 0, boostRow: -1, stickyT: 0, v: race.cruise * (rc.isPlayer ? IDLE : rc.speedMul), airZ: null, fuel: Math.max(rc.fuel, 35), target: rc.safeL, commitZ: 0, landLane: rc.safeL, jumpBuf: 0,
    });
    wemit(rc.x, 0.4, rc.z * ROW_D, 14, { min: 1, max: 3, lmin: 0.3, lmax: 0.6, smin: 0.08, smax: 0.14, color: '#bfefff', cap: 40 });
    ringFx(rc.x, 0.02, rc.z * ROW_D, '#bfefff', 0.3, 1.6, 0.5);
    if (rc === race.focus && !race.demo) cam.flash = 0.35;
  }

  function stepRacer(rc, dt) {
    const r = race;
    if (!rc.alive) {
      rc.deadT -= dt;
      if (rc.deadT <= 0 && !(r.mode === 'endless' && rc.isPlayer)) respawn(rc);
      return;
    }
    if (rc.ghostT > 0) rc.ghostT -= dt;
    if (rc.boostT > 0) rc.boostT = Math.max(0, rc.boostT - dt);
    else rc.boostPower = Math.max(0, rc.boostPower - dt * 0.1);
    if (rc.stickyT > 0) rc.stickyT -= dt;
    if (rc.bumpCd > 0) rc.bumpCd -= dt;
    const going = r.phase === 'go';

    // forward speed
    let target = going ? r.cruise * rc.speedMul : 0;
    if (rc.isPlayer && !rc.input.gas) target *= IDLE; // up arrow is the gas pedal; let go to slow down
    if (rc.fuel <= 0) target *= 0.6;
    target *= 1 + rc.boostPower;
    if (rc.boostPower > 0) target = Math.min(target, MAX_SPEED); // Stay within the bot jump planner’s supported speeds.
    if (rc.stickyT > 0) target *= 0.55;
    if (rc.input.brake) target *= 0.45;
    if (rc.finished) target = 0;
    const accel = target > rc.v ? (rc.boostT > 0 ? 20 : 7) : rc.finished ? 5 : rc.input.brake || rc.stickyT > 0 ? 14 : 8;
    target = Math.min(target, MAX_SPEED);
    rc.v = Math.min(MAX_SPEED, rc.v + clamp(target - rc.v, -accel * dt, accel * dt));

    // steering works in the air too, as in SkyRoads
    rc.vx += clamp((going ? rc.input.dir : 0) * STEER - rc.vx, -70 * dt, 70 * dt);
    rc.bump *= Math.pow(0.015, dt);
    const nx = clamp(rc.x + (rc.vx + rc.bump) * dt, -MID - 1.5, MID + 1.5);
    const side = nx > rc.x ? 0.24 : -0.24;
    if (heightAt(nx + side, rc.z + 0.2) > rc.y + 0.15 || heightAt(nx + side, rc.z - 0.15) > rc.y + 0.15) { rc.vx = 0; rc.bump = 0; } // block beside us
    else rc.x = nx;

    // forward: crash into anything taller in front (a block, or a slab edge when we drop too low)
    const nz = rc.z + rc.v * dt;
    const front = Math.max(heightAt(rc.x - 0.15, nz + 0.35), heightAt(rc.x + 0.15, nz + 0.35));
    if (front > rc.y + 0.3 && rc.y > front - SLAB - 0.9) { kill(rc, 'crash'); return; }
    rc.z = nz;

    // vertical
    const gh = rc.gh = Math.max(heightAt(rc.x - 0.22, rc.z + 0.15), heightAt(rc.x + 0.22, rc.z + 0.15),
      heightAt(rc.x - 0.22, rc.z - 0.25), heightAt(rc.x + 0.22, rc.z - 0.25));
    if (rc.grounded && gh < rc.y - 0.02) { rc.grounded = false; rc.coyote = 0.1; rc.vy = 0; rc.airZ = rc.z; rc.airGaps = 0; }
    if (rc.input.jump) rc.jumpBuf = 0.14;
    rc.input.jump = false;
    if (rc.jumpBuf > 0) {
      rc.jumpBuf -= dt;
      if (going && (rc.grounded || rc.coyote > 0)) {
        rc.vy = JUMP_V; rc.grounded = false; rc.coyote = 0; rc.jumpBuf = 0; rc.airZ = rc.z; rc.airGaps = 0;
        rc.squash = 0.35;
        if (Math.abs(rc.z - r.focus.z) < 25) {
          ringFx(rc.x, rc.y + 0.02, rc.z * ROW_D - 0.2, '#ffd9a0', 0.25, 1.1, 0.35);
          wemit(rc.x, rc.y + 0.05, rc.z * ROW_D - 0.4, 6, { min: 0.5, max: 1.5, up: 0.2, lmin: 0.25, lmax: 0.4, smin: 0.12, smax: 0.2, grow: 0.3, color: '#ffc070', cap: 60 });
        }
        if (rc.isPlayer) audio.jump();
      }
    }
    if (!rc.grounded) {
      rc.coyote -= dt;
      const ar = Math.floor(rc.z);
      if (ar !== rc.airRow) { rc.airRow = ar; if (tileAt(ar, laneOf(rc.x)) === T_GAP) rc.airGaps = (rc.airGaps || 0) + 1; }
      const prevVy = rc.vy;
      rc.vy -= GRAV * dt;
      rc.y += rc.vy * dt;
      if (rc.vy <= 0 && rc.y <= gh && rc.y >= gh - 0.45) {
        rc.y = gh; rc.grounded = true; rc.vy = 0; rc.airZ = null;
        if (prevVy < -4) {
          const p = clamp(-prevVy / 10, 0.3, 1);
          rc.squash = -0.35 * p;
          if (Math.abs(rc.z - r.focus.z) < 25) {
            ringFx(rc.x, gh + 0.02, rc.z * ROW_D, '#ffffff', 0.3, 1.6 * p + 0.4, 0.4);
            wemit(rc.x, gh + 0.05, rc.z * ROW_D - 0.3, 16, { kind: 'spark', min: 2, max: 6, up: 1.5, g: 9, lmin: 0.2, lmax: 0.45, smin: 0.04, smax: 0.07, colors: ['#ffe9a0', '#ffffff', '#ff9a3a'] });
          }
          if (rc === r.focus && !r.demo) { cam.dip = 0.18 * p; r.shake = Math.max(r.shake, 0.12 * p); }
          if (rc.isPlayer) {
            audio.land(p);
            if ((rc.airGaps || 0) >= 3) bigAir(rc.airGaps);
          }
        }
        rc.airGaps = 0;
      }
      if (rc.y < -7) { kill(rc, 'fall'); return; }
    } else rc.y = gh;

    // what we are driving on
    if (rc.grounded) {
      const row = Math.floor(rc.z), lane = laneOf(rc.x), t = tileAt(row, lane);
      if (t === T_BURN && rc.y < 0.1) { kill(rc, 'burn'); return; }
      if (t === T_BOOST && rc.boostRow !== row) {
        rc.boostRow = row;
        rc.boostPower = Math.min(0.5, rc.boostPower + 0.06);
        rc.boostT = BOOST_T;
        if (rc.isPlayer) { addMsg(rc.boostPower > 0.06 ? 'BOOST CHAIN!' : 'BOOST!', '#3bff6b', 44); audio.boost(); vignette('59,255,107', 0.55); }
      } else if (t === T_STICKY) {
        if (rc.isPlayer && rc.stickyT <= 0) audio.tone(120, 0.25, 'sawtooth', 0.06, 0, 70);
        rc.stickyT = 0.35;
      } else if (t === T_FUEL && rc.fuelRow !== row) {
        rc.fuelRow = row; rc.fuel = 100;
        if (rc.isPlayer) { addMsg('FUEL FULL!', '#19a6ff', 40); audio.fuel(); vignette('40,160,255', 0.5); }
      } else if (t === T_PAD) {
        rc.vy = PAD_V; rc.grounded = false; rc.airZ = rc.z; rc.airGaps = 0; rc.squash = 0.5;
        if (Math.abs(rc.z - r.focus.z) < 25) ringFx(rc.x, 0.02, rc.z * ROW_D, '#ffd63a', 0.3, 2, 0.5);
        if (rc.isPlayer) audio.pad();
      }
    }

    if (going && !rc.finished) rc.fuel = Math.max(0, rc.fuel - dt * 100 / FUEL_TIME);
    if (!rc.finished && rc.z >= track.finish) {
      rc.finished = true; rc.finishTime = r.t;
      r.finishOrder.push(rc);
      if (rc.isPlayer) {
        r.endT = 1.8; r.fireworks = 6;
        const place = r.finishOrder.length;
        addMsg(place === 1 ? 'YOU WIN!' : `${ordinal(place).toUpperCase()} PLACE!`, place <= 3 ? '#ffd400' : '#fff', 64);
        audio.fanfare();
        if (place <= 3) confetti(W / 2, H * 0.35, 60);
      }
    }
    rc.roll += (-(rc.vx + rc.bump) * 0.075 - rc.roll) * Math.min(1, dt * 10);
    if (rc.squash) rc.squash *= Math.pow(0.002, dt);
  }

  // a respawn point needs a straight, hazard-free run so you get time to react
  function clearAhead(row, lane, n) {
    for (let k = 1; k <= n; k++) if (!walk(row + k, lane) || tileAt(row + k, lane) === T_PAD) return false;
    return true;
  }

  // ships shove each other sideways when they touch
  function bumps() {
    const rs = race.racers;
    for (let i = 0; i < rs.length; i++) {
      for (let j = i + 1; j < rs.length; j++) {
        const a = rs[i], b = rs[j];
        if (!a.alive || !b.alive || a.ghostT > 0 || b.ghostT > 0 || a.finished || b.finished) continue;
        const dz = (a.z - b.z) * ROW_D, dx = a.x - b.x;
        if (Math.abs(dz) > 1.15 || Math.abs(dx) > 0.66 || Math.abs(a.y - b.y) > 0.6) continue;
        if (a.bumpCd > 0 && b.bumpCd > 0) continue;
        const s = dx === 0 ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(dx);
        a.bump = s * 4.5; b.bump = -s * 4.5; a.bumpCd = b.bumpCd = 0.3;
        (dz < 0 ? a : b).v *= 0.92;
        if (a.isPlayer || b.isPlayer) {
          audio.bump();
          race.shake = Math.max(race.shake, 0.25);
          wemit((a.x + b.x) / 2, (a.y + b.y) / 2 + 0.3, (a.z + b.z) / 2 * ROW_D, 16, { kind: 'spark', min: 2, max: 6, lmin: 0.2, lmax: 0.4, smin: 0.04, smax: 0.07, colors: ['#ffffff', '#ffd400', '#7fd8ff'] });
          const bot = a.isPlayer ? b : a;
          if (bot.sayT <= 0) say(bot, SHOVES);
        }
      }
    }
  }

  // ------------------------------------------------------------------- bots
  function botThink(b, dt) {
    const inp = b.input;
    inp.jump = false; inp.brake = false;
    if (!b.alive || race.phase !== 'go' || b.finished) { inp.dir = 0; return; }
    const r = Math.floor(b.z), l = clamp(laneOf(b.x), 0, LANES - 1);
    plan = planFor(Math.max(b.v, race.cruise * 0.5));
    b.thinkT -= dt;
    if (b.grounded) {
      const act = planAt(r, l);
      if (b.thinkT <= 0 && b.z >= b.commitZ) {
        b.thinkT = b.react;
        const ll = act >= 0 && act < 10 ? act : l;
        // once a slide into another lane starts, finish it (re-planning half-way makes bots dither)
        if (ll !== l) b.commitZ = b.z + plan.K * 0.8;
        b.target = ll;
        // shove the player when side by side
        const p = race.player;
        if (b.aggro && p && p.alive && p.ghostT <= 0 && Math.abs(p.z - b.z) < 1 && Math.abs(p.x - b.x) > 0.5 && Math.abs(p.x - b.x) < 1.4 && Math.random() < b.aggro * b.react * 4) {
          const pl = laneOf(p.x);
          if (walk(r + 1, pl) && walk(r + 2, pl)) b.target = pl;
        }
      }
      const noseRow = Math.floor(b.z + 0.35 + b.v * 0.06);
      const danger = !walk(noseRow, laneOf(b.x - 0.22)) && !walk(noseRow, laneOf(b.x + 0.22));
      // which row the plan wants us to take off from (an early-jump mistake looks one row further)
      const jr = act >= 10 ? r : (b.lead > 1 && planAt(r + 1, l) >= 10 ? r + 1 : -1);
      if (danger || (jr >= 0 && b.z >= jr + 1 - b.lead)) {
        // pick where to land from our real speed, not the planned one
        const m = bestLanding(Math.floor(b.z + 0.1 + b.v * JUMP_T), l, b.landLane);
        if (danger || m >= 0 || b.lead > 1) {
          inp.jump = true;
          b.landLane = m >= 0 ? m : act >= 10 ? act - 10 : l;
          b.target = b.landLane;
          b.lead = Math.random() < b.mistake ? rand(1.1, 2.2) : rand(0.15, 0.45);
        }
      } else {
        // too fast for the next gap? (e.g. a short island) then brake until a landing works
        let edge = -1;
        for (let k = r + 1; k <= r + 3; k++) if (!walk(k, l)) { edge = k; break; }
        if (edge >= 0 && bestLanding(Math.floor(edge - 0.1 + b.v * JUMP_T), l, l) < 0) {
          for (let v = b.v - 0.5; v > 3; v -= 0.5) {
            if (bestLanding(Math.floor(edge - 0.1 + v * JUMP_T), l, l) >= 0) { inp.brake = true; break; }
          }
        }
      }
    } else if (b.thinkT <= 0) {
      // in the air: aim for a safe landing lane
      b.thinkT = b.react;
      const tl = (b.vy + Math.sqrt(Math.max(0, b.vy * b.vy + 2 * GRAV * Math.max(0, b.y)))) / GRAV;
      const m = bestLanding(Math.floor(b.z + b.v * tl), l, b.landLane);
      if (m >= 0) b.target = b.landLane = m;
    }
    // steer so we arrive on the lane centre without overshooting
    const dx = b.target - MID - b.x;
    inp.dir = Math.abs(dx) < 0.02 ? 0 : Math.sign(dx) * Math.min(1, Math.sqrt(100 * Math.abs(dx)) / STEER);
  }
  // safest lane to land in on row lr within reach of lane l (-1 if none)
  function bestLanding(lr, l, prefer) {
    let best = -1, bv = Infinity;
    for (let m = Math.max(0, l - 2); m <= Math.min(LANES - 1, l + 2); m++) {
      if (!landOK(lr, m)) continue;
      const v = (lr < track.n && plan ? plan.V[lr * LANES + m] : 0) + Math.abs(m - prefer) * 0.5;
      if (v < bv) { bv = v; best = m; }
    }
    return best;
  }
  // rubber band: bots far ahead ease off, bots far behind catch up, close ones race for real
  function rubberBand() {
    const ref = race.focus;
    const late = race.player && race.player.z > track.finish * 0.88;
    const p = race.player;
    for (const b of race.bots) {
      if (b === ref) { b.speedMul = b.base; continue; }
      const gap = ref.z - b.z;
      if (b.buddy && p) {
        // the buddy keeps the player company: matches your speed, swaps the lead back and forth,
        // waits for you after a crash, and only races for real near the finish
        const want = -1 + 3 * Math.sin(race.t * 0.3);
        const pv = p.alive ? Math.max(p.v, race.cruise * IDLE) / race.cruise : IDLE;
        // it may crawl to wait for you, but only on a long clear stretch (slow ships can't clear gaps)
        const lo = b.grounded && clearAhead(Math.floor(b.z), clamp(laneOf(b.x), 0, LANES - 1), 7) ? 0.2 : 0.6;
        b.speedMul = late ? 0.94 + clamp(gap * 0.004, -0.03, 0.04) : clamp(pv * 0.97 + (gap - want) * 0.06, lo, 1.25);
        continue;
      }
      b.speedMul = b.base + (late ? clamp(gap * 0.002, -0.05, 0.06) : clamp(gap * 0.004, -0.12, 0.12));
    }
  }

  // ----------------------------------------------------------------- update
  function standings() {
    return race.racers.slice().sort((a, b) => (b.finished - a.finished) || (a.finished ? a.finishTime - b.finishTime : b.z - a.z));
  }

  function update(dt) {
    blink += dt;
    fade = Math.max(0, fade - dt * 4);
    if (results) results.t += dt;
    if (toast && (toast.t -= dt) <= 0) toast = null;
    updateParticles(dt);
    if (cam.flash > 0) cam.flash -= dt;
    if (!race) return;
    const r = race;
    const live = state === 'race' || state === 'results' || (r.demo && state !== 'ad');
    if (!live || r.paused || (state === 'race' && portraitBlocked())) { if (state !== 'race' || r.paused) audio.engine(0, false); return; }
    r.t += dt;

    if (r.phase === 'countdown') {
      const before = Math.ceil(r.count);
      r.count -= dt;
      if (Math.ceil(r.count) !== before && r.count > 0) audio.beep(false);
      if (r.count <= 0) {
        r.phase = 'go'; r.goT = r.t;
        audio.beep(true);
        platform.gameplayStart();
        if (r.player && r.upAt != null && r.upAt < 0.5) {
          r.player.boostT = BOOST_T;
          r.player.boostPower = 0.06;
          addMsg('PERFECT START!', '#3bff6b', 46);
          audio.boost();
        }
      }
    }

    const p = r.player;
    if (p) {
      p.input.dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      p.input.brake = keys.down;
      p.input.gas = (keys.up || touchMode || r.autopilot) && !keys.down; // touch: gas is automatic
    }
    rubberBand();
    if (r.mode === 'tutorial' && p) tutorialTick(r, p, dt);
    for (const b of r.bots) botThink(b, dt);
    if (p && r.autopilot) botThink(p, dt); // debug: let the AI drive the player
    for (const rc of r.racers) stepRacer(rc, dt);
    bumps();

    if (p && p.alive) {
      // coins
      const pl = laneOf(p.x);
      for (let row = Math.floor(p.z) - 1; row <= Math.floor(p.z); row++) {
        if (row < 0 || !(track.coins[row] & (1 << pl)) || Math.abs(p.x - (pl - MID)) > 0.5 || p.y > 1.4) continue;
        track.coins[row] &= ~(1 << pl);
        r.coins++;
        r.chain = r.chainT > 0 ? r.chain + 1 : 0; r.chainT = 1.2; r.coinPop = 1;
        audio.coin(r.chain);
        wemit(pl - MID, 0.5, (row + 0.5) * ROW_D, 12, { kind: 'spark', min: 2, max: 5, lmin: 0.2, lmax: 0.4, smin: 0.04, smax: 0.06, colors: ['#ffe066', '#ffffff'] });
        wemit(pl - MID, 0.5, (row + 0.5) * ROW_D, 1, { max: 0, lmin: 0.25, lmax: 0.25, smin: 0.4, smax: 0.4, grow: 0.4, color: '#ffd84a', cap: 120 });
        ringFx(pl - MID, 0.5, (row + 0.5) * ROW_D, '#ffe066', 0.15, 0.6, 0.3);
        pj(pl - MID, 0.6, (row + 0.5) * ROW_D);
        floater(r.chain >= 2 ? `+1 x${r.chain + 1}` : '+1', PX, PY - 20);
      }
      if (p.fuel < 25 && !r.lowWarned) { r.lowWarned = true; addMsg('LOW FUEL!', '#ff4f4f', 34); audio.tone(300, 0.3, 'square', 0.06, 0, 150); }
      else if (p.fuel > 30) r.lowWarned = false;
    }
    // overtakes
    if (p && r.phase === 'go' && r.t - r.goT > 1.5) {
      for (const b of r.bots) {
        const ahead = b.z > p.z;
        if (ahead !== b.ahead && p.alive && b.alive && Math.abs(b.z - p.z) < 3 && !b.finished && !p.finished) {
          if (ahead) say(b, b.buddy ? BUDDY_PASSING : PASSING);
          else { say(b, b.buddy ? BUDDY_PASSED : PASSED); addMsg('OVERTAKE!', '#19e6ff', 36); audio.overtake(); }
        }
        b.ahead = ahead;
      }
    } else if (p) for (const b of r.bots) b.ahead = b.z > p.z;

    if (r.mode !== 'endless' && p) {
      const place = standings().indexOf(p) + 1;
      if (place !== r.place) { r.place = place; r.placeT = 0; }
      r.placeT += dt;
    }
    if (r.mode === 'endless' && p && p.z > track.n - 140) genRows(track, track.gen, track.n + 200);
    if (r.mode === 'endless' && p) r.cruise = endlessCruise(p.z);
    if (r.demo && !r.audit && (r.focus.finished || r.t > 120)) { newDemo(); return; }

    if (r.endT > 0 && state === 'race') { r.endT -= dt; if (r.endT <= 0) toResults(); }
    for (const m of r.msgs) m.t += dt;
    for (const fl of r.floaters) fl.t += dt;
    r.floaters = r.floaters.filter((fl) => fl.t < 0.9);
    if (r.vig && (r.vig.a -= dt * 1.4) <= 0) r.vig = null;
    if (r.coinPop > 0) r.coinPop = Math.max(0, r.coinPop - dt * 4);
    if (r.chainT > 0) r.chainT -= dt;
    cam.dip *= Math.pow(0.001, dt);
    if (r.fireworks > 0 && Math.floor(r.t * 3) !== Math.floor((r.t - dt) * 3)) { r.fireworks--; confetti(rand(150, W - 150), rand(80, 220), 35); audio.tone(rand(500, 900), 0.3, 'triangle', 0.05, 0, rand(1500, 2500)); }

    r.msgs = r.msgs.filter((m) => m.t < 1.6);
    for (const b of r.bots) if (b.sayT > 0) b.sayT -= dt;
    if (r.shake > 0) r.shake = Math.max(0, r.shake - dt * 1.8);

    // camera follows the focus racer
    const f = r.focus;
    if (f.alive) {
      const k = 1 - Math.exp(-7 * dt);
      cam.x += (f.x * 0.8 - cam.x) * k;
      cam.y += (CAM_UP + clamp(f.y, -0.3, 3) * 0.75 - cam.y) * (1 - Math.exp(-5 * dt));
      cam.z = f.z * ROW_D - CAM_BACK + r.speedView * 0.9 + r.boostView * 0.2;
      cam.roll += (clamp(-(f.vx + f.bump) * 0.022, -0.22, 0.22) - cam.roll) * k;
      const jumpPitch = f.grounded ? 0 : clamp(f.vy * 0.007, -0.05, 0.05);
      cam.pitch += (PITCH + jumpPitch - cam.pitch) * (1 - Math.exp(-6 * dt));
      cam.cosp = Math.cos(cam.pitch); cam.sinp = Math.sin(cam.pitch);
    }
    const boostTarget = f.alive ? f.boostPower / 0.32 : 0;
    r.boostView += (boostTarget - r.boostView) * (1 - Math.exp(-(boostTarget > r.boostView ? 5 : 1.4) * dt));
    // the faster you go, the wider the view (and the closer the camera hugs the rocket)
    const spd = f.alive ? clamp(f.v / (r.cruise * 1.1), 0, 1.2) : 0;
    r.speedView += (spd - r.speedView) * Math.min(1, dt * 3);
    cam.f = FOCAL * Math.max(0.54, 1 - 0.25 * r.speedView - 0.1 * r.boostView);

    // engine trails
    for (const rc of r.racers) {
      if (!rc.alive || Math.abs(rc.z - f.z) > 30) continue;
      if (rc === f || Math.floor(r.t * 60) % 3 === 0) wemit(rc.x + rand(-0.05, 0.05), rc.y + RY * RS_ROCKET + 0.03, rc.z * ROW_D - 0.75, 1, { min: 0.2, max: 0.8, vz: -1, lmin: 0.15, lmax: 0.22 + clamp(rc.v / r.cruise, 0, 1.5) * 0.25 + (rc.boostT > 0 ? 0.18 : 0), smin: 0.04, smax: 0.07, colors: rc.boostT > 0 ? ['#9dffb8', '#ffffff'] : ['#ffb040', '#ffd88a'], cap: 10 });
      if (rc === f && rc.boostT > 0) wemit(rc.x + rand(-0.4, 0.4), rc.y + rand(0.1, 0.5), rc.z * ROW_D - 0.4, 1, { kind: 'spark', max: 0.5, vz: -8, lmin: 0.15, lmax: 0.25, smin: 0.03, smax: 0.05, color: '#9dffb8' });
    }
    updateWParts(dt);
    if (!r.demo && p) audio.engine(clamp(p.v / 16, 0, 1.3), p.alive && state === 'race');
  }

  // walks the player through the TRAINING steps; slows time right before each jump
  function tutorialTick(r, p, dt) {
    const st = track.steps.find((x) => p.z >= x.from && p.z < x.to) || null;
    if (st !== r.step) {
      // a long jump can land past the end of its step: credit it on the way out
      const prev = r.step;
      if (prev && !prev.done && prev.gap && p.alive && p.z > prev.gap + 1) {
        prev.done = true; prev.doneT = r.t;
        addMsg('NICE!', '#3bff6b', 46); audio.overtake(); confetti(W / 2, 150, 26);
      }
      r.step = st; r.stepT = 0; r.stepCoins = r.coins;
      if (st && r.phase === 'go') audio.hover();
    }
    if (!st) return;
    r.stepT += dt;
    if (st.done || r.phase !== 'go') return;
    let ok = false;
    if (st.id === 'gas') ok = (touchMode && r.stepT > 2) || (keys.up && p.v > r.cruise * 0.9);
    else if (st.id === 'steer') ok = r.coins - r.stepCoins >= 2;
    else if (st.id === 'jump' || st.id === 'wall') ok = p.alive && p.grounded && p.z > st.gap + 1.5;
    else if (st.id === 'boost') ok = p.boostT > 0;
    else if (st.id === 'red') ok = p.alive && p.z > st.to - 6;
    else if (st.id === 'fuel') ok = p.fuelRow >= st.from;
    if (ok) {
      st.done = true; st.doneT = r.t;
      if (st.id !== 'finish') { addMsg('NICE!', '#3bff6b', 46); audio.overtake(); confetti(W / 2, 150, 26); }
    }
    // slow motion right before the edge so first-time players can react
    const lo = st.id === 'wall' ? 0.9 : 0.15, hi = st.id === 'wall' ? 3.4 : 2.6;
    if ((st.id === 'jump' || st.id === 'wall') && p.alive && p.grounded && st.gap - p.z < hi && st.gap - p.z > lo) r.slowmo = Math.max(r.slowmo, 0.06);
  }
  function startTutorial() {
    newRace('tutorial');
    state = 'race';
    results = null;
  }
  function playMain() { if (!save.trained) startTutorial(); else startLevel(nextLevel()); }

  // ------------------------------------------------------------- race flow
  function startLevel(i) {
    newRace('level', i);
    state = 'race';
    results = null;
  }
  function startEndless() {
    newRace('endless');
    state = 'race';
    results = null;
  }
  // a midgame ad between races (CrazyGames rate-limits these itself)
  function withAd(fn) {
    if (save.races >= 2 && platform.adsAvailable) { state = 'ad'; audio.engine(0, false); platform.midgameAd(fn); } else fn();
  }
  function toResults() {
    const r = race, p = r.player;
    platform.gameplayStop();
    save.races++;
    if (r.mode === 'tutorial') {
      save.trained = true;
      save.coins += r.coins;
      results = { mode: 'tutorial', earned: r.coins, t: 0 };
      confetti(W / 2, 140, 90);
      writeSave();
      state = 'results';
      return;
    }
    if (r.mode === 'endless') {
      const dist = Math.floor(p.z);
      const best = dist > save.best;
      if (best) save.best = dist;
      const earned = r.coins + Math.floor(dist / 50);
      save.coins += earned;
      results = { mode: 'endless', dist, best, earned, t: 0 };
      if (best && dist > 100) { confetti(W / 2, 140, 80); platform.happytime(); }
    } else {
      // racers still flying get an estimated finishing time
      const est = (rc) => (rc.finished ? rc.finishTime : r.t + (track.finish - rc.z) / Math.max(4, r.cruise * rc.speedMul));
      const order = r.racers.slice().sort((a, b) => est(a) - est(b));
      const place = order.indexOf(p) + 1;
      const stars = place <= 3 ? 4 - place : 0;
      const earned = r.coins + PLACE_COINS[place - 1];
      save.coins += earned;
      save.stars[r.lvl - 1] = Math.max(save.stars[r.lvl - 1] || 0, stars);
      const unlockedNow = place <= 3 && r.lvl === save.unlocked && r.lvl < LEVELS;
      if (place <= 3) save.unlocked = Math.max(save.unlocked, Math.min(LEVELS, r.lvl + 1));
      results = { mode: 'level', order: order.map((rc) => ({ name: rc.name, color: rc.color, time: est(rc), you: rc === p })), place, stars, earned, unlockedNow, t: 0 };
      if (place === 1) platform.happytime();
    }
    writeSave();
    state = 'results';
  }
  function resultsPrimary() {
    if (!results) return;
    const r = race;
    if (results.mode === 'tutorial') startLevel(1);
    else if (results.mode === 'endless') withAd(startEndless);
    else if (results.place <= 3 && r.lvl < LEVELS) withAd(() => startLevel(r.lvl + 1));
    else withAd(() => startLevel(r.lvl));
  }
  function retry() {
    const r = race;
    if (r.mode === 'tutorial') startTutorial();
    else if (r.mode === 'endless') withAd(startEndless); else withAd(() => startLevel(r.lvl));
  }
  function toTitle() {
    platform.gameplayStop();
    audio.engine(0, false);
    state = 'title';
    newDemo();
  }
  function setPaused(p, manual) {
    if (!race || state !== 'race' || race.paused === p) return;
    race.paused = p;
    keys.left = keys.right = keys.down = keys.up = false;
    activePointers.clear();
    if (p) platform.gameplayStop();
    else if (race.phase === 'go' || manual) platform.gameplayStart();
  }
  function portraitBlocked() { return touchMode && window.innerHeight > window.innerWidth * 1.05; }

  function jumpPressed() {
    const r = race;
    if (state !== 'race' || !r || r.paused || !r.player) return;
    if (r.phase === 'countdown') r.upAt = r.count;
    r.player.input.jump = true;
    tutPress('jump');
  }
  function tutPress(id) {
    const r = race;
    if (!r || !r.tut || r.tut[id]) return;
    r.tut[id] = Math.max(0.001, r.t);
    const c = tutCardPos(id);
    confetti(c.x, c.y, 30);
    audio.ding();
  }
  function tutCards() {
    return touchMode
      ? [{ id: 'steer', label: 'STEER', keys: ['◀', '▶'] }, { id: 'jump', label: 'JUMP', keys: ['TAP'] }]
      : [{ id: 'gas', label: 'HOLD = GAS', keys: ['↑'] }, { id: 'steer', label: 'STEER', keys: ['←', '→'] }, { id: 'jump', label: 'JUMP', keys: ['SPACE'] }];
  }
  function tutCardPos(id) {
    const cards = tutCards(), i = Math.max(0, cards.findIndex((c) => c.id === id));
    return { x: W / 2 + (i - (cards.length - 1) / 2) * 232, y: H * 0.7 };
  }

  function selectSkin(i) {
    const s = SKINS[i];
    if (save.owned.includes(i)) { save.skin = i; writeSave(); audio.ding(); return; }
    if (save.coins < s.cost) { toast = { text: `NEED ${s.cost - save.coins} MORE COINS`, t: 1.4 }; audio.tone(120, 0.2, 'sawtooth'); return; }
    save.coins -= s.cost;
    save.owned.push(i);
    save.skin = i;
    writeSave();
    audio.fanfare();
    confetti(W / 2, H / 2, 60);
    toast = { text: `${s.name} UNLOCKED!`, t: 1.6 };
  }
  function watchAdForCoins() {
    if (!platform.adsAvailable) return;
    audio.engine(0, false);
    platform.rewardedAd((ok) => {
      if (!ok) { toast = { text: 'NO AD RIGHT NOW', t: 1.4 }; return; }
      save.coins += 60;
      writeSave();
      audio.coin();
      confetti(W / 2, 90, 40);
      toast = { text: '+60 COINS', t: 1.4 };
    });
  }

  // ------------------------------------------------------------------ input
  function onKey(code) {
    if (code === 'KeyM') { audio.setMuted(!audio.muted); toast = { text: audio.muted ? 'SOUND OFF' : 'SOUND ON', t: 1 }; return; }
    const back = code === 'Backspace' || code === 'KeyQ';
    if (state === 'title') {
      if (code === 'Enter' || code === 'Space') playMain();
      else if (code === 'KeyT') startTutorial();
      else if (code === 'KeyL') state = 'levels';
      else if (code === 'KeyE') startEndless();
      else if (code === 'KeyH') state = 'hangar';
      else if (code === 'KeyN' && DEBUG) { Object.assign(save, JSON.parse(JSON.stringify(DEFAULT_SAVE))); writeSave(); toast = { text: 'PROGRESS RESET', t: 1.5 }; }
    } else if (state === 'levels') {
      if (code === 'Enter' || code === 'Space') startLevel(nextLevel());
      else if (back) state = 'title';
    } else if (state === 'hangar') {
      const i = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'].indexOf(code);
      if (i >= 0) selectSkin(i);
      else if (back || code === 'Enter') state = 'title';
    } else if (state === 'race') {
      const r = race;
      if (code === 'KeyP') { setPaused(!r.paused, true); return; } // not Esc: it exits fullscreen on portals
      if (r.paused) {
        if (code === 'KeyQ') toTitle();
        else if (code === 'KeyR') { setPaused(false, true); retry(); }
        return;
      }
      if (code === 'Space') jumpPressed();
      if (code === 'ArrowUp' || code === 'KeyW') { if (r.phase === 'countdown') r.upAt = r.count; tutPress('gas'); }
      if (['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD'].includes(code)) tutPress('steer');
    } else if (state === 'results') {
      if (results && results.t < 0.6) return;
      if (code === 'Enter' || code === 'Space') resultsPrimary();
      else if (code === 'KeyR') retry();
      else if (back) toTitle();
    }
  }
  const KEYMAP = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowDown: 'down', KeyS: 'down', ArrowUp: 'up', KeyW: 'up' };
  window.addEventListener('keydown', (e) => {
    audio.init();
    if (touchMode && !e.repeat) touchMode = false; // a real keyboard is being used
    const k = KEYMAP[e.code];
    if (k) { keys[k] = true; e.preventDefault(); }
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'Backspace') e.preventDefault();
    if (!e.repeat) onKey(e.code);
  });
  window.addEventListener('keyup', (e) => { const k = KEYMAP[e.code]; if (k) keys[k] = false; });
  window.addEventListener('blur', () => { keys.left = keys.right = keys.down = keys.up = false; setPaused(true, false); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { setPaused(true, false); if (audio.ac) audio.ac.suspend().catch(() => {}); }
    else if (audio.ac) audio.ac.resume().catch(() => {});
  });
  // iOS only lets audio start from a user gesture
  ['touchend', 'click'].forEach((ev) => window.addEventListener(ev, () => audio.init(), { passive: true }));

  // ------------------------------------------------------------ touch input
  const activePointers = new Map(); // pointerId -> touch button id
  const TOUCH_BTNS = [
    { id: 'left', x: 92, y: H - 92, r: 64, label: '◀' },
    { id: 'right', x: 236, y: H - 92, r: 64, label: '▶' },
    { id: 'jump', x: W - 124, y: H - 104, r: 84, label: 'JUMP' },
    { id: 'brake', x: W - 124, y: H - 252, r: 46, label: 'BRAKE' },
  ];
  const PAUSE_BTN = { x: W - 36, y: 128, r: 24 };
  function canvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * W / rect.width, y: (e.clientY - rect.top) * H / rect.height };
  }
  function hitTouchButton(x, y) {
    let best = null, bd = 1e9;
    for (const b of TOUCH_BTNS) {
      const d = Math.hypot(x - b.x, y - b.y);
      if (d < b.r * 1.35 && d < bd) { bd = d; best = b; }
    }
    // generous halves: anywhere on the left third steers, the right third jumps
    if (!best) best = x < W * 0.33 ? TOUCH_BTNS[x < 164 ? 0 : 1] : x > W * 0.67 ? TOUCH_BTNS[2] : null;
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
    if (state === 'race' && !race.paused && !portraitBlocked()) {
      if (Math.hypot(x - PAUSE_BTN.x, y - PAUSE_BTN.y) < PAUSE_BTN.r * 1.6) { setPaused(true, true); return; }
      if (!touchMode) return;
      e.preventDefault();
      const b = hitTouchButton(x, y);
      if (b) {
        activePointers.set(e.pointerId, b.id);
        if (b.id === 'jump') jumpPressed(); else if (b.id !== 'brake') tutPress('steer');
        syncTouchKeys();
        try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* not supported */ }
      }
      return;
    }
    for (const b of uiButtons) if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) { audio.click(); b.fn(); return; }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') mouse = canvasPoint(e);
    if (!activePointers.has(e.pointerId)) return;
    const { x, y } = canvasPoint(e);
    const cur = activePointers.get(e.pointerId);
    if (cur !== 'left' && cur !== 'right') return;
    const b = hitTouchButton(x, y);
    if (b && (b.id === 'left' || b.id === 'right')) { activePointers.set(e.pointerId, b.id); syncTouchKeys(); }
  });
  const releasePointer = (e) => { if (activePointers.delete(e.pointerId)) syncTouchKeys(); };
  canvas.addEventListener('pointerup', releasePointer);
  canvas.addEventListener('pointercancel', releasePointer);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // ------------------------------------------------------------- projection
  let PX = 0, PY = 0, PZ = 0, PK = 0;
  function pj(X, Y, Z) {
    const dx = X - cam.x, dy = Y - cam.y + cam.dip, dz = Z - cam.z;
    let zc = dz * cam.cosp - dy * cam.sinp;
    const yc = dy * cam.cosp + dz * cam.sinp;
    if (zc < 0.05) zc = 0.05;
    PK = cam.f / zc;
    PX = W / 2 + dx * PK; PY = CY - yc * PK; PZ = zc;
  }
  function q4(c, x0, y0, z0, x1, y1, z1, x2, y2, z2, x3, y3, z3) {
    ctx.fillStyle = c;
    ctx.beginPath();
    pj(x0, y0, z0); ctx.moveTo(PX, PY);
    pj(x1, y1, z1); ctx.lineTo(PX, PY);
    pj(x2, y2, z2); ctx.lineTo(PX, PY);
    pj(x3, y3, z3); ctx.lineTo(PX, PY);
    ctx.fill();
  }
  // flat polygon on a tile top: pts are [x, z] pairs in world units
  function flatPoly(c, y, pts) {
    ctx.fillStyle = c;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 2) { pj(pts[i], y, pts[i + 1]); if (i) ctx.lineTo(PX, PY); else ctx.moveTo(PX, PY); }
    ctx.fill();
  }

  // ------------------------------------------------------------- background
  // Each world is a sky-highway over an alien planet: space sky with a galaxy and moons, a sunset glow on the
  // horizon, mountain ranges, and canyons, rivers, city lights and clouds far below the road.
  const LAND = {
    MOON: { cloud: ['#ffd8b8', '#4a5a8c'], sky: ['#050d24', '#1d3c6c'], glow: '#f2a76a', mtn: ['#4a5c84', '#2f4066', '#1c2a48'], ground: ['#33415e', '#0b111e'], haze: '205,220,255', city: '#ffc070', grid: '#38d8ff', rail: '#ff9a3a', deck: '#1e2a3e' },
    MARS: { cloud: ['#ffc49a', '#6c3040'], sky: ['#12040f', '#4c1a28'], glow: '#ff9a50', mtn: ['#8a4430', '#5e2a1e', '#3a1812'], ground: ['#552616', '#160806'], haze: '255,195,160', city: '#ffd080', grid: '#ffb050', rail: '#ff6a3a', deck: '#2e2622' },
    NEBULA: { cloud: ['#ffcff0', '#4c2c70'], sky: ['#0a0524', '#3c1854'], glow: '#ff8ad8', mtn: ['#62428a', '#422a62', '#26183e'], ground: ['#2e1d48', '#0b0618'], haze: '230,195,255', city: '#ff9ae8', grid: '#ff70e0', rail: '#ffb04a', deck: '#2a2438' },
    'ICE RINGS': { cloud: ['#ffffff', '#6f8fb0'], sky: ['#051226', '#2c5c84'], glow: '#c8f0ff', mtn: ['#d4e4f0', '#94b2cc', '#5c7c9c'], ground: ['#4e6e8c', '#132030'], haze: '230,245,255', city: '#9fe8ff', grid: '#7ff0ff', rail: '#ffd25a', deck: '#26333f' },
  };
  const land = () => LAND[theme.name] || LAND.MOON;
  const HY0 = CY - FOCAL * Math.tan(PITCH); // horizon line on screen
  const STARS = (() => {
    const r = seeded(42), out = [];
    for (let i = 0; i < 160; i++) {
      out.push({ x: r() * (W + 200), y: r() * (HY0 - 20), s: r() < 0.08 ? 2 : r() < 0.4 ? 1.3 : 0.9, g: i % 4, d: 0.3 + r() * 0.7, big: r() < 0.06 });
    }
    return out.sort((a, b) => a.g - b.g);
  })();
  let skyCache = null;
  function jagged(c, rnd, y0, amp, step, color, sw) {
    c.fillStyle = color;
    c.beginPath(); c.moveTo(0, H);
    let y = y0;
    for (let x = 0; x <= sw + step; x += step) {
      y = clamp(y + (rnd() - 0.5) * amp, y0 - amp * 1.6, y0 + amp * 0.2);
      c.lineTo(x, y - (rnd() < 0.12 ? amp * (0.6 + rnd()) : 0));
    }
    c.lineTo(sw, H); c.closePath(); c.fill();
  }
  function buildSky() {
    const th = theme, L = land(), SW = W + 240, hy = HY0;
    const cv = document.createElement('canvas');
    cv.width = Math.round(SW * RS); cv.height = Math.round(H * RS);
    const c = cv.getContext('2d');
    c.scale(RS, RS);
    const rnd = seeded(th.name.length * 97 + 5);
    // sky: deep space at the top, warm glow at the horizon
    let g = c.createLinearGradient(0, 0, 0, hy + 10);
    g.addColorStop(0, L.sky[0]); g.addColorStop(0.7, L.sky[1]); g.addColorStop(1, L.glow);
    c.fillStyle = g; c.fillRect(0, 0, SW, hy + 10);
    // stars (static field; a few twinkle on top every frame)
    for (let i = 0; i < 700; i++) {
      const y = Math.pow(rnd(), 1.4) * (hy - 6);
      c.globalAlpha = (0.2 + rnd() * 0.7) * (1 - y / hy);
      c.fillStyle = rnd() < 0.8 ? '#ffffff' : rnd() < 0.5 ? '#ffe2c0' : '#c8dcff';
      c.fillRect(rnd() * SW, y, rnd() < 0.85 ? 0.8 : 1.5, rnd() < 0.85 ? 0.8 : 1.5);
    }
    c.globalAlpha = 1;
    // nebula wisps
    for (const [nx, ny, nr, nc] of th.neb) {
      for (let k = 0; k < 6; k++) {
        const x = nx * W + 120 + (rnd() - 0.5) * nr, y = ny * hy * 1.4 + (rnd() - 0.5) * nr * 0.3, r2 = nr * (0.3 + rnd() * 0.5);
        const rg = c.createRadialGradient(x, y, 0, x, y, r2);
        rg.addColorStop(0, nc.replace(/[\d.]+\)$/, (m) => `${Math.min(0.4, parseFloat(m) * 2.2)})`)); rg.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = rg; c.fillRect(x - r2, y - r2, r2 * 2, r2 * 2);
      }
    }
    // spiral galaxy: bright core and two arms of tiny stars
    const gx = SW * 0.52, gy = hy * 0.36;
    c.save(); c.translate(gx, gy); c.rotate(-0.45);
    for (let i = 0; i < 900; i++) {
      const arm = i % 2, t = rnd(), ang = t * 5.5 + arm * Math.PI, rad = 6 + t * 120;
      const x = Math.cos(ang) * rad + (rnd() - 0.5) * 18 * t, y = (Math.sin(ang) * rad + (rnd() - 0.5) * 18 * t) * 0.34;
      c.globalAlpha = (1 - t) * 0.7; c.fillStyle = rnd() < 0.7 ? '#dfe4ff' : '#ffd9b0';
      c.fillRect(x, y, 1, 1);
    }
    c.globalAlpha = 1; c.scale(1, 0.34);
    g = c.createRadialGradient(0, 0, 0, 0, 0, 120);
    g.addColorStop(0, 'rgba(255,250,240,1)'); g.addColorStop(0.1, 'rgba(255,232,200,0.75)'); g.addColorStop(0.4, 'rgba(170,170,255,0.25)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.beginPath(); c.arc(0, 0, 120, 0, Math.PI * 2); c.fill();
    c.restore();
    // planets and moons
    const main = ctx;
    ctx = c;
    drawPlanet(th.planet, 120);
    drawPlanet({ x: 0.38, y: 0.1, r: 16, c: ['#e8eef8', '#8a96aa', '#141a26'], ring: null }, 120);
    drawPlanet({ x: 0.66, y: 0.26, r: 22, c: ['#ffe2c8', '#b88a6a', '#22140c'], ring: null }, 120);
    ctx = main;
    // mountain peaks poking up through the clouds on the horizon
    jagged(c, rnd, hy - 4, 14, 16, L.mtn[0], SW);
    jagged(c, rnd, hy + 2, 18, 22, L.mtn[1], SW);
    // a sea of clouds far below: lit by the sunset near the horizon, deep shadow towards the viewer
    const csp = cloudSprite();
    g = c.createLinearGradient(0, hy + 2, 0, H);
    g.addColorStop(0, L.cloud[0]); g.addColorStop(0.12, L.cloud[1]); g.addColorStop(1, shadeHex(L.cloud[1], 0.35));
    c.fillStyle = g; c.fillRect(0, hy + 4, SW, H - hy);
    for (let i = 0; i < 220; i++) {
      const t = Math.pow(i / 220, 1.7), y = hy + 2 + t * (H - hy + 40), w = 40 + t * 420 * (0.6 + rnd() * 0.6);
      c.globalAlpha = 0.55 + 0.4 * (1 - t);
      c.drawImage(csp, rnd() * (SW + w) - w / 2 - w / 2, y - w * 0.22, w, w * 0.5);
    }
    c.globalAlpha = 1;
    // horizon haze
    g = c.createLinearGradient(0, hy - 30, 0, hy + 40);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, `rgba(${L.haze},0.4)`); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(0, hy - 30, SW, 70);
    skyCache = { cv, theme: th, rs: RS };
  }
  function drawSpace() {
    if (!skyCache || skyCache.theme !== theme || skyCache.rs !== RS) buildSky();
    const par = -cam.x * 10;
    if (!OFF.sky) ctx.drawImage(skyCache.cv, -120 + clamp(par * 0.25, -110, 110), 0, W + 240, H);
    const SW = W + 200;
    ctx.fillStyle = '#ffffff';
    let g = -1;
    for (const s of STARS) {
      if (s.g !== g) { g = s.g; ctx.globalAlpha = 0.5 + 0.5 * Math.sin(blink * (0.7 + g * 0.6) + g * 1.7); }
      const x = (((s.x + par * s.d) % SW) + SW) % SW - 100;
      ctx.fillRect(x, s.y, s.s, s.s);
      if (s.big) { ctx.fillRect(x - 4, s.y + s.s / 2 - 0.3, 8 + s.s, 0.6); ctx.fillRect(x + s.s / 2 - 0.3, s.y - 4, 0.6, 8 + s.s); }
    }
    ctx.globalAlpha = 1;
  }
  function drawPlanet(pl, off) {
    const x = pl.x * W + off, y = pl.y * H, r = pl.r;
    if (pl.ring) {
      ctx.strokeStyle = pl.ring; ctx.globalAlpha = 0.35; ctx.lineWidth = r * 0.1;
      ctx.beginPath(); ctx.ellipse(x, y, r * 1.9, r * 0.42, -0.25, Math.PI, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    const g = ctx.createRadialGradient(x - r * 0.45, y - r * 0.45, r * 0.05, x - r * 0.1, y - r * 0.1, r * 1.15);
    g.addColorStop(0, pl.c[0]); g.addColorStop(0.45, pl.c[1]); g.addColorStop(0.85, pl.c[2]); g.addColorStop(1, '#000000');
    ctx.fillStyle = g;
    circle(x, y, r);
    ctx.strokeStyle = pl.c[1]; ctx.globalAlpha = 0.35; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, r, Math.PI * 0.9, Math.PI * 1.65); ctx.stroke();
    if (pl.ring) {
      ctx.strokeStyle = pl.ring; ctx.globalAlpha = 0.55; ctx.lineWidth = r * 0.1;
      ctx.beginPath(); ctx.ellipse(x, y, r * 1.9, r * 0.42, -0.25, 0, Math.PI); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  function shadeHex(hex, k) { const c = rgb(hex); return `rgb(${c[0] * k | 0},${c[1] * k | 0},${c[2] * k | 0})`; }
  // a puffy cloud lit from above by the sunset colour, shaded underneath (one per world)
  let cloudCache = null;
  function cloudSprite() {
    const L = land();
    if (cloudCache && cloudCache.L === L) return cloudCache.cv;
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
    const c = cv.getContext('2d'), rnd = seeded(11);
    for (let i = 0; i < 16; i++) {
      const x = 40 + rnd() * 176, y = 60 + (rnd() - 0.4) * 34 - Math.sin((x - 40) / 176 * Math.PI) * 18, r = 22 + rnd() * 26;
      const gr = c.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = gr; c.fillRect(0, 0, 256, 128);
    }
    // tint: warm light on top, cool shadow below
    c.globalCompositeOperation = 'source-atop';
    const g = c.createLinearGradient(0, 20, 0, 110);
    g.addColorStop(0, L.cloud[0]); g.addColorStop(0.55, shadeHex(L.cloud[0], 0.8)); g.addColorStop(1, L.cloud[1]);
    c.fillStyle = g; c.fillRect(0, 0, 256, 128);
    cloudCache = { cv, L };
    return cv;
  }
  // cloud puffs streaming past under the road
  const CLOUDS = Array.from({ length: 18 }, () => ({ x: 0, y: 0, z: -1e9, w: 8 }));
  function drawClouds() {
    const csp = cloudSprite();
    for (const cl of CLOUDS) {
      if (cl.z < cam.z + 2 || cl.z > cam.z + 150) {
        cl.z = cam.z + (cl.z < -1e8 ? rand(5, 150) : rand(120, 150));
        cl.x = rand(-34, 34); cl.y = rand(-12, -6); cl.w = rand(10, 24);
      }
      pj(cl.x, cl.y, cl.z);
      const w = cl.w * PK, dz = cl.z - cam.z;
      if (w < 3 || w > 1100) continue; // huge close-up sprites cost a lot of fill for little effect
      ctx.globalAlpha = clamp(dz / 14, 0, 1) * clamp((150 - dz) / 40, 0, 1) * 0.92;
      ctx.drawImage(csp, PX - w / 2, PY - w / 4, w, w / 2);
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ world
  const C_BOOST = rgb('#1c6a3e'), C_STICKY = rgb('#45531f'), C_BURN = rgb('#5a1612'), C_FUEL = rgb('#1f4c80'), C_PAD = rgb('#8a6c1c');
  const C_WHITE = rgb('#e8e8f0'), C_BLACK = rgb('#20202a');
  let laneOrder = [0, 1, 2, 3, 4, 5, 6];
  let pulseRow = -999; // a band of light that runs down the track on every music beat

  function segment(x0, y0, z0, x1, y1, z1) { pj(x0, y0, z0); ctx.moveTo(PX, PY); pj(x1, y1, z1); ctx.lineTo(PX, PY); }
  // stroke the current path as a neon tube: wide soft glow + bright core
  function glowStroke(color, w, alpha) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha * 0.3; ctx.lineWidth = w * 3.4; ctx.stroke();
    ctx.globalAlpha = alpha; ctx.lineWidth = w; ctx.stroke();
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  const THICK = 0.55, RAIL_H = 0.2; // visual thickness of the deck, height of the side rails

  function drawRow(r) {
    const z0 = r * ROW_D + GAP_Z, z1 = (r + 1) * ROW_D - GAP_Z;
    const zn = Math.max(z0, cam.z + NEAR);
    if (z1 <= zn) return;
    const dist = (z0 - cam.z) / ROW_D;
    const fog = clamp((dist - DRAW_ROWS * 0.35) / (DRAW_ROWS * 0.65), 0, 1);
    const row = track.rows[r], prev = track.rows[r - 1], next = track.rows[r + 1];
    const L = land(), deck = rgb(L.deck);
    const pulse = Math.max(0, 1 - Math.abs(r - pulseRow) / 2.5);
    const scale = cam.f / Math.max(0.5, zn - cam.z);
    if (dist > 16) drawRowFar(r, row, prev, z1, zn, fog, deck);
    else {
      const B = dist < 12 ? 0.07 : 0;
      for (const l of laneOrder) {
        const t = row[l];
        if (t === T_GAP) continue;
        const x0 = l - MID - 0.5 + GAP_X, x1 = l - MID + 0.5 - GAP_X;
        let c = deck, kk = (l + r) % 2 ? 1.04 : 0.96;
        switch (t) {
          case T_BOOST: c = C_BOOST; kk = 1; break;
          case T_STICKY: c = C_STICKY; kk = 1; break;
          case T_BURN: c = C_BURN; kk = 0.9 + 0.25 * Math.sin(blink * 10 + r * 2.1 + l * 1.3); break;
          case T_FUEL: c = C_FUEL; kk = 1 + 0.2 * Math.sin(blink * 6 + r); break;
          case T_PAD: c = C_PAD; kk = 1; break;
          case T_FINISH: c = (l + r) % 2 ? C_WHITE : C_BLACK; kk = 1; break;
        }
        const lt = l > 0 ? row[l - 1] : T_GAP, rt = l < LANES - 1 ? row[l + 1] : T_GAP;
        const ytop = -B, yb = -THICK;
        if (cam.x < x0 && lt === T_GAP) q4(shade(deck, 0.55, fog), x0, ytop, zn, x0, ytop, z1, x0, yb, z1, x0, yb, zn);
        if (cam.x > x1 && rt === T_GAP) q4(shade(deck, 0.55, fog), x1, ytop, zn, x1, ytop, z1, x1, yb, z1, x1, yb, zn);
        const open = !prev || prev[l] === T_GAP || zn > z0;
        q4(shade(deck, open ? 0.42 : 0.3, fog), x0, ytop, zn, x1, ytop, zn, x1, open ? yb : ytop - 0.12, zn, x0, open ? yb : ytop - 0.12, zn);
        if (B && zn + B < z1 - B) {
          q4(shade(c, 0.62 * kk, fog), x0, ytop, z1, x1, ytop, z1, x1 - B, 0, z1 - B, x0 + B, 0, z1 - B);
          q4(shade(c, (cam.x < x0 ? 0.95 : 0.72) * kk, fog), x0, ytop, zn, x0 + B, 0, zn + B, x0 + B, 0, z1 - B, x0, ytop, z1);
          q4(shade(c, (cam.x > x1 ? 0.95 : 0.72) * kk, fog), x1, ytop, zn, x1 - B, 0, zn + B, x1 - B, 0, z1 - B, x1, ytop, z1);
          q4(shade(c, 1.15 * kk, fog), x0, ytop, zn, x1, ytop, zn, x1 - B, 0, zn + B, x0 + B, 0, zn + B);
          q4(shade(c, kk, fog), x0 + B, 0, zn + B, x1 - B, 0, zn + B, x1 - B, 0, z1 - B, x0 + B, 0, z1 - B);
        } else q4(shade(c, kk, fog), x0, 0, zn, x1, 0, zn, x1, 0, z1, x0, 0, z1);
      }
      drawTileDecor(r, row, z0, z1, zn);
    }
    // glossy deck: the horizon glow reflects more strongly further away (fresnel)
    if (dist < 44) {
      const gl = rgb(L.glow), a = (0.05 + 0.13 * clamp((dist - 3) / 18, 0, 1)) * (1 - fog * 0.6);
      ctx.globalCompositeOperation = 'lighter';
      let s0 = -1;
      for (let l = 0; l <= LANES; l++) {
        const on = l < LANES && row[l] !== T_GAP;
        if (on && s0 < 0) s0 = l;
        if (!on && s0 >= 0) {
          q4(`rgba(${gl[0]},${gl[1]},${gl[2]},${a})`, s0 - MID - 0.5 + GAP_X, 0.002, zn, l - MID - 0.5 - GAP_X, 0.002, zn, l - MID - 0.5 - GAP_X, 0.002, z1, s0 - MID - 0.5 + GAP_X, 0.002, z1);
          s0 = -1;
        }
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    // glowing cyan grid on the deck: lane seams and a cross line every other row
    if (dist < 40) {
      ctx.beginPath();
      for (let l = 1; l < LANES; l++) if (row[l - 1] !== T_GAP && row[l] !== T_GAP) segment(l - MID - 0.5, 0.004, zn, l - MID - 0.5, 0.004, z1);
      if (r % 2 === 0 && zn === z0) {
        let a = -1;
        for (let l = 0; l <= LANES; l++) {
          const on = l < LANES && row[l] !== T_GAP;
          if (on && a < 0) a = l;
          if (!on && a >= 0) { segment(a - MID - 0.5, 0.004, z0, l - MID - 0.5, 0.004, z0); a = -1; }
        }
      }
      glowStroke(L.grid, clamp(scale * 0.016, 0.5, 2.4), (0.42 + pulse * 0.35) * (1 - fog * 0.8));
    }
    // side rails with orange running lights wherever the deck has an open side
    drawRails(r, row, prev, next, zn, z1, fog, scale, dist);
    for (const l of laneOrder) if (row[l] === T_BLOCK) drawBarrier(l, zn, z1, fog, scale);
    // coins
    const coins = track.coins[r];
    if (coins && dist < 30) {
      for (let l = 0; l < LANES; l++) {
        if (!(coins & (1 << l))) continue;
        const cz = (r + 0.5) * ROW_D;
        if (cz < cam.z + NEAR + 0.3) continue;
        pj(l - MID, 0.5 + Math.sin(blink * 4 + r) * 0.06, cz);
        const rad = 0.2 * PK, sx = Math.abs(Math.cos(blink * 4 + r * 0.7));
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(PX, PY, 0, PX, PY, rad * 2);
        g.addColorStop(0, 'rgba(255,210,60,0.35)'); g.addColorStop(1, 'rgba(255,210,60,0)');
        ctx.fillStyle = g; circle(PX, PY, rad * 2);
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#b87a00';
        ctx.beginPath(); ctx.ellipse(PX, PY, Math.max(1, rad * sx), rad, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffd84a';
        ctx.beginPath(); ctx.ellipse(PX, PY, Math.max(0.5, rad * sx * 0.78), rad * 0.78, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.fillRect(PX - rad * sx * 0.25, PY - rad * 0.5, Math.max(1, rad * sx * 0.18), rad * 0.6);
      }
    }
    if (r === track.finish) drawFinishArch(r);
  }

  // distant rows: each run of tiles is one slab
  function drawRowFar(r, row, prev, z1, zn, fog, deck) {
    let l = 0;
    while (l < LANES) {
      const t = row[l];
      if (t === T_GAP) { l++; continue; }
      let e = l;
      const plain = t === T_FLOOR || t === T_BLOCK;
      if (plain) while (e + 1 < LANES && (row[e + 1] === T_FLOOR || row[e + 1] === T_BLOCK)) e++;
      const x0 = l - MID - 0.5 + GAP_X, x1 = e - MID + 0.5 - GAP_X;
      const c = plain ? deck : t === T_BOOST ? C_BOOST : t === T_STICKY ? C_STICKY : t === T_BURN ? C_BURN : t === T_FUEL ? C_FUEL : t === T_PAD ? C_PAD : (l + r) % 2 ? C_WHITE : C_BLACK;
      if (cam.x < x0 && (l === 0 || row[l - 1] === T_GAP)) q4(shade(deck, 0.55, fog), x0, 0, zn, x0, 0, z1, x0, -THICK, z1, x0, -THICK, zn);
      if (cam.x > x1 && (e === LANES - 1 || row[e + 1] === T_GAP)) q4(shade(deck, 0.55, fog), x1, 0, zn, x1, 0, z1, x1, -THICK, z1, x1, -THICK, zn);
      let open = !prev;
      for (let q = l; q <= e && !open; q++) open = prev[q] === T_GAP;
      q4(shade(deck, open ? 0.42 : 0.3, fog), x0, 0, zn, x1, 0, zn, x1, open ? -THICK : -0.12, zn, x0, open ? -THICK : -0.12, zn);
      q4(shade(c, 1, fog), x0, 0, zn, x1, 0, zn, x1, 0, z1, x0, 0, z1);
      l = e + 1;
    }
  }

  function drawRails(r, row, prev, next, zn, z1, fog, scale, dist) {
    const L = land(), metal = rgb('#3a4250');
    const light = new Path2D();
    for (let l = 0; l < LANES; l++) {
      if (row[l] === T_GAP) continue;
      for (const side of [-1, 1]) {
        const nb = l + side;
        if (nb >= 0 && nb < LANES && row[nb] !== T_GAP) continue;
        const x = l - MID + side * (0.5 - GAP_X - 0.03);
        if (dist < 34) {
          q4(shade(metal, (side < 0) === (cam.x > x) ? 0.95 : 0.6, fog), x, 0, zn, x, 0, z1, x, RAIL_H, z1, x, RAIL_H, zn);
          q4(shade(metal, 1.25, fog), x - 0.04, RAIL_H, zn, x + 0.04, RAIL_H, zn, x + 0.04, RAIL_H, z1, x - 0.04, RAIL_H, z1);
        }
        pj(x, RAIL_H * 0.6, zn); light.moveTo(PX, PY); pj(x, RAIL_H * 0.6, z1); light.lineTo(PX, PY);
      }
      // the deck's open front and back edges get the same light strip
      if ((!prev || prev[l] === T_GAP) && zn === r * ROW_D + GAP_Z) { pj(l - MID - 0.45, -0.04, zn); light.moveTo(PX, PY); pj(l - MID + 0.45, -0.04, zn); light.lineTo(PX, PY); }
      if (!next || next[l] === T_GAP) { pj(l - MID - 0.45, -0.04, z1); light.moveTo(PX, PY); pj(l - MID + 0.45, -0.04, z1); light.lineTo(PX, PY); }
    }
    ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
    ctx.strokeStyle = L.rail;
    const w = clamp(scale * 0.03, 0.7, 4);
    const blinkOn = (r + Math.floor(blink * 8)) % 6 === 0;
    ctx.globalAlpha = 0.25 * (1 - fog); ctx.lineWidth = w * 3.2; ctx.stroke(light);
    ctx.globalAlpha = (blinkOn ? 1 : 0.75) * (1 - fog * 0.7); ctx.lineWidth = w; ctx.stroke(light);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  function drawTileDecor(r, row, z0, z1, zn) {
    const D = z1 - z0;
    for (let l = 0; l < LANES; l++) {
      const t = row[l], cx = l - MID;
      if (t === T_BOOST) {
        const off = (blink * 2.5) % 0.5;
        ctx.globalCompositeOperation = 'lighter';
        for (const f of [0.1, 0.6]) {
          const zb = z0 + (f + off) * D * 0.8, h = 0.3 * D, th = 0.14 * D;
          if (zb - th < zn) continue;
          flatPoly('#3bff6b', 0.01, [cx - 0.32, zb, cx, zb + h, cx + 0.32, zb, cx + 0.32, zb - th, cx, zb + h - th, cx - 0.32, zb - th]);
        }
        ctx.globalCompositeOperation = 'source-over';
      } else if (t === T_PAD) {
        const ph = (blink * 1.8) % 1;
        ctx.globalCompositeOperation = 'lighter';
        for (const q of [ph, (ph + 0.5) % 1]) {
          const rad = 0.12 + q * 0.32, cz = z0 + D / 2;
          if (cz - rad * 1.2 < zn) continue;
          ctx.beginPath();
          for (let i = 0; i <= 16; i++) { const a = i / 16 * Math.PI * 2; pj(cx + Math.cos(a) * rad, 0.01, cz + Math.sin(a) * rad * 1.3); if (i) ctx.lineTo(PX, PY); else ctx.moveTo(PX, PY); }
          ctx.strokeStyle = `rgba(255,214,58,${1 - q})`; ctx.lineWidth = 2.5; ctx.stroke();
        }
        ctx.globalCompositeOperation = 'source-over';
      } else if (t === T_FUEL) {
        const p = 0.5 + 0.5 * Math.sin(blink * 6 + r), a = Math.max(zn, z0 + 0.2 * D);
        ctx.globalCompositeOperation = 'lighter';
        q4(`rgba(80,180,255,${0.2 + 0.3 * p})`, cx - 0.3, 0.01, a, cx + 0.3, 0.01, a, cx + 0.3, 0.01, z1 - 0.2 * D, cx - 0.3, 0.01, z1 - 0.2 * D);
        if (z0 + 0.35 * D > zn) flatPoly('rgba(200,240,255,0.9)', 0.012, [cx, z0 + 0.72 * D, cx + 0.12, z0 + 0.45 * D, cx, z0 + 0.35 * D, cx - 0.12, z0 + 0.45 * D]);
        ctx.globalCompositeOperation = 'source-over';
      } else if (t === T_STICKY) {
        for (const [bx, bz, br] of [[-0.22, 0.3, 0.1], [0.15, 0.55, 0.13], [-0.05, 0.8, 0.08], [0.28, 0.2, 0.07]]) {
          const cz = z0 + bz * D;
          if (cz - br < zn) continue;
          pj(cx + bx, 0.02, cz);
          const rad = br * PK * (1 + 0.15 * Math.sin(blink * 5 + bx * 20 + r));
          ctx.fillStyle = 'rgba(150,230,60,0.55)';
          ctx.beginPath(); ctx.ellipse(PX, PY, rad, rad * 0.45, 0, 0, Math.PI * 2); ctx.fill();
        }
      } else if (t === T_BURN) {
        // red hazard pad: glowing panel with a bold X
        const a = Math.max(zn, z0 + 0.1 * D), p = 0.6 + 0.4 * Math.sin(blink * 8 + r + l);
        ctx.globalCompositeOperation = 'lighter';
        q4(`rgba(255,40,30,${0.25 * p})`, cx - 0.4, 0.01, a, cx + 0.4, 0.01, a, cx + 0.4, 0.01, z1 - 0.1 * D, cx - 0.4, 0.01, z1 - 0.1 * D);
        ctx.beginPath();
        if (z0 + 0.15 * D > zn) { segment(cx - 0.3, 0.012, z0 + 0.15 * D, cx + 0.3, 0.012, z1 - 0.15 * D); segment(cx + 0.3, 0.012, z0 + 0.15 * D, cx - 0.3, 0.012, z1 - 0.15 * D); }
        ctx.strokeStyle = `rgba(255,90,70,${0.8 * p})`; ctx.lineWidth = clamp(PK * 0.05, 1, 6); ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
      }
    }
  }

  // raised blocks are steel barriers with hazard stripes and a light along the top
  function drawBarrier(l, zn, z1, fog, scale) {
    const x0 = l - MID - 0.44, x1 = l - MID + 0.44, h = BLOCK_H, zb = zn, ze = z1 - 0.08;
    if (ze <= zb) return;
    const m = rgb('#4a5262');
    if (cam.x < x0) q4(shade(m, 0.6, fog), x0, h, zb, x0, h, ze, x0, 0, ze, x0, 0, zb);
    if (cam.x > x1) q4(shade(m, 0.6, fog), x1, h, zb, x1, h, ze, x1, 0, ze, x1, 0, zb);
    q4(shade(m, 0.8, fog), x0, h, zb, x1, h, zb, x1, 0, zb, x0, 0, zb);
    q4(shade(m, 1.15, fog), x0, h, zb, x1, h, zb, x1, h, ze, x0, h, ze);
    // yellow/black hazard band on the front
    const y0 = h * 0.35, y1 = h * 0.62;
    q4(shade(rgb('#f2c21a'), 1, fog), x0, y1, zb, x1, y1, zb, x1, y0, zb, x0, y0, zb);
    for (let i = 0; i < 4; i++) {
      const a = x0 + (i + 0.1) * (x1 - x0) / 4, b = a + (x1 - x0) / 8;
      q4(shade(rgb('#1a1a1a'), 1, fog), a, y1, zb, b, y1, zb, b + 0.08, y0, zb, a + 0.08, y0, zb);
    }
    ctx.beginPath(); segment(x0, h, zb, x1, h, zb);
    glowStroke(land().rail, clamp(scale * 0.025, 0.7, 3), 0.8 * (1 - fog * 0.7));
  }

  function drawFinishArch(r) {
    const z = r * ROW_D + 0.2;
    if (z < cam.z + NEAR + 0.5) return;
    for (const sx of [-MID - 0.9, MID + 0.6]) {
      q4('#2a2a3a', sx, -0.3, z, sx + 0.3, -0.3, z, sx + 0.3, 2.6, z, sx, 2.6, z);
      ctx.beginPath(); segment(sx, -0.3, z, sx, 2.6, z); segment(sx + 0.3, -0.3, z, sx + 0.3, 2.6, z);
      glowStroke(RAINBOW[Math.floor(blink * 6) % RAINBOW.length], clamp(PK * 0.04, 1, 4), 1);
    }
    const n = 14, x0 = -MID - 0.9, w = (2 * MID + 1.8) / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < 2; j++) {
        const y = 2.2 + j * 0.25;
        q4((i + j) % 2 ? '#111' : '#fff', x0 + i * w, y + 0.25, z, x0 + (i + 1) * w, y + 0.25, z, x0 + (i + 1) * w, y, z, x0 + i * w, y, z);
      }
    }
    pj(0, 2.95, z);
    txt('FINISH', PX, PY, clamp(PK * 0.5, 8, 90), '#ffd400');
  }

  // ---------------------------------------------------------------- rocket
  // A real rocket lying along the track: round body, nose cone, 4 fins, engine bell. Local space: x right,
  // y up, z forward; the body axis runs along z at height RY. Built once as faces with outward normals.
  const RY = 0.3, RN = 8, RS_ROCKET = 1.0; // RS_ROCKET: in-race size of the rocket
  const ROCKET = (() => {
    const faces = [];
    // rings along the body from the engine bell to the nose tip, and the paint of each band between them
    const rings = [[-0.64, 0.155], [-0.5, 0.11], [-0.47, 0.175], [-0.43, 0.185], [-0.1, 0.185], [-0.02, 0.185], [0.42, 0.18],
      [0.5, 0.175], [0.62, 0.16], [0.8, 0.11], [0.94, 0.05], [1.02, 0]];
    const paint = ['metal', 'dark', 'ring', 'white', 'blue', 'skin', 'blue', 'white', 'red', 'red', 'red'];
    for (let k = 0; k < rings.length - 1; k++) {
      const [za, ra] = rings[k], [zb, rb] = rings[k + 1], part = paint[k];
      const slope = -(rb - ra) / (zb - za);
      for (let i = 0; i < RN; i++) {
        const a0 = i / RN * Math.PI * 2, a1 = (i + 1) / RN * Math.PI * 2, am = (a0 + a1) / 2;
        const v = [[Math.cos(a0) * ra, RY + Math.sin(a0) * ra, za], [Math.cos(a1) * ra, RY + Math.sin(a1) * ra, za],
          [Math.cos(a1) * rb, RY + Math.sin(a1) * rb, zb], [Math.cos(a0) * rb, RY + Math.sin(a0) * rb, zb]];
        const nl = Math.hypot(1, slope);
        faces.push({ v, n: [Math.cos(am) / nl, Math.sin(am) / nl, slope / nl], part, cull: true });
      }
    }
    // three swept fins (one on top, two angled down): white with red tips
    for (const deg of [90, 210, 330]) {
      const a = deg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
      const P = (r, z) => [ca * r, RY + sa * r, z];
      faces.push({ v: [P(0.17, -0.44), P(0.17, -0.02), P(0.34, -0.3), P(0.34, -0.52)], n: [-sa, ca, 0], part: 'white', cull: false });
      faces.push({ v: [P(0.34, -0.52), P(0.34, -0.3), P(0.48, -0.44), P(0.48, -0.6)], n: [-sa, ca, 0], part: 'red', cull: false });
    }
    return faces;
  })();
  const FIN_TIPS = [90, 210, 330].map((d) => [Math.cos(d * Math.PI / 180) * 0.48, Math.sin(d * Math.PI / 180) * 0.48]);
  const LIGHT = (() => { const l = [-0.45, 0.8, -0.4], m = Math.hypot(...l); return l.map((x) => x / m); })();
  const PART_COL = { white: '#f2efe6', blue: '#1d58c8', red: '#dd2f28', metal: '#6a707c', dark: '#24272e', ring: '#a4aab4' };
  let rocketTop = [0, 0];

  // view: { toWorld(x,y,z) -> [X,Y,Z], rotN(n) -> n', project(X,Y,Z) sets PX/PY/PZ/PK, away(c, n) -> true if facing away }
  function drawRocket(view, color, trail, boost, speed, num = '07') {
    const skin = color === '#ffffff' && trail === 'rainbow' ? RAINBOW[Math.floor(blink * 4) % RAINBOW.length] : color;
    const tc = trail === 'rainbow' ? RAINBOW[Math.floor(blink * 12) % RAINBOW.length] : trail;
    const list = [];
    for (const f of ROCKET) {
      const w = f.v.map((p) => view.toWorld(p[0], p[1], p[2]));
      const n = view.rotN(f.n);
      const c = [(w[0][0] + w[2][0]) / 2, (w[0][1] + w[2][1]) / 2, (w[0][2] + w[2][2]) / 2];
      if (f.cull && view.away(c, n)) continue;
      const pts = w.map((p) => { view.project(p[0], p[1], p[2]); return [PX, PY]; });
      view.project(c[0], c[1], c[2]);
      list.push({ f, n, pts, d: PZ });
    }
    list.sort((a, b) => b.d - a.d);
    for (const { f, n, pts } of list) {
      const dot = n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2];
      const k = 0.42 + 0.7 * Math.max(0, f.cull ? dot : Math.abs(dot));
      const base = f.part === 'skin' ? skin : PART_COL[f.part];
      ctx.fillStyle = shade(rgb(base), k, 0);
      ctx.beginPath();
      pts.forEach((p, j) => (j ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
      ctx.fill();
      // tiny stroke hides the seams between facets
      ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 0.6; ctx.stroke();
    }
    // bubble canopy on top of the body
    const cn = view.rotN([0, 1, 0.15]), cc = view.toWorld(0, RY + 0.18, 0.28);
    if (!view.away(cc, cn)) {
      ctx.beginPath();
      for (let i = 0; i <= 14; i++) {
        const a = i / 14 * Math.PI * 2, x = Math.sin(a) * 0.09, z = 0.28 + Math.cos(a) * 0.17;
        const q = view.toWorld(x, RY + Math.sqrt(Math.max(0, 0.18 * 0.18 - x * x)) + 0.04, z);
        view.project(q[0], q[1], q[2]);
        if (i) ctx.lineTo(PX, PY); else ctx.moveTo(PX, PY);
      }
      ctx.fillStyle = '#2f7fd0'; ctx.fill();
      ctx.strokeStyle = shade(rgb(skin), 0.85, 0); ctx.lineWidth = Math.max(1.5, PK * 0.02); ctx.stroke();
      const hl = view.toWorld(-0.03, RY + 0.22, 0.34);
      view.project(hl[0], hl[1], hl[2]);
      ctx.fillStyle = 'rgba(220,245,255,0.8)'; circle(PX, PY, PK * 0.025);
    }
    // "SKYHAWK 07" decal on whichever side faces the camera
    for (const side of [-1, 1]) {
      const n = view.rotN([side, 0.1, 0]), o = view.toWorld(side * 0.187, RY - 0.03, 0.02);
      if (view.away(o, n)) continue;
      let O = o, A = view.toWorld(side * 0.187, RY - 0.03, 0.4), U = view.toWorld(side * 0.187, RY + 0.11, 0.02);
      view.project(O[0], O[1], O[2]); let ox = PX, oy = PY;
      view.project(A[0], A[1], A[2]); let ax = PX - ox, ay = PY - oy;
      view.project(U[0], U[1], U[2]); let ux = PX - ox, uy = PY - oy;
      if (ax * -uy - ay * -ux < 0) { ox += ax; oy += ay; ax = -ax; ay = -ay; } // keep the text readable, not mirrored
      if (Math.hypot(ax, ay) < 14) continue;
      ctx.save();
      ctx.transform(ax / 100, ay / 100, -ux / 100 * 0.9, -uy / 100 * 0.9, ox, oy);
      ctx.font = `bold 21px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#1d3f9a';
      ctx.fillText('SKYHAWK', 4, -66);
      ctx.font = `bold 72px ${FONT}`;
      ctx.fillText(num, 22, 4);
      ctx.restore();
    }
    // engine: glowing nozzle opening + fire, seen from behind
    const ex = view.toWorld(0, RY, -0.64), en = view.rotN([0, 0, -1]);
    view.project(ex[0], ex[1], ex[2]);
    const ePX = PX, ePY = PY, eK = PK;
    ctx.globalCompositeOperation = 'lighter';
    if (!view.away(ex, en)) {
      const g = ctx.createRadialGradient(ePX, ePY, 0, ePX, ePY, eK * 0.32);
      g.addColorStop(0, 'rgba(255,246,210,0.95)'); g.addColorStop(0.25, 'rgba(255,170,60,0.7)'); g.addColorStop(1, 'rgba(255,90,20,0)');
      ctx.fillStyle = g; circle(ePX, ePY, eK * 0.32);
    }
    const len = 0.3 + speed * speed * 0.85 + (boost ? 0.9 : 0) + Math.random() * 0.08;
    // soft plume of glows from white-hot at the nozzle to red at the tail
    for (let k = 0; k < (OFF.plume ? 0 : 4); k++) {
      const t = k / 3, q = view.toWorld(0, RY, -0.66 - t * len);
      view.project(q[0], q[1], q[2]);
      const sz = PK * (0.2 - t * 0.12) * (boost ? 1.25 : 1) * 2.2;
      ctx.globalAlpha = 0.85 * (1 - t * 0.65);
      ctx.drawImage(glowSprite(t < 0.2 ? '#fff0c8' : t < 0.55 ? '#ffa030' : '#ff4a14'), PX - sz, PY - sz, sz * 2, sz * 2);
    }
    for (const [rad, ln, col, al] of [[0.05, len * 0.5, '#fff6d8', 0.75]]) {
      const tip = view.toWorld(0, RY, -0.64 - ln);
      ctx.fillStyle = col; ctx.globalAlpha = al;
      for (let i = 0; i < 8; i++) {
        const a0 = i / 8 * Math.PI * 2, a1 = (i + 1) / 8 * Math.PI * 2;
        const p0 = view.toWorld(Math.cos(a0) * rad, RY + Math.sin(a0) * rad, -0.64), p1 = view.toWorld(Math.cos(a1) * rad, RY + Math.sin(a1) * rad, -0.64);
        ctx.beginPath();
        view.project(p0[0], p0[1], p0[2]); ctx.moveTo(PX, PY);
        view.project(p1[0], p1[1], p1[2]); ctx.lineTo(PX, PY);
        view.project(tip[0], tip[1], tip[2]); ctx.lineTo(PX, PY);
        ctx.fill();
      }
    }
    // blinking lights on two fin tips
    ctx.globalAlpha = Math.floor(blink * 3) % 2 ? 1 : 0.3;
    for (const [i, col] of [[1, '#ff3b3b'], [2, '#3bff6b']]) {
      const tp = view.toWorld(FIN_TIPS[i][0], RY + FIN_TIPS[i][1], -0.52);
      view.project(tp[0], tp[1], tp[2]);
      ctx.fillStyle = col; circle(PX, PY, Math.max(1, PK * 0.03));
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    const top = view.toWorld(0, RY + 0.3, 0);
    view.project(top[0], top[1], top[2]);
    rocketTop = [PX, PY];
  }
  // far away the rocket is a few pixels: body dot, coloured nose and a flame glow
  function drawRocketFar(view, rc) {
    const b = view.toWorld(0, RY, -0.1), n = view.toWorld(0, RY, 0.5), e = view.toWorld(0, RY, -0.6);
    view.project(b[0], b[1], b[2]);
    const r = Math.max(1, PK * 0.2), bx = PX, by = PY;
    ctx.fillStyle = rc.color === '#ffffff' ? '#f2efe6' : rc.color; circle(bx, by, r);
    view.project(n[0], n[1], n[2]);
    ctx.fillStyle = '#dd2f28'; circle(PX, PY, r * 0.6);
    view.project(e[0], e[1], e[2]);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rc.trail === 'rainbow' ? '#ffffff' : rc.trail; circle(PX, PY, r * 0.8);
    ctx.globalCompositeOperation = 'source-over';
    const top = view.toWorld(0, RY + 0.3, 0);
    view.project(top[0], top[1], top[2]);
    rocketTop = [PX, PY];
  }
  function worldView(rc) {
    const cr = Math.cos(rc.roll), sr = Math.sin(rc.roll);
    const pitch = clamp(rc.vy * 0.03, -0.35, 0.35), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const bob = rc.grounded ? Math.sin(blink * 9 + rc.z) * 0.015 : 0;
    const sq = rc.squash || 0, kx = 1 - sq * 0.45, ky = 1 + sq, kz = 1 + sq * 0.3; // squash & stretch
    const rot = (x, y, z) => { const y1 = y * cp + z * sp, z1 = z * cp - y * sp; return [x * cr - y1 * sr, x * sr + y1 * cr, z1]; };
    return {
      toWorld(x, y, z) {
        const q = rot(x * kx * RS_ROCKET, (y - RY) * ky * RS_ROCKET, z * kz * RS_ROCKET);
        return [rc.x + q[0], rc.y + RY * RS_ROCKET + 0.03 + bob + q[1], rc.z * ROW_D + q[2]]; // raised so the fins clear the track
      },
      rotN(n) { return rot(n[0], n[1], n[2]); },
      project: pj,
      away(c, n) { return n[0] * (c[0] - cam.x) + n[1] * (c[1] - cam.y + cam.dip) + n[2] * (c[2] - cam.z) > 0; },
    };
  }
  function drawRocketPreview(cx, cy, s, yaw, tilt, color, trail, boost) {
    const cyw = Math.cos(yaw), syw = Math.sin(yaw), ct = Math.cos(tilt), st = Math.sin(tilt);
    const view = {
      toWorld(x, y, z) { return [x * cyw + z * syw, y - RY, -x * syw + z * cyw]; },
      rotN(n) { return [n[0] * cyw + n[2] * syw, n[1], -n[0] * syw + n[2] * cyw]; },
      project(X, Y, Z) { PX = cx + X * s; PY = cy - (Y * ct + Z * st) * s; PZ = 10 + Z * ct - Y * st; PK = s; },
      away(c, n) { return n[2] * ct - n[1] * st > 0; },
    };
    drawRocket(view, color, trail, boost, 0.2);
  }
  function drawRacer(rc) {
    if (rc.z * ROW_D - 0.6 < cam.z + NEAR) return;
    // hover glow on the track under the rocket
    if (rc.gh > -Infinity && rc.y - rc.gh < 2.5) {
      pj(rc.x, rc.gh + 0.01, rc.z * ROW_D - 0.05);
      const a = clamp(0.4 - (rc.y - rc.gh) * 0.15, 0.06, 0.4), rad = 0.7 * PK;
      ctx.save();
      ctx.translate(PX, PY); ctx.scale(1, 0.32);
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rad);
      const cc = rgb(rc.trail === 'rainbow' ? '#ffffff' : rc.trail);
      g.addColorStop(0, `rgba(${cc[0]},${cc[1]},${cc[2]},${a})`); g.addColorStop(1, `rgba(${cc[0]},${cc[1]},${cc[2]},0)`);
      ctx.fillStyle = g; circle(0, 0, rad);
      ctx.restore();
    }
    // rivals right behind you are close to the camera: fade them so they never block the view
    const f = race && race.focus;
    if (f && rc !== f && rc.z < f.z + 0.3) ctx.globalAlpha = clamp(0.12 + (rc.z - f.z + 2.2) * 0.35, 0.12, 1);
    if (rc.ghostT > 0) ctx.globalAlpha = 0.35 + 0.3 * Math.abs(Math.sin(blink * 14));
    const view = worldView(rc);
    if (rc.z * ROW_D - cam.z > 20) drawRocketFar(view, rc);
    else drawRocket(view, rc.color, rc.trail, rc.boostT > 0, race ? clamp(rc.v / Math.max(1, race.cruise), 0, 1.5) : 0.6, rc.num || '07');
    ctx.globalAlpha = 1;
    rc.sx = rocketTop[0]; rc.sy = rocketTop[1]; rc._f = frameNo;
  }

  // streaks of space dust rushing past: the main sense of speed off the track
  const DUST = Array.from({ length: 34 }, () => ({ x: 0, y: 0, z: -1e9 }));
  function drawDust(speed) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
    const len = 0.15 + speed * ROW_D * 0.12;
    const near = new Path2D(), far = new Path2D();
    for (const d of DUST) {
      if (d.z < cam.z + 1 || d.z > cam.z + 110) {
        d.z = cam.z + (d.z < -1e8 ? rand(2, 100) : rand(70, 100));
        do { d.x = rand(-16, 16); d.y = rand(-8, 9); } while (Math.abs(d.x) < 5.5 && d.y < 3.5 && d.y > -3.5);
      }
      const path = d.z - cam.z < 50 ? near : far;
      pj(d.x, d.y, d.z); path.moveTo(PX, PY); pj(d.x, d.y, d.z + len); path.lineTo(PX, PY);
    }
    ctx.globalAlpha = 0.4; ctx.stroke(near);
    ctx.globalAlpha = 0.18; ctx.stroke(far);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  function renderWorld() {
    FOG = rgb(land().sky[1]);
    const P = DEBUG ? (window.__prof = window.__prof || {}) : null, tk = () => performance.now();
    let t0 = DEBUG && tk();
    drawSpace();
    if (P) { P.space = (P.space || 0) + tk() - t0; t0 = tk(); }
    ctx.save();
    ctx.translate(W / 2, CY); ctx.rotate(cam.roll); ctx.translate(-W / 2, -CY);
    laneOrder.sort((a, b) => Math.abs(b - MID - cam.x) - Math.abs(a - MID - cam.x));
    const first = Math.max(0, Math.floor((cam.z + NEAR) / ROW_D));
    pulseRow = first + 2 + ((blink * 128 / 60) % 1) * 46;
    if (!OFF.clouds) drawClouds();
    drawDust(race && race.focus ? race.focus.v : 8);
    if (P) { P.dust = (P.dust || 0) + tk() - t0; t0 = tk(); }
    const last = Math.min(track.n - 1, first + DRAW_ROWS);
    const buckets = new Map();
    for (const rc of race.racers) {
      if (!rc.alive) continue;
      const k = clamp(Math.floor(rc.z - 0.45), first, last + 1);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(rc);
    }
    if (buckets.has(last + 1)) for (const rc of buckets.get(last + 1)) if (rc.z < last + 4) drawRacer(rc);
    let tRows = 0, tShips = 0;
    for (let r = last; r >= first; r--) {
      let ta = DEBUG && tk();
      drawRow(r);
      if (P) { tRows += tk() - ta; ta = tk(); }
      const list = buckets.get(r);
      if (list) {
        if (list.length > 1) list.sort((a, b) => b.z - a.z);
        for (const rc of list) drawRacer(rc);
      }
      if (P) tShips += tk() - ta;
    }
    if (P) { P.rows = (P.rows || 0) + tRows; P.ships = (P.ships || 0) + tShips; P.n = (P.n || 0) + 1; t0 = tk(); }
    // smoke (normal blending), then additive glows, sparks and rings
    for (const p of wparts) {
      if (p.kind !== 'smoke' || p.z < cam.z + 1.5) continue;
      pj(p.x, p.y, p.z);
      const t = p.life / p.max, sz = Math.min(p.cap * 3, (p.size + t * p.grow) * PK);
      ctx.globalAlpha = (1 - t) * 0.5;
      ctx.drawImage(glowSprite(p.color), PX - sz, PY - sz, sz * 2, sz * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const p of wparts) {
      if (p.kind === 'smoke' || p.z < cam.z + NEAR) continue;
      pj(p.x, p.y, p.z);
      const t = p.life / p.max;
      if (p.ring) {
        // flat shockwave ring on the track
        const rad = (p.size + t * p.grow) * PK;
        ctx.globalAlpha = (1 - t) * 0.9; ctx.strokeStyle = p.color; ctx.lineWidth = Math.max(1, 3 * (1 - t) * PK * 0.04 + 1);
        ctx.beginPath(); ctx.ellipse(PX, PY, rad, rad * 0.32, 0, 0, Math.PI * 2); ctx.stroke();
        continue;
      }
      if (p.kind === 'spark') {
        // a short bright streak along the spark's motion
        const x0 = PX, y0 = PY, k0 = PK;
        pj(p.x - p.vx * 0.045, p.y - p.vy * 0.045, p.z - p.vz * 0.045);
        ctx.globalAlpha = 1 - t; ctx.strokeStyle = p.color;
        ctx.lineWidth = clamp(p.size * k0 * 0.5, 1, 5);
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(PX, PY); ctx.stroke();
        continue;
      }
      const sz = Math.min(p.cap, (p.size + t * p.grow) * PK * (1 - t * 0.4)) * 2.2;
      if (sz < 0.6) continue;
      ctx.globalAlpha = 1 - t;
      ctx.drawImage(glowSprite(p.color), PX - sz, PY - sz, sz * 2, sz * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // speed streaks rushing out from the vanishing point, strongest at the screen edges
  function drawSpeedLines(k, boost) {
    if (k < 0.04) return;
    const hy = CY - cam.f * Math.tan(cam.pitch);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let i = 0; i < 34; i++) {
      const a = i * 2.39996 + Math.floor(blink * 24 + i) * 0.37;
      const ph = (blink * (1.8 + (i % 5) * 0.35) + i * 0.137) % 1;
      const d0 = 250 + ph * 420, len = (35 + 260 * k * k + 90 * boost) * (0.5 + ph);
      const ca = Math.cos(a), sa = Math.sin(a) * 0.62;
      ctx.strokeStyle = boost > 0.3 && i % 3 === 0 ? '#9dffb8' : '#ffffff';
      ctx.globalAlpha = Math.min(0.5, 0.42 * k) * (1 - ph * 0.5);
      ctx.lineWidth = 1 + ph * 2.2;
      ctx.beginPath();
      ctx.moveTo(W / 2 + ca * d0, hy + sa * d0);
      ctx.lineTo(W / 2 + ca * (d0 + len), hy + sa * (d0 + len));
      ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  // tunnel-vision darkening at the edges when flying fast
  function drawSpeedVignette(k) {
    if (k < 0.05) return;
    const g = ctx.createRadialGradient(W / 2, H * 0.45, H * 0.42, W / 2, H * 0.45, W * 0.62);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,8,${0.42 * k})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }

  // -------------------------------------------------------------------- HUD
  function bar(x, y, w, h, pct, color) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; rr(x - 3, y - 3, w + 6, h + 6, 7);
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; rr(x, y, w, h, 5);
    if (pct > 0.01) {
      ctx.fillStyle = color; rr(x, y, w * pct, h, 5);
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; rr(x + 2, y + 2, Math.max(0, w * pct - 4), h * 0.35, 3);
    }
  }

  // the current TRAINING instruction: a big key cap + text, ticked off when done
  function drawTutorialBanner(r) {
    const st = r.step;
    if (!st || r.phase !== 'go') return;
    const done = st.done, since = done ? r.t - st.doneT : 0;
    if (done && since > 1.2) return;
    const idx = track.steps.indexOf(st) + 1, total = track.steps.length;
    const keyTxt = touchMode ? (st.touchKey ?? st.key) : st.key, text = touchMode && st.touchText ? st.touchText : st.text;
    const s = elasticOut(r.stepT * 2.2) * (done ? 1 + 0.08 * Math.sin(since * 20) : 1 + 0.03 * Math.sin(blink * 5));
    // sits at the top between the HUD panels so the road ahead stays visible
    ctx.font = `22px ${FONT}`;
    const kw = keyTxt ? Math.max(44, ctx.measureText(keyTxt).width + 22) : 0;
    const tw = ctx.measureText(text).width, w = Math.min(540, kw + tw + 44), x0 = -w / 2;
    const fit = Math.min(1, (540 - kw - 44) / Math.max(1, tw));
    ctx.save(); ctx.translate(W / 2, 46); ctx.scale(s, s);
    ctx.fillStyle = done ? 'rgba(20,120,60,0.88)' : 'rgba(6,14,30,0.85)'; rr(x0, -26, w, 52, 12);
    ctx.strokeStyle = done ? '#3bff6b' : '#38d8ff'; ctx.lineWidth = 2.5; strokeRR(x0, -26, w, 52, 12);
    let x = x0 + 14;
    if (keyTxt) {
      const bob = done ? 0 : Math.abs(Math.sin(blink * 6)) * -3;
      ctx.fillStyle = '#e8eef8'; rr(x, -17 + bob, kw, 32, 7);
      ctx.fillStyle = '#9aa6b8'; rr(x, 12 + bob, kw, 4, 2);
      txt(keyTxt, x + kw / 2, 7 + bob, 19, '#10182a', 'center', false);
      x += kw + 12;
    }
    ctx.save(); ctx.translate(x, 8); ctx.scale(fit, 1);
    txt(done ? '✔ ' + text : text, 0, 0, 22, done ? '#ffffff' : '#ffd400', 'left');
    ctx.restore();
    txt(`STEP ${idx}/${total}`, 0, 42, 14, '#9fd8ff');
    ctx.restore();
    // urgent pulse right before a jump, low on the screen under the rocket
    if (!done && (st.id === 'jump' || st.id === 'wall') && r.slowmo > 0) {
      const k = 1 + 0.08 * Math.sin(blink * 18);
      ctx.save(); ctx.translate(W / 2, H - 70); ctx.scale(k, k);
      txt(touchMode ? 'TAP JUMP NOW!' : 'PRESS SPACE NOW!', 0, 0, 46, '#ff5a5a');
      ctx.restore();
    }
  }
  // angled sci-fi HUD strip: LABEL  value
  function hudRow(x, y, w, label, value, color, pop = 1, right = false) {
    const h = 28, sk = 11;
    ctx.beginPath();
    if (right) { ctx.moveTo(x + sk, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); }
    else { ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w - sk, y + h); ctx.lineTo(x, y + h); }
    ctx.closePath();
    ctx.fillStyle = 'rgba(6,14,30,0.62)'; ctx.fill();
    ctx.strokeStyle = 'rgba(80,200,255,0.75)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#38d8ff'; ctx.fillRect(right ? x + w - 3 : x, y, 3, h);
    txt(label, x + (right ? 20 : 12), y + 21, 17, '#5fd4ff', 'left', false);
    if (value) {
      ctx.save(); ctx.translate(x + w - (right ? 12 : 20), y + 22); ctx.scale(pop, pop);
      txt(value, 0, 0, 21, color, 'right');
      ctx.restore();
    }
  }
  function drawVignette(v) {
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.65);
    g.addColorStop(0, `rgba(${v.c},0)`); g.addColorStop(1, `rgba(${v.c},${clamp(v.a, 0, 1)})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  function drawHUD() {
    const r = race, p = r.player;
    // name tags + speech bubbles
    for (const b of r.bots) {
      if (!b.alive || b._f !== frameNo || b.sy < 0 || b.sy > H) continue;
      const dist = b.z - r.focus.z;
      if (dist > 26 || dist < -3) continue;
      const sz = clamp(20 - dist * 0.4, 11, 18);
      txt(b.name, b.sx, b.sy - 14, sz, b.color);
      if (b.sayT > 0) {
        const s = Math.min(1, elasticOut((1.4 - b.sayT) * 2.5));
        ctx.save(); ctx.translate(b.sx, b.sy - 40); ctx.scale(s, s);
        ctx.font = `20px ${FONT}`;
        const w = ctx.measureText(b.say).width + 20;
        ctx.fillStyle = '#fff'; rr(-w / 2, -22, w, 30, 10);
        ctx.beginPath(); ctx.moveTo(-6, 7); ctx.lineTo(6, 7); ctx.lineTo(0, 16); ctx.fill();
        txt(b.say, 0, 1, 20, '#111', 'center', false);
        ctx.restore();
      }
    }
    if (r.demo || !p) return;
    if (!OFF.vig) drawSpeedVignette(Math.max(r.speedView * 0.8, r.boostView));
    drawSpeedLines(Math.max(r.speedView * 0.95, r.boostView), r.boostView);
    if (r.vig) drawVignette(r.vig);
    const time = fmtTime(r.phase === 'go' ? r.t - r.goT : 0);
    if (r.mode === 'tutorial') {
      hudRow(12, 12, 176, 'MODE', 'TRAINING', '#ffd400');
      hudRow(12, 44, 176, 'TIME', time, '#ffffff');
      drawTutorialBanner(r);
    } else if (r.mode === 'endless') {
      hudRow(12, 12, 176, 'DIST', String(Math.floor(p.z)), '#ffffff');
      hudRow(12, 44, 176, 'BEST', String(save.best), '#ffd400');
    } else {
      const ps = 1 + 0.4 * Math.max(0, 1 - r.placeT * 3);
      hudRow(12, 12, 176, 'POS', `${ordinal(r.place).toUpperCase()}/${r.racers.length}`, r.place === 1 ? '#ffd400' : '#ffffff', ps);
      hudRow(12, 44, 176, 'TIME', time, '#ffffff');
    }
    hudRow(12, 76, 176, 'COINS', String(r.coins), '#ffd84a', 1 + r.coinPop * 0.35);
    hudRow(W - 222, 12, 210, 'SPEED', `${Math.round(p.v * SPEED_TO_MPH)} mph`, p.boostT > 0 ? '#3bff6b' : '#ffffff', 1, true);
    hudRow(W - 222, 44, 210, 'FUEL', '', '#ffffff', 1, true);
    bar(W - 140, 53, 116, 10, p.fuel / 100, p.fuel > 50 ? '#19a6ff' : p.fuel > 25 ? '#ffd400' : '#ff4f4f');
    if (p.fuel < 25 && Math.floor(blink * 4) % 2) txt('LOW FUEL', W - 82, 92, 17, '#ff4f4f');
    if (r.mode === 'level' && r.t < 4) txt(`LEVEL ${r.lvl} — ${r.def.name}`, W / 2, 40, 24, '#fff');
    // floating +1s
    for (const fl of r.floaters) {
      ctx.globalAlpha = clamp((0.9 - fl.t) * 3, 0, 1);
      txt(fl.text, fl.x, fl.y - fl.t * 50, fl.size * (1 + 0.3 * Math.max(0, 1 - fl.t * 6)), fl.color);
    }
    ctx.globalAlpha = 1;
    if (!touchMode && !r.autopilot && r.phase === 'go' && p.alive && !p.finished && !keys.up && r.t - r.goT > 1.5 && Math.floor(blink * 3) % 2) txt('HOLD ↑ FOR GAS', 16, 132, 20, '#ffd400', 'left');

    // messages
    r.msgs.forEach((m, i) => {
      const s = Math.min(1, elasticOut(m.t * 2.2));
      ctx.save();
      ctx.globalAlpha = clamp((1.6 - m.t) * 3, 0, 1);
      ctx.translate(W / 2, H * 0.21);
      ctx.scale(s, s);
      txt(m.text, 0, 0, clamp(m.size * 0.85, 28, 48), m.color);
      ctx.restore();
    });
    ctx.globalAlpha = 1;
    if (r.phase === 'countdown') drawCountdown(r);
    else if (r.t - r.goT < 0.8) {
      const s = 1 + (r.t - r.goT) * 1.5;
      ctx.save(); ctx.globalAlpha = 1 - (r.t - r.goT) / 0.8; ctx.translate(W / 2, H * 0.4); ctx.scale(s, s);
      txt('GO!', 0, 0, 54, '#3bff6b'); ctx.restore(); ctx.globalAlpha = 1;
    }
    drawTutorial(r);
    if (touchMode) drawTouchControls();
    else txt('P PAUSE', W - 20, H - 14, 14, 'rgba(255,255,255,0.5)', 'right', false);
    if (r.paused) drawPause();
  }
  function drawCountdown(r) {
    const n = Math.ceil(r.count);
    if (n > 3) return;
    const f = r.count - Math.floor(r.count);
    const s = 0.6 + elasticOut(1 - f) * 0.6;
    ctx.save(); ctx.translate(W / 2, H * 0.4); ctx.scale(s, s);
    txt(String(n), 0, 0, 120, ['#3bff6b', '#ffd400', '#ff4f4f'][n - 1] || '#fff');
    ctx.restore();
    // "YOU" marker over the player's ship
    const p = r.player;
    if (p._f === frameNo) {
      const bob = Math.sin(blink * 8) * 6;
      ctx.fillStyle = '#ffd400';
      ctx.beginPath(); ctx.moveTo(p.sx - 12, p.sy - 44 + bob); ctx.lineTo(p.sx + 12, p.sy - 44 + bob); ctx.lineTo(p.sx, p.sy - 28 + bob); ctx.fill();
      txt('YOU', p.sx, p.sy - 50 + bob, 22, '#ffd400');
    }
  }
  function drawTutorial(r) {
    if (!r.tut) return;
    const since = r.phase === 'go' ? r.t - r.goT : 0;
    const cards = tutCards();
    const done = cards.every((c) => r.tut[c.id]);
    const lastDone = Math.max(...cards.map((c) => r.tut[c.id]));
    if (since > 7 || (done && r.t - lastDone > 1)) return;
    cards.forEach((c, i) => {
      const pos = tutCardPos(c.id);
      const pressed = !!r.tut[c.id];
      const s = elasticOut(r.t * 1.6 - i * 0.25) * (pressed ? 1 + 0.12 * Math.sin(blink * 12) : 1 + 0.05 * Math.sin(blink * 5 + i));
      ctx.save(); ctx.translate(pos.x, pos.y + (pressed ? 0 : Math.sin(blink * 5 + i * 1.5) * 6)); ctx.scale(s, s);
      ctx.fillStyle = pressed ? 'rgba(40,180,90,0.9)' : 'rgba(0,0,0,0.65)'; rr(-105, -55, 210, 110, 18);
      ctx.strokeStyle = pressed ? '#b8ffc0' : '#ffd400'; ctx.lineWidth = 4; strokeRR(-105, -55, 210, 110, 18);
      const kw = c.keys.length === 1 ? 140 : 56;
      c.keys.forEach((k, j) => {
        const kx = c.keys.length === 1 ? -70 : -64 + j * 72;
        ctx.fillStyle = '#fff'; rr(kx, -42, kw, 46, 9);
        txt(k, kx + kw / 2, -9, 28, '#111', 'center', false);
      });
      txt(pressed ? 'NICE!' : c.label, 0, 40, 26, pressed ? '#fff' : '#ffd400');
      ctx.restore();
    });
  }
  function drawTouchControls() {
    for (const b of TOUCH_BTNS) {
      const down = [...activePointers.values()].includes(b.id);
      ctx.fillStyle = down ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.18)';
      circle(b.x, b.y, b.r);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.stroke();
      const fs = b.id === 'jump' ? 34 : b.id === 'brake' ? 20 : 44;
      txt(b.label, b.x, b.y + fs * 0.36, fs, '#fff');
    }
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; circle(PAUSE_BTN.x, PAUSE_BTN.y, PAUSE_BTN.r);
    ctx.fillStyle = '#fff'; ctx.fillRect(PAUSE_BTN.x - 8, PAUSE_BTN.y - 10, 6, 20); ctx.fillRect(PAUSE_BTN.x + 2, PAUSE_BTN.y - 10, 6, 20);
  }
  function drawPause() {
    ctx.fillStyle = 'rgba(0,0,10,0.7)'; ctx.fillRect(0, 0, W, H);
    txt('PAUSED', W / 2, 170, 80, '#fff');
    button(W / 2 - 140, 220, 280, 60, 'RESUME', () => setPaused(false, true), '#1fa84f');
    button(W / 2 - 140, 295, 280, 54, 'RESTART  (R)', () => { setPaused(false, true); retry(); }, '#2f6bff');
    button(W / 2 - 140, 364, 280, 54, 'MENU  (Q)', toTitle, '#7a3bd6');
    if (!touchMode) txt('P  RESUME', W / 2, 460, 20, '#aaa');
  }

  // ---------------------------------------------------------------- screens
  function button(x, y, w, h, label, fn, color = '#e0201c', size) {
    uiButtons.push({ x, y, w, h, fn });
    // hit-test in screen space (the button may be drawn inside a transform)
    const m = ctx.getTransform(), sx = m.a / RS, ox = m.e / RS, oy = m.f / RS;
    const hx = (mouse.x - ox) / sx, hy = (mouse.y - oy) / sx;
    const hover = !touchMode && hx >= x && hx <= x + w && hy >= y && hy <= y + h;
    if (hover) hoverNow = label;
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    const k = hover ? 1.06 : 1;
    ctx.scale(k, k);
    ctx.translate(-w / 2, -h / 2);
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; rr(3, 5, w, h, 14);
    ctx.fillStyle = color; rr(0, 0, w, h, 14);
    ctx.fillStyle = 'rgba(255,255,255,0.18)'; rr(4, 4, w - 8, h * 0.42, 10);
    if (hover) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; strokeRR(0, 0, w, h, 14); }
    txt(label, w / 2, h / 2 + (size || h * 0.42) * 0.36, size || Math.min(34, h * 0.48), '#fff');
    ctx.restore();
  }
  function coinCount(x, y) {
    ctx.fillStyle = '#ffd84a'; circle(x, y - 9, 12);
    ctx.fillStyle = '#b87a00'; circle(x, y - 9, 6);
    txt(String(save.coins), x + 20, y + 2, 28, '#ffd84a', 'left');
  }
  function drawLogo(cx, cy, k) {
    ctx.save();
    ctx.translate(cx, cy); ctx.scale(k, k);
    ctx.transform(1, 0, -0.16, 1, 0, 0);
    ctx.font = `104px ${FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.lineJoin = 'round';
    const g1 = ctx.createLinearGradient(0, -80, 0, 0);
    g1.addColorStop(0, '#fff7b0'); g1.addColorStop(0.5, '#ffd400'); g1.addColorStop(1, '#ff7a1f');
    ctx.shadowColor = '#ff4fd8'; ctx.shadowBlur = 24;
    ctx.lineWidth = 14; ctx.strokeStyle = '#1a0630'; ctx.strokeText(TITLE[0], 0, 0);
    ctx.shadowBlur = 0;
    ctx.fillStyle = g1; ctx.fillText(TITLE[0], 0, 0);
    ctx.font = `96px ${FONT}`;
    const g2 = ctx.createLinearGradient(0, 10, 0, 92);
    g2.addColorStop(0, '#b5fbff'); g2.addColorStop(0.5, '#19e6ff'); g2.addColorStop(1, '#b84dff');
    ctx.shadowColor = '#19e6ff'; ctx.shadowBlur = 24;
    ctx.lineWidth = 13; ctx.strokeText(TITLE[1], 0, 90);
    ctx.shadowBlur = 0;
    ctx.fillStyle = g2; ctx.fillText(TITLE[1], 0, 90);
    ctx.fillStyle = '#fff';
    star(-200, -70, 14, blink); star(205, 50, 11, -blink); star(165, -88, 7, blink * 2);
    ctx.restore();
  }
  function drawTitle() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(0,0,10,0.55)'); g.addColorStop(0.5, 'rgba(0,0,10,0.05)'); g.addColorStop(1, 'rgba(0,0,10,0.6)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    drawLogo(W / 2, 120 + Math.sin(blink * 2) * 4, 1);
    const s = 1 + 0.04 * Math.sin(blink * 5);
    ctx.save(); ctx.translate(W / 2, 282); ctx.scale(s, s);
    button(-170, -38, 340, 76, save.trained ? `PLAY  LEVEL ${nextLevel()}` : 'PLAY', playMain, '#1fa84f', 38);
    ctx.restore();
    uiButtons[uiButtons.length - 1] = { x: W / 2 - 170, y: 244, w: 340, h: 76, fn: playMain };
    button(20, 20, 180, 44, 'HOW TO PLAY', startTutorial, '#c47a12', 20);
    button(W / 2 - 310, 350, 196, 58, 'LEVELS', () => { state = 'levels'; }, '#2f6bff');
    button(W / 2 - 98, 350, 196, 58, 'ENDLESS', startEndless, '#d6308a');
    button(W / 2 + 114, 350, 196, 58, 'HANGAR', () => { state = 'hangar'; }, '#7a3bd6');
    coinCount(W - 150, 44);
    if (save.best) txt(`ENDLESS BEST ${save.best}`, 24, 92, 18, '#ffd400', 'left');
    if (!touchMode) txt('↑  GAS     ← →  STEER     SPACE  JUMP     ↓  BRAKE     P  PAUSE', W / 2, H - 22, 18, 'rgba(255,255,255,0.75)');
  }
  function drawLevels() {
    ctx.fillStyle = 'rgba(0,0,12,0.72)'; ctx.fillRect(0, 0, W, H);
    txt('CHOOSE A LEVEL', W / 2, 80, 52, '#fff');
    button(24, 24, 120, 46, 'BACK', () => { state = 'title'; }, '#555');
    coinCount(W - 150, 56);
    const cw = 200, ch = 112, gx = 22, gy = 22, x0 = (W - (4 * cw + 3 * gx)) / 2, y0 = 118;
    for (let i = 1; i <= LEVELS; i++) {
      const c = (i - 1) % 4, row = Math.floor((i - 1) / 4), x = x0 + c * (cw + gx), y = y0 + row * (ch + gy);
      const locked = i > save.unlocked, th = levelDef(i).theme;
      ctx.fillStyle = locked ? '#1c1c26' : (TRACK_STYLE[th.name] || TRACK_STYLE.MOON).base; rr(x, y, cw, ch, 14);
      ctx.strokeStyle = locked ? '#444' : th.glow; ctx.lineWidth = 3; strokeRR(x, y, cw, ch, 14);
      if (!locked) uiButtons.push({ x, y, w: cw, h: ch, fn: () => startLevel(i) });
      txt(String(i), x + 18, y + 42, 36, locked ? '#666' : '#fff', 'left');
      txt(LEVEL_NAMES[i - 1], x + cw / 2, y + 74, 20, locked ? '#666' : '#fff');
      if (locked) {
        ctx.fillStyle = '#777'; rr(x + cw - 46, y + 22, 26, 20, 4);
        ctx.strokeStyle = '#777'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(x + cw - 33, y + 22, 8, Math.PI, 0); ctx.stroke();
      } else {
        const st = save.stars[i - 1] || 0;
        for (let k = 0; k < 3; k++) { ctx.fillStyle = k < st ? '#ffd400' : 'rgba(255,255,255,0.2)'; star(x + cw / 2 - 30 + k * 30, y + 96, 11, -Math.PI / 2); }
      }
    }
    txt('Finish in the top 3 to unlock the next level', W / 2, H - 16, 18, '#aaa');
  }
  function drawHangar() {
    ctx.fillStyle = 'rgba(0,0,12,0.72)'; ctx.fillRect(0, 0, W, H);
    txt('HANGAR', W / 2, 80, 56, '#fff');
    button(24, 24, 120, 46, 'BACK', () => { state = 'title'; }, '#555');
    coinCount(W / 2 - 40, 116);
    if (platform.adsAvailable) button(W - 230, 24, 206, 46, '▶ AD  +60 COINS', watchAdForCoins, '#d6308a', 20);
    const cw = 260, ch = 170, gx = 24, x0 = (W - (3 * cw + 2 * gx)) / 2, y0 = 140;
    SKINS.forEach((s, i) => {
      const x = x0 + (i % 3) * (cw + gx), y = y0 + Math.floor(i / 3) * (ch + 20);
      const owned = save.owned.includes(i), sel = save.skin === i;
      ctx.fillStyle = sel ? 'rgba(40,180,90,0.35)' : 'rgba(255,255,255,0.08)'; rr(x, y, cw, ch, 16);
      ctx.strokeStyle = sel ? '#3bff6b' : 'rgba(255,255,255,0.3)'; ctx.lineWidth = sel ? 4 : 2; strokeRR(x, y, cw, ch, 16);
      uiButtons.push({ x, y, w: cw, h: ch, fn: () => selectSkin(i) });
      drawRocketPreview(x + cw / 2, y + 74, 120, blink * 0.9 + i, 0.4, s.color, s.trail, sel);
      txt(`${i + 1}  ${s.name}`, x + cw / 2, y + 132, 22, '#fff');
      if (sel) txt('SELECTED', x + cw / 2, y + 158, 18, '#3bff6b');
      else if (owned) txt('TAP TO USE', x + cw / 2, y + 158, 18, '#ccc');
      else txt(`${s.cost} COINS`, x + cw / 2, y + 158, 18, save.coins >= s.cost ? '#ffd84a' : '#ff7a7a');
    });
  }
  function drawResults() {
    const res = results;
    ctx.fillStyle = 'rgba(0,0,12,0.66)'; ctx.fillRect(0, 0, W, H);
    const pop = elasticOut(res.t * 1.8);
    if (res.mode === 'tutorial') {
      ctx.save(); ctx.translate(W / 2, 150); ctx.scale(pop, pop);
      waveText('TRAINING COMPLETE!', 0, 0, 64, blink);
      ctx.restore();
      txt("You're ready to race the pilots!", W / 2, 220, 30, '#ffffff');
      txt('Finish in the top 3 to unlock the next level', W / 2, 262, 22, '#9fd8ff');
      if (res.earned) txt(`+${res.earned} COINS`, W / 2, 310, 28, '#ffd84a');
      button(W / 2 - 290, 380, 280, 70, 'START RACE ▶', resultsPrimary, '#1fa84f');
      button(W / 2 + 10, 380, 280, 70, 'MENU', toTitle, '#7a3bd6');
      return;
    }
    if (res.mode === 'endless') {
      txt(res.best ? 'NEW BEST!' : 'GAME OVER', W / 2, 110, 64, res.best ? '#ffd400' : '#fff');
      ctx.save(); ctx.translate(W / 2, 220); ctx.scale(pop, pop);
      txt(String(res.dist), 0, 0, 110, '#fff');
      ctx.restore();
      txt('DISTANCE', W / 2, 252, 22, '#aaa');
      txt(`BEST  ${save.best}`, W / 2, 298, 30, '#ffd400');
      txt(`+${res.earned} COINS`, W / 2, 340, 28, '#ffd84a');
      button(W / 2 - 290, 390, 280, 66, 'PLAY AGAIN', resultsPrimary, '#1fa84f');
      button(W / 2 + 10, 390, 280, 66, 'MENU', toTitle, '#7a3bd6');
      return;
    }
    const r = race;
    if (res.place === 1) waveText('YOU WIN!', W / 2, 92, 70, blink);
    else txt(`${ordinal(res.place).toUpperCase()} PLACE`, W / 2, 92, 66, res.place <= 3 ? '#ffd400' : '#fff');
    for (let k = 0; k < 3; k++) {
      const s = elasticOut(res.t * 2 - 0.3 - k * 0.25);
      ctx.save(); ctx.translate(W / 2 - 60 + k * 60, 140); ctx.scale(s, s);
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; star(0, 3, 28, -Math.PI / 2);
      ctx.fillStyle = k < res.stars ? '#ffd400' : 'rgba(255,255,255,0.2)'; star(0, 0, 26, -Math.PI / 2);
      ctx.restore();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; rr(W / 2 - 230, 178, 460, 30 * res.order.length + 16, 14);
    res.order.forEach((o, i) => {
      const y = 204 + i * 30;
      if (o.you) { ctx.fillStyle = 'rgba(255,212,0,0.22)'; rr(W / 2 - 222, y - 22, 444, 28, 8); }
      txt(ordinal(i + 1), W / 2 - 200, y, 22, i < 3 ? '#ffd400' : '#ccc', 'left');
      ctx.fillStyle = o.color; circle(W / 2 - 128, y - 8, 8);
      txt(o.name, W / 2 - 110, y, 22, o.you ? '#fff' : '#ddd', 'left');
      txt(fmtTime(o.time - r.goT), W / 2 + 200, y, 22, '#ccc', 'right');
    });
    const y2 = 214 + 30 * res.order.length + 26;
    txt(`+${Math.min(res.earned, Math.floor(Math.max(0, res.t - 0.6) * 60))} COINS`, W / 2, y2, 26, '#ffd84a');
    if (res.unlockedNow) txt(`LEVEL ${r.lvl + 1} UNLOCKED!`, W / 2, y2 + 32, 24, '#3bff6b');
    else if (res.place > 3) txt('Finish in the top 3 to unlock the next level', W / 2, y2 + 32, 20, '#ff9f9f');
    const by = H - 84;
    if (res.place <= 3 && r.lvl < LEVELS) {
      button(W / 2 - 330, by, 200, 60, 'MENU', toTitle, '#7a3bd6');
      button(W / 2 - 110, by, 200, 60, 'RETRY', retry, '#2f6bff');
      button(W / 2 + 110, by, 220, 60, 'NEXT ▶', resultsPrimary, '#1fa84f');
    } else {
      button(W / 2 - 230, by, 200, 60, 'MENU', toTitle, '#7a3bd6');
      button(W / 2 + 10, by, 220, 60, res.place <= 3 ? 'PLAY AGAIN' : 'TRY AGAIN', resultsPrimary, '#1fa84f');
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
    hoverNow = null;
    ctx.setTransform(RS, 0, 0, RS, 0, 0);
    ctx.save();
    if (race && race.shake > 0) ctx.translate((Math.random() * 2 - 1) * race.shake * 12, (Math.random() * 2 - 1) * race.shake * 12);
    renderWorld();
    ctx.restore();
    if (cam.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${cam.flash * 1.5})`; ctx.fillRect(0, 0, W, H); }
    if (state === 'race') drawHUD();
    else {
      if (race.demo && state === 'title') drawHUD();
      if (state === 'title') drawTitle();
      else if (state === 'levels') drawLevels();
      else if (state === 'hangar') drawHangar();
      else if (state === 'results') drawResults();
      else { ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(0, 0, W, H); }
    }
    drawParticles();
    if (toast) txt(toast.text, W / 2, H - 46, 24, '#fff');
    if (hoverNow && hoverNow !== hoverLast) audio.hover();
    hoverLast = hoverNow;
    // quick fade between screens
    if (state !== lastState) { if (lastState !== null && !(lastState === 'race' && state === 'results')) fade = 1; lastState = state; }
    if (fade > 0) { ctx.fillStyle = `rgba(4,2,16,${fade * 0.85})`; ctx.fillRect(0, 0, W, H); }
    if (portraitBlocked()) drawRotateHint();
  }

  // ------------------------------------------------------------------ loop
  let last = performance.now(), acc = 0;
  function frame(now) {
    const real = Math.min(0.1, (now - last) / 1000);
    last = now;
    try {
      let scale = 1;
      if (race && race.slowmo > 0 && !race.paused && state === 'race') { race.slowmo -= real; scale = 0.35; }
      acc += real * scale;
      while (acc >= STEP) { update(STEP); acc -= STEP; }
      if (state !== 'ad' && !(race && race.paused)) music.tick();
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
    newRace('level', 2);
    const r = race;
    r.phase = 'go';
    // a busy stretch: no full gaps ahead, ideally with boost tiles just in front
    const fullGap = (k) => track.rows[k].every((t) => t === T_GAP);
    let r0 = 100, bestScore = -1;
    for (let k = 60; k < track.finish - 40; k++) {
      let ok = true, score = 0;
      for (let j = -3; j < 34 && ok; j++) ok = !fullGap(k + j);
      if (!ok) continue;
      for (let j = 2; j < 30; j++) for (const t of track.rows[k + j]) score += t === T_BOOST || t === T_BURN || t === T_BLOCK ? 1 : 0;
      if (score > bestScore) { bestScore = score; r0 = k; }
    }
    const p = r.player;
    // the player's rocket is drawn large in side view on top of the scene (below), like the key art
    Object.assign(p, { z: r0 + 0.5, x: 0, y: 0.35, vy: 2, grounded: false, gh: 0, roll: -0.12, boostT: 1, alive: false });
    const [b0, b1, b2, b3] = r.bots;
    Object.assign(b0, { z: r0 + 2.4, x: -1.4, y: 0.9, vy: 1, grounded: false, gh: 0, roll: 0.25, say: 'ZOOM!', sayT: 1 });
    Object.assign(b1, { z: r0 + 1.5, x: 1.5, y: 0, grounded: true, roll: -0.15, boostT: 1 });
    Object.assign(b2, { z: r0 + 8, x: 0.6, y: 0, grounded: true });
    Object.assign(b3, { z: r0 + 14, x: -1, y: 0.6, vy: 0, grounded: false, gh: 0 });
    for (const rc of r.racers) if (!walk(Math.floor(rc.z), laneOf(rc.x))) rc.gh = -Infinity;
    cam.x = 0; cam.y = CAM_UP + 0.35; cam.z = p.z * ROW_D - CAM_BACK - 0.6; cam.roll = 0.02; cam.f = FOCAL;
    RS = 2;
    canvas.width = W * 2; canvas.height = H * 2;
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    frameNo = 5;
    blink = 1.3;
    renderWorld();

    const shots = [
      ['cover-landscape.png', 1920, 1080, 0.12, 1.7],
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
      c2.drawImage(main, (sw - cw) / 2, (sh - ch) * cropY * 0.5, cw, ch, 0, 0, w, h);
      if (dim) { c2.fillStyle = `rgba(0,0,0,${dim})`; c2.fillRect(0, 0, w, h); }
      // the hero rocket in a 3/4 side view, sized to fit this cover
      if (!dim) {
        const sc = Math.min(w * 0.24, h * 0.43), rx = w * 0.5, ry = h * 0.68;
        ctx = c2;
        ctx.save(); ctx.translate(rx, ry + sc * 0.62); ctx.scale(1, 0.25);
        ctx.globalCompositeOperation = 'lighter';
        const hg = ctx.createRadialGradient(0, 0, 0, 0, 0, sc * 1.9);
        hg.addColorStop(0, 'rgba(255,170,70,0.45)'); hg.addColorStop(1, 'rgba(255,170,70,0)');
        ctx.fillStyle = hg; circle(0, 0, sc * 1.9);
        ctx.restore();
        drawRocketPreview(rx, ry, sc, 1.2, 0.3, SKINS[0].color, SKINS[0].trail, true);
        ctx = mainCtx;
      }
      const g = c2.createLinearGradient(0, 0, 0, h * 0.5);
      g.addColorStop(0, 'rgba(0,0,0,0.5)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      c2.fillStyle = g; c2.fillRect(0, 0, w, h * 0.5);
      if (k) {
        ctx = c2;
        drawLogo(w / 2, h * logoY + 80 * k, k);
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
  function drawLoading() {
    ctx.setTransform(RS, 0, 0, RS, 0, 0);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#07021c'); g.addColorStop(1, '#2b0d4a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    drawLogo(W / 2, H / 2 - 50, 1);
    txt('LOADING...', W / 2, H / 2 + 120, 28, '#9ff6ff');
  }
  async function boot() {
    resize();
    window.addEventListener('resize', resize);
    drawLoading();
    await platform.init();
    platform.loadingStart();
    loadSave();
    if (COVER_MODE) { platform.loadingStop(); makeCovers(); return; }
    newDemo();
    // brand-new players go straight into level 1 on their first click (1 click to play)
    platform.loadingStop();
    if (DEBUG) {
      window.__sprint = {
        get race() { return race; }, get state() { return state; }, get track() { return track; }, get camera() { return { ...cam }; }, save,
        start(i) { startLevel(i); }, endless() { startEndless(); },
        autopilot() { race.autopilot = true; race.player.react = 0.08; },
        touch() { touchMode = true; },
        // advance the simulation by hand (works even when the tab isn't painting frames)
        tick(seconds) { for (let i = 0; i < Math.round(seconds / STEP); i++) update(STEP); render(); },
        sim(seconds) { for (let i = 0; i < Math.round(seconds / STEP); i++) update(STEP); },
        // plays every level with 5 bots and no player; returns how often each bot fell or crashed
        audit() {
          const out = [];
          for (let i = 1; i <= LEVELS; i++) {
            newRace('demo', i);
            race.audit = true;
            const deaths = race.bots.map(() => 0), alive = race.bots.map(() => true);
            let t = 0;
            while (t < 200 && !race.bots.every((b) => b.finished)) {
              update(STEP); t += STEP;
              race.bots.forEach((b, k) => { if (alive[k] && !b.alive) deaths[k]++; alive[k] = b.alive; });
            }
            out.push({ level: i, rows: track.finish, secs: +t.toFixed(1), finished: race.bots.filter((b) => b.finished).length, deaths });
          }
          newDemo();
          return out;
        },
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
    requestAnimationFrame(frame);
  }
  boot();
})();
