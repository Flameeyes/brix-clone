// @ts-check
import { Game, TICKS_PER_SECOND } from './game.js';
import { parseLevels } from './levels.js';
import { Renderer, SCREEN_HEIGHT, SCREEN_WIDTH } from './render.js';
import { Sound } from './sound.js';

/** @typedef {import('./game.js').Action} Action */

/** @type {Record<string, Action>} */
const KEYS = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ' ': 'fire',
  Enter: 'start',
  Escape: 'escape',
  F1: 'start',
  F3: 'hiscores',
  h: 'hiscores',
  F4: 'retry',
  r: 'retry',
  F5: 'sound',
  s: 'sound',
  F7: 'credits',
  c: 'credits',
};

const REPEATING = new Set(['left', 'right', 'up', 'down']);

/** @param {string} name */
async function loadFile(name) {
  const response = await fetch(`data/${name}`);
  if (!response.ok) {
    throw new Error(`Could not load ${name}: ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * @param {HTMLFormElement} form
 * @returns {(score: number, place: number) => Promise<string>}
 */
function nameAsker(form) {
  const input = /** @type {HTMLInputElement} */ (form.elements.namedItem('name'));
  const caption = /** @type {HTMLElement} */ (form.querySelector('.caption'));
  return (score, place) =>
    new Promise((resolve) => {
      caption.textContent = `NICE GAME! PLACE:${place} SCORE:${score}`;
      input.value = '';
      form.hidden = false;
      input.focus();
      form.onsubmit = (event) => {
        event.preventDefault();
        form.hidden = true;
        input.blur();
        resolve(input.value);
      };
    });
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {Game} game
 * @param {Sound} sound
 */
function bindPointer(canvas, game, sound) {
  /** @param {PointerEvent} event */
  const toScreen = (event) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) * SCREEN_WIDTH) / rect.width,
      y: ((event.clientY - rect.top) * SCREEN_HEIGHT) / rect.height,
    };
  };
  canvas.addEventListener('pointerdown', (event) => {
    sound.unlock();
    canvas.setPointerCapture(event.pointerId);
    const { x, y } = toScreen(event);
    game.pointerDown(x, y);
    event.preventDefault();
  });
  canvas.addEventListener('pointermove', (event) => {
    if (canvas.hasPointerCapture(event.pointerId)) {
      game.pointerMove(toScreen(event).x);
    }
  });
  const release = () => game.pointerUp();
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
}

/**
 * On-screen buttons for touch devices. Direction buttons repeat while held.
 *
 * @param {HTMLElement} pad
 * @param {Game} game
 * @param {Sound} sound
 */
function bindTouchPad(pad, game, sound) {
  for (const button of pad.querySelectorAll('button')) {
    const action = /** @type {Action} */ (button.dataset.action);
    /** @type {number | undefined} */
    let timer;
    const stop = () => {
      window.clearTimeout(timer);
      timer = undefined;
    };
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      sound.unlock();
      game.handle(action);
      if (REPEATING.has(action)) {
        const repeat = () => {
          game.handle(action);
          timer = window.setTimeout(repeat, 110);
        };
        timer = window.setTimeout(repeat, 350);
      }
    });
    button.addEventListener('pointerup', stop);
    button.addEventListener('pointerleave', stop);
    button.addEventListener('pointercancel', stop);
    button.addEventListener('contextmenu', (event) => event.preventDefault());
  }
}

async function main() {
  const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('screen'));
  const [levels, blocks, font, logo] = await Promise.all(['LEVELS', 'BLOCKS', 'FONT', 'BRIX.PIC'].map(loadFile));
  const sound = new Sound();
  const renderer = new Renderer(canvas, { blocks, font, logo });
  const form = /** @type {HTMLFormElement} */ (document.getElementById('name-entry'));
  const game = new Game(parseLevels(levels), renderer, sound, nameAsker(form));

  window.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement) {
      return;
    }
    const action = KEYS[event.key] ?? KEYS[event.key.toLowerCase()];
    if (!action || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    event.preventDefault();
    sound.unlock();
    game.handle(action);
  });
  bindPointer(canvas, game, sound);
  bindTouchPad(/** @type {HTMLElement} */ (document.getElementById('pad')), game, sound);

  const step = 1000 / TICKS_PER_SECOND;
  let last = performance.now();
  let pending = 0;
  /** @param {number} now */
  const loop = (now) => {
    pending = Math.min(pending + now - last, 250);
    last = now;
    while (pending >= step) {
      game.update();
      pending -= step;
    }
    game.draw();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    void navigator.serviceWorker.register('sw.js');
  }
}

main().catch((error) => {
  document.body.textContent = `BRIX failed to start: ${error}`;
  throw error;
});
