// @ts-check
import { VGA_PALETTE, cssColor } from './palette.js';

export const SCREEN_WIDTH = 320;
export const SCREEN_HEIGHT = 200;

const TILE_SIZE = 16;
const GLYPH_SIZE = 8;
const FIRST_GLYPH = 0x20;
const GLYPH_COUNT = 64;

export const COLOR = {
  black: 0,
  blue: 9,
  green: 10,
  cyan: 11,
  red: 12,
  magenta: 13,
  yellow: 14,
  white: 15,
  grey: 24,
  lightGrey: 27,
  orange: 42,
};

/**
 * Turns the BLOCKS file (16x16 tiles, one palette index per pixel) into a
 * sprite sheet. Index 0 is treated as transparent.
 *
 * @param {Uint8Array} blocks
 * @returns {HTMLCanvasElement}
 */
function buildTileSheet(blocks) {
  const count = blocks.length / (TILE_SIZE * TILE_SIZE);
  const canvas = document.createElement('canvas');
  canvas.width = count * TILE_SIZE;
  canvas.height = TILE_SIZE;
  const context = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  const image = context.createImageData(canvas.width, canvas.height);
  for (let tile = 0; tile < count; tile++) {
    for (let y = 0; y < TILE_SIZE; y++) {
      for (let x = 0; x < TILE_SIZE; x++) {
        const index = blocks[tile * TILE_SIZE * TILE_SIZE + y * TILE_SIZE + x];
        const offset = (y * canvas.width + tile * TILE_SIZE + x) * 4;
        const [r, g, b] = VGA_PALETTE[index];
        image.data.set([r, g, b, index === 0 ? 0 : 255], offset);
      }
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

/**
 * BRIX.PIC is an uncompressed 8-bit BMP where index 255 marks the logo.
 *
 * @param {Uint8Array} bmp
 * @returns {HTMLCanvasElement}
 */
function buildLogoMask(bmp) {
  const view = new DataView(bmp.buffer, bmp.byteOffset, bmp.byteLength);
  const pixels = view.getUint32(10, true);
  const width = view.getInt32(18, true);
  const height = view.getInt32(22, true);
  const stride = Math.ceil(width / 4) * 4;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  const image = context.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (bmp[pixels + (height - 1 - y) * stride + x] !== 0) {
        image.data.set([255, 255, 255, 255], (y * width + x) * 4);
      }
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

export class Renderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{blocks: Uint8Array, font: Uint8Array, logo: Uint8Array}} assets
   */
  constructor(canvas, assets) {
    canvas.width = SCREEN_WIDTH;
    canvas.height = SCREEN_HEIGHT;
    this.context = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    this.context.imageSmoothingEnabled = false;
    this.tiles = buildTileSheet(assets.blocks);
    this.font = assets.font;
    this.logoMask = buildLogoMask(assets.logo);
    this.logoCanvas = document.createElement('canvas');
    this.logoCanvas.width = this.logoMask.width;
    this.logoCanvas.height = this.logoMask.height;
    /** @type {Map<number, HTMLCanvasElement>} */
    this.glyphSheets = new Map();
  }

  clear() {
    this.context.fillStyle = cssColor(COLOR.black);
    this.context.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
  }

  /**
   * @param {number} tile
   * @param {number} x
   * @param {number} y
   * @param {number} [size] drawn size, for scaled-down tiles
   */
  tile(tile, x, y, size = TILE_SIZE) {
    this.context.drawImage(this.tiles, tile * TILE_SIZE, 0, TILE_SIZE, TILE_SIZE, Math.round(x), Math.round(y), size, size);
  }

  /** @param {number} color */
  glyphSheet(color) {
    const cached = this.glyphSheets.get(color);
    if (cached) {
      return cached;
    }
    const canvas = document.createElement('canvas');
    canvas.width = GLYPH_COUNT * GLYPH_SIZE;
    canvas.height = GLYPH_SIZE;
    const context = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    const image = context.createImageData(canvas.width, canvas.height);
    const [r, g, b] = VGA_PALETTE[color];
    for (let glyph = 0; glyph < GLYPH_COUNT; glyph++) {
      for (let y = 0; y < GLYPH_SIZE; y++) {
        const bits = this.font[glyph * GLYPH_SIZE + y];
        for (let x = 0; x < GLYPH_SIZE; x++) {
          if (bits & (0x80 >> x)) {
            image.data.set([r, g, b, 255], (y * canvas.width + glyph * GLYPH_SIZE + x) * 4);
          }
        }
      }
    }
    context.putImageData(image, 0, 0);
    this.glyphSheets.set(color, canvas);
    return canvas;
  }

  /**
   * Draws text with the original 8x8 font, which only has upper case
   * letters, digits and punctuation.
   *
   * @param {string} text
   * @param {number} x
   * @param {number} y
   * @param {number} [color]
   */
  text(text, x, y, color = COLOR.white) {
    const sheet = this.glyphSheet(color);
    [...text.toUpperCase()].forEach((ch, i) => {
      const glyph = ch.charCodeAt(0) - FIRST_GLYPH;
      if (glyph > 0 && glyph < GLYPH_COUNT) {
        this.context.drawImage(sheet, glyph * GLYPH_SIZE, 0, GLYPH_SIZE, GLYPH_SIZE, Math.round(x) + i * GLYPH_SIZE, Math.round(y), GLYPH_SIZE, GLYPH_SIZE);
      }
    });
  }

  /** @param {string} text @param {number} y @param {number} [color] @param {number} [centerX] */
  centered(text, y, color = COLOR.white, centerX = SCREEN_WIDTH / 2) {
    this.text(text, centerX - (text.length * GLYPH_SIZE) / 2, y, color);
  }

  /**
   * Draws a number with the big 16x16 digit tiles.
   *
   * @param {string} digits may contain ':' which is drawn as a narrow gap
   * @param {number} x
   * @param {number} y
   * @param {'red' | 'blue'} style
   */
  bigDigits(digits, x, y, style) {
    const base = style === 'red' ? 20 : 40;
    let cursor = x;
    for (const ch of digits) {
      if (ch === ':') {
        this.text(':', cursor - 1, y + 5, style === 'red' ? COLOR.red : COLOR.cyan);
        cursor += 6;
      } else {
        this.tile(base + Number(ch), cursor, y);
        cursor += 14;
      }
    }
  }

  /** @param {number} x @param {number} y @param {number} width @param {number} height @param {number} color */
  fill(x, y, width, height, color) {
    this.context.fillStyle = cssColor(color);
    this.context.fillRect(x, y, width, height);
  }

  /** @param {number} x @param {number} y @param {number} width @param {number} height @param {number} color */
  frame(x, y, width, height, color) {
    this.context.strokeStyle = cssColor(color);
    this.context.lineWidth = 1;
    this.context.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, width - 1, height - 1);
  }

  /** @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2 @param {number} color @param {number} width */
  line(x1, y1, x2, y2, color, width) {
    this.context.strokeStyle = cssColor(color);
    this.context.lineWidth = width;
    this.context.beginPath();
    this.context.moveTo(x1, y1);
    this.context.lineTo(x2, y2);
    this.context.stroke();
  }

  /** @param {number} x @param {number} y @param {number} width @param {number} height @param {() => void} draw */
  clipped(x, y, width, height, draw) {
    this.context.save();
    this.context.beginPath();
    this.context.rect(x, y, width, height);
    this.context.clip();
    draw();
    this.context.restore();
  }

  get logoWidth() {
    return this.logoMask.width;
  }

  /**
   * Draws the title logo filled with scrolling rainbow bars.
   *
   * @param {number} x @param {number} y @param {number} phase
   */
  drawLogo(x, y, phase) {
    const context = /** @type {CanvasRenderingContext2D} */ (this.logoCanvas.getContext('2d'));
    const { width, height } = this.logoCanvas;
    context.globalCompositeOperation = 'source-over';
    for (let row = 0; row < height; row++) {
      context.fillStyle = cssColor(32 + (Math.floor((row + phase) / 2) % 24));
      context.fillRect(0, row, width, 1);
    }
    context.globalCompositeOperation = 'destination-in';
    context.drawImage(this.logoMask, 0, 0);
    this.context.drawImage(this.logoCanvas, Math.round(x), Math.round(y));
  }
}
