// The world: one plain-data state, one seeded random source, and the fixed step that advances it.
// The update order is the game's spine — aim, skiff, shots, drones, crystals, effects, wave
// director, then collision — and it never varies, so a seed plus a list of inputs replays a run
// exactly. Nothing here draws; nothing here knows what a screen is.
import { ARENA, CRYSTAL, HULL_MAX, SHIP, STEP } from './config.js';
import { createRandom } from './rng.js';
import {
  EVENT_BOSS_PHASE,
  EVENT_DASH,
  EVENT_FIRE,
  EVENT_HULL,
  EVENT_KILL,
  EVENT_OVER,
  EVENT_PICKUP,
  EVENT_SHOT_HIT,
  EVENT_WAVE,
  EVENT_WIN,
  KIND_BOSS,
  clearPools,
  createPools,
  createShip,
  findBoss,
  nearestTarget,
  resetShip,
  updateBullet,
  updateCrystal,
  updateEnemy,
  updateParticles,
  updatePopups,
  updateShip,
} from './entities.js';
import { createDirector, startWave, updateBoss, updateDirector } from './waves.js';
import { resolveCombat } from './combat.js';

export {
  EVENT_BOSS_PHASE,
  EVENT_DASH,
  EVENT_FIRE,
  EVENT_HULL,
  EVENT_KILL,
  EVENT_OVER,
  EVENT_PICKUP,
  EVENT_SHOT_HIT,
  EVENT_WAVE,
  EVENT_WIN,
};

export const PHASE_INTRO = 'intro';
export const PHASE_FIGHT = 'fight';
export const PHASE_CLEARED = 'cleared';
export const PHASE_WON = 'won';
export const PHASE_LOST = 'lost';

/** Controls with nothing pressed: the neutral state for the title backdrop and the first frame. */
export function neutralControls(aimAngle) {
  return { moveX: 0, moveY: 0, aimAngle: aimAngle ?? -Math.PI / 2, aimAtPointer: false, firing: false, dash: false };
}

/**
 * Aim: the mouse when it moved recently, otherwise the nearest threat, with a little lead so that
 * auto-aim at a crossing seeker actually connects. Travel time is what makes shots feel physical.
 */
function resolveAim(state, controls) {
  const ship = state.ship;
  let angle = ship.aimAngle;
  if (controls.aimAtPointer) {
    angle = Math.atan2(controls.aimY - ship.y, controls.aimX - ship.x);
  } else {
    const target = nearestTarget(state, ship.x, ship.y, 1200);
    if (target !== null) {
      const distance = Math.hypot(target.x - ship.x, target.y - ship.y);
      const flight = distance / SHIP.bulletSpeed;
      const aimX = target.x + target.vx * flight * 0.6;
      const aimY = target.y + target.vy * flight * 0.6;
      angle = Math.atan2(aimY - ship.y, aimX - ship.x);
    }
  }
  // Both the ship (where the cannon points) and the frame's controls (what the hull turns toward)
  // get the resolved angle; leaving the controls behind is what froze the hull before.
  ship.aimAngle = angle;
  controls.aimAngle = angle;
}

