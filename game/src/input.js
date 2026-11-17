// Keyboard and pointer input. Held state (movement, trigger) is read as a snapshot each frame;
// one-shot presses (start, restart, pause, dash) are queued as bit flags and taken exactly once by
// the loop, so a press between two frames is never lost and never counted twice.
//
// Mouse position is converted to arena coordinates by the caller's `toArena` function, because only
// the renderer knows how the 1280x720 field is scaled into the window.

export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_DASH = 4;
export const ACTION_RESTART = 8;
export const ACTION_MUTE = 16;

const UP = new Set(['ArrowUp', 'KeyW']);
const DOWN = new Set(['ArrowDown', 'KeyS']);
const LEFT = new Set(['ArrowLeft', 'KeyA']);
const RIGHT = new Set(['ArrowRight', 'KeyD']);
const FIRE = new Set(['Space']);
const DASH = new Set(['ShiftLeft', 'ShiftRight', 'KeyJ']);
const CONFIRM = new Set(['Enter', 'Space']);
const PAUSE = new Set(['KeyP', 'Escape']);
const RESTART = new Set(['KeyR']);
const MUTE = new Set(['KeyM']);

/** How long, in seconds, after the last pointer move the mouse keeps steering the skiff's aim. */
export const POINTER_HOLD = 2.4;

export function createInput(canvas, toArena) {
  const held = { up: false, down: false, left: false, right: false, fire: false };
  let actions = 0;
  let pointerX = 0;
  let pointerY = 0;
  let pointerActive = false;
  let pointerMovedAt = -Infinity;

  function movePointer(clientX, clientY) {
    const point = toArena(clientX, clientY);
    pointerX = point.x;
    pointerY = point.y;
    pointerActive = true;
    pointerMovedAt = performance.now() / 1000;
  }

  window.addEventListener('keydown', (event) => {
    if (event.repeat) {
      if (UP.has(event.code) || DOWN.has(event.code) || LEFT.has(event.code) || RIGHT.has(event.code) || FIRE.has(event.code)) event.preventDefault();
      return;
    }
    if (UP.has(event.code)) held.up = true;
    else if (DOWN.has(event.code)) held.down = true;
    else if (LEFT.has(event.code)) held.left = true;
    else if (RIGHT.has(event.code)) held.right = true;
    else if (FIRE.has(event.code)) held.fire = true;
    else if (DASH.has(event.code)) actions |= ACTION_DASH;
    else if (PAUSE.has(event.code)) actions |= ACTION_PAUSE;
    else if (RESTART.has(event.code)) actions |= ACTION_RESTART;
    else if (MUTE.has(event.code)) actions |= ACTION_MUTE;
    if (CONFIRM.has(event.code) && !event.repeat) actions |= ACTION_CONFIRM;
    if (UP.has(event.code) || DOWN.has(event.code) || LEFT.has(event.code) || RIGHT.has(event.code) || FIRE.has(event.code) || CONFIRM.has(event.code)) {
      event.preventDefault();
    }
  });

  window.addEventListener('keyup', (event) => {
    if (UP.has(event.code)) held.up = false;
    else if (DOWN.has(event.code)) held.down = false;
    else if (LEFT.has(event.code)) held.left = false;
    else if (RIGHT.has(event.code)) held.right = false;
    else if (FIRE.has(event.code)) held.fire = false;
  });

  // A key released while the tab is hidden never sends keyup: let go of everything on blur.
  function releaseAll() {
    held.up = false;
    held.down = false;
    held.left = false;
    held.right = false;
    held.fire = false;
  }
  window.addEventListener('blur', releaseAll);

  canvas.addEventListener('pointermove', (event) => movePointer(event.clientX, event.clientY));
  canvas.addEventListener('pointerdown', (event) => {
    movePointer(event.clientX, event.clientY);
    actions |= ACTION_CONFIRM;
    if (event.button === 0) held.fire = true;
    canvas.setPointerCapture?.(event.pointerId);
  });
  window.addEventListener('pointerup', (event) => {
    if (event.button === 0) held.fire = false;
  });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  return {
    /** Movement axes in [-1, 1], already normalised for diagonals. */
    move() {
      let x = (held.right ? 1 : 0) - (held.left ? 1 : 0);
      let y = (held.down ? 1 : 0) - (held.up ? 1 : 0);
      if (x !== 0 && y !== 0) {
        const scale = Math.SQRT1_2;
        x *= scale;
        y *= scale;
      }
      return { x, y };
    },
    /** Whether the trigger is held (Space or the left mouse button). */
    firing() {
      return held.fire;
    },
    /** The pointer in arena coordinates, and whether it moved recently enough to steer the aim. */
    pointer() {
      const now = performance.now() / 1000;
      return { x: pointerX, y: pointerY, active: pointerActive && now - pointerMovedAt < POINTER_HOLD };
    },
    /** The one-shot presses since the last call, as ACTION_* bit flags. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
    releaseAll,
  };
}
