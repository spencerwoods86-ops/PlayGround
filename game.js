/* Rust & Rumble — a small, honest physics platformer. */
(() => {
'use strict';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });
const shell = document.getElementById('shell');
const statusEl = document.getElementById('status');
const locksEl = document.getElementById('locks');
const overlay = document.getElementById('overlay');
const hintEl = document.getElementById('hint');

const H = 540;                 // logical world height
const GROUND = 500;            // top of factory floor
const LEVEL_W = 2500;
const GRAV = 1200;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rect = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
let VIEW_W = 960, dpr = 1, scale = 1;
let player, things, platforms, gateA, gateB, plateA, plateB, beam, camera, won, elapsed, statusTimer, particles, shake;

const input = { left: false, right: false, jump: false, interact: false, throw: false };
const pressed = { jump: false, interact: false, throw: false };

function makeThing(x, y, w, h, type, mass) {
  return { x, y, w, h, vx: 0, vy: 0, type, mass, angle: 0, held: false, onGround: false, onBeam: false, awake: true };
}

function reset() {
  player = { x: 190, y: GROUND - 40, w: 24, h: 40, vx: 0, vy: 0, onGround: false, facing: 1, held: null, anim: 0, coyote: 0, jumpBuf: 0 };
  platforms = [
    { x: 0,    y: GROUND, w: LEVEL_W, h: 40, kind: 'ground' },
    { x: 215,  y: 430, w: 125, h: 14 },
    { x: 390,  y: 372, w: 135, h: 14 },
    { x: 555,  y: 330, w: 125, h: 14 },
    { x: 695,  y: 285, w: 95,  h: 14 },   // boulder ledge
    { x: 875,  y: 350, w: 130, h: 14 },   // high gear-plate platform
    { x: 1120, y: 425, w: 130, h: 14 },
    { x: 1300, y: 445, w: 110, h: 14 },
    { x: 1480, y: 420, w: 150, h: 14 },   // second boulder ledge
    { x: 1795, y: 480, w: 12,  h: 20 },   // little catch lip by the floor plate
    { x: 1990, y: 430, w: 130, h: 14 },
    { x: 2165, y: 375, w: 125, h: 14 },
    { x: 2420, y: 380, w: 80,  h: 120, kind: 'wall' }
  ];
  things = [
    makeThing(608, 373, 27, 27, 'gear', 0.8),       // rides the plank's left end
    makeThing(730, 247, 38, 38, 'boulder', 12),     // puzzle 1: drop on right end
    makeThing(1518, 382, 38, 38, 'boulder', 9),     // puzzle 2: push onto floor plate
    makeThing(1170, 462, 30, 30, 'crate', 4)
  ];
  gateA = { x: 1060, y: 180, w: 30, h: 320, open: false, anim: 0 };
  gateB = { x: 1870, y: 180, w: 30, h: 320, open: false, anim: 0 };
  plateA = { x: 882, y: 350, w: 106, h: 8, threshold: 0.7, weight: 0, active: false };
  plateB = { x: 1620, y: 500, w: 160, h: 8, threshold: 7, weight: 0, active: false };
  beam = { x: 720, y: 400, half: 120, angle: 0, omega: 0, inertia: 50000, maxAngle: 0.6, prevOmega: 0, balanced: 0, flash: 0 };
  beam.balanced = 0.8 * GRAV * 98.5;             // fixed counterweight on the short arm
  camera = 0; won = false; elapsed = 0; statusTimer = 0; particles = []; shake = 0;
  input.left = input.right = input.jump = input.interact = input.throw = false;
  pressed.jump = pressed.interact = pressed.throw = false;
  overlay.classList.remove('show');
  locksEl.textContent = 'LOCKS 0 / 2';
  document.querySelectorAll('.touch-btn.active').forEach(b => b.classList.remove('active'));
  setStatus('Climb up and push the boulder off the right ledge.', 4);
}

function setStatus(text, seconds = 2.2) {
  if (statusEl.textContent !== text) statusEl.textContent = text;
  statusTimer = seconds;
}
function overlap(a, b) { return a.x + a.w > b.x && a.x < b.x + b.w && a.y + a.h > b.y && a.y < b.y + b.h; }

// ---------- input ----------
const keyMap = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'jump', KeyW: 'jump', Space: 'jump', KeyE: 'interact', KeyF: 'throw' };
addEventListener('keydown', e => {
  const k = keyMap[e.code];
  if (!k) return;
  e.preventDefault();
  if (!input[k] && (k === 'jump' || k === 'interact' || k === 'throw')) pressed[k] = true;
  input[k] = true;
});
addEventListener('keyup', e => { const k = keyMap[e.code]; if (k) { e.preventDefault(); input[k] = false; } });
addEventListener('blur', () => { for (const k in input) input[k] = false; });
addEventListener('keydown', e => { if (e.code === 'KeyR') { e.preventDefault(); reset(); } });

document.querySelectorAll('.touch-btn').forEach(btn => {
  const k = btn.dataset.key;
  const down = e => {
    e.preventDefault();
    if (btn.setPointerCapture) { try { btn.setPointerCapture(e.pointerId); } catch (_) {} }
    if (!input[k] && (k === 'jump' || k === 'interact' || k === 'throw')) pressed[k] = true;
    input[k] = true; btn.classList.add('active');
  };
  const up = e => { e.preventDefault(); input[k] = false; btn.classList.remove('active'); };
  btn.addEventListener('pointerdown', down);
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointercancel', up);
  btn.addEventListener('lostpointercapture', up);
  btn.addEventListener('contextmenu', e => e.preventDefault());
});

