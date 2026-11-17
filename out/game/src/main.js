// Boot and the one loop. The simulation runs on a fixed 1/60 s step, several steps in a slow frame
// and none in a fast one, so speeds and collisions are the same on every machine; the renderer
// paints whatever the world holds. Four screens: title, play, paused and the two endings.
//
//   ?seed=N              fixes the world (defaults to 7, so a plain open is reproducible)
//   ?shot=start|play|win|end   stages that screenshot scene instead of running the loop
import { STEP } from './config.js';
import { createWorld, neutralControls } from './world.js';
import { ACTION_CONFIRM, ACTION_DASH, ACTION_MUTE, ACTION_PAUSE, ACTION_RESTART, createInput } from './input.js';
import {
  SCREEN_LOST,
  SCREEN_PAUSED,
  SCREEN_PLAY,
  SCREEN_TITLE,
  SCREEN_WON,
  drawBanner,
  drawHud,
  drawScreen,
} from './hud.js';
import { createRenderer } from './render.js';
import { createAudio } from './audio.js';
import { createRandom } from './rng.js';
import { stageShot } from './shots.js';

/** The longest frame the loop will catch up on; a longer stall (a hidden tab) is dropped. */
const MAX_FRAME = 0.25;
const DEFAULT_SEED = 7;
const BEST_KEY = 'ion-drift.best';

const params = new URLSearchParams(window.location.search);
const shotName = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : DEFAULT_SEED;

// Determinism: the seeded generator takes over Math.random for the whole page before anything else
// runs, so even the unseeded corners (noise buffers, tie-breaks) repeat exactly for a given seed.
Math.random = createRandom(seed ^ 0x1a2b3c4d);

const canvas = document.getElementById('game');
const statusLine = document.getElementById('status');

const world = createWorld(seed);
const renderer = createRenderer(canvas, seed);
const audio = createAudio();
const input = createInput(canvas, (x, y) => renderer.toArena(x, y));

// A read-only handle for the capture harness, the tests and anyone curious in the console.
window.__ionDrift = {
  state: world.state,
  audio,
  input,
  get screen() {
    return screen;
  },
};

let screen = SCREEN_TITLE;
let best = 0;
let muted = false;
let dashQueued = false;
let accumulator = 0;
let lastFrame = performance.now();

function readBest() {
  try {
    return Number.parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Storage can be off (private windows): the best score then lasts this visit only.
  }
}

/** Screen readers and anyone reading the page's text hear the state changes. */
function announce(message) {
  if (statusLine !== null) statusLine.textContent = message;
}

function startRun() {
  audio.unlock();
  audio.play('start');
  world.reset();
  accumulator = 0;
  dashQueued = false;
  screen = SCREEN_PLAY;
  announce('Ion Drift. Wave one. Three hull, harvest the crystals.');
}

function finishRun(won) {
  if (world.state.score > best) {
    best = world.state.score;
    saveBest(best);
  }
  screen = won ? SCREEN_WON : SCREEN_LOST;
  // Clear floating score text so the summary reads over a quiet field, not a stack of popups.
  for (const popup of world.state.popups) popup.active = false;
  audio.play(won ? 'win' : 'lose');
  announce(`${won ? 'Nebula cleared' : 'Hull breach'}. Final score ${world.state.score}. Press R to fly again.`);
}

/** Sound effects from the event bits the simulation returned. */
function soundFor(events) {
  if (events === 0) return;
  if (events & 1) audio.play('fire');
  if (events & 2) audio.play('dash');
  if (events & 4) audio.play('pickup');
  if (events & 8) audio.play('hit');
  if (events & 16) audio.play('kill');
  if (events & 32) audio.play('hull');
  if (events & 64) audio.play('wave');
  if (events & 128) audio.play('phase');
  if (events & 1024) audio.play('bossShot');
}

/** One fixed step of the live game, with the input read fresh for that step. */
function stepPlay(dt) {
  const move = input.move();
  const pointer = input.pointer();
  const controls = {
    moveX: move.x,
    moveY: move.y,
    aimAngle: world.state.ship.angle,
    aimX: pointer.x,
    aimY: pointer.y,
    aimAtPointer: pointer.active,
    firing: input.firing(),
    dash: dashQueued,
  };
  dashQueued = false;
  const events = world.step(dt, controls, { harmless: false });
  soundFor(events);
  if (events & 512) finishRun(false);
  else if (events & 256) finishRun(true);
}

/** The title screen's backdrop: the world runs, nothing hurts, the skiff drifts on a slow orbit. */
function stepTitle(dt) {
  const t = world.state.time;
  const controls = neutralControls(world.state.ship.angle);
  controls.moveX = Math.cos(t * 0.55) * 0.55;
  controls.moveY = Math.sin(t * 0.4) * 0.45;
  controls.aimAngle = Math.atan2(360 - world.state.ship.y, 640 - world.state.ship.x);
  world.step(dt, controls, { harmless: true });
}

function handleActions() {
  const actions = input.takeActions();
  if (actions & ACTION_MUTE) {
    muted = audio.toggleMute();
    announce(muted ? 'Sound off.' : 'Sound on.');
  }
  if (screen === SCREEN_TITLE) {
    if (actions & ACTION_CONFIRM) startRun();
    return;
  }
  if (screen === SCREEN_WON || screen === SCREEN_LOST) {
    if (actions & (ACTION_RESTART | ACTION_CONFIRM)) startRun();
    return;
  }
  if (actions & ACTION_DASH) dashQueued = true;
  if (actions & ACTION_PAUSE) {
    if (screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    } else {
      screen = SCREEN_PLAY;
      announce('Playing.');
    }
  }
  if (screen === SCREEN_PAUSED && actions & ACTION_CONFIRM) {
    screen = SCREEN_PLAY;
    announce('Playing.');
  }
}

function render() {
  const state = world.state;
  const ui = { best, muted };
  renderer.beginFrame(state);
  renderer.drawWorld(state);
  if (screen === SCREEN_PLAY || screen === SCREEN_PAUSED) drawHud(renderer.context, state, ui);
  if (screen === SCREEN_PLAY || screen === SCREEN_PAUSED) drawBanner(renderer.context, state);
  drawScreen(renderer.context, screen, state, ui);
}

function frame(now) {
  requestAnimationFrame(frame);
  const elapsed = Math.min((now - lastFrame) / 1000, MAX_FRAME);
  lastFrame = now;
  handleActions();

  if (screen === SCREEN_PLAY || screen === SCREEN_TITLE) {
    accumulator += elapsed;
    while (accumulator >= STEP) {
      accumulator -= STEP;
      if (screen === SCREEN_PLAY) stepPlay(STEP);
      else if (screen === SCREEN_TITLE) stepTitle(STEP);
      else break;
    }
  } else {
    accumulator = 0;
  }
  render();
}

/** Stage a screenshot scene: advance the real rules, paint it twice, then flag it ready. */
function runShot(name) {
  const scene = stageShot(name, world);
  screen = scene.screen;
  best = 0;
  let painted = 0;
  function paint() {
    render();
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && screen === SCREEN_PLAY) {
    screen = SCREEN_PAUSED;
    announce('Paused.');
  }
});

if (shotName !== null) {
  runShot(shotName);
} else {
  best = readBest();
  world.reset();
  announce('Ion Drift. Press Space or click to launch.');
  requestAnimationFrame(frame);
}
