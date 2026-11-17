// The five waves, the spawn director that paces them, and the Warden's three-phase brain.
// The director owns the clock: it releases each drone at its scheduled second, trickles crystals
// into the arena, and decides when a wave is cleared. Wave five is the boss, and its phases are
// timed by hull: radial bursts, then a sweeping beam, then a charge.
import { ARENA, CRYSTAL, ENEMY, HULL_MAX, SCORE, WAVE } from './config.js';
import {
  EVENT_BOSS_PHASE,
  EVENT_WAVE,
  KIND_BOSS,
  KIND_SEEKER,
  KIND_SPLITTER,
  KIND_TURRET,
  OWNER_ENEMY,
  PARTICLE_SPARK,
  countEnemies,
  findBoss,
  spawnAsteroid,
  spawnBullet,
  spawnBurst,
  spawnCrystal,
  spawnEnemy,
  spawnParticle,
  spawnPopup,
  spawnRing,
} from './entities.js';
import { randomRange } from './rng.js';

const TAU = Math.PI * 2;

/** Extra event bits only the boss raises; main.js maps them to sounds. */
export const EVENT_BOSS_SHOT = 1024;

export const BOSS_RADIAL = 0;
export const BOSS_SWEEP = 1;
export const BOSS_CHARGE = 2;

/** The wave table. `at` is the second, from the wave's start, each drone is released. */
export const WAVES = [
  {
    name: 'DRIFT',
    subtitle: 'Something in the dust has noticed the skiff.',
    groups: [{ kind: KIND_SEEKER, count: 5, every: 0.85, from: 0.8 }],
  },
  {
    name: 'SENTRY',
    subtitle: 'Turrets wake along the rim. Rocks come with them.',
    groups: [
      { kind: KIND_SEEKER, count: 5, every: 0.9, from: 0.6 },
      { kind: KIND_TURRET, count: 2, every: 2.2, from: 1.8 },
      { kind: 'asteroid', count: 3, every: 1.5, from: 1.2 },
    ],
  },
  {
    name: 'FRACTURE',
    subtitle: 'Splitters break into shards. Shoot straight or drown.',
    groups: [
      { kind: KIND_SEEKER, count: 12, every: 0.7, from: 0.4 },
      { kind: KIND_SPLITTER, count: 3, every: 1.7, from: 1.5 },
      { kind: KIND_TURRET, count: 2, every: 2.6, from: 3.2 },
      { kind: 'asteroid', count: 3, every: 1.8, from: 2.0 },
    ],
  },
  {
    name: 'PRESSURE',
    subtitle: 'The nebula closes in. Keep moving, keep collecting.',
    groups: [
      { kind: KIND_SEEKER, count: 6, every: 1.0, from: 0.5 },
      { kind: KIND_SPLITTER, count: 3, every: 1.7, from: 1.5 },
      { kind: KIND_TURRET, count: 2, every: 2.6, from: 3.0 },
      { kind: 'asteroid', count: 2, every: 1.9, from: 1.0 },
    ],
  },
  {
    name: 'THE WARDEN',
    subtitle: 'Something enormous turns toward you.',
    boss: true,
    groups: [{ kind: KIND_SEEKER, count: 3, every: 1.1, from: 1.5 }],
  },
];

/** Expand the groups into one ordered release list per wave, once, at load. */
for (const wave of WAVES) {
  wave.queue = [];
  for (const group of wave.groups) {
    for (let index = 0; index < group.count; index += 1) {
      wave.queue.push({ kind: group.kind, at: group.from + index * group.every });
    }
  }
  wave.queue.sort((a, b) => a.at - b.at);
  wave.count = wave.queue.length;
}

const SPAWN = { distanceMin: 340, distanceMax: 560 };

export function createDirector() {
  return { waveTime: 0, queueIndex: 0, crystalTimer: 1.2 };
}

/**
 * A spawn point on the ring around the skiff, anywhere in the full turn: drones close in from every
 * side, which is what makes a wave feel like an ambush rather than a firing line. Points that would
 * land outside the arena are retried, so a skiff hugging a wall still gets legal spawns.
 */