document.getElementById('restart').addEventListener('click', reset);
document.getElementById('again').addEventListener('click', reset);

// ---------- responsive camera ----------
function resize() {
  const cssW = shell.clientWidth, cssH = shell.clientHeight;
  dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.round(cssW * dpr));
  canvas.height = Math.max(1, Math.round(cssH * dpr));
  scale = cssH / H;
  VIEW_W = cssW / scale;
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
  ctx.imageSmoothingEnabled = false;
}
addEventListener('resize', resize);
addEventListener('orientationchange', () => setTimeout(resize, 60));
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);

// ---------- collision helpers ----------
// One-way top collision for characters and props. Gates are full solid slabs.
function landOn(body, prevBottom, dt) {
  body.onGround = false;
  for (const p of platforms) {
    if (body.x + body.w <= p.x || body.x >= p.x + p.w) continue;
    const bottom = body.y + body.h;
    if (body.vy >= 0 && prevBottom <= p.y + 7 && bottom >= p.y) {
      body.y = p.y - body.h; body.vy = 0; body.onGround = true;
      if (p.kind === 'ground') body.y = p.y - body.h;
    }
  }
  // Rotating plank: a real sloped surface with a real contact point.
  const local = body.x + body.w * 0.5 - beam.x;
  if (Math.abs(local) <= beam.half + body.w * 0.5) {
    const surf = beam.y + Math.tan(beam.angle) * local;
    const bottom = body.y + body.h;
    if (body.vy >= 0 && prevBottom <= surf + 11 && bottom >= surf) {
      body.y = surf - body.h; body.vy = 0; body.onGround = true; body.onBeam = true;
    }
  }
}

function moveBody(body, dt, isPlayer) {
  body.onGround = false; body.onBeam = false;
  const prevBottom = body.y + body.h;
  body.x += body.vx * dt;
  // world edges & closed gates
  if (body.x < 0) { body.x = 0; body.vx = Math.max(0, body.vx); }
  if (body.x + body.w > LEVEL_W) { body.x = LEVEL_W - body.w; body.vx = Math.min(0, body.vx); }
  for (const g of [gateA, gateB]) {
    if (g.open) continue;
    if (overlap(body, g)) {
      if (body.vx > 0) { body.x = g.x - body.w; body.vx = 0; }
      else if (body.vx < 0) { body.x = g.x + g.w; body.vx = 0; }
    }
  }
  // Platform sides stop heavy props, never the player (one-way platforms).
  if (!isPlayer) {
    for (const p of platforms) {
      if (p.kind === 'ground') continue;
      if (overlap(body, p) && body.y + body.h > p.y + 5) {
        if (body.vx > 0) { body.x = p.x - body.w; body.vx = 0; }
        else if (body.vx < 0) { body.x = p.x + p.w; body.vx = 0; }
      }
    }
  }
  body.y += body.vy * dt;
  landOn(body, prevBottom, dt);
  if (isPlayer) {
    // keep the little mechanic out of the floor
    if (body.y + body.h > GROUND) { body.y = GROUND - body.h; body.vy = 0; body.onGround = true; }
  }
  if (body.onGround) body.coyote = 0.1; else body.coyote = Math.max(0, body.coyote - dt);
}

// ---------- carrying ----------
function nearestThing() {
  let best = null, bestD = 70;
  const px = player.x + player.w / 2, py = player.y + player.h / 2;
  for (const o of things) {
    if (o.held) continue;
    const d = Math.hypot(o.x + o.w / 2 - px, o.y + o.h / 2 - py);
    if (d < bestD) { bestD = d; best = o; }
  }
  return best;
}
function interact() {
  if (player.held) { drop(); return; }
  const o = nearestThing();
  if (!o) { setStatus('Nothing close enough to lift.'); return; }
  if (o.mass > 4.5) { setStatus('Too heavy! Push it instead.', 1.8); shake = Math.max(shake, 2); return; }
  o.held = true; player.held = o; o.vx = 0; o.vy = 0;
  setStatus(o.type === 'gear' ? 'Gear lifted — drop it or toss it.' : 'Crate lifted.', 1.6);
}
function drop() {
  const o = player.held; if (!o) return;
  o.held = false; player.held = null;
  o.x = player.x + player.w / 2 - o.w / 2 + player.facing * 22;
  o.y = player.y + 7; o.vx = player.vx * 0.5; o.vy = 20;
  o.awake = true;
}
function toss() {
  const o = player.held; if (!o) return;
  o.held = false; player.held = null;
  o.x = player.x + player.w / 2 - o.w / 2 + player.facing * 20;
  o.y = player.y + 3;
  o.vx = player.facing * 440 + player.vx * 0.5; o.vy = -420; o.awake = true;
  setStatus('Toss!', 1);
}

// ---------- plank dynamics ----------
function surfaceAt(local) { return beam.y + Math.tan(beam.angle) * local; }

