// Who hit whom, and what it cost. Bullets against drones and rocks, contact against the hull, the
// beam against the skiff, crystals against the collector, and the multiplier that ties it all to
// the score. Nothing here draws, and nothing here reads input: it is pure consequence.
import { CRYSTAL, ENEMY, SCORE, SHIP } from './config.js';
import {
  EVENT_HULL,
  EVENT_KILL,
  EVENT_OVER,
  EVENT_PICKUP,
  EVENT_SHOT_HIT,
  EVENT_WIN,
  KIND_ASTEROID,
  KIND_BOSS,
  KIND_SHARD,
  KIND_SPLITTER,
  OWNER_PLAYER,
  PARTICLE_SHARD,
  PARTICLE_SMOKE,
  PARTICLE_SPARK,
  spawnBurst,
  spawnCrystal,
  spawnEnemy,
  spawnParticle,
  spawnPopup,
  spawnRing,
} from './entities.js';

/** Squared distance between two circles' centres. */
function distanceSquared(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/** Whether a circle at (cx, cy) with `radius` overlaps another circle. */
function circlesTouch(ax, ay, aRadius, bx, by, bRadius) {
  const reach = aRadius + bRadius;
  return distanceSquared(ax, ay, bx, by) <= reach * reach;
}

/** Distance from a point to a segment: used for the Warden's beam, which is a line with width. */
export function pointToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const lengthSquared = abx * abx + aby * aby;
  let t = lengthSquared > 0 ? ((px - ax) * abx + (py - ay) * aby) / lengthSquared : 0;
  t = Math.max(0, Math.min(1, t));
  const dx = px - (ax + abx * t);
  const dy = py - (ay + aby * t);
  return Math.sqrt(dx * dx + dy * dy);
}

/** Add `base` points to the score through the multiplier, tracking which half of the score it is. */
function award(state, base, fromCrystal) {
  const points = Math.round(base * state.multiplier);
  state.score += points;
  if (fromCrystal) state.crystalScore += points;
  else state.killScore += points;
  return points;
}

/** The skiff takes a hit: one hull pip, a moment of grace, shake, flash, and a broken streak. */
export function damageShip(state, amount, sourceX, sourceY) {
  const ship = state.ship;
  if (ship.invulnerable > 0 || ship.dashTimer > 0) return 0;
  if (state.phase === 'lost' || state.phase === 'won') return 0;

  ship.hull -= amount;
  ship.invulnerable = SHIP.hurtInvulnerable;
  ship.hurt = 0.6;
  state.shake = Math.max(state.shake, SHIP.hurtShake);
  state.flash = 0.55;
  state.multiplier = Math.max(CRYSTAL.min, state.multiplier - 0.5);
  state.multiplierIdle = 0;

  spawnBurst(state, ship.x, ship.y, 4, 24, 320, PARTICLE_SPARK);
  spawnBurst(state, ship.x, ship.y, 1, 8, 120, PARTICLE_SMOKE);
  spawnRing(state, ship.x, ship.y, 4, 44, 0.5);

  // Shoved away from whatever did it, so a hit never leaves the skiff inside the hazard.
  const dx = ship.x - sourceX;
  const dy = ship.y - sourceY;
  const length = Math.hypot(dx, dy) || 1;
  ship.vx += (dx / length) * 260;
  ship.vy += (dy / length) * 260;

  if (ship.hull <= 0) {
    ship.hull = 0;
    state.phase = 'lost';
    state.shake = 26;
    spawnBurst(state, ship.x, ship.y, 4, 46, 420, PARTICLE_SPARK);
    spawnBurst(state, ship.x, ship.y, 1, 26, 240, PARTICLE_SMOKE);
    spawnRing(state, ship.x, ship.y, 4, 90, 1.1);
    return EVENT_HULL | EVENT_OVER;
  }
  return EVENT_HULL;
}

/** A drone or rock loses hull; at zero it dies and pays out. */
export function damageEnemy(state, enemy, amount) {
  enemy.hp -= amount;
  enemy.hurt = 0.11;
  state.shake = Math.max(state.shake, enemy.kind === KIND_BOSS ? 1.4 : 0.9);
  if (enemy.hp > 0) return 0;
  return killEnemy(state, enemy);
}

/** Kill one enemy: score, debris, splitter children, and the boss's ending. */
export function killEnemy(state, enemy) {
  if (!enemy.active) return 0;
  enemy.active = false;
  state.kills += 1;

  const boss = enemy.kind === KIND_BOSS;
  const points = award(state, enemy.value, false);
  spawnPopup(state, enemy.x, enemy.y - enemy.radius - 6, `+${points}`);

  if (boss) {
    state.score += SCORE.bossKill;
    state.killScore += SCORE.bossKill;
    spawnBurst(state, enemy.x, enemy.y, 3, 70, 520, PARTICLE_SPARK);
    spawnBurst(state, enemy.x, enemy.y, 4, 40, 260, PARTICLE_SPARK);
    spawnBurst(state, enemy.x, enemy.y, 1, 34, 210, PARTICLE_SMOKE);
    spawnRing(state, enemy.x, enemy.y, 3, 190, 1.4);
    spawnRing(state, enemy.x, enemy.y, 4, 90, 0.9);
    state.shake = 30;
    state.flash = 0.8;
    state.phase = 'won';
    return EVENT_KILL | EVENT_WIN;
  }

  const colour = enemy.kind === KIND_ASTEROID ? 3 : enemy.kind === KIND_SPLITTER ? 2 : 1;
  spawnBurst(state, enemy.x, enemy.y, colour, enemy.kind === KIND_ASTEROID ? 22 : 18, enemy.radius * 14 + 110, PARTICLE_SPARK);
  spawnRing(state, enemy.x, enemy.y, 4, enemy.radius * 3.4, 0.28);
  spawnBurst(state, enemy.x, enemy.y, 1, 5, 90, PARTICLE_SMOKE);
  spawnRing(state, enemy.x, enemy.y, colour, enemy.radius * 2.4, 0.35);
  for (let index = 0; index < 4; index += 1) {
    const fragment = spawnParticle(state, PARTICLE_SHARD, enemy.x, enemy.y, Math.cos(index * 1.7) * 160, Math.sin(index * 1.7) * 160, 0.6, 4, colour);
    if (fragment !== null) fragment.spin = 7;
  }

  // Splitters come apart into two smaller, faster shards.
  if (enemy.kind === KIND_SPLITTER) {
    for (let index = 0; index < ENEMY.splitter.children; index += 1) {
      const angle = (index / ENEMY.splitter.children) * Math.PI * 2 + state.random() * 0.8;
      const child = spawnEnemy(state, KIND_SHARD, enemy.x + Math.cos(angle) * 14, enemy.y + Math.sin(angle) * 14);
      if (child !== null) {
        child.vx = Math.cos(angle) * 200;
        child.vy = Math.sin(angle) * 200;
        child.generation = 1;
      }
    }
  }

  if (enemy.kind !== KIND_BOSS && state.random() < CRYSTAL.dropChance) spawnCrystal(state, enemy.x, enemy.y);
  return EVENT_KILL;
}

