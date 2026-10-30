'use strict';

const FRUITS = [
  { e: '🍉', c: '#ff4d6d' }, { e: '🍎', c: '#ff3b3b' }, { e: '🍊', c: '#ff9f1c' },
  { e: '🍋', c: '#ffe14d' }, { e: '🍌', c: '#ffe680' }, { e: '🍓', c: '#ff2d55' },
  { e: '🍑', c: '#ffb38a' }, { e: '🍍', c: '#ffd23f' }, { e: '🥝', c: '#8bd450' },
  { e: '🍇', c: '#9b59d0' },
];
const MAX_LIVES = 3;
const TRAIL_MS = 160;
const COMBO_MS = 250;
const BEST_KEY = 'fruit-slice-best';
const SOUND_KEY = 'fruit-slice-sound';
const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

const $ = id => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');
const rand = (a, b) => a + Math.random() * (b - a);

let W = 0, H = 0, DPR = 1, R = 36;
const sprites = new Map();

let G = null;
let best = +localStorage.getItem(BEST_KEY) || 0;
let soundOn = localStorage.getItem(SOUND_KEY) !== 'off';
let pointerDown = false;

/* ---------- Canvas & sprites ---------- */

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = innerWidth;
  H = innerHeight;
  canvas.width = W * DPR;
  canvas.height = H * DPR;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  R = Math.max(30, Math.min(52, Math.min(W, H) * 0.085));
  sprites.clear();
}