function updateBeam(dt) {
  const riders = [];
  let torque = 0;
  for (const o of things) {
    if (o.held) continue;
    const local = o.x + o.w / 2 - beam.x;
    if (Math.abs(local) > beam.half + o.w / 2) continue;
    const surf = surfaceAt(local);
    const resting = o.onBeam || (Math.abs(o.y + o.h - surf) < 13 && o.vy > -20);
    if (!resting) continue;
    riders.push({ o, local });
    torque += o.mass * GRAV * local;
  }
  torque += beam.balanced;                        // fixed counterweight on the right arm
  torque -= beam.angle * 145000;                  // pivot torsion spring keeps the empty plank centred
  beam.prevOmega = beam.omega;
  beam.omega += (torque / beam.inertia) * dt;
  beam.omega *= Math.pow(0.996, dt * 60);
  const before = beam.angle;
  beam.angle += beam.omega * dt;
  let hitStop = false, stopSign = 0;
  if (Math.abs(beam.angle) >= beam.maxAngle) {
    stopSign = Math.sign(beam.angle);
    beam.angle = stopSign * beam.maxAngle;
    hitStop = !(stopSign > 0 && before >= beam.maxAngle - 0.0001) && !(stopSign < 0 && before <= -beam.maxAngle + 0.0001);
  }
  // Carry everything that is resting on the plank along its new slope.
  for (const { o, local } of riders) {
    if (hitStop) continue;
    const surf = surfaceAt(local);
    if (surf > o.y + o.h + 18) continue;
    o.y = surf - o.h; o.vy = 0; o.onBeam = true; o.onGround = true;
  }
  if (hitStop) {
    // Hard mechanical stop: anything resting on the rising arm is flung free.
    beam.flash = 1; shake = Math.max(shake, 4);
    for (const { o, local } of riders) {
      const v = beam.prevOmega;
      o.vy = Math.min(o.vy, v * local);
      o.vx += -local * Math.sin(beam.angle) * v * 0.92;
      o.y = surfaceAt(local) - o.h - 2;
      o.onBeam = false; o.onGround = false; o.awake = true;
      burst(o.x + o.w / 2, o.y + o.h, '#ffcf5a', 8);
    }
    for (let i = 0; i < 6; i++) particles.push({ x: beam.x + (Math.random() - 0.5) * 80, y: beam.y - 20, vx: (Math.random() - 0.5) * 90, vy: -Math.random() * 80, life: 0.5, max: 0.5, c: '#b7c2bd', s: 2 });
    beam.omega *= 0.25;
  }
  beam.flash = Math.max(0, beam.flash - dt * 3);
}

// ---------- object interactions ----------
function collidePlayerProps(dt) {
  for (const o of things) {
    if (o.held || !overlap(player, o)) continue;
    const prevBottom = player.y + player.h;
    if (player.vy >= 0 && prevBottom <= o.y + 10 && player.y + player.h >= o.y) {
      player.y = o.y - player.h; player.vy = 0; player.onGround = true;
      continue;
    }
    // shove things with your shoulder; heavier props resist more
    const dir = player.x + player.w / 2 < o.x + o.w / 2 ? 1 : -1;
    const push = (player.vx > 0 ? 1 : player.vx < 0 ? -1 : 0);
    if (push !== 0) {
      player.x = dir > 0 ? o.x - player.w : o.x + o.w;
      o.vx += push * 280 * dt * 60 / (1 + o.mass * 0.35);
      player.vx *= 0.25;
      if (o.mass > 6) player.x = dir > 0 ? o.x - player.w : o.x + o.w;
    }
  }
}

function collideProps() {
  for (let i = 0; i < things.length; i++) {
    for (let j = i + 1; j < things.length; j++) {
      const a = things[i], b = things[j];
      if (a.held || b.held || !overlap(a, b)) continue;
      const dx = (a.x + a.w / 2) - (b.x + b.w / 2);
      const dy = (a.y + a.h / 2) - (b.y + b.h / 2);
      if (Math.abs(dx) > Math.abs(dy) * 0.7) {
        const push = Math.abs(dx) < 0.01 ? 0.1 : Math.sign(dx) * Math.min(a.x + a.w - b.x, b.x + b.w - a.x) * 0.5;
        a.x += push; b.x -= push;
        const av = a.vx, bv = b.vx, total = a.mass + b.mass;
        a.vx = (av * (a.mass - b.mass) + 2 * b.mass * bv) / total;
        b.vx = (bv * (b.mass - a.mass) + 2 * a.mass * av) / total;
      } else if (dy < 0) {
        a.y -= Math.min(a.y + a.h - b.y, 0.6); a.vy = Math.min(a.vy, b.vy); a.onGround = true;
      } else {
        b.y -= Math.min(b.y + b.h - a.y, 0.6); b.vy = Math.min(a.vy, b.vy); b.onGround = true;
      }
    }
  }
}

function burst(x, y, color, n) {
  for (let i = 0; i < n; i++) particles.push({ x, y, vx: (Math.random() - 0.5) * 190, vy: -Math.random() * 190, life: 0.5 + Math.random() * 0.35, max: 0.85, c: color, s: 2 + Math.random() * 3 });
}

// ---------- pins / plates ----------
function plateCheck(plate) {
  plate.weight = 0;
  for (const o of things) {
    if (o.held) continue;
    const cx = o.x + o.w / 2, bottom = o.y + o.h;
    if (cx > plate.x - 4 && cx < plate.x + plate.w + 4 && bottom > plate.y - 4 && bottom < plate.y + 14) {
      plate.weight += o.mass;
    }
  }
  plate.active = plate.weight >= plate.threshold;
}

