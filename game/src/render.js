// World pixels: the nebula backdrop, the parallax starfield, the skiff and its trail, drones, rocks,
// bullets, crystals, particles, the Warden's beam, and the vignettes that sit over everything.
// The 1280x720 logical field is scaled to the window and letterboxed; nothing here reads input or
// knows the score. The interface is hud.js, drawn on top of the same field.
import { ARENA, COLORS, ENEMY, SHIP } from './config.js';
import { createRandom, range } from './rng.js';
import {
  KIND_ASTEROID,
  KIND_BOSS,
  KIND_SEEKER,
  KIND_SHARD,
  KIND_SPLITTER,
  KIND_TURRET,
  PARTICLE_RING,
  PARTICLE_SHARD,
  PARTICLE_SMOKE,
  PARTICLE_SPARK,
} from './entities.js';

/** Particle colour slots, indexed by the small integer entities.js stores on each particle. */
export const PARTICLE_COLORS = ['#7df9ff', '#ff5c82', '#ffb347', '#b07cff', '#ff5f70'];

const STAR_LAYERS = [
  { count: 130, factor: 0.012, size: 1.6, speed: 5 },
  { count: 70, factor: 0.035, size: 2.1, speed: 9 },
  { count: 34, factor: 0.075, size: 2.8, speed: 14 },
];

const TAU = Math.PI * 2;
const STAR_BUCKETS = 6;