function pointOnRim(state, clearance) {
  const random = state.random;
  const ship = state.ship;
  const lowX = ARENA.inset + 30;
  const highX = ARENA.width - ARENA.inset - 30;
  const lowY = ARENA.inset + 30;
  const highY = ARENA.height - ARENA.inset - 30;
  for (let attempt = 0; attempt < 14; attempt += 1) {
    const angle = randomRange(random, 0, TAU);
    const distance = randomRange(random, SPAWN.distanceMin, SPAWN.distanceMax);
    const x = ship.x + Math.cos(angle) * distance;
    const y = ship.y + Math.sin(angle) * distance;
    if (x < lowX || x > highX || y < lowY || y > highY) continue;
    if (Math.hypot(x - ship.x, y - ship.y) < clearance) continue;
    return { x, y };
  }
  // Cornered: fall back to the rim point furthest from the skiff.
  const corners = [
    { x: lowX, y: lowY },
    { x: highX, y: lowY },
    { x: lowX, y: highY },
    { x: highX, y: highY },
  ];
  let best = corners[0];
  let bestDistance = -1;
  for (const corner of corners) {
    const distance = Math.hypot(corner.x - ship.x, corner.y - ship.y);
    if (distance > bestDistance) {
      bestDistance = distance;
      best = corner;
    }
  }
  return best;
}

/** Release one drone of `kind` at the rim, flashed in with a ring so it is never a surprise hit. */
function releaseDrone(state, kind) {
  if (kind === 'asteroid') {
    const random = state.random;
    const spot = pointOnRim(state, 260);
    const toCentre = Math.atan2(ARENA.height / 2 - spot.y, ARENA.width / 2 - spot.x) + randomRange(random, -0.5, 0.5);
    const speed = randomRange(random, ENEMY.asteroid.speedMin, ENEMY.asteroid.speedMax);
    const rock = spawnAsteroid(state, spot.x, spot.y, Math.cos(toCentre) * speed, Math.sin(toCentre) * speed, randomRange(random, ENEMY.asteroid.radiusMin, ENEMY.asteroid.radiusMax));
    if (rock !== null) spawnRing(state, rock.x, rock.y, 3, rock.radius * 1.6, 0.5);
    return;
  }
  const spot = pointOnRim(state, 230);
  const enemy = spawnEnemy(state, kind, spot.x, spot.y);
  if (enemy !== null) spawnRing(state, spot.x, spot.y, kind === KIND_TURRET ? 2 : 1, enemy.radius * 2.2, 0.5);
}

/** Set the wave up: name, banner, intro pause, and an empty release cursor. */
export function startWave(state, index) {
  const wave = WAVES[index];
  state.waveIndex = index;
  state.waveName = wave.name;
  state.waveSubtitle = wave.subtitle;
  state.phase = 'intro';
  state.phaseTimer = wave.boss ? WAVE.bossIntro : WAVE.intro;
  state.director.waveTime = 0;
  state.director.queueIndex = 0;
  state.director.crystalTimer = randomRange(state.random, 0.8, 1.6);
  state.banner = {
    title: `WAVE ${index + 1} / 5`,
    text: wave.name,
    sub: wave.subtitle,
    timer: (wave.boss ? WAVE.bossIntro : WAVE.intro) + 1.6,
    total: (wave.boss ? WAVE.bossIntro : WAVE.intro) + 1.6,
    tone: wave.boss ? 2 : 0,
  };
  if (wave.boss) {
    const boss = spawnEnemy(state, KIND_BOSS, ARENA.width / 2, ARENA.inset + 130);
    if (boss !== null) {
      boss.phase = BOSS_RADIAL;
      boss.phaseTimer = 1.6;
      spawnRing(state, boss.x, boss.y, 3, 120, 1.2);
      spawnBurst(state, boss.x, boss.y, 3, 26, 220, 0);
    }
  }
  return EVENT_WAVE;
}

function spawnCrystals(state, dt) {
  const director = state.director;
  director.crystalTimer -= dt;
  if (director.crystalTimer > 0) return;
  const random = state.random;
  director.crystalTimer = randomRange(random, CRYSTAL.spawnMin, CRYSTAL.spawnMax);
  let alive = 0;
  for (const crystal of state.crystals) if (crystal.active) alive += 1;
  if (alive >= CRYSTAL.maxAlive) return;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const x = randomRange(random, ARENA.inset + 90, ARENA.width - ARENA.inset - 90);
    const y = randomRange(random, ARENA.inset + 90, ARENA.height - ARENA.inset - 90);
    if (Math.hypot(x - state.ship.x, y - state.ship.y) < 170) continue;
    if (spawnCrystal(state, x, y) !== null) return;
  }
}

