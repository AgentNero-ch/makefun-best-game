// The screenshot scenes behind ?shot=start|play|win|end, and the autopilot that flies them. Each
// scene plays the real rules forward from a fresh world with a deterministic pilot — no state is
// faked — so the frame is a genuine moment of a real run and the same seed always gives the same
// picture. The play scene keeps the busiest frame it saw, which is why it is never an empty arena.
import { ARENA, ENEMY, STEP } from './config.js';
import { KIND_ASTEROID, KIND_BOSS, countEnemies, findBoss, nearestCrystal, nearestTarget } from './entities.js';
import { SCREEN_LOST, SCREEN_PLAY, SCREEN_TITLE, SCREEN_WON } from './hud.js';

const PLAY_SECONDS = 36;
const PLAY_EXTRA_SECONDS = 14;
const WIN_LIMIT_SECONDS = 480;
const END_PREFIX_SECONDS = 80;
const END_LIMIT_SECONDS = 90;
const START_SECONDS = 5;

/** What "a screen full" means for the frozen mid-game frame. */
const RICH_ENEMIES = 8;
const RICH_BULLETS = 8;
const RICH_PARTICLES = 24;

/**
 * Repulsion from anything that can hurt the skiff, plus a perpendicular dodge away from incoming
 * fire. The pilot never uses Math.random: same seed, same flight.
 */
function dangerField(state, style) {
  const ship = state.ship;
  let mx = 0;
  let my = 0;
  let dash = false;
  const cautious = style !== 'reckless';
  const dodge = style === 'careful' ? 3.6 : 3.0;

  if (cautious) {
    for (let index = 0; index < state.bullets.length; index += 1) {
      const bullet = state.bullets[index];
      if (!bullet.active || bullet.owner === 0) continue;
      const rx = bullet.x - ship.x;
      const ry = bullet.y - ship.y;
      const rvx = ship.vx - bullet.vx;
      const rvy = ship.vy - bullet.vy;
      const vv = rvx * rvx + rvy * rvy;
      if (vv < 1) continue;
      const time = -(rx * rvx + ry * rvy) / vv;
      if (time < 0 || time > 0.8) continue;
      const closest = Math.hypot(rx + rvx * time, ry + rvy * time);
      if (closest > 64) continue;
      const speed = Math.hypot(bullet.vx, bullet.vy) || 1;
      const px = -bullet.vy / speed;
      const py = bullet.vx / speed;
      const side = Math.sign((ship.x - bullet.x) * px + (ship.y - bullet.y) * py) || 1;
      const urgency = 1 - closest / 64;
      mx += px * side * dodge * urgency;
      my += py * side * dodge * urgency;
      if (time < 0.3 && closest < 38 && ship.dashCooldown <= 0) dash = true;
    }
  }

  let nearestDistance = Infinity;
  for (let index = 0; index < state.enemies.length; index += 1) {
    const enemy = state.enemies[index];
    if (!enemy.active) continue;
    // Aim the avoidance where the drone will be, not where it is.
    const aheadX = enemy.x + enemy.vx * 0.22;
    const aheadY = enemy.y + enemy.vy * 0.22;
    const dx = ship.x - aheadX;
    const dy = ship.y - aheadY;
    const distance = Math.hypot(dx, dy) || 1;
    if (distance < nearestDistance) nearestDistance = distance;

    if (enemy.kind === KIND_BOSS) {
      const reach = 320;
      if (distance < reach) {
        const force = (1 - distance / reach) * 2.2;
        mx += (dx / distance) * force;
        my += (dy / distance) * force;
      }
      if (cautious && distance < 150 && ship.dashCooldown <= 0) dash = true;
      continue;
    }
    const reach = enemy.kind === 4 ? 170 : 250;
    if (distance < reach) {
      const force = (1 - distance / reach) ** 1.4 * 2.4;
      mx += (dx / distance) * force;
      my += (dy / distance) * force;
      if (cautious && distance < 95 && ship.dashCooldown <= 0) dash = true;
    }
  }

  // The Warden's beam and its charge are the two things that kill pilots: step off the line.
  const boss = findBoss(state);
  if (boss !== null) {
    const beamLive = boss.phase === 1 && (boss.beamActive || boss.beamWarm > 0.15);
    if (beamLive) {
      const directionX = Math.cos(boss.beamAngle);
      const directionY = Math.sin(boss.beamAngle);
      // Perpendicular offset from the beam axis; move to the side the skiff is already on.
      const relX = ship.x - boss.x;
      const relY = ship.y - boss.y;
      const along = relX * directionX + relY * directionY;
      const perpX = relX - directionX * along;
      const perpY = relY - directionY * along;
      const distance = Math.hypot(perpX, perpY) || 1;
      const side = perpX * -directionY + perpY * directionX >= 0 ? 1 : -1;
      const force = distance < 120 ? 3.4 : 1.6;
      mx += (-directionY * side) * force;
      my += (directionX * side) * force;
      if (distance < 70 && ship.dashCooldown <= 0) dash = true;
    }
    if (boss.phase === 2 && !boss.charging && boss.phaseTimer < ENEMY.boss.chargeWarmup) {
      // It has locked on: slide off the locked line rather than backing away down it.
      const lockX = boss.chargeX - boss.x;
      const lockY = boss.chargeY - boss.y;
      const length = Math.hypot(lockX, lockY) || 1;
      const side = (ship.x - boss.x) * (-lockY / length) + (ship.y - boss.y) * (lockX / length) >= 0 ? 1 : -1;
      mx += (-lockY / length) * side * 2.6;
      my += (lockX / length) * side * 2.6;
      if (ship.dashCooldown <= 0) dash = true;
    }
  }

  // A pull toward the middle: it keeps the skiff out of the corners and the fight in frame.
  const offsetX = ship.x - 640;
  const offsetY = ship.y - 360;
  const offCentre = Math.hypot(offsetX / 640, offsetY / 360);
  if (offCentre > 0.45) {
    mx -= (offsetX / 640) * (offCentre - 0.45) * 1.5;
    my -= (offsetY / 360) * (offCentre - 0.45) * 1.5;
  }

  // Walls: the arena is small, and a corner is where a skiff dies.
  const margin = 165;
  if (ship.x < margin) mx += (1 - ship.x / margin) * 2.0;
  else if (ship.x > 1280 - margin) mx -= (1 - (1280 - ship.x) / margin) * 2.0;
  if (ship.y < margin) my += (1 - ship.y / margin) * 2.0;
  else if (ship.y > 720 - margin) my -= (1 - (720 - ship.y) / margin) * 2.0;

  // A slow orbit, so the skiff keeps moving even when nothing is close.
  mx += Math.cos(state.time * 0.55 + 0.9) * 0.16;
  my += Math.sin(state.time * 0.47) * 0.16;

  return { mx, my, dash, nearestDistance };
}