// Emoji pre-rendered once per size; drawing text every frame is slow on phones.
function sprite(emoji) {
  let s = sprites.get(emoji);
  if (!s) {
    const size = Math.ceil(R * 2.4 * DPR);
    s = document.createElement('canvas');
    s.width = s.height = size;
    const c = s.getContext('2d');
    c.font = `${R * 2 * DPR}px ${EMOJI_FONT}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(emoji, size / 2, size / 2 + R * 0.12 * DPR);
    sprites.set(emoji, s);
  }
  return s;
}

function drawSprite(emoji) {
  const d = R * 2.4;
  ctx.drawImage(sprite(emoji), -d / 2, -d / 2, d, d);
}

/* ---------- Sound ---------- */

let audioCtx = null, master = null, musicBus = null;

// Kid-friendly loudness: low master gain plus a limiter so nothing spikes.
function ensureAudio() {
  if (audioCtx) return audioCtx.state === 'suspended' ? (audioCtx.resume(), true) : true;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const limiter = audioCtx.createDynamicsCompressor();
    limiter.threshold.value = -20;
    limiter.ratio.value = 12;
    limiter.connect(audioCtx.destination);
    master = audioCtx.createGain();
    master.gain.value = 0.45;
    master.connect(limiter);
    musicBus = audioCtx.createGain();
    musicBus.gain.value = 0.18;
    musicBus.connect(master);
    return true;
  } catch {
    return false;
  }
}

function note(freq, t, dur, type, vol, dest, slide = 1) {
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide !== 1) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  g.gain.setValueAtTime(0.001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function tone(freq, dur, type = 'sine', vol = 0.15, slide = 1) {
  if (!soundOn || !ensureAudio()) return;
  note(freq, audioCtx.currentTime, dur, type, vol, master, slide);
}

const sfx = {
  slice: () => tone(rand(600, 900), 0.12, 'triangle', 0.15, 1.8),
  treat: () => { tone(880, 0.12, 'sine', 0.15); setTimeout(() => tone(1320, 0.18, 'sine', 0.15), 90); },
  combo: () => { tone(660, 0.1); setTimeout(() => tone(990, 0.1), 80); setTimeout(() => tone(1320, 0.2), 160); },
  boom: () => tone(140, 0.5, 'triangle', 0.25, 0.3),
  miss: () => tone(260, 0.25, 'triangle', 0.1, 0.6),
};

/* ---------- Background music (original tune) ---------- */

const BPM = 132;
const BEAT = 60 / BPM;
// [MIDI note, beats]; 0 = rest. 8 bars of 4/4.
const MELODY = [
  [72, 1], [76, 1], [79, 1], [76, 1],
  [77, 1], [81, 1], [79, 2],
  [76, .5], [74, .5], [72, 1], [74, .5], [76, .5], [76, 1],
  [74, 1], [74, 1], [67, 1], [0, 1],
  [72, 1], [76, 1], [79, 1], [84, 1],
  [81, .5], [79, .5], [77, 1], [76, 1], [0, 1],
  [74, 1], [76, .5], [77, .5], [74, 1], [71, 1],
  [72, 2], [0, 2],
];
const BASS = [48, 53, 48, 43, 48, 53, 43, 48];
const midi = m => 440 * 2 ** ((m - 69) / 12);

let musicTimer = null, melT = 0, bassT = 0, melIdx = 0, bassStep = 0;

function startMusic() {
  if (!soundOn || musicTimer || !ensureAudio()) return;
  melT = bassT = audioCtx.currentTime + 0.1;
  melIdx = bassStep = 0;
  musicTimer = setInterval(scheduleMusic, 100);
  scheduleMusic();
}

function stopMusic() {
  clearInterval(musicTimer);
  musicTimer = null;
}

function scheduleMusic() {
  const ahead = audioCtx.currentTime + 0.3;
  while (melT < ahead) {
    const [m, beats] = MELODY[melIdx];
    if (m) note(midi(m), melT, beats * BEAT * 0.9, 'triangle', 0.5, musicBus);
    melT += beats * BEAT;
    melIdx = (melIdx + 1) % MELODY.length;
  }
  while (bassT < ahead) {
    const root = BASS[(bassStep / 4 | 0) % BASS.length];
    note(midi(bassStep % 2 ? root + 7 : root), bassT, BEAT * 0.8, 'sine', 0.6, musicBus);
    bassT += BEAT;
    bassStep++;
  }
}

/* ---------- Game ---------- */

function resetGame() {
  G = {
    state: 'play',
    score: 0,
    lives: MAX_LIVES,
    elapsed: 0,
    spawnTimer: 0.6,
    items: [],
    halves: [],
    particles: [],
    texts: [],
    trail: [],
    combo: 0,
    comboX: 0,
    comboY: 0,
    lastSliceT: 0,
    flash: 0,
    shake: 0,
  };
  renderHud();
}

function launch(kind, emoji, color, delay) {
  const g = H * 0.9;
  const x = W * rand(0.15, 0.85);
  const apex = H * rand(0.15, 0.45);
  const vy = -Math.sqrt(2 * g * (H + R - apex));
  const flight = (-vy / g) * 2;
  G.items.push({
    kind, emoji, color, delay,
    x, y: H + R,
    vx: (W * rand(0.25, 0.75) - x) / flight,
    vy,
    rot: rand(0, Math.PI * 2),
    vr: rand(-3, 3),
    sliced: false,
  });
}

function spawnWave() {
  const level = Math.min(G.elapsed / 60, 1);
  const count = 1 + (Math.random() * (1.5 + level * 4) | 0);
  for (let i = 0; i < count; i++) {
    const r = Math.random();
    const delay = i * rand(0.1, 0.25);
    if (G.elapsed > 5 && r < 0.08 + level * 0.12) launch('bomb', '💣', '#444', delay);
    else if (r > 0.96) launch('treat', '🦴', '#ffd84d', delay);
    else {
      const f = FRUITS[Math.random() * FRUITS.length | 0];
      launch('fruit', f.e, f.c, delay);
    }
  }
  G.spawnTimer = 1.7 - level * 0.8 + rand(0, 0.4);
}

function addText(x, y, text, color = '#fff', size = 30) {
  G.texts.push({ x, y, text, color, size, life: 1 });
}

function splash(x, y, color, n = 14, speed = 260) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), s = rand(speed * 0.3, speed);
    G.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, r: rand(3, 7), color, life: rand(0.4, 0.8) });
  }
}

function slice(it, angle) {
  it.sliced = true;
  if (it.kind === 'bomb') return explode(it);

  const nx = -Math.sin(angle), ny = Math.cos(angle);
  for (const side of [-1, 1]) {
    G.halves.push({
      emoji: it.emoji,
      x: it.x, y: it.y,
      vx: it.vx + side * nx * 90,
      vy: it.vy + side * ny * 90,
      rot: it.rot,
      vr: it.vr + side * 2,
      cut: angle - it.rot,
      side,
    });
  }
  splash(it.x, it.y, it.color);

  if (it.kind === 'treat') {
    G.score += 5;
    addText(it.x, it.y, '🦴 +5', '#ffb700', 34);
    sfx.treat();
  } else {
    G.score += 1;
    sfx.slice();
  }

  const now = performance.now();
  G.combo = now - G.lastSliceT < COMBO_MS ? G.combo + 1 : 1;
  G.lastSliceT = now;
  G.comboX = it.x;
  G.comboY = it.y;
  renderHud();
}

function explode(it) {
  splash(it.x, it.y, '#ff9f1c', 24, 420);
  splash(it.x, it.y, '#555', 16, 300);
  addText(it.x, it.y, '💥', '#fff', 60);
  G.flash = 1;
  G.shake = 0.5;
  sfx.boom();
  navigator.vibrate?.(200);
  loseLife();
}

function loseLife() {
  G.lives--;
  renderHud();
  if (G.lives <= 0 && G.state === 'play') {
    G.state = 'ending';
    setTimeout(gameOver, 900);
  }
}

function gameOver() {
  G.state = 'over';
  stopMusic();
  const record = G.score > best;
  if (record) {
    best = G.score;
    localStorage.setItem(BEST_KEY, String(best));
  }
  $('finalScore').textContent = G.score;
  $('overBest').textContent = record && best > 0 ? '🏆 新纪录！' : `🏆 最高分：${best}`;
  show('overScreen');
}

function checkSlice(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
  if (len2 < 9) return;
  const angle = Math.atan2(dy, dx);
  for (const it of G.items) {
    if (it.sliced || it.delay > 0) continue;
    const t = Math.max(0, Math.min(1, ((it.x - a.x) * dx + (it.y - a.y) * dy) / len2));
    const px = a.x + t * dx - it.x, py = a.y + t * dy - it.y;
    if (px * px + py * py <= R * R * 0.9) slice(it, angle);
  }
}

function update(dt) {
  const g = H * 0.9;
  const playing = G.state === 'play';
  G.elapsed += dt;

  if (playing) {
    G.spawnTimer -= dt;
    if (G.spawnTimer <= 0) spawnWave();
  }

  for (const it of G.items) {
    if (it.delay > 0) { it.delay -= dt; continue; }
    it.vy += g * dt;
    it.x += it.vx * dt;
    it.y += it.vy * dt;
    it.rot += it.vr * dt;
    if (!it.sliced && it.vy > 0 && it.y > H + R * 1.5) {
      it.gone = true;
      if (it.kind === 'fruit' && playing) {
        addText(Math.max(30, Math.min(W - 30, it.x)), H - 50, '❌', '#ff5a5f', 34);
        sfx.miss();
        loseLife();
      }
    }
  }
  G.items = G.items.filter(it => !it.sliced && !it.gone);

  for (const h of G.halves) {
    h.vy += g * dt;
    h.x += h.vx * dt;
    h.y += h.vy * dt;
    h.rot += h.vr * dt;
  }
  G.halves = G.halves.filter(h => h.y < H + R * 2);

  for (const p of G.particles) {
    p.vy += g * 0.6 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
  }
  G.particles = G.particles.filter(p => p.life > 0);

  for (const t of G.texts) {
    t.y -= 50 * dt;
    t.life -= dt;
  }
  G.texts = G.texts.filter(t => t.life > 0);

  const now = performance.now();
  if (G.combo && now - G.lastSliceT > COMBO_MS) {
    if (G.combo >= 3 && playing) {
      G.score += G.combo;
      addText(G.comboX, G.comboY - 40, `${G.combo} 连击！+${G.combo}`, '#ff5aa0', 34);
      sfx.combo();
      renderHud();
    }
    G.combo = 0;
  }

  G.flash = Math.max(0, G.flash - dt * 2.5);
  G.shake = Math.max(0, G.shake - dt);
}

/* ---------- Drawing ---------- */

function draw() {
  ctx.clearRect(0, 0, W, H);
  if (!G) return;

  ctx.save();
  if (G.shake > 0) ctx.translate(rand(-10, 10) * G.shake, rand(-10, 10) * G.shake);

  for (const p of G.particles) {
    ctx.globalAlpha = Math.min(1, p.life * 2);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  for (const h of G.halves) {
    ctx.save();
    ctx.translate(h.x, h.y);
    ctx.rotate(h.rot + h.cut);
    ctx.beginPath();
    ctx.rect(-R * 1.3, h.side < 0 ? -R * 1.3 : 0, R * 2.6, R * 1.3);
    ctx.clip();
    ctx.rotate(-h.cut);
    drawSprite(h.emoji);
    ctx.restore();
  }

  for (const it of G.items) {
    if (it.delay > 0) continue;
    ctx.save();
    ctx.translate(it.x, it.y);
    ctx.rotate(it.rot);
    if (it.kind === 'treat') {
      ctx.shadowColor = '#ffd84d';
      ctx.shadowBlur = 24;
    } else if (it.kind === 'bomb') {
      ctx.shadowColor = '#ff3b3b';
      ctx.shadowBlur = 16;
    }
    drawSprite(it.emoji);
    ctx.restore();
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const t of G.texts) {
    ctx.globalAlpha = Math.min(1, t.life * 2);
    ctx.font = `bold ${t.size}px "Varela Round","PingFang SC","Microsoft YaHei",${EMOJI_FONT}`;
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#fff';
    ctx.strokeText(t.text, t.x, t.y);
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, t.x, t.y);
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  drawTrail();

  if (G.flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${G.flash * 0.8})`;
    ctx.fillRect(0, 0, W, H);
  }
}

