// The interface: hull pips, score, multiplier, the wave clock, the Warden's health, the dash meter,
// the wave banner, and the four full screens (title, paused, victory, defeat). It draws on top of
// the world in the same 1280x720 space, so the HUD never shakes and never scales differently from
// the arena. Nothing here advances the simulation.
import { ARENA, COLORS, CRYSTAL, FONTS, HULL_MAX, SHIP, TEXT } from './config.js';
import { WAVES } from './waves.js';
import { countEnemies } from './entities.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_WON = 'won';
export const SCREEN_LOST = 'lost';

const fontCache = new Map();

function font(template, size) {
  const key = `${template}${size}`;
  const hit = fontCache.get(key);
  if (hit !== undefined) return hit;
  const built = FONTS[template].replace('{size}', String(size));
  fontCache.set(key, built);
  return built;
}

function text(ctx, value, x, y, size, color, align = 'left', template = 'ui') {
  ctx.font = font(template, size);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(value, x, y);
}

/** Letter-spaced capitals, drawn a glyph at a time: the title needs the air between the letters. */
function spacedText(ctx, value, x, y, size, spacing, color, align = 'center') {
  ctx.font = font('display', size);
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  const widths = [];
  let total = 0;
  for (const character of value) {
    const width = ctx.measureText(character).width;
    widths.push(width);
    total += width + spacing;
  }
  total -= spacing;
  let cursor = align === 'center' ? x - total / 2 : x;
  for (let index = 0; index < value.length; index += 1) {
    ctx.fillText(value[index], cursor, y);
    cursor += widths[index] + spacing;
  }
  return total;
}

/** The wordmark: ION in white, DRIFT in cyan, one measured block so the seam never collides. */
function wordmark(ctx, centerX, y, size, spacing) {
  ctx.font = font('display', size);
  const left = ['I', 'O', 'N'];
  const right = ['D', 'R', 'I', 'F', 'T'];
  const gap = size * 0.3;
  let leftWidth = 0;
  for (const glyph of left) leftWidth += ctx.measureText(glyph).width + spacing;
  let rightWidth = 0;
  for (const glyph of right) rightWidth += ctx.measureText(glyph).width + spacing;
  let cursor = centerX - (leftWidth + rightWidth + gap) / 2;
  ctx.textAlign = 'left';
  for (const glyph of left) {
    ctx.fillStyle = COLORS.text;
    ctx.fillText(glyph, cursor, y);
    cursor += ctx.measureText(glyph).width + spacing;
  }
  cursor += gap - spacing;
  for (const glyph of right) {
    ctx.fillStyle = COLORS.hull;
    ctx.fillText(glyph, cursor, y);
    cursor += ctx.measureText(glyph).width + spacing;
  }
  return leftWidth + rightWidth + gap;
}