/** Steer for a crystal when there is room, or when the multiplier is about to bleed. */
function crystalPull(state, threatDistance) {
  const ship = state.ship;
  const crystal = nearestCrystal(state, ship.x, ship.y);
  if (crystal === null) return { x: 0, y: 0 };
  if (threatDistance < 240 && state.multiplierIdle < 1.9) return { x: 0, y: 0 };
  const dx = crystal.x - ship.x;
  const dy = crystal.y - ship.y;
  const distance = Math.hypot(dx, dy) || 1;
  const pull = Math.min(1.1, 0.55 + distance / 500);
  return { x: (dx / distance) * pull, y: (dy / distance) * pull };
}

/** The shot the skiff should take: nearest threat, led by its travel time. */
function aimAt(state, ship) {
  const target = nearestTarget(state, ship.x, ship.y, 1400);
  if (target === null) return { angle: ship.angle, firing: false };
  const distance = Math.hypot(target.x - ship.x, target.y - ship.y);
  const flight = distance / 860;
  return {
    angle: Math.atan2(target.y + target.vy * flight - ship.y, target.x + target.vx * flight - ship.x),
    firing: distance < 900,
  };
}

/**
 * The pilot. `style` is 'play' (good), 'careful' (extra dodging), 'reckless' (ignores danger) or
 * 'suicide' (flies into the nearest drone on purpose, for the defeat scene).
 */
