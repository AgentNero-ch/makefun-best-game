// The things in the world and how each one moves: the skiff's momentum and dash, its shots, the
// drone kinds, drifting asteroids, ion crystals and the particle spray. Everything is pooled and
// preallocated — a long run creates no objects, only reuses slots — and nothing here draws or
// plays a sound. Combat (who hit whom) lives in combat.js; the boss brain lives in waves.js.
import { ARENA, BULLET, CRYSTAL, ENEMY, HULL_MAX, PARTICLE, POOLS, SHIP } from './config.js';
import { randomRange } from './rng.js';

export const KIND_SEEKER = 0;
export const KIND_TURRET = 1;
export const KIND_SPLITTER = 2;
export const KIND_SHARD = 3;
export const KIND_ASTEROID = 4;
export const KIND_BOSS = 5;

export const OWNER_PLAYER = 0;
export const OWNER_ENEMY = 1;

export const PARTICLE_SPARK = 0;
export const PARTICLE_SMOKE = 1;
export const PARTICLE_RING = 2;
export const PARTICLE_SHARD = 3;

export const EVENT_FIRE = 1;
export const EVENT_DASH = 2;
export const EVENT_PICKUP = 4;
export const EVENT_SHOT_HIT = 8;
export const EVENT_KILL = 16;
export const EVENT_HULL = 32;
export const EVENT_WAVE = 64;
export const EVENT_BOSS_PHASE = 128;
export const EVENT_WIN = 256;
export const EVENT_OVER = 512;

const TAU = Math.PI * 2;

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

/** Wrap an angle into (-pi, pi]. */
export function wrapAngle(value) {
  let angle = value % TAU;
  if (angle > Math.PI) angle -= TAU;
  else if (angle <= -Math.PI) angle += TAU;
  return angle;
}

/** Shortest-path angle interpolation, `t` in [0, 1]. */
export function angleTowards(from, to, t) {
  return from + wrapAngle(to - from) * t;
}

export function createShip() {
  return {
    x: ARENA.width / 2,
    y: ARENA.height / 2,
    vx: 0,
    vy: 0,
    angle: -Math.PI / 2,
    radius: SHIP.radius,
    hull: HULL_MAX,
    invulnerable: 0,
    fireTimer: 0,
    dashTimer: 0,
    dashCooldown: 0,
    hurt: 0,
    thrust: 0,
    /** Recent positions, newest at trailHead: x at slot*2, y at slot*2+1. */
    trail: new Float32Array(SHIP.trailCount * 2),
    trailHead: 0,
    trailTimer: 0,
    trailFilled: false,
  };
}

export function resetShip(ship) {
  ship.x = ARENA.width / 2;
  ship.y = ARENA.height / 2;
  ship.vx = 0;
  ship.vy = 0;
  ship.angle = -Math.PI / 2;
  ship.hull = HULL_MAX;
  ship.invulnerable = 1.2;
  ship.fireTimer = 0;
  ship.dashTimer = 0;
  ship.dashCooldown = 0;
  ship.hurt = 0;
  ship.thrust = 0;
  ship.trail.fill(0);
  ship.trailHead = 0;
  ship.trailTimer = 0;
  ship.trailFilled = false;
}

function createBullet() {
  return {
    active: false,
    owner: OWNER_PLAYER,
    x: 0,
    y: 0,
    prevX: 0,
    prevY: 0,
    vx: 0,
    vy: 0,
    life: 0,
    radius: 3,
    damage: 1,
    hue: 0,
  };
}

function createEnemy() {
  return {
    active: false,
    kind: KIND_SEEKER,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    radius: 12,
    hp: 1,
    maxHp: 1,
    speed: 100,
    accel: 400,
    drag: 1,
    value: 100,
    damage: 1,
    angle: 0,
    spin: 0,
    fireTimer: 0,
    burst: 0,
    burstTimer: 0,
    age: 0,
    hurt: 0,
    seed: 0,
    generation: 0,
    /* Boss only. */
    phase: 0,
    phaseTimer: 0,
    phaseAge: 0,
    beamAngle: 0,
    beamActive: false,
    beamWarm: 0,
    spawnAngles: 0,
    charging: false,
    chargeX: 0,
    chargeY: 0,
  };
}