// ---------- main step ----------
function update(dt) {
  if (won) return;
  elapsed += dt;
  statusTimer = Math.max(0, statusTimer - dt);
  if (statusTimer === 0 && !gateA.open) setStatus('Puzzle 1: drop the boulder on the seesaw’s right end.', 0);
  else if (statusTimer === 0 && gateA.open && !plateB.active) setStatus('Puzzle 2: push the heavy boulder onto the floor plate.', 0);

  if (pressed.interact) { interact(); pressed.interact = false; }
  if (pressed.throw) { toss(); pressed.throw = false; }

  // player movement
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  if (dir) player.facing = dir;
  const carrySlow = player.held ? 0.78 : 1;
  const accel = player.onGround ? 1900 : 1100;
  if (dir) player.vx += dir * accel * dt;
  const drag = dir ? (player.onGround ? 0.875 : 0.965) : (player.onGround ? 0.70 : 0.985);
  player.vx *= Math.pow(drag, dt * 60);
  player.vx = clamp(player.vx, -230 * carrySlow, 230 * carrySlow);
  if (Math.abs(player.vx) < 2 && !dir) player.vx = 0;
  if (pressed.jump) { player.jumpBuf = 0.13; pressed.jump = false; }
  player.jumpBuf = Math.max(0, player.jumpBuf - dt);
  if (player.jumpBuf > 0 && player.coyote > 0) {
    player.vy = -475; player.onGround = false; player.coyote = 0; player.jumpBuf = 0;
    burst(player.x + player.w / 2, player.y + player.h, '#b8d8d4', 4);
  }
  if (!input.jump && player.vy < -180) player.vy += 1500 * dt;
  player.vy = Math.min(880, player.vy + GRAV * dt);
  player.anim += Math.abs(player.vx) * dt * 0.055;
  moveBody(player, dt, true);
  collidePlayerProps(dt);
  if (player.y > H + 80) { player.x = Math.max(60, player.x - 110); player.y = 200; player.vy = 0; }

  // Held prop rigidly follows the hands, but still exists in the world.
  if (player.held) {
    const o = player.held;
    o.x = player.x + player.w / 2 - o.w / 2 + player.facing * 14;
    o.y = player.y + 4;
    o.vx = 0; o.vy = 0; o.angle += dt * 0.4;
  }

  // Plank first, then props.
  updateBeam(dt);
  for (const o of things) {
    if (o.held) continue;
    o.awake = true;
    o.vy = Math.min(880, o.vy + GRAV * dt);
    o.vx *= Math.pow(o.onGround ? 0.88 : 0.997, dt * 60);
    if (Math.abs(o.vx) < 1) o.vx = 0;
    moveBody(o, dt, false);
    if (o.type === 'gear') o.angle += o.vx * dt * 0.03;
    // objects that wobble off the end of the world get a soft reset
    if (o.y > H + 120) {
      if (o.type === 'boulder') { o.x = 730; o.y = 247; }
      else { o.x = 570; o.y = 380; }
      o.vx = o.vy = 0;
    }
  }
  collideProps();

  // pressure plates and gates
  plateCheck(plateA); plateCheck(plateB);
  const wasA = gateA.open, wasB = gateB.open;
  gateA.open = plateA.active; gateB.open = plateB.active;
  if (gateA.open && !wasA) { setStatus('CLANK! The first lock is open.', 2.4); burst(gateA.x + 15, 280, '#55d9c4', 16); shake = 5; }
  if (gateB.open && !wasB) { setStatus('The final gate is open — head for the exit!', 3); burst(gateB.x + 15, 280, '#55d9c4', 16); shake = 5; }
  gateA.anim += ((gateA.open ? 1 : 0) - gateA.anim) * Math.min(1, dt * 8);
  gateB.anim += ((gateB.open ? 1 : 0) - gateB.anim) * Math.min(1, dt * 8);
  const lockText = `LOCKS ${Number(gateA.open) + Number(gateB.open)} / 2`;
  if (locksEl.textContent !== lockText) locksEl.textContent = lockText;

  // victory — stand at the marked exit
  if (player.x + player.w > 2374 && player.y + player.h > 370) {
    won = true;
    overlay.classList.add('show');
    burst(2360, 440, '#ffcf5a', 50);
  }

  camera = clamp(player.x + player.w / 2 - VIEW_W * 0.44, 0, LEVEL_W - VIEW_W);
  if (camera < 0) camera = 0;
  shake = Math.max(0, shake - dt * 20);
  for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 500 * dt; p.life -= dt; }
  particles = particles.filter(p => p.life > 0);
}

