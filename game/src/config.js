// Every tuning number, colour and label in ION DRIFT, in one place. The arena is a fixed
// 1280x720 logical space: the renderer scales it to the window and letterboxes the rest, so no
// rule below ever depends on the screen size or on the device pixel ratio.

export const ARENA = { width: 1280, height: 720, inset: 24 };

/** The simulation's fixed step: 60 updates a second whatever the display's refresh rate. */
export const STEP = 1 / 60;

export const HULL_MAX = 3;

export const SHIP = {
  radius: 16,
  /** Thrust in px/s^2; drag in 1/s, so the skiff coasts and slides instead of snapping. */
  accel: 1750,
  drag: 3.2,
  maxSpeed: 430,
  fireDelay: 0.1,
  bulletSpeed: 860,
  bulletLife: 1.18,
  bulletRadius: 3.2,
  /** The dash: a short, fast burst that makes the skiff untouchable on the way through. */
  dashSpeed: 1150,
  dashTime: 0.16,
  dashCooldown: 1.2,
  dashInvulnerable: 0.34,
  hurtInvulnerable: 1.45,
  hurtShake: 16,
  muzzle: 18,
  /** Trail samples: one every trailStep seconds, kept in a ring buffer. */
  trailCount: 30,
  trailStep: 0.018,
};

export const CRYSTAL = {
  radius: 13,
  value: 30,
  maxAlive: 8,
  spawnMin: 1.4,
  spawnMax: 2.6,
  dropChance: 0.32,
  drift: 24,
  lifespan: 20,
  /** Multiplier: each crystal lifts it a notch, and it bleeds away when you stop collecting. */
  step: 0.25,
  min: 1,
  max: 5,
  decayDelay: 2.6,
  decayRate: 0.5,
};

export const ENEMY = {
  seeker: { radius: 15, hp: 2, speed: 168, accel: 640, drag: 1.5, value: 100, damage: 1 },
  turret: { radius: 17, hp: 5, speed: 46, fireDelay: 2.4, bulletSpeed: 245, value: 140, damage: 1 },
  splitter: { radius: 21, hp: 4, speed: 108, accel: 460, drag: 1.2, value: 150, damage: 1, children: 2 },
  shard: { radius: 11, hp: 2, speed: 188, accel: 720, drag: 1.0, value: 60, damage: 1 },
  asteroid: { radiusMin: 20, radiusMax: 38, hp: 5, speedMin: 55, speedMax: 130, value: 40, damage: 1, spin: 1.2 },
  boss: {
    radius: 56,
    hp: 150,
    value: 5000,
    damage: 1,
    driftSpeed: 78,
    /** Phase thresholds as a fraction of max hull; the boss falls through them in order. */
    beamAt: 0.62,
    chargeAt: 0.3,
    radialEvery: 2.05,
    radialShots: 16,
    radialSpeed: 205,
    beamSweep: 1.15,
    beamWidth: 17,
    beamTime: 2.5,
    beamWarmup: 0.85,
    beamRest: 1.1,
    chargeWarmup: 0.85,
    chargeTime: 0.75,
    chargeSpeed: 820,
    chargeRest: 1.3,
  },
};

export const BULLET = {
  /** Pools: allocated once at boot, never grown, so a long run allocates nothing. */
  playerRadius: 3.2,
  enemyRadius: 5.4,
};

export const POOLS = {
  bullets: 340,
  enemies: 44,
  crystals: 14,
  particles: 900,
  popups: 40,
};

export const PARTICLE = {
  sparkLife: 0.55,
  smokeLife: 0.9,
  ringLife: 0.45,
  maxLife: 1.4,
};

/** Wave pacing, in seconds: the pause between waves and the length of the wave banner. */
export const WAVE = {
  intro: 2.1,
  cleared: 2.4,
  bossIntro: 3.2,
};

export const SCORE = {
  waveClear: 250,
  bossKill: 5000,
};

export const COLORS = {
  void: '#04060e',
  deep: '#080d1c',
  fogA: '#1d2b63',
  fogB: '#4a1d5c',
  fogC: '#0f3c48',
  grid: 'rgba(86, 232, 255, 0.07)',
  rim: 'rgba(120, 220, 255, 0.35)',
  hull: '#7df9ff',
  hullDim: 'rgba(125, 249, 255, 0.18)',
  ship: '#dff6ff',
  shipLine: '#56e8ff',
  flame: '#8ff0ff',
  bullet: '#b9f4ff',
  enemyBullet: '#ff5c72',
  seeker: '#ff5c82',
  turret: '#ff8a3d',
  splitter: '#b07cff',
  shard: '#d6b8ff',
  asteroid: '#79839b',
  asteroidLine: '#aab4c8',
  boss: '#ff2d5e',
  bossCore: '#ffd166',
  beam: '#ff2f6b',
  crystal: '#7df9ff',
  popup: '#ffe9a8',
  crystalCore: '#ffffff',
  text: '#e8f6ff',
  muted: '#8fa5c7',
  warn: '#ff6b7d',
  good: '#7dffb2',
  accent: '#ffc857',
  panel: 'rgba(6, 12, 26, 0.86)',
  panelLine: 'rgba(120, 220, 255, 0.35)',
};

/** Local system faces only: nothing is fetched, so the game runs offline. */
export const FONTS = {
  display: '900 {size}px ui-sans-serif, system-ui, "Segoe UI", Helvetica, Arial, sans-serif',
  ui: '600 {size}px ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  mono: '400 {size}px ui-monospace, "SF Mono", Menlo, Consolas, monospace',
};

export const TEXT = {
  title: 'ION DRIFT',
  subtitle: 'Mining skiff seven. Nebula collapsing. Five waves between you and open space.',
  start: 'PRESS SPACE OR CLICK TO LAUNCH',
  restart: 'PRESS R TO FLY AGAIN',
  winTitle: 'NEBULA CLEARED',
  winSub: 'The Warden is scrap. The drift is quiet again.',
  loseTitle: 'HULL BREACH',
  loseSub: 'The nebula keeps what it takes.',
  pauseTitle: 'PAUSED',
  pauseSub: 'Press P to resume',
};