function createCrystal() {
  return { active: false, x: 0, y: 0, vx: 0, vy: 0, phase: 0, spin: 0, age: 0, life: 0, scale: 1 };
}

function createParticle() {
  return { active: false, kind: PARTICLE_SPARK, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, size: 2, color: 0, spin: 0, angle: 0, drag: 0 };
}

function createPopup() {
  return { active: false, x: 0, y: 0, vy: 0, life: 0, maxLife: 1, text: '' };
}

function freeSlot(pool) {
  for (let index = 0; index < pool.length; index += 1) if (!pool[index].active) return pool[index];
  return null;
}

/** Fill a fresh state's pools. Called once per world; reset() deactivates them in place. */
export function createPools() {
  const bullets = [];
  for (let index = 0; index < POOLS.bullets; index += 1) bullets.push(createBullet());
  const enemies = [];
  for (let index = 0; index < POOLS.enemies; index += 1) enemies.push(createEnemy());
  const crystals = [];
  for (let index = 0; index < POOLS.crystals; index += 1) crystals.push(createCrystal());
  const particles = [];
  for (let index = 0; index < POOLS.particles; index += 1) particles.push(createParticle());
  const popups = [];
  for (let index = 0; index < POOLS.popups; index += 1) popups.push(createPopup());
  return { bullets, enemies, crystals, particles, popups };
}

export function spawnBullet(state, x, y, vx, vy, owner, damage) {
  const bullet = freeSlot(state.bullets);
  if (bullet === null) return null;
  bullet.active = true;
  bullet.owner = owner;
  bullet.x = x;
  bullet.y = y;
  bullet.prevX = x;
  bullet.prevY = y;
  bullet.vx = vx;
  bullet.vy = vy;
  bullet.damage = damage;
  bullet.radius = owner === OWNER_PLAYER ? BULLET.playerRadius : BULLET.enemyRadius;
  bullet.life = owner === OWNER_PLAYER ? SHIP.bulletLife : 5.5;
  bullet.hue = owner === OWNER_PLAYER ? 0 : 1;
  return bullet;
}

export function spawnParticle(state, kind, x, y, vx, vy, life, size, color) {
  const particle = freeSlot(state.particles);
  if (particle === null) return null;
  particle.active = true;
  particle.kind = kind;
  particle.x = x;
  particle.y = y;
  particle.vx = vx;
  particle.vy = vy;
  particle.life = life;
  particle.maxLife = life;
  particle.size = size;
  particle.color = color;
  particle.angle = Math.atan2(vy, vx);
  particle.spin = 0;
  particle.drag = kind === PARTICLE_SMOKE ? 1.4 : 2.6;
  return particle;
}

/** A radial spray of sparks or smoke; `speed` is the outward speed of the fastest particle. */
export function spawnBurst(state, x, y, color, count, speed, kind) {
  const random = state.random;
  for (let index = 0; index < count; index += 1) {
    const direction = random() * TAU;
    const velocity = speed * (0.25 + random() * 0.75);
    const life = kind === PARTICLE_SMOKE ? randomRange(random, 0.5, PARTICLE.smokeLife) : randomRange(random, 0.22, PARTICLE.sparkLife);
    const size = kind === PARTICLE_SMOKE ? randomRange(random, 3.5, 8) : randomRange(random, 2, 4.6);
    spawnParticle(state, kind, x, y, Math.cos(direction) * velocity, Math.sin(direction) * velocity, life, size, color);
  }
}