/**
 * Advance the wave clock: release queued drones, trickle crystals, and move between intro, fight
 * and cleared. The boss's death ends the game in combat.js, not here.
 */
export function updateDirector(state, dt) {
  let events = 0;
  const director = state.director;
  if (state.phase === 'intro') {
    state.phaseTimer = Math.max(0, state.phaseTimer - dt);
    if (state.phaseTimer === 0) {
      state.phase = 'fight';
      director.waveTime = 0;
      director.queueIndex = 0;
    }
    return events;
  }
  if (state.phase === 'cleared') {
    state.phaseTimer = Math.max(0, state.phaseTimer - dt);
    if (state.phaseTimer === 0) {
      if (state.waveIndex < WAVES.length - 1) events |= startWave(state, state.waveIndex + 1);
    }
    return events;
  }
  if (state.phase !== 'fight') return events;

  director.waveTime += dt;
  const wave = WAVES[state.waveIndex];
  while (director.queueIndex < wave.queue.length && wave.queue[director.queueIndex].at <= director.waveTime) {
    releaseDrone(state, wave.queue[director.queueIndex].kind);
    director.queueIndex += 1;
  }
  spawnCrystals(state, dt);

  if (state.waveIndex < WAVES.length - 1 && director.queueIndex >= wave.queue.length && countEnemies(state) === 0) {
    state.score += SCORE.waveClear;
    state.killScore += SCORE.waveClear;
    // Clearing a wave patches one hull pip: the run is five waves long, and three pips alone
    // would make the last two a formality of attrition rather than a fight.
    if (state.ship.hull < HULL_MAX) {
      state.ship.hull += 1;
      spawnPopup(state, state.ship.x, state.ship.y - 28, '+1 HULL');
      spawnRing(state, state.ship.x, state.ship.y, 0, 46, 0.7);
      for (let spark = 0; spark < 12; spark += 1) {
        const direction = (spark / 12) * Math.PI * 2;
        spawnParticle(state, PARTICLE_SPARK, state.ship.x + Math.cos(direction) * 22, state.ship.y + Math.sin(direction) * 22, Math.cos(direction) * 90, Math.sin(direction) * 90, 0.5, 3, 0);
      }
    }
    state.phase = 'cleared';
    state.phaseTimer = WAVE.cleared;
    state.banner = {
      title: `WAVE ${state.waveIndex + 1} CLEARED`,
      text: `+${SCORE.waveClear}`,
      sub: 'The drift thins. Repair the hull, restock the ion cells.',
      timer: WAVE.cleared + 0.8,
      total: WAVE.cleared + 0.8,
      tone: 1,
    };
    events |= EVENT_WAVE;
  }
  return events;
}

/** Circle the arena, dragging the boss toward a slowly orbiting anchor. */
function hoverBoss(boss, ship, dt, speed) {
  const anchorX = ARENA.width / 2 + Math.cos(boss.age * 0.42) * 250;
  const anchorY = ARENA.height / 2 + Math.sin(boss.age * 0.63) * 130;
  const dx = anchorX - boss.x;
  const dy = anchorY - boss.y;
  const distance = Math.hypot(dx, dy) || 1;
  const wantX = (dx / distance) * speed;
  const wantY = (dy / distance) * speed;
  boss.vx += (wantX - boss.vx) * Math.min(1, dt * 1.6);
  boss.vy += (wantY - boss.vy) * Math.min(1, dt * 1.6);
  boss.x += boss.vx * dt;
  boss.y += boss.vy * dt;
  if (!boss.beamActive) boss.angle = Math.atan2(ship.y - boss.y, ship.x - boss.x);
}

/** Point `boss`'s core at the skiff. */
function faceShip(boss, ship) {
  boss.angle = Math.atan2(ship.y - boss.y, ship.x - boss.x);
}

