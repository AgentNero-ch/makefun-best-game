// One seeded random source for the whole game. mulberry32 is small, fast and good enough for a
// game world; the point is that the same seed replays the same run, frame for frame, which is what
// makes the screenshot scenes (and the determinism test) work.

export function createRandom(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A float in [min, max). */
export function randomRange(random, min, max) {
  return min + random() * (max - min);
}

/** Shorthand for randomRange, used by the renderer's star and dust generation. */
export const range = randomRange;

/** An integer in [min, max]. */
export function rangeInt(random, min, max) {
  return min + Math.floor(random() * (max - min + 1));
}

/** A random element of `list`. */
export function pick(random, list) {
  return list[Math.floor(random() * list.length) % list.length];
}

/** An angle in [0, 2pi). */
export function angle(random) {
  return random() * Math.PI * 2;
}