/** An expanding ring, for a kill or a dash: the readable "something happened here" shape. */
export function spawnRing(state, x, y, color, size, life) {
  const ring = spawnParticle(state, PARTICLE_RING, x, y, 0, 0, life, size, color);
  if (ring !== null) ring.drag = 0;
  return ring;
}

export function spawnPopup(state, x, y, text) {
  // Stacked rewards would sit on top of each other: lift a new popup clear of any close one.
  let offset = 0;
  for (let index = 0; index < state.popups.length; index += 1) {
    const other = state.popups[index];
    if (!other.active) continue;
    if (Math.abs(other.x - x) < 72 && Math.abs(other.y - (y - offset)) < 26) offset += 26;
  }
  const popup = freeSlot(state.popups);
  if (popup === null) return;
  popup.active = true;
  popup.x = x;
  popup.y = y - offset;
  popup.vy = -34;
  popup.life = 0.9;
  popup.maxLife = 0.9;
  popup.text = text;
}

export function spawnCrystal(state, x, y) {
  const crystal = freeSlot(state.crystals);
  if (crystal === null) return null;
  const random = state.random;
  crystal.active = true;
  crystal.x = clamp(x, ARENA.inset + 40, ARENA.width - ARENA.inset - 40);
  crystal.y = clamp(y, ARENA.inset + 40, ARENA.height - ARENA.inset - 40);
  crystal.vx = randomRange(random, -CRYSTAL.drift, CRYSTAL.drift);
  crystal.vy = randomRange(random, -CRYSTAL.drift, CRYSTAL.drift);
  crystal.phase = random() * TAU;
  crystal.spin = randomRange(random, -1.4, 1.4);
  crystal.age = 0;
  crystal.life = CRYSTAL.lifespan;
  crystal.scale = 0;
  return crystal;
}

/** Spawn one drone of `kind` at (x, y). Returns the pooled enemy, or null when the pool is full. */
export function spawnEnemy(state, kind, x, y) {
  const enemy = freeSlot(state.enemies);
  if (enemy === null) return null;
  const random = state.random;
  enemy.active = true;
  enemy.kind = kind;
  enemy.x = x;
  enemy.y = y;
  enemy.vx = 0;
  enemy.vy = 0;
  enemy.angle = randomRange(random, -Math.PI, Math.PI);
  enemy.spin = 0;
  enemy.fireTimer = randomRange(random, 0.6, 1.4);
  enemy.age = 0;
  enemy.hurt = 0;
  enemy.seed = random() * TAU;
  enemy.generation = 0;
  enemy.phase = 0;
  enemy.phaseTimer = 0;
  enemy.phaseAge = 0;
  enemy.beamActive = false;
  enemy.beamWarm = 0;
  switch (kind) {
    case KIND_TURRET:
      enemy.radius = ENEMY.turret.radius;
      enemy.hp = ENEMY.turret.hp;
      enemy.speed = ENEMY.turret.speed;
      enemy.value = ENEMY.turret.value;
      enemy.damage = ENEMY.turret.damage;
      break;
    case KIND_SPLITTER:
      enemy.radius = ENEMY.splitter.radius;
      enemy.hp = ENEMY.splitter.hp;
      enemy.speed = ENEMY.splitter.speed;
      enemy.accel = ENEMY.splitter.accel;
      enemy.drag = ENEMY.splitter.drag;
      enemy.value = ENEMY.splitter.value;
      enemy.damage = ENEMY.splitter.damage;
      break;
    case KIND_SHARD:
      enemy.radius = ENEMY.shard.radius;
      enemy.hp = ENEMY.shard.hp;
      enemy.speed = ENEMY.shard.speed;
      enemy.accel = ENEMY.shard.accel;
      enemy.drag = ENEMY.shard.drag;
      enemy.value = ENEMY.shard.value;
      enemy.damage = ENEMY.shard.damage;
      break;
    case KIND_BOSS:
      enemy.radius = ENEMY.boss.radius;
      enemy.hp = ENEMY.boss.hp;
      enemy.value = ENEMY.boss.value;
      enemy.damage = ENEMY.boss.damage;
      enemy.angle = Math.PI / 2;
      break;
    default:
      enemy.radius = ENEMY.seeker.radius;
      enemy.hp = ENEMY.seeker.hp;
      enemy.speed = ENEMY.seeker.speed;
      enemy.accel = ENEMY.seeker.accel;
      enemy.drag = ENEMY.seeker.drag;
      enemy.value = ENEMY.seeker.value;
      enemy.damage = ENEMY.seeker.damage;
      break;
  }
  enemy.maxHp = enemy.hp;
  return enemy;
}