/** Radial phase: rings of slow shots, offset a little each burst so the gaps rotate. */
function radialPhase(boss, state, dt) {
  const bossSpec = ENEMY.boss;
  hoverBoss(boss, state.ship, dt, bossSpec.driftSpeed);
  boss.fireTimer -= dt;
  if (boss.fireTimer > 0) return 0;
  boss.fireTimer = bossSpec.radialEvery;
  boss.spin += 0.55;
  for (let index = 0; index < bossSpec.radialShots; index += 1) {
    const shotAngle = boss.spin + (index / bossSpec.radialShots) * Math.PI * 2;
    spawnBullet(state, boss.x + Math.cos(shotAngle) * (boss.radius + 6), boss.y + Math.sin(shotAngle) * (boss.radius + 6), Math.cos(shotAngle) * bossSpec.radialSpeed, Math.sin(shotAngle) * bossSpec.radialSpeed, OWNER_ENEMY, 1);
  }
  spawnRing(state, boss.x, boss.y, 3, boss.radius * 1.5, 0.4);
  spawnBurst(state, boss.x, boss.y, 3, 8, 140, 0);
  return EVENT_BOSS_SHOT;
}

/** Sweep phase: rest, a warm-up line that shows where it will go, then a beam that crosses. */
function sweepPhase(boss, state, dt) {
  const bossSpec = ENEMY.boss;
  const cycle = bossSpec.beamRest + bossSpec.beamWarmup + bossSpec.beamTime;
  hoverBoss(boss, state.ship, dt, bossSpec.driftSpeed * 0.6);
  boss.phaseTimer += dt;
  if (boss.phaseTimer >= cycle) boss.phaseTimer -= cycle;
  const rest = bossSpec.beamRest;
  const warmEnd = rest + bossSpec.beamWarmup;
  if (boss.phaseTimer < rest) {
    boss.beamActive = false;
    boss.beamWarm = 0;
    faceShip(boss, state.ship);
  } else if (boss.phaseTimer < warmEnd) {
    boss.beamActive = false;
    boss.beamWarm = (boss.phaseTimer - rest) / bossSpec.beamWarmup;
    faceShip(boss, state.ship);
  } else {
    if (!boss.beamActive) {
      boss.beamActive = true;
      boss.spawnAngles = boss.angle;
      spawnBurst(state, boss.x, boss.y, 3, 12, 180, 0);
    }
    const progress = (boss.phaseTimer - warmEnd) / bossSpec.beamTime;
    boss.beamAngle = boss.spawnAngles + (progress - 0.5) * bossSpec.beamSweep * 2;
  }
  boss.angle = boss.beamAngle;
  return 0;
}

/** Charge phase: a lock-on flash, a straight rush, then a slow recovery while it reloads. */
function chargePhase(boss, state, dt) {
  const bossSpec = ENEMY.boss;
  const cycle = bossSpec.chargeWarmup + bossSpec.chargeTime + bossSpec.chargeRest;
  boss.phaseTimer += dt;
  if (boss.phaseTimer >= cycle) boss.phaseTimer -= cycle;
  boss.beamActive = false;
  const warmEnd = bossSpec.chargeWarmup;
  const rushEnd = warmEnd + bossSpec.chargeTime;
  if (boss.phaseTimer < warmEnd) {
    hoverBoss(boss, state.ship, dt, bossSpec.driftSpeed * 0.8);
    boss.chargeX = state.ship.x;
    boss.chargeY = state.ship.y;
    faceShip(boss, state.ship);
  } else if (boss.phaseTimer < rushEnd) {
    if (!boss.charging) {
      boss.charging = true;
      const dx = boss.chargeX - boss.x;
      const dy = boss.chargeY - boss.y;
      const length = Math.hypot(dx, dy) || 1;
      boss.vx = (dx / length) * bossSpec.chargeSpeed;
      boss.vy = (dy / length) * bossSpec.chargeSpeed;
      spawnBurst(state, boss.x, boss.y, 3, 20, 260, 1);
    }
    boss.x += boss.vx * dt;
    boss.y += boss.vy * dt;
    if (boss.x < ARENA.inset + boss.radius || boss.x > ARENA.width - ARENA.inset - boss.radius) {
      boss.x = Math.min(ARENA.width - ARENA.inset - boss.radius, Math.max(ARENA.inset + boss.radius, boss.x));
      boss.vx *= -0.4;
    }
    if (boss.y < ARENA.inset + boss.radius || boss.y > ARENA.height - ARENA.inset - boss.radius) {
      boss.y = Math.min(ARENA.height - ARENA.inset - boss.radius, Math.max(ARENA.inset + boss.radius, boss.y));
      boss.vy *= -0.4;
    }
    boss.vx *= Math.exp(-0.6 * dt);
    boss.vy *= Math.exp(-0.6 * dt);
  } else {
    boss.charging = false;
    boss.vx *= Math.exp(-3 * dt);
    boss.vy *= Math.exp(-3 * dt);
    boss.x += boss.vx * dt;
    boss.y += boss.vy * dt;
    faceShip(boss, state.ship);
  }
  return 0;
}