// ---------- drawing ----------
function drawBackground() {
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#142238');
  sky.addColorStop(0.55, '#263f55');
  sky.addColorStop(1, '#435b61');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, VIEW_W, H);
  // soft shafts of factory light
  for (let i = 0; i < 8; i++) {
    const x = ((i * 281 - camera * 0.14) % (VIEW_W + 500) + VIEW_W + 500) % (VIEW_W + 500) - 180;
    ctx.fillStyle = 'rgba(255,214,126,.055)';
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 76, 0); ctx.lineTo(x + 186, H); ctx.lineTo(x + 112, H); ctx.fill();
  }
  // far pipes and tanks
  for (let i = 0; i < 10; i++) {
    const x = ((i * 225 - camera * 0.22) % 2300 + 2300) % 2300 - 260;
    rect(x, 128, 90, 252, '#203649');
    rect(x + 10, 140, 70, 218, '#2b465a');
    rect(x + 22, 158, 46, 12, '#4d6d73');
    rect(x + 22, 182, 46, 4, '#172c3f');
    for (let j = 0; j < 4; j++) rect(x + 22 + j * 12, 198, 7, 11, '#c58a51');
    rect(x + 7, 121, 76, 8, '#3e596b');
    rect(x + 40, 74, 8, 60, '#314b60');
    rect(x + 33, 76, 22, 6, '#c08d57');
  }
  // giant idle background cogs
  for (let i = 0; i < 4; i++) {
    const gx = ((i * 620 - camera * 0.34) % 2500 + 2500) % 2500 - 220;
    const gy = 118 + (i % 2) * 34;
    ctx.save(); ctx.translate(gx, gy); ctx.rotate(elapsed * (i % 2 ? 0.08 : -0.06));
    ctx.fillStyle = '#243b4d';
    for (let k = 0; k < 10; k++) { ctx.save(); ctx.rotate(k * Math.PI / 5); ctx.fillRect(-7, -54, 14, 20); ctx.restore(); }
    ctx.beginPath(); ctx.arc(0, 0, 37, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#192d3f'; ctx.beginPath(); ctx.arc(0, 0, 17, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  // ceiling structure
  rect(0, 0, VIEW_W, 30, '#101d30');
  for (let x = -((camera * 0.7) % 90); x < VIEW_W + 90; x += 90) {
    rect(x, 25, 48, 8, '#43596d'); rect(x + 5, 33, 4, 42, '#263b4f'); rect(x + 20, 33, 2, 24, '#4c6473');
  }
  // haze
  const haze = ctx.createLinearGradient(0, 300, 0, H);
  haze.addColorStop(0, 'rgba(93,130,131,0)');
  haze.addColorStop(1, 'rgba(150,176,158,.13)');
  ctx.fillStyle = haze; ctx.fillRect(0, 0, VIEW_W, H);
}

function drawPlatform(p) {
  if (p.kind === 'wall') {
    rect(p.x, p.y, p.w, p.h, '#2b3f50');
    for (let y = p.y + 5; y < p.y + p.h; y += 17) rect(p.x + 4, y, p.w - 8, 4, '#536a73');
    return;
  }
  rect(p.x - 2, p.y + 12, p.w + 4, 6, '#1a2b3c');
  rect(p.x, p.y, p.w, p.h, '#3c5262');
  rect(p.x, p.y, p.w, 4, '#d1b26d');
  rect(p.x + 2, p.y + 4, p.w - 4, 3, '#70807f');
  for (let x = p.x + 9; x < p.x + p.w - 8; x += 25) {
    rect(x, p.y + 8, 14, 3, '#223545');
    rect(x + 4, p.y + 12, 4, 2, '#a3a98f');
  }
  rect(p.x, p.y + p.h - 2, p.w, 2, '#101f30');
}

function drawBeamAndRig() {
  // pedestal / fulcrum
  rect(beam.x - 30, GROUND - 18, 60, 18, '#1a2b3c');
  ctx.fillStyle = '#344b5c';
  ctx.beginPath(); ctx.moveTo(beam.x - 28, GROUND); ctx.lineTo(beam.x, beam.y + 4); ctx.lineTo(beam.x + 28, GROUND); ctx.closePath(); ctx.fill();
  rect(beam.x - 11, beam.y + 2, 22, 18, '#243a4c');
  // pivot cog
  ctx.save(); ctx.translate(beam.x, beam.y); ctx.rotate(-beam.angle * 0.9);
  ctx.fillStyle = '#d9a249';
  for (let k = 0; k < 8; k++) { ctx.save(); ctx.rotate(k * Math.PI / 4); ctx.fillRect(-4, -15, 8, 8); ctx.restore(); }
  ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f8d17b'; ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  // plank
  ctx.save(); ctx.translate(beam.x, beam.y); ctx.rotate(beam.angle);
  rect(-beam.half - 5, -10, beam.half * 2 + 10, 18, '#1a2a3b');
  rect(-beam.half, -8, beam.half * 2, 12, '#b8753c');
  rect(-beam.half, -8, beam.half * 2, 3, '#efbd62');
  rect(-beam.half, 1, beam.half * 2, 3, '#7c4a30');
  for (let x = -beam.half + 8; x < beam.half; x += 26) rect(x, -4, 12, 3, '#6f432d');
  // hazard tips
  for (let i = 0; i < 4; i++) {
    rect(-beam.half + i * 8, -8, 4, 12, i % 2 ? '#f0c04f' : '#283d4d');
    rect(beam.half - 8 - i * 8, -8, 4, 12, i % 2 ? '#f0c04f' : '#283d4d');
  }
  // counterweight bolted to the short right arm
  rect(beam.half - 30, -8, 24, 24, '#344958');
  rect(beam.half - 27, -5, 18, 4, '#90a19d');
  rect(beam.half - 27, 4, 18, 3, '#5e7474');
  ctx.restore();
  if (beam.flash > 0) {
    ctx.strokeStyle = `rgba(255,220,120,${beam.flash})`; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(beam.x, beam.y, 48 + (1 - beam.flash) * 38, 0, Math.PI * 2); ctx.stroke();
  }
}

function drawPlate(plate, label) {
  const glow = plate.active;
  rect(plate.x - 5, plate.y + 5, plate.w + 10, 7, '#223444');
  rect(plate.x, plate.y, plate.w, 7, glow ? '#57e0bb' : '#c16b52');
  rect(plate.x + 3, plate.y + 1, plate.w - 6, 2, glow ? '#d8fff2' : '#f0a064');
  for (let x = plate.x + 12; x < plate.x + plate.w - 5; x += 22) rect(x, plate.y + 3, 8, 2, glow ? '#1e7f78' : '#733f39');
  ctx.fillStyle = glow ? '#baffea' : '#f4c681';
  ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
  ctx.fillText(glow ? 'PRESSED' : label, plate.x + plate.w / 2, plate.y - 8);
  ctx.textAlign = 'left';
}

function drawGate(g, number) {
  // fixed side guides
  rect(g.x - 16, 156, 9, g.h + 18, '#253a4d');
  rect(g.x + g.w + 7, 156, 9, g.h + 18, '#253a4d');
  rect(g.x - 18, 148, 13, 9, '#c69855');
  rect(g.x + g.w + 5, 148, 13, 9, '#c69855');
  const lift = g.anim * (g.h + 20);
  if (lift < g.h - 2) {
    ctx.save(); ctx.beginPath(); ctx.rect(g.x - 16, 50, g.w + 40, g.h + 44); ctx.clip();
    const y = g.y - lift;
    rect(g.x - 8, y - 14, g.w + 16, 16, '#1b2d40');
    rect(g.x - 5, y, g.w + 10, g.h, '#132538');
    rect(g.x + 1, y + 5, g.w - 2, g.h - 10, '#334b5d');
    // vertical steel seams + rivets
    rect(g.x + 5, y + 8, 4, g.h - 16, '#738582');
    rect(g.x + g.w - 9, y + 8, 4, g.h - 16, '#738582');
    for (let yy = y + 13; yy < y + g.h - 12; yy += 35) {
      rect(g.x + 1, yy, g.w - 2, 7, '#50676f');
      rect(g.x + 1, yy + 7, g.w - 2, 2, '#1b2e40');
      rect(g.x + 3, yy + 2, 3, 3, '#b6bda6');
      rect(g.x + g.w - 6, yy + 2, 3, 3, '#b6bda6');
    }
    // hazard band and lock housing
    for (let i = 0; i < 7; i++) {
      rect(g.x + 1 + i * 5, y + g.h - 45, 3, 22, i % 2 ? '#e7b14e' : '#273c4d');
    }
    rect(g.x - 3, y + 138, g.w + 6, 54, '#203446');
    rect(g.x + g.w / 2 - 10, y + 146, 20, 35, '#d5a04c');
    rect(g.x + g.w / 2 - 6, y + 153, 12, 10, '#fff0b3');
    rect(g.x + g.w / 2 - 3, y + 163, 6, 12, '#3d3023');
    rect(g.x + g.w / 2 - 4, y + 179, 8, 4, '#ff7b58');
    ctx.restore();
  }
  // lintel
  rect(g.x - 18, 164, g.w + 36, 10, '#354b5d');
  rect(g.x - 14, 160, g.w + 28, 5, '#c69855');
}

function drawThing(o) {
  if (o.type === 'boulder') {
    const cx = o.x + o.w / 2, cy = o.y + o.h / 2, r = o.w / 2;
    ctx.fillStyle = '#263747'; ctx.beginPath(); ctx.arc(cx + 2, cy + 3, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#728491'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#8e9d9f'; ctx.beginPath(); ctx.arc(cx - 5, cy - 6, r * 0.55, 0, Math.PI * 2); ctx.fill();
    rect(o.x + 7, o.y + 7, 9, 5, '#bcc2b4');
    rect(o.x + o.w - 12, o.y + 19, 7, 6, '#526574');
    rect(o.x + 9, o.y + o.h - 10, 7, 4, '#586b79');
    rect(o.x + 17, o.y + 25, 4, 4, '#435665');
  } else if (o.type === 'gear') {
    ctx.save(); ctx.translate(o.x + o.w / 2, o.y + o.h / 2); ctx.rotate(o.angle);
    ctx.fillStyle = '#a26432';
    for (let k = 0; k < 8; k++) { ctx.save(); ctx.rotate(k * Math.PI / 4); ctx.fillRect(-4, -17, 8, 10); ctx.restore(); }
    ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.fillStyle = '#e8ad45'; ctx.fill();
    ctx.fillStyle = '#f8d478'; ctx.beginPath(); ctx.arc(-2, -2, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#87542f'; ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  } else {
    rect(o.x - 2, o.y - 2, o.w + 4, o.h + 4, '#5e402b');
    rect(o.x, o.y, o.w, o.h, '#c47945');
    rect(o.x + 3, o.y + 3, o.w - 6, 5, '#e9a865');
    rect(o.x + 5, o.y + 10, 4, 4, '#7b4b2f');
    rect(o.x + o.w - 9, o.y + 10, 4, 4, '#7b4b2f');
    rect(o.x + 4, o.y + o.h - 6, o.w - 8, 3, '#844e31');
    rect(o.x + 3, o.y + 3, 3, 3, '#f5d08a'); rect(o.x + o.w - 6, o.y + o.h - 6, 3, 3, '#f5d08a');
  }
  if (o.held) { rect(o.x + o.w / 2 - 1, o.y - 8, 2, 7, '#fff0c1'); rect(o.x + o.w / 2 - 4, o.y - 9, 8, 2, '#fff0c1'); }
}

function drawPlayer() {
  const x = Math.round(player.x), y = Math.round(player.y);
  const moving = Math.abs(player.vx) > 12;
  const step = moving ? Math.floor(player.anim) % 2 : 0;
  const face = player.facing;
  // shadow
  rect(x + 3, y + 38, 20, 3, 'rgba(0,0,0,.18)');
  // pack
  rect(x + (face > 0 ? 1 : 17), y + 17, 7, 14, '#7d4b3a');
  rect(x + (face > 0 ? 2 : 18), y + 19, 5, 4, '#ad7650');
  // legs
  rect(x + 5 + (step ? 1 : 0), y + 30, 6, 8, '#32485c');
  rect(x + 14 - (step ? 1 : 0), y + 30, 6, 8, '#32485c');
  rect(x + 3 + (step ? 3 : 0), y + 37, 9, 3, '#5b3b3e');
  rect(x + 14 - (step ? 3 : 0), y + 37, 9, 3, '#5b3b3e');
  // body
  rect(x + 4, y + 16, 17, 15, '#2e8c82');
  rect(x + 6, y + 18, 13, 4, '#59c3ac');
  rect(x + 4, y + 27, 17, 4, '#7f4c39');
  rect(x + 11, y + 21, 4, 5, '#f3c04f');
  // arms
  rect(x + (face > 0 ? 20 : 0), y + 19, 5, 10, '#eab568');
  rect(x + (face > 0 ? 0 : 19), y + 19, 5, 9, '#d79c5a');
  // head
  rect(x + 5, y + 4, 16, 13, '#eab568');
  rect(x + 3, y + 3, 5, 8, '#d79c5a');
  rect(x + 5, y + 1, 16, 5, '#e7b04f');
  rect(x + 8, y + 6, 10, 3, '#24384a');
  rect(x + (face > 0 ? 15 : 8), y + 10, 3, 3, '#17243a');
  rect(x + (face > 0 ? 17 : 7), y + 15, 3, 2, '#b4674f');
  rect(x + 19, y + 6, 4, 3, '#f5cf72');
  // belt lamp
  rect(x + (face > 0 ? 19 : 2), y + 26, 3, 3, '#ffe49a');
  if (player.held) {
    rect(x + (face > 0 ? 23 : 0), y + 19, 4, 5, '#eab568');
  }
}

function drawSign(x, y, num, title, sub, accent = '#f0b34e') {
  rect(x, y, 148, 44, '#152435');
  rect(x + 4, y + 4, 140, 36, '#3d5668');
  rect(x + 4, y + 4, 6, 36, accent);
  ctx.fillStyle = '#fff0c1'; ctx.font = 'bold 9px monospace';
  ctx.fillText(num + '  ' + title, x + 17, y + 18);
  ctx.fillStyle = '#a9d2cf'; ctx.font = '8px monospace';
  ctx.fillText(sub, x + 17, y + 31);
}

function drawWorld() {
  drawBackground();
  ctx.save();
  const sx = shake ? (Math.random() - 0.5) * shake : 0;
  const sy = shake ? (Math.random() - 0.5) * shake : 0;
  ctx.translate(Math.round(-camera + sx), Math.round(sy));

  // structural columns
  for (let x = 60; x < LEVEL_W; x += 300) {
    rect(x, 64, 13, GROUND - 64, '#2c4357');
    rect(x - 5, 82, 23, 9, '#a8654a');
    rect(x + 3, 91, 6, GROUND - 103, '#536d78');
    rect(x + 5, 140, 2, 250, '#7d8f8c');
    rect(x + 3, 340, 6, 6, '#d4a95f');
    rect(x + 3, 410, 6, 6, '#d4a95f');
  }
  // overhead lamps
  for (let x = 188; x < LEVEL_W; x += 410) {
    rect(x, 70, 58, 7, '#c39a5c');
    rect(x + 23, 77, 12, 9, '#ffe08a');
    rect(x + 26, 86, 6, 5, '#fff3bd');
    ctx.fillStyle = 'rgba(255,207,90,.055)';
    ctx.beginPath(); ctx.moveTo(x + 4, 88); ctx.lineTo(x + 52, 88); ctx.lineTo(x + 104, 420); ctx.lineTo(x - 48, 420); ctx.fill();
  }
  // wall panels / signage
  for (let x = 132; x < LEVEL_W; x += 360) {
    rect(x, 196, 86, 38, '#1a2c3e');
    rect(x + 5, 201, 76, 28, '#2d475a');
    rect(x + 12, 208, 13, 14, '#d49a4c');
    rect(x + 32, 208, 40, 4, '#8ea9a5');
    rect(x + 32, 217, 28, 3, '#5eb6a7');
  }
  // pipe run with valves
  rect(0, 108, LEVEL_W, 6, '#314b5d');
  rect(0, 114, LEVEL_W, 3, '#182b3d');
  for (let x = 240; x < LEVEL_W; x += 520) {
    rect(x, 100, 10, 22, '#a56b4a');
    rect(x - 5, 106, 20, 5, '#d4a55c');
    rect(x + 2, 122, 6, 26, '#3d5a6b');
  }

  // factory floor
  rect(0, GROUND, LEVEL_W, 40, '#334a5a');
  rect(0, GROUND, LEVEL_W, 6, '#b59d69');
  rect(0, GROUND + 6, LEVEL_W, 2, '#607274');
  for (let x = 0; x < LEVEL_W; x += 40) {
    rect(x, GROUND + 12, 31, 3, '#253a4c');
    rect(x + 7, GROUND + 22, 8, 4, '#5b6c6d');
    rect(x + 25, GROUND + 30, 9, 3, '#223647');
  }
  for (let x = 160; x < LEVEL_W; x += 600) {
    rect(x, GROUND - 1, 84, 8, '#203444');
    for (let i = 0; i < 7; i++) rect(x + i * 12, GROUND - 1, 6, 8, i % 2 ? '#e4b252' : '#24394a');
  }

  platforms.forEach(drawPlatform);
  drawSign(150, 300, '1', 'PUSH THE BOULDER', 'OFF THE RIGHT LEDGE', '#f0b34e');
  drawSign(792, 250, '2', 'GEAR SWITCH', 'LAND THE GEAR HERE', '#55d9c4');
  drawSign(1468, 300, '3', 'HEAVY FLOOR PLATE', 'NEEDS 7+ WEIGHT', '#f0b34e');
  drawSign(2180, 304, '4', 'EXIT AHEAD', 'KEEP ROLLING', '#55d9c4');

  // highlight the intended route with tiny paint arrows
  for (const ax of [335, 518, 676, 828]) {
    ctx.fillStyle = 'rgba(240,179,78,.6)';
    ctx.beginPath(); ctx.moveTo(ax, 452); ctx.lineTo(ax + 13, 452); ctx.lineTo(ax + 6, 445); ctx.lineTo(ax + 6, 459); ctx.fill();
  }

  drawBeamAndRig();
  drawPlate(plateA, 'GEAR PLATE');
  drawPlate(plateB, 'HEAVY PLATE');
  drawGate(gateA, 1);
  drawGate(gateB, 2);
  things.forEach(drawThing);
  drawPlayer();
  if (!player.held) {
    const near = nearestThing();
    if (near) {
      const label = near.mass > 4.5 ? 'PUSH' : 'LIFT';
      const cx = near.x + near.w / 2;
      const top = near.y - 25;
      rect(cx - 25, top, 50, 17, '#17243ae6');
      rect(cx - 25, top, 3, 17, near.mass > 4.5 ? '#f0b34e' : '#55d9c4');
      ctx.fillStyle = '#fff0c1'; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
      ctx.fillText(label, cx + 1, top + 12);
      ctx.textAlign = 'left';
    }
  }

  // exit door
  rect(2290, 388, 14, 112, '#2c4558');
  rect(2304, 348, 156, 152, '#3b5a66');
  rect(2311, 355, 142, 145, '#69ab95');
  rect(2319, 363, 126, 137, '#1f404e');
  rect(2329, 373, 106, 127, '#162f3e');
  rect(2339, 383, 86, 117, '#2e605d');
  rect(2339, 383, 86, 8, '#e7b356');
  rect(2350, 400, 64, 59, '#f3c255');
  rect(2358, 408, 48, 43, '#193947');
  rect(2364, 414, 36, 3, '#f9db86');
  rect(2376, 422, 12, 8, '#ffcf5a');
  ctx.save(); ctx.translate(2406, 425); ctx.rotate(-0.05);
  rect(-30, -18, 60, 17, '#ffcf5a');
  ctx.fillStyle = '#22384a'; ctx.font = 'bold 13px monospace'; ctx.textAlign = 'center'; ctx.fillText('EXIT', 0, -5);
  ctx.restore(); ctx.textAlign = 'left';
  // beacon
  rect(2296, 330, 4, 18, '#6e8588');
  rect(2292, 326, 12, 6, '#ffe281');
  ctx.fillStyle = 'rgba(255,226,129,.16)';
  ctx.beginPath(); ctx.arc(2298, 330, 44 + Math.sin(elapsed * 4) * 4, 0, Math.PI * 2); ctx.fill();

  // particles
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    rect(p.x, p.y, p.s, p.s, p.c);
  }
  ctx.globalAlpha = 1;

  // gate label banners above closed doors
  for (const g of [gateA, gateB]) {
    if (!g.open) {
      rect(g.x - 18, 92, g.w + 36, 22, '#182a3c');
      rect(g.x - 14, 96, g.w + 28, 14, '#8c4f42');
      ctx.fillStyle = '#ffd889'; ctx.font = 'bold 8px monospace'; ctx.fillText('LOCKED', g.x - 4, 106);
    }
  }
  ctx.restore();

  // screen-space objective rail
  const railW = Math.min(190, VIEW_W * 0.24);
  rect(VIEW_W - railW - 14, H - 18, railW, 4, '#2a3f52');
  rect(VIEW_W - railW - 14, H - 18, railW * (player.x / (LEVEL_W - 60)), 4, '#55d9c4');
  rect(VIEW_W - railW - 17, H - 21, 6, 10, '#ffe7a0');
  rect(VIEW_W - 17, H - 21, 6, 10, '#ffe7a0');
}

let accumulator = 0;
const STEP = 1 / 120;
function frame(now) {
  frame.last = frame.last || now;
  const elapsedMs = Math.min(80, Math.max(0, now - frame.last));
  frame.last = now;
  accumulator = Math.min(0.1, accumulator + elapsedMs / 1000);
  let steps = 0;
  while (accumulator >= STEP && steps < 10) {
    update(STEP);
    accumulator -= STEP;
    steps++;
  }
  if (steps === 10) accumulator = 0;
  drawWorld();
  requestAnimationFrame(frame);
}

// Debug/testing hook: the actual simulation remains the only source of truth.
window.__RR = {
  get state() {
    return { player, things, beam, gateA, gateB, plateA, plateB, won, elapsed, camera, VIEW_W };
  },
  press(k) { if (k in pressed) pressed[k] = true; input[k] = true; },
  release(k) { input[k] = false; },
  input,
  step(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) update(dt); },
  reset
};

resize();
reset();
requestAnimationFrame(frame);
})();