function timeText(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function scoreText(score) {
  return String(Math.round(score)).padStart(6, '0');
}

function panel(ctx, x, y, width, height, tint) {
  ctx.save();
  ctx.fillStyle = COLORS.panel;
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = COLORS.panelLine;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
  ctx.strokeStyle = tint;
  ctx.lineWidth = 2;
  const corner = 18;
  const marks = [
    [x, y, 1, 1],
    [x + width, y, -1, 1],
    [x, y + height, 1, -1],
    [x + width, y + height, -1, -1],
  ];
  for (const [cx, cy, dx, dy] of marks) {
    ctx.beginPath();
    ctx.moveTo(cx + dx * corner, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + dy * corner);
    ctx.stroke();
  }
  ctx.restore();
}

function scanlines(ctx, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#7df9ff';
  for (let y = 0; y < ARENA.height; y += 4) ctx.fillRect(0, y, ARENA.width, 1);
  ctx.restore();
}

function hullPip(ctx, x, y, width, height, filled) {
  // A forward chevron: hull reads as "you", never as one of the arena's hexagons.
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + width * 0.72, y);
  ctx.lineTo(x + width, y + height * 0.5);
  ctx.lineTo(x + width * 0.72, y + height);
  ctx.lineTo(x, y + height);
  ctx.lineTo(x + width * 0.28, y + height * 0.5);
  ctx.closePath();
  if (filled) {
    ctx.fillStyle = COLORS.hull;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.stroke();
  } else {
    ctx.fillStyle = 'rgba(125, 249, 255, 0.07)';
    ctx.fill();
    ctx.strokeStyle = COLORS.hullDim;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

/** The live HUD. `ui.best` is the stored best score, `ui.muted` the sound state. */
export function drawHud(ctx, state, ui) {
  ctx.save();
  ctx.textBaseline = 'alphabetic';

  // Scrims: the interface sits on its own dark bands so nothing in the arena fights the numbers.
  const topScrim = ctx.createLinearGradient(0, 0, 0, 150);
  topScrim.addColorStop(0, 'rgba(3, 7, 16, 0.92)');
  topScrim.addColorStop(0.72, 'rgba(3, 7, 16, 0.55)');
  topScrim.addColorStop(1, 'rgba(3, 7, 16, 0)');
  ctx.fillStyle = topScrim;
  ctx.fillRect(0, 0, ARENA.width, 150);
  const bottomScrim = ctx.createLinearGradient(0, ARENA.height, 0, ARENA.height - 110);
  bottomScrim.addColorStop(0, 'rgba(3, 7, 16, 0.9)');
  bottomScrim.addColorStop(0.7, 'rgba(3, 7, 16, 0.45)');
  bottomScrim.addColorStop(1, 'rgba(3, 7, 16, 0)');
  ctx.fillStyle = bottomScrim;
  ctx.fillRect(0, ARENA.height - 110, ARENA.width, 110);

  // Hull, top left.
  text(ctx, 'HULL', 40, 52, 12, COLORS.muted, 'left', 'ui');
  for (let index = 0; index < HULL_MAX; index += 1) {
    hullPip(ctx, 40 + index * 40, 62, 30, 16, index < state.ship.hull);
  }

  // Wave clock, top centre, with a bar of how much of the wave is left and the boss's health.
  const wave = WAVES[state.waveIndex];
  text(ctx, `WAVE ${state.waveIndex + 1} / ${WAVES.length}`, ARENA.width / 2, 46, 12, COLORS.muted, 'center', 'ui');
  text(ctx, wave.name, ARENA.width / 2, 68, 18, COLORS.text, 'center', 'ui');

  const started = state.director.queueIndex;
  const remaining = Math.max(0, wave.count - started) + countEnemies(state);
  const cleared = wave.count > 0 ? Math.min(1, 1 - remaining / wave.count) : 1;
  const barWidth = 260;
  const barX = ARENA.width / 2 - barWidth / 2;
  ctx.fillStyle = 'rgba(125, 249, 255, 0.14)';
  ctx.fillRect(barX, 80, barWidth, 6);
  ctx.fillStyle = COLORS.hull;
  ctx.fillRect(barX, 80, barWidth * cleared, 6);

  const boss = state.boss;
  if (boss !== null && boss.active) {
    const bossWidth = 440;
    const bossX = ARENA.width / 2 - bossWidth / 2;
    text(ctx, 'THE WARDEN', ARENA.width / 2, 112, 12, COLORS.warn, 'center', 'ui');
    ctx.fillStyle = 'rgba(255, 47, 107, 0.15)';
    ctx.fillRect(bossX, 120, bossWidth, 10);
    ctx.fillStyle = COLORS.boss;
    ctx.fillRect(bossX, 120, bossWidth * Math.max(0, boss.hp / boss.maxHp), 10);
    ctx.strokeStyle = 'rgba(255, 140, 170, 0.7)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bossX + 0.5, 120.5, bossWidth - 1, 9);
    // Phase ticks: the boss's two turning points, marked on its own bar.
    for (const mark of [0.62, 0.3]) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.fillRect(bossX + bossWidth * mark, 118, 1.5, 14);
    }
    text(ctx, 'PHASE ' + (boss.phase + 1), bossX + bossWidth + 12, 130, 11, COLORS.muted, 'left', 'ui');
  }

  // Score and multiplier, top right.
  text(ctx, scoreText(state.score), ARENA.width - 40, 76, 38, COLORS.text, 'right', 'ui');
  text(ctx, 'SCORE', ARENA.width - 40, 48, 12, COLORS.muted, 'right', 'ui');
  const chipWidth = 96;
  const chipX = ARENA.width - 40 - chipWidth;
  const chipY = 86;
  ctx.fillStyle = 'rgba(255, 200, 87, 0.12)';
  ctx.fillRect(chipX, chipY, chipWidth, 24);
  ctx.strokeStyle = hexAlpha(COLORS.accent, 0.6);
  ctx.lineWidth = 1.2;
  ctx.strokeRect(chipX + 0.5, chipY + 0.5, chipWidth - 1, 23);
  text(ctx, `x${state.multiplier.toFixed(2)}`, chipX + 10, chipY + 17, 16, COLORS.accent, 'left', 'ui');
  // The streak timer: how long the multiplier has before it starts bleeding.
  const decay = Math.min(1, state.multiplierIdle / CRYSTAL.decayDelay);
  ctx.fillStyle = 'rgba(255, 200, 87, 0.25)';
  ctx.fillRect(chipX, chipY + 26, chipWidth, 3);
  ctx.fillStyle = COLORS.accent;
  ctx.fillRect(chipX, chipY + 26, chipWidth * (1 - decay), 3);

  // Dash meter, bottom left.
  const dashReady = state.ship.dashCooldown <= 0;
  const dashFill = dashReady ? 1 : 1 - state.ship.dashCooldown / SHIP.dashCooldown;
  text(ctx, 'DASH', 40, ARENA.height - 62, 12, dashReady ? COLORS.hull : COLORS.muted, 'left', 'ui');
  ctx.fillStyle = 'rgba(125, 249, 255, 0.14)';
  ctx.fillRect(40, ARENA.height - 52, 132, 8);
  ctx.fillStyle = dashReady ? COLORS.hull : 'rgba(125, 249, 255, 0.55)';
  ctx.fillRect(40, ARENA.height - 52, 132 * dashFill, 8);
  if (dashReady) {
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.25 * Math.sin(state.time * 8);
    ctx.fillStyle = COLORS.hull;
    ctx.fillRect(40, ARENA.height - 52, 132, 8);
    ctx.restore();
  }
  text(ctx, dashReady ? 'READY' : `${state.ship.dashCooldown.toFixed(1)}s`, 182, ARENA.height - 45, 11, COLORS.muted, 'left', 'ui');

  // Ion count and clock, bottom right.
  text(ctx, 'ION', ARENA.width - 118, ARENA.height - 62, 12, COLORS.muted, 'right', 'ui');
  text(ctx, String(state.crystalsCollected).padStart(2, '0'), ARENA.width - 118, ARENA.height - 38, 24, COLORS.crystal, 'right', 'ui');
  text(ctx, timeText(state.time), ARENA.width - 40, ARENA.height - 38, 22, COLORS.text, 'right', 'ui');
  text(ctx, 'TIME', ARENA.width - 40, ARENA.height - 62, 12, COLORS.muted, 'right', 'ui');

  // Controls, for the opening seconds only, then the field gets the space back.
  if (state.time < 11 && state.phase === 'fight') {
    const alpha = Math.min(1, Math.max(0, (11 - state.time) / 3));
    ctx.save();
    ctx.globalAlpha = alpha * 0.9;
    text(ctx, 'WASD / ARROWS  MOVE      MOUSE  AIM      SPACE  FIRE      SHIFT  DASH', ARENA.width / 2, ARENA.height - 26, 13, COLORS.muted, 'center', 'ui');
    ctx.restore();
  }

  if (ui.muted) text(ctx, 'MUTED', ARENA.width - 40, ARENA.height - 96, 11, COLORS.muted, 'right', 'ui');
  ctx.restore();
}

function hexAlpha(hex, alpha) {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

/** The wave banner: fades in fast, holds, fades out. */
export function drawBanner(ctx, state) {
  const banner = state.banner;
  if (banner === null) return;
  const fadeIn = Math.min(1, (banner.total - banner.timer) / 0.3);
  const fadeOut = Math.min(1, banner.timer / 0.7);
  const alpha = Math.max(0, Math.min(fadeIn, fadeOut));
  if (alpha <= 0) return;
  const tone = banner.tone === 2 ? COLORS.warn : banner.tone === 1 ? COLORS.good : COLORS.hull;
  ctx.save();
  ctx.globalAlpha = alpha;
  const y = 210;
  ctx.fillStyle = 'rgba(4, 6, 14, 0.55)';
  ctx.fillRect(0, y - 86, ARENA.width, 190);
  ctx.strokeStyle = hexAlpha(tone, 0.5);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ARENA.width * 0.18, y - 86);
  ctx.lineTo(ARENA.width * 0.82, y - 86);
  ctx.moveTo(ARENA.width * 0.18, y + 104);
  ctx.lineTo(ARENA.width * 0.82, y + 104);
  ctx.stroke();
  text(ctx, banner.title, ARENA.width / 2, y - 34, 16, tone, 'center', 'ui');
  spacedText(ctx, banner.text, ARENA.width / 2, y + 26, 54, 6, COLORS.text);
  text(ctx, banner.sub, ARENA.width / 2, y + 66, 16, COLORS.muted, 'center', 'ui');
  ctx.restore();
}

const TITLE_CONTROLS = [
  ['WASD / ARROWS', 'thrust, with drift'],
  ['MOUSE', 'aim the ion cannon'],
  ['SPACE', 'fire (auto-aims without a mouse)'],
  ['SHIFT', 'dash: brief invulnerability'],
  ['P / ESC', 'pause'],
];

function drawTitle(ctx, state, ui) {
  ctx.save();
  ctx.fillStyle = 'rgba(4, 6, 14, 0.62)';
  ctx.fillRect(0, 0, ARENA.width, ARENA.height);
  scanlines(ctx, 0.02);

  // A slow sweep behind the logo, so the title screen is not a still image.
  const sweep = (state.time * 90) % (ARENA.width + 400) - 200;
  const gradient = ctx.createLinearGradient(sweep - 200, 0, sweep + 200, ARENA.height);
  gradient.addColorStop(0, 'rgba(86, 232, 255, 0)');
  gradient.addColorStop(0.5, 'rgba(86, 232, 255, 0.09)');
  gradient.addColorStop(1, 'rgba(86, 232, 255, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, ARENA.width, ARENA.height);

  const wordWidth = wordmark(ctx, ARENA.width / 2, 200, 104, 9);
  const ruleWidth = wordWidth - 22;
  ctx.fillStyle = hexAlpha(COLORS.hull, 0.55);
  ctx.fillRect(ARENA.width / 2 - ruleWidth / 2, 224, ruleWidth, 2);
  ctx.fillStyle = hexAlpha(COLORS.hull, 0.9);
  ctx.fillRect(ARENA.width / 2 - ruleWidth / 2, 224, ruleWidth * 0.16, 2);

  text(ctx, TEXT.subtitle, ARENA.width / 2, 262, 17, COLORS.muted, 'center', 'mono');

  // The controls block is centred as a block, not as a left-aligned column.
  ctx.font = font('ui', 15);
  let keyWidth = 0;
  let actionWidth = 0;
  for (const row of TITLE_CONTROLS) {
    keyWidth = Math.max(keyWidth, ctx.measureText(row[0]).width);
    actionWidth = Math.max(actionWidth, ctx.measureText(row[1]).width);
  }
  const gap = 26;
  const blockWidth = keyWidth + gap + actionWidth;
  const blockLeft = ARENA.width / 2 - blockWidth / 2;
  for (let index = 0; index < TITLE_CONTROLS.length; index += 1) {
    const y = 336 + index * 33;
    text(ctx, TITLE_CONTROLS[index][0], blockLeft + keyWidth, y, 15, COLORS.hull, 'right', 'ui');
    text(ctx, TITLE_CONTROLS[index][1], blockLeft + keyWidth + gap, y, 15, COLORS.text, 'left', 'mono');
  }

  text(ctx, 'Clear five waves. Harvest the drift. Kill the Warden.', ARENA.width / 2, 522, 16, hexAlpha(COLORS.accent, 0.85), 'center', 'mono');

  const blink = 0.86 + 0.14 * Math.sin(state.time * 4.4);
  const width = 372;
  const promptX = ARENA.width / 2 - width / 2;
  ctx.save();
  ctx.globalAlpha = blink;
  ctx.fillStyle = 'rgba(86, 232, 255, 0.08)';
  ctx.fillRect(promptX, 570, width, 44);
  ctx.strokeStyle = hexAlpha(COLORS.hull, 0.6);
  ctx.lineWidth = 1;
  ctx.strokeRect(promptX + 0.5, 570.5, width - 1, 43);
  text(ctx, TEXT.start, ARENA.width / 2, 598, 20, '#ffffff', 'center', 'ui');
  ctx.restore();
  if (ui.best > 0) text(ctx, `BEST  ${scoreText(ui.best)}`, ARENA.width / 2, 642, 14, COLORS.muted, 'center', 'ui');
  text(ctx, 'AN ORIGINAL BROWSER ARCADE GAME  -  FIVE WAVES, ONE SKIFF', ARENA.width / 2, 690, 11, 'rgba(143, 165, 199, 0.65)', 'center', 'ui');
  ctx.restore();
}

/** Thousands separators, so a five-digit score contribution stays readable. */
function grouped(value) {
  return Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * The run in four rows: what the crystals were worth, what the drones were worth, the best streak,
 * and the clock. Points sit in one right-aligned column; counts live in the label, so no number is
 * ever attached to the wrong noun.
 */
/**
 * The run in four rows: what the crystals were worth, what the drones were worth, the best streak,
 * and the clock. Counts and points get their own columns with a header, so no number is ever
 * attached to the wrong noun.
 */
function breakdownRows(state) {
  return [
    { label: 'ION CRYSTALS', count: String(state.crystalsCollected), points: grouped(state.crystalScore) },
    { label: 'DRONES DESTROYED', count: String(state.kills), points: grouped(state.killScore) },
    { label: 'PEAK MULTIPLIER', count: '\u2014', points: `${state.multiplierPeak.toFixed(2)}\u00d7` },
    { label: 'RUN TIME', count: '\u2014', points: timeText(state.time) },
  ];
}

function drawSummary(ctx, state, screen, ui) {
  const won = screen === SCREEN_WON;
  const tint = won ? COLORS.good : COLORS.warn;
  ctx.save();
  // Dim the frozen battle, do not erase it: the edges stay readable so the ending still shows the
  // wave that did this, while a soft pool of shadow under the panel keeps the type clean.
  ctx.fillStyle = won ? 'rgba(3, 12, 10, 0.34)' : 'rgba(12, 3, 8, 0.36)';
  ctx.fillRect(0, 0, ARENA.width, ARENA.height);
  const pool = ctx.createRadialGradient(ARENA.width / 2, ARENA.height / 2, 120, ARENA.width / 2, ARENA.height / 2, 520);
  pool.addColorStop(0, 'rgba(2, 4, 10, 0.72)');
  pool.addColorStop(0.7, 'rgba(2, 4, 10, 0.42)');
  pool.addColorStop(1, 'rgba(2, 4, 10, 0)');
  ctx.fillStyle = pool;
  ctx.fillRect(0, 0, ARENA.width, ARENA.height);
  scanlines(ctx, 0.02);

  const width = 700;
  const height = 472;
  const x = (ARENA.width - width) / 2;
  const y = (ARENA.height - height) / 2;
  panel(ctx, x, y, width, height, tint);

  const left = x + 76;
  const right = x + width - 76;
  const countX = right - 210;

  text(ctx, won ? 'MISSION COMPLETE' : 'RUN ENDED', ARENA.width / 2, y + 44, 13, COLORS.muted, 'center', 'ui');
  spacedText(ctx, won ? TEXT.winTitle : TEXT.loseTitle, ARENA.width / 2, y + 88, 44, 5, tint);
  text(ctx, won ? TEXT.winSub : TEXT.loseSub, ARENA.width / 2, y + 120, 15, COLORS.muted, 'center', 'mono');

  ctx.fillStyle = hexAlpha(tint, 0.55);
  ctx.fillRect(left, y + 142, right - left, 1);

  text(ctx, 'COUNT', countX, y + 168, 10, COLORS.muted, 'right', 'ui');
  text(ctx, 'POINTS', right, y + 168, 10, COLORS.muted, 'right', 'ui');

  const rows = breakdownRows(state);
  for (let index = 0; index < rows.length; index += 1) {
    const rowY = y + 202 + index * 34;
    text(ctx, rows[index].label, left, rowY, 15, COLORS.muted, 'left', 'ui');
    text(ctx, rows[index].count, countX, rowY, 15, COLORS.hull, 'right', 'mono');
    text(ctx, rows[index].points, right, rowY, 16, COLORS.text, 'right', 'mono');
  }

  ctx.fillStyle = hexAlpha(tint, 0.55);
  ctx.fillRect(left, y + 342, right - left, 1);
  text(ctx, 'FINAL SCORE', left, y + 378, 15, COLORS.muted, 'left', 'ui');
  text(ctx, scoreText(state.score), right, y + 388, 46, COLORS.text, 'right', 'ui');
  if (ui.best > 0) text(ctx, `BEST  ${scoreText(ui.best)}`, right, y + 410, 12, COLORS.muted, 'right', 'ui');

  // The restart prompt gets a real affordance: a keycap and a border, not just a sentence.
  const promptY = y + height - 46;
  ctx.fillStyle = hexAlpha(tint, 0.1);
  ctx.fillRect(left, promptY - 28, right - left, 40);
  ctx.strokeStyle = hexAlpha(tint, 0.45);
  ctx.lineWidth = 1;
  ctx.strokeRect(left + 0.5, promptY - 27.5, right - left - 1, 39);
  ctx.strokeStyle = hexAlpha(tint, 0.8);
  ctx.strokeRect(left + 16.5, promptY - 19.5, 24, 22);
  text(ctx, 'R', left + 28.5, promptY - 3, 14, tint, 'center', 'ui');
  text(ctx, 'RESTART THE RUN', left + 54, promptY - 3, 15, COLORS.text, 'left', 'ui');

  ctx.restore();
}

function drawPaused(ctx, state) {
  ctx.save();
  ctx.fillStyle = 'rgba(4, 6, 14, 0.7)';
  ctx.fillRect(0, 0, ARENA.width, ARENA.height);
  const width = 460;
  const height = 210;
  const x = (ARENA.width - width) / 2;
  const y = (ARENA.height - height) / 2;
  panel(ctx, x, y, width, height, COLORS.hull);
  spacedText(ctx, TEXT.pauseTitle, ARENA.width / 2, y + 92, 40, 8, COLORS.text);
  text(ctx, TEXT.pauseSub, ARENA.width / 2, y + 138, 16, COLORS.muted, 'center', 'ui');
  text(ctx, 'M toggles sound', ARENA.width / 2, y + 170, 13, COLORS.muted, 'center', 'mono');
  ctx.restore();
}

/** Paint the overlay for the current screen. The world is already on the canvas underneath. */
export function drawScreen(ctx, screen, state, ui) {
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  if (screen === SCREEN_TITLE) drawTitle(ctx, state, ui);
  else if (screen === SCREEN_PAUSED) drawPaused(ctx, state);
  else if (screen === SCREEN_WON || screen === SCREEN_LOST) drawSummary(ctx, state, screen, ui);
  ctx.restore();
}