export function createWorld(seed) {
  let random = createRandom(seed);
  const pools = createPools();
  const state = {
    seed,
    random,
    time: 0,
    phase: PHASE_INTRO,
    phaseTimer: 0,
    waveIndex: 0,
    waveName: '',
    waveSubtitle: '',
    ship: createShip(),
    bullets: pools.bullets,
    enemies: pools.enemies,
    crystals: pools.crystals,
    crystalsCollected: 0,
    particles: pools.particles,
    popups: pools.popups,
    boss: null,
    director: createDirector(),
    score: 0,
    crystalScore: 0,
    killScore: 0,
    kills: 0,
    multiplier: CRYSTAL.min,
    multiplierPeak: CRYSTAL.min,
    multiplierIdle: 0,
    shake: 0,
    flash: 0,
    banner: null,
    hullMax: HULL_MAX,
  };

  // A reused control packet for the harmless backdrop, so the title screen allocates nothing.
  const backdropControls = { moveX: 0, moveY: 0, aimAngle: -Math.PI / 2, aimAtPointer: false, firing: false, dash: false };

  function reset() {
    random = createRandom(seed);
    state.random = random;
    clearPools(state);
    resetShip(state.ship);
    state.time = 0;
    state.phase = PHASE_INTRO;
    state.phaseTimer = 0;
    state.waveIndex = 0;
    state.waveName = '';
    state.waveSubtitle = '';
    state.boss = null;
    state.score = 0;
    state.crystalScore = 0;
    state.killScore = 0;
    state.kills = 0;
    state.crystalsCollected = 0;
    state.multiplier = CRYSTAL.min;
    state.multiplierPeak = CRYSTAL.min;
    state.multiplierIdle = 0;
    state.shake = 0;
    state.flash = 0;
    state.banner = null;
    state.hullMax = HULL_MAX;
    state.director = createDirector();
    startWave(state, 0);
  }

  /**
   * One fixed step. `controls` carries intent only (axes, aim angle, trigger, dash); `options.harmless`
   * runs the world as a backdrop: things move and spawn, nothing collides, nothing fires.
   */
  function step(dt, controls, options) {
    const harmless = options !== undefined && options.harmless === true;
    const frozen = state.phase === PHASE_WON || state.phase === PHASE_LOST;
    if (frozen) {
      updateParticles(state, dt);
      updatePopups(state, dt);
      decayFeedback(state, dt);
      return 0;
    }

    let events = 0;
    state.time += dt;

    if (!harmless) {
      resolveAim(state, controls);
      events |= updateShip(state.ship, controls, dt, state);
    } else {
      state.ship.invulnerable = 1;
      backdropControls.moveX = controls.moveX;
      backdropControls.moveY = controls.moveY;
      backdropControls.aimAngle = controls.aimAngle;
      events |= updateShip(state.ship, backdropControls, dt, state);
    }

    for (let index = 0; index < state.bullets.length; index += 1) {
      if (state.bullets[index].active) updateBullet(state.bullets[index], dt);
    }
    for (let index = 0; index < state.crystals.length; index += 1) {
      if (state.crystals[index].active) updateCrystal(state.crystals[index], dt);
    }
    for (let index = 0; index < state.enemies.length; index += 1) {
      const enemy = state.enemies[index];
      if (!enemy.active) continue;
      if (enemy.kind === KIND_BOSS) events |= updateBoss(enemy, state, dt);
      else updateEnemy(enemy, state, dt);
    }

    updateParticles(state, dt);
    updatePopups(state, dt);
    events |= updateDirector(state, dt);

    state.boss = findBoss(state);
    if (!harmless) events |= resolveCombat(state, dt);
    if (state.boss !== null && state.boss.beamActive) state.shake = Math.max(state.shake, 2.4);

    decayFeedback(state, dt);
    if (state.banner !== null) {
      state.banner.timer -= dt;
      if (state.banner.timer <= 0) state.banner = null;
    }
    return events;
  }

  return { state, reset, step, seed, startWave: (index) => startWave(state, index) };
}

/** Shake and the white hit flash fade on their own clock, independent of the simulation. */
function decayFeedback(state, dt) {
  state.shake = state.shake > 0.05 ? state.shake * Math.exp(-6.5 * dt) : 0;
  state.flash = Math.max(0, state.flash - dt * 2.4);
}

/** Where the skiff's nose points, for the renderer's muzzle glow. */
export function shipNose(ship, distance) {
  return { x: ship.x + Math.cos(ship.angle) * distance, y: ship.y + Math.sin(ship.angle) * distance };
}

/** The arena centre, used by the staging camera and the boss's hover anchor. */
export const ARENA_CENTRE = { x: ARENA.width / 2, y: ARENA.height / 2 };

/** The fixed step the whole game runs on. Re-exported so main.js and shots.js share one clock. */
export const FIXED_STEP = STEP;