/**
 * The Warden. Its phase follows its hull, and every phase change throws a shockwave and calls in
 * a few seekers, so the fight keeps escalating instead of becoming a duel with a wall.
 */
export function updateBoss(boss, state, dt) {
  let events = 0;
  const bossSpec = ENEMY.boss;
  boss.age += dt;
  boss.hurt = Math.max(0, boss.hurt - dt);

  const fraction = boss.hp / boss.maxHp;
  const wanted = fraction > bossSpec.beamAt ? BOSS_RADIAL : fraction > bossSpec.chargeAt ? BOSS_SWEEP : BOSS_CHARGE;
  if (wanted !== boss.phase) {
    boss.phase = wanted;
    boss.phaseTimer = 0;
    boss.beamActive = false;
    boss.beamWarm = 0;
    boss.charging = false;
    boss.fireTimer = 0.9;
    spawnRing(state, boss.x, boss.y, 3, 150, 0.9);
    spawnBurst(state, boss.x, boss.y, 3, 24, 300, 0);
    state.shake = Math.max(state.shake, 14);
    for (let index = 0; index < 2; index += 1) {
      const spot = { x: boss.x + randomRange(state.random, -120, 120), y: boss.y + randomRange(state.random, -80, 80) };
      spawnEnemy(state, KIND_SEEKER, Math.max(40, Math.min(ARENA.width - 40, spot.x)), Math.max(40, Math.min(ARENA.height - 40, spot.y)));
    }
    state.banner = {
      title: 'THE WARDEN',
      text: wanted === BOSS_SWEEP ? 'PHASE 2 // SWEEP' : 'PHASE 3 // CHARGE',
      sub: wanted === BOSS_SWEEP ? 'It stops firing blind. Watch the line.' : 'It has stopped holding back.',
      timer: 1.8,
      total: 1.8,
      tone: 2,
    };
    events |= EVENT_BOSS_PHASE;
  }
  boss.phaseAge += dt;

  if (boss.phase === BOSS_SWEEP) events |= sweepPhase(boss, state, dt);
  else if (boss.phase === BOSS_CHARGE) events |= chargePhase(boss, state, dt);
  else events |= radialPhase(boss, state, dt);

  // Keep the boss inside the arena whatever the phase did to its velocity.
  boss.x = Math.min(ARENA.width - ARENA.inset - boss.radius, Math.max(ARENA.inset + boss.radius, boss.x));
  boss.y = Math.min(ARENA.height - ARENA.inset - boss.radius, Math.max(ARENA.inset + boss.radius, boss.y));
  return events;
}

/** True while the Warden's beam is live; combat.js uses it for the line check. */
export function bossBeam(boss) {
  return boss !== null && boss.beamActive ? boss.beamAngle : null;
}

/** The end point of the live beam, for drawing and for the line collision. */
export function beamEnd(boss) {
  const length = 1600;
  return { x: boss.x + Math.cos(boss.beamAngle) * length, y: boss.y + Math.sin(boss.beamAngle) * length };
}

/** A wave name for the HUD, with the boss flagged. */
export function waveLabel(state) {
  const wave = WAVES[state.waveIndex];
  return `WAVE ${state.waveIndex + 1} / ${WAVES.length} - ${wave.name}`;
}

/** Exports used by the screenshot staging: the boss's own phase names. */
export function bossPhaseName(phase) {
  return phase === BOSS_SWEEP ? 'sweep' : phase === BOSS_CHARGE ? 'charge' : 'radial';
}