/** A tumbling rock, thrown in from off-screen on a chord across the arena. */
export function spawnAsteroid(state, x, y, vx, vy, radius) {
  const enemy = spawnEnemy(state, KIND_ASTEROID, x, y);
  if (enemy === null) return null;
  const random = state.random;
  enemy.radius = radius;
  enemy.hp = Math.round(ENEMY.asteroid.hp * (radius / 24));
  enemy.maxHp = enemy.hp;
  enemy.vx = vx;
  enemy.vy = vy;
  enemy.spin = randomRange(random, -ENEMY.asteroid.spin, ENEMY.asteroid.spin);
  enemy.angle = random() * TAU;
  enemy.value = ENEMY.asteroid.value;
  return enemy;
}

/** The skiff: thrust with drag, a dash burst, clamped to the arena, firing from the nose. */
export function updateShip(ship, controls, dt, state) {
  let events = 0;

  if (controls.dash && ship.dashCooldown <= 0 && ship.dashTimer <= 0) {
    const length = Math.hypot(controls.moveX, controls.moveY);
    const dx = length > 0.12 ? controls.moveX / length : Math.cos(ship.angle);
    const dy = length > 0.12 ? controls.moveY / length : Math.sin(ship.angle);
    ship.vx = dx * SHIP.dashSpeed;
    ship.vy = dy * SHIP.dashSpeed;
    ship.dashTimer = SHIP.dashTime;
    ship.dashCooldown = SHIP.dashCooldown;
    ship.invulnerable = Math.max(ship.invulnerable, SHIP.dashInvulnerable);
    ship.hurt = Math.max(ship.hurt, 0.18);
    spawnRing(state, ship.x, ship.y, 0, 26, 0.4);
    events |= EVENT_DASH;
  }

  if (ship.dashTimer > 0) {
    ship.dashTimer = Math.max(0, ship.dashTimer - dt);
    const coast = Math.exp(-1.1 * dt);
    ship.vx *= coast;
    ship.vy *= coast;
  } else {
    ship.vx += controls.moveX * SHIP.accel * dt;
    ship.vy += controls.moveY * SHIP.accel * dt;
    const damp = Math.exp(-SHIP.drag * dt);
    ship.vx *= damp;
    ship.vy *= damp;
    const speed = Math.hypot(ship.vx, ship.vy);
    if (speed > SHIP.maxSpeed) {
      const scale = SHIP.maxSpeed / speed;
      ship.vx *= scale;
      ship.vy *= scale;
    }
  }

  // The engine flame follows the throttle rather than snapping to it.
  const throttle = Math.min(1, Math.hypot(controls.moveX, controls.moveY));
  ship.thrust += (throttle - ship.thrust) * Math.min(1, dt * 10);

  ship.x += ship.vx * dt;
  ship.y += ship.vy * dt;
  const lowX = ARENA.inset + SHIP.radius;
  const highX = ARENA.width - ARENA.inset - SHIP.radius;
  const lowY = ARENA.inset + SHIP.radius;
  const highY = ARENA.height - ARENA.inset - SHIP.radius;
  if (ship.x < lowX) {
    ship.x = lowX;
    ship.vx = Math.abs(ship.vx) * 0.32;
  } else if (ship.x > highX) {
    ship.x = highX;
    ship.vx = -Math.abs(ship.vx) * 0.32;
  }
  if (ship.y < lowY) {
    ship.y = lowY;
    ship.vy = Math.abs(ship.vy) * 0.32;
  } else if (ship.y > highY) {
    ship.y = highY;
    ship.vy = -Math.abs(ship.vy) * 0.32;
  }

  // Aim: lean toward the target angle instead of snapping, so the skiff reads as a vehicle.
  ship.angle = angleTowards(ship.angle, controls.aimAngle, Math.min(1, dt * 16));

  ship.fireTimer = Math.max(0, ship.fireTimer - dt);
  ship.invulnerable = Math.max(0, ship.invulnerable - dt);
  ship.hurt = Math.max(0, ship.hurt - dt);
  ship.dashCooldown = Math.max(0, ship.dashCooldown - dt);

  if (controls.firing && ship.fireTimer <= 0) {
    const cos = Math.cos(ship.angle);
    const sin = Math.sin(ship.angle);
    const speed = SHIP.bulletSpeed;
    spawnBullet(
      state,
      ship.x + cos * SHIP.muzzle,
      ship.y + sin * SHIP.muzzle,
      cos * speed + ship.vx * 0.25,
      sin * speed + ship.vy * 0.25,
      OWNER_PLAYER,
      1,
    );
    spawnParticle(state, PARTICLE_SPARK, ship.x + cos * SHIP.muzzle, ship.y + sin * SHIP.muzzle, cos * 140, sin * 140, 0.14, 3.4, 0);
    ship.vx -= cos * 16;
    ship.vy -= sin * 16;
    ship.fireTimer = SHIP.fireDelay;
    events |= EVENT_FIRE;
  }

  // Sample the trail on a fixed clock, not per frame, so it has the same length at any frame rate.
  ship.trailTimer += dt;
  while (ship.trailTimer >= SHIP.trailStep) {
    ship.trailTimer -= SHIP.trailStep;
    ship.trailHead = (ship.trailHead + 1) % SHIP.trailCount;
    ship.trail[ship.trailHead * 2] = ship.x;
    ship.trail[ship.trailHead * 2 + 1] = ship.y;
    ship.trailFilled = true;
  }

  return events;
}