export function autopilot(state, style) {
  const ship = state.ship;
  if (style === 'suicide') {
    const target = nearestTarget(state, ship.x, ship.y, 2000);
    if (target === null) {
      return { moveX: 0, moveY: 0, aimAngle: ship.angle, aimX: ship.x, aimY: ship.y, aimAtPointer: false, firing: false, dash: false };
    }
    const dx = target.x - ship.x;
    const dy = target.y - ship.y;
    const distance = Math.hypot(dx, dy) || 1;
    return {
      moveX: dx / distance,
      moveY: dy / distance,
      aimAngle: Math.atan2(dy, dx),
      aimX: target.x,
      aimY: target.y,
      aimAtPointer: false,
      firing: false,
      dash: false,
    };
  }

  const danger = dangerField(state, style);
  const pull = crystalPull(state, danger.nearestDistance);
  let mx = danger.mx + pull.x;
  let my = danger.my + pull.y;
  const length = Math.hypot(mx, my);
  if (length > 1) {
    mx /= length;
    my /= length;
  }
  const aim = aimAt(state, ship);
  return {
    moveX: mx,
    moveY: my,
    aimAngle: aim.angle,
    aimX: ship.x + Math.cos(aim.angle) * 120,
    aimY: ship.y + Math.sin(aim.angle) * 120,
    aimAtPointer: true,
    firing: aim.firing,
    dash: danger.dash && style !== 'reckless',
  };
}

function copyState(state) {
  const { random, ...plain } = state;
  const copy = structuredClone(plain);
  copy.random = random;
  return copy;
}

function pasteState(state, copy) {
  Object.assign(state, copy);
  state.random = copy.random;
  state.boss = findBoss(state);
}

function stepWith(world, style, dt) {
  return world.step(dt, autopilot(world.state, style), { harmless: false });
}

/** Run the world for `seconds` (or until it ends). Returns true if the run finished. */
function advance(world, seconds, style) {
  const steps = Math.round(seconds / STEP);
  for (let index = 0; index < steps; index += 1) {
    stepWith(world, style, STEP);
    const phase = world.state.phase;
    if (phase === 'won' || phase === 'lost') return true;
  }
  return false;
}

/** Steer the title screen's skiff on a slow figure of eight, threat-free. */
function advanceBackdrop(world, seconds) {
  const steps = Math.round(seconds / STEP);
  for (let index = 0; index < steps; index += 1) {
    const ship = world.state.ship;
    const time = world.state.time;
    world.step(
      STEP,
      {
        moveX: Math.cos(time * 0.5) * 0.5,
        moveY: Math.sin(time * 0.36) * 0.4,
        aimAngle: Math.atan2(360 - ship.y, 640 - ship.x),
        aimX: 640,
        aimY: 360,
        aimAtPointer: false,
        firing: false,
        dash: false,
      },
      { harmless: true },
    );
  }
}

/** How full of life a frame is: shots in flight first, then drones, debris and crystals. */
function richness(state) {
  let bullets = 0;
  let particles = 0;
  let crystals = 0;
  for (const bullet of state.bullets) if (bullet.active) bullets += 1;
  for (const particle of state.particles) if (particle.active) particles += 1;
  for (const crystal of state.crystals) if (crystal.active) crystals += 1;
  const ship = state.ship;
  // Frames where the skiff is near the middle compose better than frames where it is pinned to a wall,
  // so centrality is graded rather than a flag.
  const offCentre = Math.hypot((ship.x - ARENA.width / 2) / (ARENA.width / 2), (ship.y - ARENA.height / 2) / (ARENA.height / 2));
  // Debris and impact light are what make a still frame read as a peak rather than a lull.
  return countEnemies(state) * 10 + bullets * 9 + particles * 2.2 + state.flash * 90 + state.shake * 3 + crystals * 3 + surroundScore(state) * 16 - offCentre * 90;
}

/** How many quadrants around the skiff hold a live drone: a fight, not a firing line. */
function surroundScore(state) {
  const ship = state.ship;
  const quadrants = [false, false, false, false];
  for (const enemy of state.enemies) {
    if (!enemy.active || enemy.kind === KIND_ASTEROID) continue;
    const angle = Math.atan2(enemy.y - ship.y, enemy.x - ship.x);
    const quadrant = Math.floor((angle + Math.PI) / (Math.PI / 2)) % 4;
    quadrants[quadrant] = true;
  }
  return quadrants.filter(Boolean).length;
}

function countBullets(state) {
  let bullets = 0;
  for (const bullet of state.bullets) if (bullet.active) bullets += 1;
  return bullets;
}

function countParticles(state) {
  let particles = 0;
  for (const particle of state.particles) if (particle.active) particles += 1;
  return particles;
}