function hexToRgba(hex, alpha) {
  const value = Number.parseInt(hex.slice(1), 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

/** Pre-rendered radial falloff, drawn additively: one per colour and radius, cached for the run. */
function createGlowCache() {
  const cache = new Map();
  return function glow(color, radius) {
    const key = `${color}:${radius}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const size = Math.max(4, Math.ceil(radius * 2));
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, hexToRgba(color, 0.95));
    gradient.addColorStop(0.35, hexToRgba(color, 0.36));
    gradient.addColorStop(1, hexToRgba(color, 0));
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
    cache.set(key, canvas);
    return canvas;
  };
}

/** The background nebula, painted once into an offscreen canvas at the logical resolution. */
function createNebula(random) {
  const canvas = document.createElement('canvas');
  canvas.width = ARENA.width;
  canvas.height = ARENA.height;
  const context = canvas.getContext('2d');
  context.fillStyle = COLORS.void;
  context.fillRect(0, 0, ARENA.width, ARENA.height);

  const clouds = [
    { x: 0.18, y: 0.22, radius: 560, color: COLORS.fogA, alpha: 0.5 },
    { x: 0.82, y: 0.72, radius: 620, color: COLORS.fogB, alpha: 0.42 },
    { x: 0.55, y: 0.12, radius: 420, color: COLORS.fogC, alpha: 0.4 },
    { x: 0.35, y: 0.86, radius: 460, color: COLORS.fogA, alpha: 0.26 },
    { x: 0.72, y: 0.34, radius: 300, color: COLORS.fogC, alpha: 0.3 },
  ];
  for (const cloud of clouds) {
    const gradient = context.createRadialGradient(cloud.x * ARENA.width, cloud.y * ARENA.height, 0, cloud.x * ARENA.width, cloud.y * ARENA.height, cloud.radius);
    gradient.addColorStop(0, hexToRgba(cloud.color, cloud.alpha));
    gradient.addColorStop(0.55, hexToRgba(cloud.color, cloud.alpha * 0.35));
    gradient.addColorStop(1, hexToRgba(cloud.color, 0));
    context.fillStyle = gradient;
    context.fillRect(0, 0, ARENA.width, ARENA.height);
  }

  // Dust: a few hundred dim points so the flat gradients read as depth rather than as paint.
  for (let index = 0; index < 900; index += 1) {
    const x = range(random, 0, ARENA.width);
    const y = range(random, 0, ARENA.height);
    const size = range(random, 0.4, 1.5);
    context.fillStyle = `rgba(190, 220, 255, ${range(random, 0.02, 0.16)})`;
    context.fillRect(x, y, size, size);
  }

  // Two faint arcs of ionised gas, for a bit of structure behind the arena.
  context.lineWidth = 1.5;
  for (let index = 0; index < 5; index += 1) {
    context.strokeStyle = `rgba(125, 249, 255, ${0.03 + index * 0.012})`;
    context.beginPath();
    context.arc(ARENA.width * 0.5, ARENA.height * 1.15, 620 + index * 34, Math.PI * 1.08, Math.PI * 1.92);
    context.stroke();
  }
  return canvas;
}

/** The dark corners that frame the field, painted once. */
function createVignette(color) {
  const canvas = document.createElement('canvas');
  canvas.width = ARENA.width;
  canvas.height = ARENA.height;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(ARENA.width / 2, ARENA.height / 2, ARENA.height * 0.32, ARENA.width / 2, ARENA.height / 2, ARENA.width * 0.72);
  gradient.addColorStop(0, hexToRgba(color, 0));
  gradient.addColorStop(0.65, hexToRgba(color, 0.28));
  gradient.addColorStop(1, hexToRgba(color, 0.82));
  context.fillStyle = gradient;
  context.fillRect(0, 0, ARENA.width, ARENA.height);
  return canvas;
}

/** Quantised rgba strings, so the hot loops never build a colour string per particle per frame. */
const rgbaCache = new Map();
function rgba(hex, alpha) {
  const step = Math.max(0, Math.min(64, Math.round(alpha * 64)));
  const key = `${hex}:${step}`;
  let value = rgbaCache.get(key);
  if (value === undefined) {
    value = hexToRgba(hex, step / 64);
    rgbaCache.set(key, value);
  }
  return value;
}

export function createRenderer(canvas, seed) {
  const context = canvas.getContext('2d', { alpha: false });
  const view = { scale: 1, x: 0, y: 0, width: 1, height: 1, ratio: 1 };
  const glow = createGlowCache();
  const nebula = createNebula(createRandom(seed ^ 0x9e3779b9));
  const vignette = createVignette('#000000');
  const hurtVignette = createVignette('#ff2f4a');

  const stars = [];
  const starPaths = [];
  for (let bucket = 0; bucket < STAR_BUCKETS; bucket += 1) starPaths.push([]);
  const starRandom = createRandom(seed ^ 0x51ed270b);
  for (const layer of STAR_LAYERS) {
    for (let index = 0; index < layer.count; index += 1) {
      stars.push({
        x: range(starRandom, 0, ARENA.width),
        y: range(starRandom, 0, ARENA.height),
        size: layer.size * range(starRandom, 0.5, 1.2),
        factor: layer.factor,
        speed: layer.speed * range(starRandom, 0.6, 1.4),
        phase: range(starRandom, 0, TAU),
        bright: range(starRandom, 0.25, 0.9),
      });
    }
  }

  function resize() {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(320, Math.round(window.innerWidth * ratio));
    const height = Math.max(240, Math.round(window.innerHeight * ratio));
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    view.ratio = ratio;
    view.width = width;
    view.height = height;
    view.scale = Math.min(width / ARENA.width, height / ARENA.height);
    view.x = (width - ARENA.width * view.scale) / 2;
    view.y = (height - ARENA.height * view.scale) / 2;
  }

  /** Window (CSS) pixels to arena units, for aiming with the mouse. */
  function toArena(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const deviceX = (clientX - rect.left) * scaleX;
    const deviceY = (clientY - rect.top) * scaleY;
    return { x: (deviceX - view.x) / view.scale, y: (deviceY - view.y) / view.scale };
  }

  function beginFrame(state) {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = COLORS.void;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
    // Screen shake moves the world, never the interface.
    const shake = state.shake;
    if (shake > 0.1) {
      const offsetX = Math.sin(state.time * 91.3) * shake * 0.55;
      const offsetY = Math.cos(state.time * 77.7) * shake * 0.55;
      context.translate(offsetX, offsetY);
    }
    context.drawImage(nebula, 0, 0);
  }

  function drawStars(state) {
    const ship = state.ship;
    const drift = state.time;
    // Brightness is bucketed into six bands: six fills for the whole parallax field instead of
    // four hundred style changes, which is what used to cost frames during a boss burst.
    for (let bucket = 0; bucket < STAR_BUCKETS; bucket += 1) starPaths[bucket].length = 0;
    for (let index = 0; index < stars.length; index += 1) {
      const star = stars[index];
      let x = star.x - ship.x * star.factor * 0.1 + drift * star.speed * 0.06;
      let y = star.y - ship.y * star.factor * 0.1 + drift * star.speed * 0.02;
      x = ((x % ARENA.width) + ARENA.width) % ARENA.width;
      y = ((y % ARENA.height) + ARENA.height) % ARENA.height;
      const twinkle = 0.65 + 0.35 * Math.sin(drift * 1.6 + star.phase);
      const alpha = star.bright * twinkle;
      const bucket = Math.min(STAR_BUCKETS - 1, Math.max(0, Math.floor(alpha * STAR_BUCKETS)));
      starPaths[bucket].push(x, y, star.size);
    }
    for (let bucket = 0; bucket < STAR_BUCKETS; bucket += 1) {
      const path = starPaths[bucket];
      if (path.length === 0) continue;
      context.fillStyle = rgba('#c6e4ff', ((bucket + 0.5) / STAR_BUCKETS) * 0.85);
      context.beginPath();
      for (let index = 0; index < path.length; index += 3) {
        context.rect(path[index], path[index + 1], path[index + 2], path[index + 2]);
      }
      context.fill();
    }
  }

  /** Arena rim, faint grid and corner brackets: the field has an edge, and it reads. */
  function drawFrame(state) {
    const inset = ARENA.inset;
    context.save();
    context.strokeStyle = COLORS.grid;
    context.lineWidth = 1;
    context.beginPath();
    for (let x = inset + 60; x < ARENA.width - inset; x += 96) {
      context.moveTo(x, inset);
      context.lineTo(x, ARENA.height - inset);
    }
    for (let y = inset + 60; y < ARENA.height - inset; y += 96) {
      context.moveTo(inset, y);
      context.lineTo(ARENA.width - inset, y);
    }
    context.stroke();

    context.strokeStyle = COLORS.rim;
    context.lineWidth = 2;
    context.strokeRect(inset, inset, ARENA.width - inset * 2, ARENA.height - inset * 2);

    const bracket = 26;
    context.strokeStyle = 'rgba(125, 249, 255, 0.75)';
    context.lineWidth = 3;
    const corners = [
      [inset, inset, 1, 1],
      [ARENA.width - inset, inset, -1, 1],
      [inset, ARENA.height - inset, 1, -1],
      [ARENA.width - inset, ARENA.height - inset, -1, -1],
    ];
    for (const [x, y, dx, dy] of corners) {
      context.beginPath();
      context.moveTo(x + dx * bracket, y);
      context.lineTo(x, y);
      context.lineTo(x, y + dy * bracket);
      context.stroke();
    }
    context.restore();
  }

  function drawShip(state) {
    const ship = state.ship;
    if (state.phase === 'lost' && ship.hull <= 0) return;
    const flicker = ship.invulnerable > 0 && Math.floor(state.time * 18) % 2 === 0;
    const alpha = flicker ? 0.55 : 1;

    // A tight white halo: bright enough to find the skiff, not so wide it washes out the field.
    context.save();
    context.globalCompositeOperation = 'lighter';
    context.globalAlpha = 0.45 * alpha;
    context.drawImage(glow('#ffffff', 34), ship.x - 34, ship.y - 34);
    context.restore();

    // Trail: oldest sample first, fading and thinning toward the tail.
    if (ship.trailFilled) {
      context.save();
      context.globalCompositeOperation = 'lighter';
      context.lineCap = 'round';
      const count = SHIP.trailCount;
      for (let age = count - 1; age > 0; age -= 1) {
        const head = (ship.trailHead - age + count * 2) % count;
        const next = (head + 1) % count;
        const x1 = ship.trail[head * 2];
        const y1 = ship.trail[head * 2 + 1];
        const x2 = ship.trail[next * 2];
        const y2 = ship.trail[next * 2 + 1];
        if (x1 === 0 && y1 === 0) continue;
        // A dash leaves a long jump between two samples: skip it rather than draw a tether.
        if (Math.abs(x1 - x2) + Math.abs(y1 - y2) > 46) continue;
        const fade = 1 - age / count;
        context.strokeStyle = `rgba(86, 232, 255, ${0.3 * fade * fade})`;
        context.lineWidth = 7 * fade;
        context.beginPath();
        context.moveTo(x1, y1);
        context.lineTo(x2, y2);
        context.stroke();
      }
      context.restore();
    }

    // Twin engine flames: a mining skiff has two thrusters, and that reads at a glance.
    const flameLength = 14 + ship.thrust * 26 + Math.sin(state.time * 42) * 3;
    context.save();
    context.globalCompositeOperation = 'lighter';
    context.translate(ship.x, ship.y);
    context.rotate(ship.angle);
    for (const nozzle of [-8, 8]) {
      const flame = context.createLinearGradient(-16, nozzle, -16 - flameLength, nozzle);
      flame.addColorStop(0, 'rgba(220, 254, 255, 0.95)');
      flame.addColorStop(0.4, 'rgba(86, 232, 255, 0.5)');
      flame.addColorStop(1, 'rgba(86, 232, 255, 0)');
      context.fillStyle = flame;
      context.beginPath();
      context.moveTo(-16, nozzle - 5);
      context.lineTo(-16 - flameLength, nozzle);
      context.lineTo(-16, nozzle + 5);
      context.closePath();
      context.fill();
    }
    context.restore();

    // The skiff: a broad white hull with two cargo pods and a canopy — nothing like the darts.
    context.save();
    context.translate(ship.x, ship.y);
    context.rotate(ship.angle);
    context.globalAlpha = alpha;

    context.beginPath();
    context.moveTo(-6, -19);
    context.lineTo(10, -15);
    context.lineTo(10, 15);
    context.lineTo(-6, 19);
    context.closePath();
    context.fillStyle = 'rgba(20, 48, 66, 0.95)';
    context.fill();
    context.strokeStyle = COLORS.shipLine;
    context.lineWidth = 1.6;
    context.stroke();

    context.beginPath();
    context.moveTo(30, 0);
    context.lineTo(12, -13);
    context.lineTo(-14, -12);
    context.lineTo(-14, 12);
    context.lineTo(12, 13);
    context.closePath();
    context.fillStyle = '#f6feff';
    context.fill();
    context.strokeStyle = COLORS.shipLine;
    context.lineWidth = 2.2;
    context.stroke();

    // Canopy and nose stripe.
    context.beginPath();
    context.moveTo(9, 0);
    context.lineTo(2, -6);
    context.lineTo(-6, 0);
    context.lineTo(2, 6);
    context.closePath();
    context.fillStyle = '#0b2b3d';
    context.fill();
    context.strokeStyle = 'rgba(125, 249, 255, 0.9)';
    context.lineWidth = 1;
    context.stroke();
    context.beginPath();
    context.moveTo(22, 0);
    context.lineTo(14, 0);
    context.strokeStyle = 'rgba(86, 232, 255, 0.9)';
    context.lineWidth = 2;
    context.stroke();
    context.restore();

    // Shield ring: visible only while the skiff has grace, so invulnerability is legible.
    if (ship.invulnerable > 0 && ship.dashTimer <= 0) {
      const pulse = 0.35 + 0.3 * Math.sin(state.time * 24);
      context.save();
      context.strokeStyle = `rgba(125, 249, 255, ${pulse})`;
      context.lineWidth = 2.5;
      context.beginPath();
      context.arc(ship.x, ship.y, ship.radius + 16 + Math.sin(state.time * 12) * 1.5, 0, TAU);
      context.stroke();
      context.restore();
    }
    if (ship.dashTimer > 0) {
      context.save();
      context.globalCompositeOperation = 'lighter';
      context.strokeStyle = `rgba(125, 249, 255, ${0.55 * (ship.dashTimer / SHIP.dashTime)})`;
      context.lineWidth = 4;
      context.beginPath();
      context.arc(ship.x, ship.y, ship.radius + 20, 0, TAU);
      context.stroke();
      context.restore();
    }
  }

  function drawBullets(state) {
    context.save();
    context.globalCompositeOperation = 'lighter';
    context.lineCap = 'round';
    for (let index = 0; index < state.bullets.length; index += 1) {
      const bullet = state.bullets[index];
      if (!bullet.active) continue;
      const friendly = bullet.owner === 0;
      const color = friendly ? COLORS.bullet : COLORS.enemyBullet;
      if (friendly) {
        // A long bright streak with a hot head: the skiff's shots are the busiest shape on screen.
        const tail = 16;
        const speed = Math.hypot(bullet.vx, bullet.vy) || 1;
        const tailX = bullet.x - (bullet.vx / speed) * tail;
        const tailY = bullet.y - (bullet.vy / speed) * tail;
        context.strokeStyle = 'rgba(180, 250, 255, 0.32)';
        context.lineWidth = 6;
        context.beginPath();
        context.moveTo(tailX, tailY);
        context.lineTo(bullet.x, bullet.y);
        context.stroke();
        context.strokeStyle = 'rgba(255, 255, 255, 0.95)';
        context.lineWidth = 2.6;
        context.beginPath();
        context.moveTo(tailX, tailY);
        context.lineTo(bullet.x, bullet.y);
        context.stroke();
        context.globalAlpha = 0.8;
        context.drawImage(glow(color, 16), bullet.x - 16, bullet.y - 16);
        context.globalAlpha = 1;
      } else {
        const speed = Math.hypot(bullet.vx, bullet.vy) || 1;
        const tailX = bullet.x - (bullet.vx / speed) * 14;
        const tailY = bullet.y - (bullet.vy / speed) * 14;
        context.strokeStyle = 'rgba(255, 92, 114, 0.55)';
        context.lineWidth = 8;
        context.beginPath();
        context.moveTo(tailX, tailY);
        context.lineTo(bullet.x, bullet.y);
        context.stroke();
        context.strokeStyle = 'rgba(255, 214, 222, 0.85)';
        context.lineWidth = 3;
        context.beginPath();
        context.moveTo(tailX, tailY);
        context.lineTo(bullet.x, bullet.y);
        context.stroke();
        context.globalAlpha = 0.9;
        context.drawImage(glow(color, 26), bullet.x - 26, bullet.y - 26);
        context.globalAlpha = 1;
        context.fillStyle = '#fff4f6';
        context.beginPath();
        context.arc(bullet.x, bullet.y, 4.2, 0, TAU);
        context.fill();
      }
    }
    context.restore();
  }

  function drawCrystals(state) {
    context.save();
    for (let index = 0; index < state.crystals.length; index += 1) {
      const crystal = state.crystals[index];
      if (!crystal.active) continue;
      const bob = Math.sin(state.time * 2.4 + crystal.phase) * 3;
      const fade = crystal.life < 3 ? 0.4 + 0.6 * Math.abs(Math.sin(crystal.life * 5)) : 1;
      const scale = crystal.scale * fade;
      const sprite = glow(COLORS.crystal, 30);
      context.globalCompositeOperation = 'lighter';
      context.globalAlpha = 0.55;
      context.drawImage(sprite, crystal.x - 30, crystal.y + bob - 30);
      context.globalAlpha = 1;
      context.globalCompositeOperation = 'source-over';
      context.save();
      context.translate(crystal.x, crystal.y + bob);
      context.rotate(state.time * crystal.spin + crystal.phase);
      context.scale(scale, scale);
      context.beginPath();
      context.moveTo(0, -13);
      context.lineTo(9, 0);
      context.lineTo(0, 13);
      context.lineTo(-9, 0);
      context.closePath();
      context.fillStyle = hexToRgba(COLORS.crystal, 0.4);
      context.fill();
      context.strokeStyle = COLORS.crystal;
      context.lineWidth = 1.8;
      context.stroke();
      context.beginPath();
      context.moveTo(0, -6);
      context.lineTo(4, 0);
      context.lineTo(0, 6);
      context.lineTo(-4, 0);
      context.closePath();
      context.fillStyle = COLORS.crystalCore;
      context.fill();
      context.restore();
    }
    context.restore();
  }

  function drawSeeker(enemy, state) {
    // Three fading ghosts along its velocity: the seeker reads as fast even in a still frame.
    context.save();
    context.globalCompositeOperation = 'lighter';
    const halo = enemy.radius * 1.8;
    for (let ghost = 1; ghost <= 3; ghost += 1) {
      const gx = enemy.x - enemy.vx * 0.03 * ghost;
      const gy = enemy.y - enemy.vy * 0.03 * ghost;
      context.globalAlpha = 0.22 / ghost;
      context.drawImage(glow(COLORS.seeker, halo), gx - halo, gy - halo);
    }
    context.restore();

    context.save();
    context.translate(enemy.x, enemy.y);
    context.rotate(enemy.angle);
    const bob = 1 + Math.sin(state.time * 6 + enemy.seed) * 0.06;
    context.scale(bob, bob);
    context.beginPath();
    context.moveTo(enemy.radius + 8, 0);
    context.lineTo(-enemy.radius * 0.75, -enemy.radius * 0.95);
    context.lineTo(-enemy.radius * 0.25, 0);
    context.lineTo(-enemy.radius * 0.75, enemy.radius * 0.95);
    context.closePath();
    context.fillStyle = enemy.hurt > 0 ? '#ffffff' : COLORS.seeker;
    context.fill();
    context.strokeStyle = 'rgba(255, 214, 226, 0.9)';
    context.lineWidth = 1.6;
    context.stroke();
    context.beginPath();
    context.arc(enemy.radius * 0.15, 0, 4, 0, TAU);
    context.fillStyle = '#2a0510';
    context.fill();
    context.restore();
  }

  function drawTurret(enemy, state) {
    context.save();
    const halo = enemy.radius * 2;
    context.globalCompositeOperation = 'lighter';
    context.globalAlpha = 0.35;
    context.drawImage(glow(COLORS.turret, halo), enemy.x - halo, enemy.y - halo);
    context.restore();

    context.save();
    context.translate(enemy.x, enemy.y);
    context.rotate(state.time * 0.6);
    context.beginPath();
    for (let side = 0; side < 6; side += 1) {
      const angle = (side / 6) * TAU;
      const x = Math.cos(angle) * enemy.radius;
      const y = Math.sin(angle) * enemy.radius;
      if (side === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.closePath();
    context.fillStyle = enemy.hurt > 0 ? '#ffffff' : 'rgba(52, 16, 8, 0.92)';
    context.fill();
    context.strokeStyle = COLORS.turret;
    context.lineWidth = 2.6;
    context.stroke();
    context.restore();

    context.save();
    context.translate(enemy.x, enemy.y);
    context.rotate(enemy.angle);
    context.fillStyle = enemy.hurt > 0 ? '#ffffff' : COLORS.turret;
    context.fillRect(0, -4.5, enemy.radius + 14, 9);
    context.fillStyle = 'rgba(30, 8, 4, 0.9)';
    context.fillRect(2, -2, enemy.radius + 8, 4);
    context.beginPath();
    context.arc(0, 0, 6.5, 0, TAU);
    context.fillStyle = '#ffd9a8';
    context.fill();
    context.strokeStyle = '#ff5a2a';
    context.lineWidth = 2;
    context.stroke();
    context.restore();
  }

  function drawSplitter(enemy, state) {
    const pulse = 1 + Math.sin(state.time * 4 + enemy.seed) * 0.08;
    context.save();
    context.translate(enemy.x, enemy.y);
    context.beginPath();
    for (let side = 0; side < 3; side += 1) {
      const angle = (side / 3) * TAU + state.time * 0.8;
      const radius = enemy.radius * pulse;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (side === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.closePath();
    context.fillStyle = enemy.hurt > 0 ? '#ffffff' : hexToRgba(COLORS.splitter, 0.55);
    context.fill();
    context.strokeStyle = COLORS.splitter;
    context.lineWidth = 2;
    context.stroke();
    context.beginPath();
    context.arc(0, 0, enemy.radius * 0.4 * pulse, 0, TAU);
    context.strokeStyle = '#e8d8ff';
    context.lineWidth = 1.6;
    context.stroke();
    context.restore();
  }

  function drawAsteroid(enemy) {
    context.save();
    context.translate(enemy.x, enemy.y);
    context.rotate(enemy.angle);
    const sides = 9;
    context.beginPath();
    for (let side = 0; side < sides; side += 1) {
      const angle = (side / sides) * TAU;
      const wobble = 0.72 + ((Math.sin(enemy.seed * 12.9898 + side * 78.233) * 43758.5453) % 1 + 1) % 1 * 0.4;
      const radius = enemy.radius * wobble;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (side === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.closePath();
    context.fillStyle = enemy.hurt > 0 ? '#ffffff' : 'rgba(62, 73, 96, 0.98)';
    context.fill();
    context.strokeStyle = '#c2cce0';
    context.lineWidth = 1.8;
    context.stroke();
    context.beginPath();
    context.arc(-enemy.radius * 0.3, -enemy.radius * 0.2, enemy.radius * 0.18, 0, TAU);
    context.fillStyle = 'rgba(20, 24, 34, 0.8)';
    context.fill();
    context.restore();
  }

  function drawBoss(enemy, state) {
    const boss = enemy;
    const phaseColor = boss.phase === 0 ? COLORS.boss : boss.phase === 1 ? '#ff5cd2' : '#ffb347';
    const pulse = 1 + Math.sin(state.time * 3.4) * 0.03;

    context.save();
    context.globalCompositeOperation = 'lighter';
    const halo = glow(phaseColor, boss.radius * 2.4);
    context.globalAlpha = 0.5;
    context.drawImage(halo, boss.x - boss.radius * 2.4, boss.y - boss.radius * 2.4);
    context.globalAlpha = 1;
    context.restore();

    context.save();
    context.translate(boss.x, boss.y);
    // Outer counter-rotating ring of armour plates.
    context.rotate(-state.time * 0.5);
    for (let plate = 0; plate < 6; plate += 1) {
      context.save();
      context.rotate((plate / 6) * TAU);
      context.fillStyle = boss.hurt > 0 ? '#ffffff' : 'rgba(40, 8, 22, 0.95)';
      context.strokeStyle = phaseColor;
      context.lineWidth = 2.4;
      context.beginPath();
      context.moveTo(boss.radius * 0.62, -boss.radius * 0.42);
      context.lineTo(boss.radius * 1.12, -boss.radius * 0.18);
      context.lineTo(boss.radius * 1.12, boss.radius * 0.18);
      context.lineTo(boss.radius * 0.62, boss.radius * 0.42);
      context.closePath();
      context.fill();
      context.stroke();
      context.restore();
    }
    context.restore();

    context.save();
    context.translate(boss.x, boss.y);
    context.rotate(state.time * 0.9);
    context.beginPath();
    context.arc(0, 0, boss.radius * 0.72 * pulse, 0, TAU);
    context.strokeStyle = hexToRgba(phaseColor, 0.8);
    context.lineWidth = 3;
    context.stroke();
    for (let spike = 0; spike < 3; spike += 1) {
      context.save();
      context.rotate((spike / 3) * TAU);
      context.beginPath();
      context.moveTo(boss.radius * 0.55, -7);
      context.lineTo(boss.radius * 1.3, 0);
      context.lineTo(boss.radius * 0.55, 7);
      context.closePath();
      context.fillStyle = hexToRgba(phaseColor, 0.3);
      context.fill();
      context.strokeStyle = phaseColor;
      context.lineWidth = 1.4;
      context.stroke();
      context.restore();
    }
    context.restore();

    // The eye: it aims at the skiff, and it flashes before it commits to something.
    context.save();
    context.translate(boss.x, boss.y);
    context.rotate(boss.angle);
    const eyeLength = boss.phase === 2 && boss.charging ? boss.radius * 1.5 : boss.radius * 0.95;
    context.beginPath();
    context.moveTo(eyeLength, 0);
    context.lineTo(0, -boss.radius * 0.36);
    context.lineTo(0, boss.radius * 0.36);
    context.closePath();
    context.fillStyle = hexToRgba(phaseColor, 0.5);
    context.fill();
    context.beginPath();
    context.arc(0, 0, boss.radius * 0.3, 0, TAU);
    context.fillStyle = COLORS.bossCore;
    context.fill();
    context.strokeStyle = '#fff4d0';
    context.lineWidth = 1.6;
    context.stroke();
    context.restore();

    // Charging telegraph: a bright line to where it will go, and a trembling hull.
    if (boss.phase === 2 && !boss.charging && boss.phaseTimer < ENEMY.boss.chargeWarmup) {
      context.save();
      context.globalCompositeOperation = 'lighter';
      context.strokeStyle = `rgba(255, 179, 71, ${0.25 + 0.25 * Math.sin(state.time * 30)})`;
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(boss.x, boss.y);
      context.lineTo(boss.chargeX, boss.chargeY);
      context.stroke();
      context.restore();
    }

    // Beam: a warm-up line that thickens, then a live bar with a white core.
    if (boss.phase === 1 && (boss.beamActive || boss.beamWarm > 0)) {
      const length = 1700;
      const endX = boss.x + Math.cos(boss.beamAngle) * length;
      const endY = boss.y + Math.sin(boss.beamAngle) * length;
      context.save();
      context.globalCompositeOperation = 'lighter';
      context.lineCap = 'round';
      if (boss.beamActive) {
        context.strokeStyle = 'rgba(255, 47, 107, 0.32)';
        context.lineWidth = 34;
        context.beginPath();
        context.moveTo(boss.x, boss.y);
        context.lineTo(endX, endY);
        context.stroke();
        context.strokeStyle = 'rgba(255, 120, 160, 0.7)';
        context.lineWidth = 13;
        context.beginPath();
        context.moveTo(boss.x, boss.y);
        context.lineTo(endX, endY);
        context.stroke();
        context.strokeStyle = 'rgba(255, 245, 250, 0.95)';
        context.lineWidth = 4.5;
        context.beginPath();
        context.moveTo(boss.x, boss.y);
        context.lineTo(endX, endY);
        context.stroke();
      } else {
        context.strokeStyle = `rgba(255, 47, 107, ${0.12 + boss.beamWarm * 0.4})`;
        context.lineWidth = 1 + boss.beamWarm * 5;
        context.beginPath();
        context.moveTo(boss.x, boss.y);
        context.lineTo(endX, endY);
        context.stroke();
      }
      context.restore();
    }
  }

  function drawEnemies(state) {
    for (let index = 0; index < state.enemies.length; index += 1) {
      const enemy = state.enemies[index];
      if (!enemy.active) continue;
      if (enemy.kind === KIND_BOSS) drawBoss(enemy, state);
      else if (enemy.kind === KIND_TURRET) drawTurret(enemy, state);
      else if (enemy.kind === KIND_SPLITTER) drawSplitter(enemy, state);
      else if (enemy.kind === KIND_ASTEROID) drawAsteroid(enemy, state);
      else if (enemy.kind === KIND_SHARD) {
        context.save();
        context.translate(enemy.x, enemy.y);
        context.rotate(enemy.angle);
        context.beginPath();
        context.moveTo(enemy.radius + 3, 0);
        context.lineTo(-enemy.radius * 0.7, -enemy.radius * 0.8);
        context.lineTo(-enemy.radius * 0.7, enemy.radius * 0.8);
        context.closePath();
        context.fillStyle = enemy.hurt > 0 ? '#ffffff' : COLORS.shard;
        context.fill();
        context.strokeStyle = '#f0e4ff';
        context.lineWidth = 1;
        context.stroke();
        context.restore();
      } else if (enemy.kind === KIND_SEEKER) drawSeeker(enemy, state);
    }
  }

  function drawParticles(state) {
    context.save();
    context.globalCompositeOperation = 'lighter';
    for (let index = 0; index < state.particles.length; index += 1) {
      const particle = state.particles[index];
      if (!particle.active) continue;
      const life = particle.life / particle.maxLife;
      const color = PARTICLE_COLORS[particle.color] ?? PARTICLE_COLORS[0];
      const fade = Math.max(0, life);
      if (particle.kind === PARTICLE_SPARK) {
        const tailX = particle.x - particle.vx * 0.018;
        const tailY = particle.y - particle.vy * 0.018;
        context.strokeStyle = rgba(color, fade * 0.9);
        context.lineWidth = particle.size * (0.4 + life * 0.6);
        context.lineCap = 'round';
        context.beginPath();
        context.moveTo(tailX, tailY);
        context.lineTo(particle.x, particle.y);
        context.stroke();
      } else if (particle.kind === PARTICLE_SMOKE) {
        context.globalAlpha = life * 0.22;
        const radius = particle.size * (2.2 - life);
        context.fillStyle = color;
        context.beginPath();
        context.arc(particle.x, particle.y, radius, 0, TAU);
        context.fill();
        context.globalAlpha = 1;
      } else if (particle.kind === PARTICLE_RING) {
        const progress = 1 - life;
        context.strokeStyle = rgba(color, fade * 0.7);
        context.lineWidth = 1.5 + life * 3;
        context.beginPath();
        context.arc(particle.x, particle.y, particle.size * (0.2 + progress * 0.9), 0, TAU);
        context.stroke();
      } else if (particle.kind === PARTICLE_SHARD) {
        context.save();
        context.translate(particle.x, particle.y);
        context.rotate(particle.angle);
        context.fillStyle = rgba(color, fade * 0.8);
        context.fillRect(-particle.size, -particle.size * 0.4, particle.size * 2, particle.size * 0.8);
        context.restore();
      }
    }
    context.restore();
  }

  function drawPopups(state) {
    context.save();
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = '700 16px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
    for (let index = 0; index < state.popups.length; index += 1) {
      const popup = state.popups[index];
      if (!popup.active) continue;
      const alpha = Math.min(1, popup.life / popup.maxLife + 0.2);
      context.fillStyle = `rgba(255, 233, 168, ${alpha})`;
      context.fillText(popup.text, popup.x, popup.y);
    }
    context.restore();
  }

  function drawOverlays(state) {
    context.drawImage(vignette, 0, 0);
    if (state.ship.hurt > 0) {
      context.save();
      context.globalAlpha = Math.min(0.85, state.ship.hurt * 1.4);
      context.drawImage(hurtVignette, 0, 0);
      context.restore();
    }
    if (state.flash > 0) {
      context.save();
      context.globalAlpha = Math.min(0.55, state.flash * 0.7);
      context.fillStyle = '#dff6ff';
      context.fillRect(0, 0, ARENA.width, ARENA.height);
      context.restore();
    }
    if (state.phase === 'lost') {
      // A light blood wash, not a blackout: the summary screen has to sit over a readable battle.
      context.save();
      context.globalAlpha = 0.16;
      context.fillStyle = '#2a0410';
      context.fillRect(0, 0, ARENA.width, ARENA.height);
      context.restore();
    }
  }

  function drawWorld(state) {
    drawStars(state);
    drawFrame(state);
    drawCrystals(state);
    drawEnemies(state);
    drawBullets(state);
    drawShip(state);
    drawParticles(state);
    drawPopups(state);
    drawOverlays(state);
  }

  resize();
  window.addEventListener('resize', resize);
  return { drawWorld, beginFrame, resize, toArena, view, context };
}