export function updateBullet(bullet, dt) {
  bullet.prevX = bullet.x;
  bullet.prevY = bullet.y;
  bullet.x += bullet.vx * dt;
  bullet.y += bullet.vy * dt;
  bullet.life -= dt;
  if (bullet.life <= 0) bullet.active = false;
  else if (bullet.x < -40 || bullet.x > ARENA.width + 40 || bullet.y < -40 || bullet.y > ARENA.height + 40) bullet.active = false;
}

/** Chase steering shared by seekers, splitters and their shards. */
function steerTowards(enemy, targetX, targetY, dt, wobble) {
  const dx = targetX - enemy.x;
  const dy = targetY - enemy.y;
  const distance = Math.hypot(dx, dy) || 1;
  const angle = Math.atan2(dy, dx) + wobble;
  const desiredX = Math.cos(angle) * enemy.speed;
  const desiredY = Math.sin(angle) * enemy.speed;
  const steerX = desiredX - enemy.vx;
  const steerY = desiredY - enemy.vy;
  const steerLength = Math.hypot(steerX, steerY) || 1;
  const step = Math.min(steerLength, enemy.accel * dt);
  enemy.vx += (steerX / steerLength) * step;
  enemy.vy += (steerY / steerLength) * step;
  const damp = Math.exp(-enemy.drag * dt);
  enemy.vx *= damp;
  enemy.vy *= damp;
  enemy.x += enemy.vx * dt;
  enemy.y += enemy.vy * dt;
  enemy.angle = Math.atan2(enemy.vy, enemy.vx);
  return distance;
}