/** Pick a crystal up: score, a multiplier notch, and a shower of light. */
export function collectCrystal(state, crystal) {
  crystal.active = false;
  state.crystalsCollected += 1;
  state.multiplier = Math.min(CRYSTAL.max, state.multiplier + CRYSTAL.step);
  state.multiplierIdle = 0;
  const points = award(state, CRYSTAL.value, true);
  spawnPopup(state, crystal.x, crystal.y - 16, `+${points}`);
  spawnBurst(state, crystal.x, crystal.y, 0, 14, 200, PARTICLE_SPARK);
  spawnRing(state, crystal.x, crystal.y, 0, 34, 0.4);
}

/** The multiplier bleeds away while you stop collecting, down to its floor of 1. */
export function updateMultiplier(state, dt) {
  state.multiplierIdle += dt;
  if (state.multiplierIdle > CRYSTAL.decayDelay) {
    state.multiplier = Math.max(CRYSTAL.min, state.multiplier - CRYSTAL.decayRate * dt);
  }
  if (state.multiplier > state.multiplierPeak) state.multiplierPeak = state.multiplier;
}

/** The Warden's beam: a wide line from its core that costs a hull pip to stand in. */
function resolveBeam(state) {
  let events = 0;
  const boss = state.boss;
  if (boss === null || !boss.beamActive) return events;
  const length = 1600;
  const endX = boss.x + Math.cos(boss.beamAngle) * length;
  const endY = boss.y + Math.sin(boss.beamAngle) * length;
  const distance = pointToSegment(state.ship.x, state.ship.y, boss.x, boss.y, endX, endY);
  if (distance < ENEMY.boss.beamWidth * 0.5 + state.ship.radius) {
    events |= damageShip(state, 1, boss.x, boss.y);
  }
  return events;
}

/**
 * One pass of collisions. Bullets are checked against their opposite side, the hull against every
 * live hazard, and crystals against the collector. Returns EVENT_* flags for main.js.
 */
export function resolveCombat(state, dt) {
  let events = 0;
  const ship = state.ship;
  const bullets = state.bullets;

  for (let index = 0; index < bullets.length; index += 1) {
    const bullet = bullets[index];
    if (!bullet.active) continue;
    if (bullet.owner === OWNER_PLAYER) {
      for (let other = 0; other < state.enemies.length; other += 1) {
        const enemy = state.enemies[other];
        if (!enemy.active) continue;
        if (!circlesTouch(bullet.x, bullet.y, bullet.radius, enemy.x, enemy.y, enemy.radius)) continue;
        bullet.active = false;
        events |= EVENT_SHOT_HIT;
        spawnBurst(state, bullet.x, bullet.y, 0, 4, 120, PARTICLE_SPARK);
        events |= damageEnemy(state, enemy, bullet.damage);
        break;
      }
    } else if (circlesTouch(bullet.x, bullet.y, bullet.radius, ship.x, ship.y, ship.radius)) {
      bullet.active = false;
      spawnBurst(state, bullet.x, bullet.y, 4, 8, 140, PARTICLE_SPARK);
      events |= damageShip(state, 1, bullet.x, bullet.y);
    }
  }

  for (let index = 0; index < state.enemies.length; index += 1) {
    const enemy = state.enemies[index];
    if (!enemy.active) continue;
    if (!circlesTouch(ship.x, ship.y, ship.radius, enemy.x, enemy.y, enemy.radius)) continue;
    events |= damageShip(state, enemy.damage, enemy.x, enemy.y);
    // Bounce the skiff out of the thing it touched, so contact is a shove, not a trap.
    const dx = ship.x - enemy.x;
    const dy = ship.y - enemy.y;
    const length = Math.hypot(dx, dy) || 1;
    ship.vx += (dx / length) * 220;
    ship.vy += (dy / length) * 220;
  }

  for (let index = 0; index < state.crystals.length; index += 1) {
    const crystal = state.crystals[index];
    if (!crystal.active) continue;
    if (!circlesTouch(ship.x, ship.y, ship.radius + 8, crystal.x, crystal.y, CRYSTAL.radius)) continue;
    collectCrystal(state, crystal);
    events |= EVENT_PICKUP;
  }

  events |= resolveBeam(state);
  updateMultiplier(state, dt);
  return events;
}