function drawTrail() {
  const now = performance.now();
  G.trail = G.trail.filter(p => now - p.t < TRAIL_MS);
  if (G.trail.length < 2) return;
  ctx.lineCap = 'round';
  for (const [color, width] of [['255,143,177', 14], ['255,255,255', 6]]) {
    for (let i = 1; i < G.trail.length; i++) {
      const a = G.trail[i - 1], b = G.trail[i];
      const k = 1 - (now - b.t) / TRAIL_MS;
      ctx.strokeStyle = `rgba(${color},${k})`;
      ctx.lineWidth = width * k + 1;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }
}

/* ---------- UI ---------- */

function renderHud() {
  $('score').textContent = G ? G.score : 0;
  const lives = G ? G.lives : MAX_LIVES;
  $('lives').innerHTML = Array.from({ length: MAX_LIVES }, (_, i) =>
    `<span class="${i < lives ? '' : 'lost'}">🐾</span>`).join('');
  $('soundBtn').textContent = soundOn ? '🔊' : '🔇';
  $('bestStart').textContent = best;
}

function show(id) {
  for (const s of ['startScreen', 'pauseScreen', 'overScreen']) $(s).classList.toggle('hidden', s !== id);
}

function start() {
  resetGame();
  show(null);
  stopMusic();
  startMusic();
}

function pause() {
  if (G && G.state === 'play') {
    G.state = 'pause';
    pointerDown = false;
    stopMusic();
    show('pauseScreen');
  }
}

function resume() {
  G.state = 'play';
  show(null);
  startMusic();
}

/* ---------- Input ---------- */

canvas.addEventListener('pointerdown', e => {
  if (!G || G.state !== 'play') return;
  pointerDown = true;
  canvas.setPointerCapture(e.pointerId);
  G.trail = [{ x: e.clientX, y: e.clientY, t: performance.now() }];
});

canvas.addEventListener('pointermove', e => {
  if (!pointerDown || G.state !== 'play') return;
  const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of events.length ? events : [e]) {
    const p = { x: ev.clientX, y: ev.clientY, t: performance.now() };
    const last = G.trail[G.trail.length - 1];
    G.trail.push(p);
    if (last) checkSlice(last, p);
  }
});

const endPointer = () => { pointerDown = false; };
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

$('startBtn').addEventListener('click', start);
$('againBtn').addEventListener('click', start);
$('restartBtn').addEventListener('click', start);
$('resumeBtn').addEventListener('click', resume);
$('pauseBtn').addEventListener('click', pause);
$('soundBtn').addEventListener('click', () => {
  soundOn = !soundOn;
  localStorage.setItem(SOUND_KEY, soundOn ? 'on' : 'off');
  if (soundOn && G && G.state === 'play') startMusic();
  else stopMusic();
  renderHud();
});

document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
window.addEventListener('resize', resize);

/* ---------- Main loop ---------- */

let lastT = performance.now();
function loop(t) {
  const dt = Math.min((t - lastT) / 1000, 0.05);
  lastT = t;
  if (G && G.state !== 'pause') update(dt);
  draw();
  requestAnimationFrame(loop);
}

resize();
renderHud();
requestAnimationFrame(loop);

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js');
}