/** Drones and rocks. The boss has its own brain in waves.js and is skipped here. */
export function updateEnemy(enemy, state, dt) {
  const ship = state.ship;
  enemy.age += dt;
  enemy.hurt = Math.max(0, enemy.hurt - dt);

  switch (enemy.kind) {
    case KIND_TURRET: {
      const dx = ship.x - enemy.x;
      const dy = ship.y - enemy.y;
      enemy.angle = angleTowards(enemy.angle, Math.atan2(dy, dx), Math.min(1, dt * 3.2));
      // Turrets creep, keeping a lazy distance rather than sitting perfectly still.
      const distance = Math.hypot(dx, dy) || 1;
      const push = distance < 320 ? -1 : distance > 520 ? 1 : 0;
      enemy.x += (dx / distance) * push * enemy.speed * dt;
      enemy.y += (dy / distance) * push * enemy.speed * dt;
      enemy.x += Math.cos(enemy.age * 0.9 + enemy.seed) * 14 * dt;
      enemy.y += Math.sin(enemy.age * 1.1 + enemy.seed) * 14 * dt;
      // Turrets fire three-round bursts: a readable, dodgeable volley that fills the lane.
      enemy.fireTimer -= dt;
      enemy.burstTimer -= dt;
      if (enemy.fireTimer <= 0) {
        enemy.burst = 3;
        enemy.burstTimer = 0;
        enemy.fireTimer = ENEMY.turret.fireDelay;
      }
      if (enemy.burst > 0 && enemy.burstTimer <= 0) {
        enemy.burst -= 1;
        enemy.burstTimer = 0.17;
        const lead = distance / ENEMY.turret.bulletSpeed;
        const aimX = ship.x + ship.vx * lead * 0.55;
        const aimY = ship.y + ship.vy * lead * 0.55;
        const shotAngle = Math.atan2(aimY - enemy.y, aimX - enemy.x);
        spawnBullet(state, enemy.x + Math.cos(shotAngle) * 20, enemy.y + Math.sin(shotAngle) * 20, Math.cos(shotAngle) * ENEMY.turret.bulletSpeed, Math.sin(shotAngle) * ENEMY.turret.bulletSpeed, OWNER_ENEMY, 1);
        spawnParticle(state, PARTICLE_SPARK, enemy.x + Math.cos(shotAngle) * 20, enemy.y + Math.sin(shotAngle) * 20, Math.cos(shotAngle) * 120, Math.sin(shotAngle) * 120, 0.2, 5, 2);
        spawnBurst(state, enemy.x + Math.cos(shotAngle) * 20, enemy.y + Math.sin(shotAngle) * 20, 2, 3, 90, PARTICLE_SPARK);
        state.shake = Math.max(state.shake, 1.6);
      }
      break;
    }
    case KIND_ASTEROID:
      enemy.x += enemy.vx * dt;
      enemy.y += enemy.vy * dt;
      enemy.angle += enemy.spin * dt;
      if (enemy.x < ARENA.inset + enemy.radius || enemy.x > ARENA.width - ARENA.inset - enemy.radius) enemy.vx *= -1;
      if (enemy.y < ARENA.inset + enemy.radius || enemy.y > ARENA.height - ARENA.inset - enemy.radius) enemy.vy *= -1;
      break;
    case KIND_SPLITTER: {
      const wobble = Math.sin(enemy.age * 1.6 + enemy.seed) * 0.5;
      steerTowards(enemy, ship.x, ship.y, dt, wobble);
      break;
    }
    case KIND_SHARD: {
      const wobble = Math.sin(enemy.age * 3.1 + enemy.seed) * 0.35;
      steerTowards(enemy, ship.x, ship.y, dt, wobble);
      break;
    }
    default: {
      const wobble = Math.sin(enemy.age * 1.9 + enemy.seed) * 0.45;
      steerTowards(enemy, ship.x, ship.y, dt, wobble);
      break;
    }
  }
}