/** A frame worth freezing on: a crowded wave, shots in the air, sparks, and a central skiff. */
function isRich(state) {
  const ship = state.ship;
  return (
    countEnemies(state) >= RICH_ENEMIES &&
    surroundScore(state) >= 3 &&
    countBullets(state) >= RICH_BULLETS &&
    countParticles(state) >= RICH_PARTICLES &&
    Math.abs(ship.x - ARENA.width / 2) < 280 &&
    Math.abs(ship.y - ARENA.height / 2) < 170
  );
}

/**
 * Play the real game and freeze on a frame that looks like the game at its busiest: a live wave,
 * shots in the air, debris, and the skiff in the middle of it rather than against a wall. Frames
 * meeting every "screen full" threshold win outright; otherwise the richest frame seen is used.
 */
function stagePlay(world) {
  let best = null;
  let bestValue = -1;
  let qualified = null;
  let qualifiedTime = -1;
  const steps = Math.round((PLAY_SECONDS + PLAY_EXTRA_SECONDS) / STEP);
  for (let index = 0; index < steps; index += 1) {
    stepWith(world, 'play', STEP);
    const state = world.state;
    if (state.phase === 'won' || state.phase === 'lost') break;
    if (state.time < 12) continue;
    // Frames far from the requested moment are worth less, so the fallback still looks like
    // "about half a minute in" rather than a random instant.
    const value = richness(state) - Math.abs(state.time - PLAY_SECONDS) * 0.7;
    if (value > bestValue) {
      bestValue = value;
      best = copyState(state);
    }
    // Once past the requested stretch, the first frame that has everything wins.
    if (state.time >= PLAY_SECONDS && isRich(state)) {
      qualified = copyState(state);
      qualifiedTime = state.time;
      break;
    }
  }
  const chosen = qualified !== null ? qualified : best;
  if (chosen !== null) pasteState(world.state, chosen);
  return { qualifiedTime, qualified: qualified !== null };
}

/**
 * Win the whole run for real, then let the boss's explosion breathe for a beat. Two pilot profiles
 * are tried (a confident one, then a more evasive one) so a bad early wave cannot waste the scene.
 */
function stageWin(world) {
  for (const style of ['play', 'careful']) {
    world.reset();
    advance(world, WIN_LIMIT_SECONDS, style);
    if (world.state.phase === 'won') {
      advance(world, 0.5, 'play');
      for (const popup of world.state.popups) popup.active = false;
      return;
    }
    if (world.state.phase === 'lost') continue;
  }
}

/** Build a real mid-game run, then fly it into a drone until the hull fails. */
function stageEnd(world) {
  advance(world, END_PREFIX_SECONDS, 'play');
  if (world.state.phase === 'won') world.reset();
  advance(world, END_LIMIT_SECONDS, 'suicide');
  if (world.state.phase === 'lost') advance(world, 0.4, 'suicide');
}

/**
 * Set `world` to the named scene and return the screen to draw over it. Unknown names fall back to
 * the title, so a typo in a URL still shows a game rather than a black page.
 */
export function stageShot(name, world) {
  world.reset();
  if (name === 'play') {
    stagePlay(world);
    return { screen: SCREEN_PLAY };
  }
  if (name === 'win') {
    stageWin(world);
    return { screen: world.state.phase === 'won' ? SCREEN_WON : SCREEN_PLAY };
  }
  if (name === 'end') {
    stageEnd(world);
    return { screen: world.state.phase === 'lost' ? SCREEN_LOST : SCREEN_PLAY };
  }
  advanceBackdrop(world, START_SECONDS);
  return { screen: SCREEN_TITLE };
}

/** Exposed for a headless check: what a scene ended up holding. */
export function shotReport(world) {
  const state = world.state;
  let bullets = 0;
  let particles = 0;
  for (const bullet of state.bullets) if (bullet.active) bullets += 1;
  for (const particle of state.particles) if (particle.active) particles += 1;
  const boss = findBoss(state);
  return {
    phase: state.phase,
    wave: state.waveIndex + 1,
    enemies: countEnemies(state),
    bullets,
    particles,
    score: state.score,
    hull: state.ship.hull,
    multiplier: Number(state.multiplier.toFixed(2)),
    time: Number(state.time.toFixed(1)),
    bossHp: boss === null ? 0 : boss.hp,
  };
}