export function updateCrystal(crystal, dt) {
  crystal.age += dt;
  crystal.life -= dt;
  crystal.x += crystal.vx * dt;
  crystal.y += crystal.vy * dt;
  crystal.vx *= Math.exp(-0.6 * dt);
  crystal.vy *= Math.exp(-0.6 * dt);
  if (crystal.x < ARENA.inset + 24 || crystal.x > ARENA.width - ARENA.inset - 24) crystal.vx *= -1;
  if (crystal.y < ARENA.inset + 24 || crystal.y > ARENA.height - ARENA.inset - 24) crystal.vy *= -1;
  crystal.scale = Math.min(1, crystal.scale + dt * 3);
  if (crystal.life <= 0) crystal.active = false;
}

export function updateParticles(state, dt) {
  const particles = state.particles;
  for (let index = 0; index < particles.length; index += 1) {
    const particle = particles[index];
    if (!particle.active) continue;
    particle.life -= dt;
    if (particle.life <= 0) {
      particle.active = false;
      continue;
    }
    if (particle.drag > 0) {
      const damp = Math.exp(-particle.drag * dt);
      particle.vx *= damp;
      particle.vy *= damp;
    }
    if (particle.kind === PARTICLE_SMOKE) particle.vy -= 26 * dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    if (particle.kind === PARTICLE_SHARD) particle.angle += particle.spin * dt;
  }
}

export function updatePopups(state, dt) {
  const popups = state.popups;
  for (let index = 0; index < popups.length; index += 1) {
    const popup = popups[index];
    if (!popup.active) continue;
    popup.life -= dt;
    popup.y += popup.vy * dt;
    popup.vy *= Math.exp(-2 * dt);
    if (popup.life <= 0) popup.active = false;
  }
}

/** The nearest live target to a point, ignoring rocks unless nothing else is around. */
export function nearestTarget(state, x, y, maxDistance) {
  let best = null;
  let bestDistance = maxDistance * maxDistance;
  for (let index = 0; index < state.enemies.length; index += 1) {
    const enemy = state.enemies[index];
    if (!enemy.active || enemy.kind === KIND_ASTEROID) continue;
    const dx = enemy.x - x;
    const dy = enemy.y - y;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = enemy;
    }
  }
  if (best !== null) return best;
  for (let index = 0; index < state.enemies.length; index += 1) {
    const enemy = state.enemies[index];
    if (!enemy.active) continue;
    const dx = enemy.x - x;
    const dy = enemy.y - y;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = enemy;
    }
  }
  return best;
}

/** The nearest crystal to a point, or null. */
export function nearestCrystal(state, x, y) {
  let best = null;
  let bestDistance = Infinity;
  for (let index = 0; index < state.crystals.length; index += 1) {
    const crystal = state.crystals[index];
    if (!crystal.active) continue;
    const dx = crystal.x - x;
    const dy = crystal.y - y;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = crystal;
    }
  }
  return best;
}

/** The live boss, or null. */
export function findBoss(state) {
  for (let index = 0; index < state.enemies.length; index += 1) {
    const enemy = state.enemies[index];
    if (enemy.active && enemy.kind === KIND_BOSS) return enemy;
  }
  return null;
}

/** How many enemies are alive (rocks excluded: they are scenery with teeth). */
export function countEnemies(state) {
  let count = 0;
  for (let index = 0; index < state.enemies.length; index += 1) {
    const enemy = state.enemies[index];
    if (enemy.active && enemy.kind !== KIND_ASTEROID) count += 1;
  }
  return count;
}

/** Deactivate every enemy, bullet, crystal, particle and popup, in place. */
export function clearPools(state) {
  for (const bullet of state.bullets) bullet.active = false;
  for (const enemy of state.enemies) enemy.active = false;
  for (const crystal of state.crystals) crystal.active = false;
  for (const particle of state.particles) particle.active = false;
  for (const popup of state.popups) popup.active = false;
}
