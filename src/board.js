// @ts-check
import { FIELD_HEIGHT, FIELD_WIDTH } from './levels.js';

// A port of the playing field logic of the original BRIX.EXE. Comments point
// out the original's behaviour where it is not obvious.

export const EMPTY = 0;
export const BLOCK = 10;
export const WALL = 11;
export const LIFT = 12;
export const OUTSIDE = 13;

export const TILE = 16;
/** Lift steps spent waiting after hitting an obstacle, before moving back. */
const LIFT_PAUSE = 10;

/** @param {number} kind */
export const isIcon = (kind) => kind >= 1 && kind <= 8;

/**
 * @typedef {{x: number, y: number}} Point
 * @typedef {{x: number, y: number, direction: 1 | -1, offset: number, pause: number, riders: number}} Lift
 * @typedef {{cells: Point[], chain: number}} Blast
 */

export class Board {
  /**
   * @param {number[]} grid 14x12 tile ids, row by row
   * @param {{x: number, y: number, direction: 1 | -1} | null} lift
   * @param {Point} cursor
   */
  constructor(grid, lift, cursor) {
    this.cells = [...grid];
    /** @type {Lift | null} */
    this.lift = lift ? { ...lift, offset: 0, pause: 0, riders: 0 } : null;
    if (this.lift) {
      this.set(this.lift.x, this.lift.y, LIFT);
    }
    /** Icons dropping one row. They all move together, `fallOffset` pixels so far. */
    /** @type {Point[]} */
    this.falling = [];
    this.fallOffset = 0;
    this.cursor = { ...cursor };
    /** An icon is grabbed and moves with the cursor. */
    this.selected = false;
    /** The cursor is following a grabbed icon that is falling. */
    this.following = false;
    /** The cursor is following a grabbed icon riding the lift. */
    this.riding = false;
    /** Icons blasted since the player last moved one; long chains earn a bonus. */
    this.chain = 0;
  }

  /** @param {number} x @param {number} y */
  inside(x, y) {
    return x >= 0 && y >= 0 && x < FIELD_WIDTH && y < FIELD_HEIGHT;
  }

  /** @param {number} x @param {number} y */
  at(x, y) {
    return this.inside(x, y) ? this.cells[y * FIELD_WIDTH + x] : OUTSIDE;
  }

  /** @param {number} x @param {number} y @param {number} kind */
  set(x, y, kind) {
    this.cells[y * FIELD_WIDTH + x] = kind;
  }

  /** @param {number} x @param {number} y */
  isFalling(x, y) {
    return this.falling.some((p) => p.x === x && p.y === y);
  }

  /** @returns {Map<number, number>} */
  iconCounts() {
    /** @type {Map<number, number>} */
    const counts = new Map();
    for (const kind of this.cells) {
      if (isIcon(kind)) {
        counts.set(kind, (counts.get(kind) ?? 0) + 1);
      }
    }
    return counts;
  }

  isCleared() {
    return this.cells.every((kind) => !isIcon(kind));
  }

  /** An icon that is the last of its kind can never be blasted. */
  isStuck() {
    return [...this.iconCounts().values()].some((count) => count === 1);
  }

  /**
   * Whether (x, y) belongs to the lift or the stack it carries; while the
   * lift moves this includes the square it is moving into.
   *
   * @param {number} x @param {number} y
   */
  inLiftColumn(x, y) {
    const lift = this.lift;
    if (!lift || x !== lift.x) {
      return false;
    }
    const top = lift.y - lift.riders;
    if (lift.offset > 0) {
      return y >= top && y <= lift.y + 1;
    }
    if (lift.offset < 0) {
      return y >= top - 1 && y <= lift.y;
    }
    return y >= top && y <= lift.y;
  }

  /** @param {number} x @param {number} y */
  isMovingWithLift(x, y) {
    return this.inLiftColumn(x, y) && this.lift?.offset !== 0;
  }

  /** @param {Point} point */
  isRider(point) {
    const lift = this.lift;
    return lift !== null && point.x === lift.x && point.y < lift.y && point.y >= lift.y - lift.riders;
  }

  countRiders() {
    const lift = this.lift;
    if (!lift) {
      return;
    }
    let riders = 0;
    while (isIcon(this.at(lift.x, lift.y - riders - 1))) {
      if (this.selected && this.cursor.x === lift.x && this.cursor.y === lift.y - riders - 1) {
        this.riding = true;
      }
      riders += 1;
    }
    lift.riders = riders;
  }

  // Player actions

  /** @param {number} dx @param {number} dy */
  moveCursor(dx, dy) {
    if (this.selected) {
      return false;
    }
    const x = this.cursor.x + dx;
    const y = this.cursor.y + dy;
    const kind = this.at(x, y);
    if (kind === WALL || kind === OUTSIDE) {
      return false;
    }
    this.cursor = { x, y };
    return true;
  }

  toggleSelect() {
    if (!isIcon(this.at(this.cursor.x, this.cursor.y)) || this.following) {
      return false;
    }
    this.selected = !this.selected;
    if (this.isRider(this.cursor)) {
      this.riding = !this.riding;
    }
    return true;
  }

  release() {
    if (this.selected && !this.following) {
      this.toggleSelect();
    }
  }

  /**
   * Moves the grabbed icon one square sideways, instantly. Nothing may move
   * while anything on the field is falling.
   *
   * @param {-1 | 1} dx
   * @returns {boolean}
   */
  slide(dx) {
    const { x, y } = this.cursor;
    const lift = this.lift;
    if (!this.selected || !isIcon(this.at(x, y)) || this.at(x + dx, y) !== EMPTY || this.falling.length > 0) {
      return false;
    }
    if (this.riding && lift && lift.offset !== 0) {
      return false;
    }
    if (lift && x + dx === lift.x) {
      if (y === lift.y + 1 && lift.offset > 0) {
        return false;
      }
      if (y === lift.y - lift.riders - 1 && lift.offset < 0) {
        return false;
      }
    }
    this.set(x + dx, y, this.at(x, y));
    this.set(x, y, EMPTY);
    this.cursor = { x: x + dx, y };
    this.chain = 0;
    if (this.riding && lift) {
      // Whatever was stacked above the icon on the lift drops into the gap.
      const top = lift.y - lift.riders;
      for (let row = y; row > top; row--) {
        this.set(x, row, this.at(x, row - 1));
      }
      this.set(x, top, EMPTY);
      this.riding = false;
    }
    return true;
  }

  // Timed steps, driven by the game loop

  /**
   * When nothing is mid-fall, looks for blasts and for icons that start
   * falling; then moves the falling icons down by a pixel.
   *
   * @returns {Blast | null} icons to blast, which freezes the game until
   *   `removeBlast` is called
   */
  gravityStep() {
    /** @type {Blast | null} */
    let blast = null;
    if (this.fallOffset === 0) {
      this.findFalling();
      blast = this.makeBlast(this.matchAll());
    }
    if (this.falling.length === 0) {
      return blast;
    }
    this.fallOffset += 1;
    for (let i = 0; i < this.falling.length; i++) {
      const icon = this.falling[i];
      const followed = this.selected && icon.x === this.cursor.x && icon.y === this.cursor.y;
      if (followed) {
        this.following = true;
      }
      if (this.landOnLift(icon)) {
        if (followed) {
          this.riding = true;
          this.following = false;
          if (this.lift?.direction === -1) {
            this.cursor.y += 1;
          }
        }
        this.falling.splice(i, 1);
        i -= 1;
      }
    }
    if (this.fallOffset === TILE) {
      this.fallOffset = 0;
      if (this.following) {
        this.cursor.y += 1;
        this.following = false;
      }
      for (const icon of this.falling) {
        this.set(icon.x, icon.y + 1, this.at(icon.x, icon.y));
        this.set(icon.x, icon.y, EMPTY);
      }
      this.falling = [];
    }
    return blast;
  }

  findFalling() {
    const lift = this.lift;
    this.falling = [];
    for (let x = FIELD_WIDTH - 2; x >= 1; x--) {
      for (let y = FIELD_HEIGHT - 2; y >= 1; y--) {
        if (!isIcon(this.at(x, y))) {
          continue;
        }
        if (this.at(x, y + 1) !== EMPTY) {
          // An icon sitting on a stack that the lift carries down follows
          // it, and joins the stack once it catches up.
          const onSinkingStack = lift !== null && lift.direction > 0 && lift.offset !== 0
            && x === lift.x && lift.y - lift.riders === y + 1;
          if (!onSinkingStack) {
            continue;
          }
        }
        this.falling.push({ x, y });
      }
    }
  }

  /**
   * A falling icon that reaches the stack on a moving lift becomes part of it.
   *
   * @param {Point} icon
   */
  landOnLift(icon) {
    const lift = this.lift;
    if (!lift || icon.x !== lift.x) {
      return false;
    }
    if (lift.direction > 0) {
      if (icon.y === lift.y - lift.riders - 1 && lift.offset <= this.fallOffset) {
        lift.riders += 1;
        return true;
      }
    } else if (icon.y === lift.y - lift.riders - 2 && lift.offset + TILE <= this.fallOffset) {
      lift.riders += 1;
      this.set(icon.x, icon.y + 1, this.at(icon.x, icon.y));
      this.set(icon.x, icon.y, EMPTY);
      return true;
    }
    return false;
  }

  /**
   * Every icon that is not about to fall blasts, together with the matching
   * icons next to it. Icons on a moving lift are left to the lift's checks.
   *
   * @returns {Point[]}
   */
  matchAll() {
    /** @type {Point[]} */
    const found = [];
    for (let x = 1; x < FIELD_WIDTH - 1; x++) {
      for (let y = 1; y < FIELD_HEIGHT - 1; y++) {
        const kind = this.at(x, y);
        if (!isIcon(kind) || this.isFalling(x, y) || this.isMovingWithLift(x, y)) {
          continue;
        }
        const matches = [[x, y - 1], [x, y + 1], [x + 1, y], [x - 1, y]].some(
          ([nx, ny]) => this.at(nx, ny) === kind && !this.isMovingWithLift(nx, ny) && !this.isFalling(nx, ny),
        );
        if (matches) {
          found.push({ x, y });
        }
      }
    }
    return found;
  }

  /**
   * One step of the lift: a pixel of movement, or at a square boundary the
   * decision where to go next. When its way is blocked it pauses briefly and
   * turns around.
   *
   * @returns {Blast | null}
   */
  liftStep() {
    const lift = this.lift;
    if (!lift) {
      return null;
    }
    if (lift.pause > 0) {
      lift.pause -= 1;
      return null;
    }
    if (lift.offset !== 0) {
      lift.offset += lift.direction;
      if (Math.abs(lift.offset) < TILE) {
        return null;
      }
      lift.offset = 0;
      this.shiftLift(lift);
      return this.makeBlast(this.matchBesideRiders(lift));
    }
    this.countRiders();
    const blast = this.makeBlast(this.matchWithinStack(lift));
    const above = this.at(lift.x, lift.y - lift.riders - 1);
    const below = this.at(lift.x, lift.y + 1);
    if ((lift.direction < 0 && above === EMPTY) || (lift.direction > 0 && below === EMPTY)) {
      lift.offset = lift.direction;
    } else {
      lift.direction = lift.direction > 0 ? -1 : 1;
      lift.pause = LIFT_PAUSE;
    }
    return blast;
  }

  /** @param {Lift} lift */
  shiftLift(lift) {
    const top = lift.y - lift.riders;
    if (lift.direction < 0) {
      for (let y = top - 1; y < lift.y; y++) {
        this.set(lift.x, y, this.at(lift.x, y + 1));
      }
      this.set(lift.x, lift.y, EMPTY);
    } else {
      for (let y = lift.y + 1; y > top; y--) {
        this.set(lift.x, y, this.at(lift.x, y - 1));
      }
      this.set(lift.x, top, EMPTY);
    }
    lift.y += lift.direction;
    if (this.riding) {
      this.cursor.y += lift.direction;
    }
  }

  /** @param {Lift} lift @returns {Point[]} */
  matchBesideRiders(lift) {
    this.countRiders();
    /** @type {Point[]} */
    const found = [];
    for (let i = 0; i < lift.riders; i++) {
      const y = lift.y - i - 1;
      const kind = this.at(lift.x, y);
      const neighbours = [lift.x - 1, lift.x + 1].filter((x) => this.at(x, y) === kind && !this.isFalling(x, y));
      if (neighbours.length > 0) {
        found.push(...neighbours.map((x) => ({ x, y })), { x: lift.x, y });
      }
    }
    return found;
  }

  /** @param {Lift} lift @returns {Point[]} */
  matchWithinStack(lift) {
    /** @type {Point[]} */
    const found = [];
    for (let i = 0; i < lift.riders; i++) {
      const y = lift.y - i - 1;
      if (this.at(lift.x, y - 1) === this.at(lift.x, y)) {
        found.push({ x: lift.x, y }, { x: lift.x, y: y - 1 });
      }
    }
    return found;
  }

  /**
   * @param {Point[]} cells
   * @returns {Blast | null}
   */
  makeBlast(cells) {
    const unique = cells.filter((cell, i) => cells.findIndex((c) => c.x === cell.x && c.y === cell.y) === i);
    if (unique.length === 0) {
      return null;
    }
    this.chain += unique.length;
    return { cells: unique, chain: this.chain };
  }

  /** @param {Blast} blast */
  removeBlast(blast) {
    for (const { x, y } of blast.cells) {
      this.set(x, y, EMPTY);
      if (x === this.cursor.x && y === this.cursor.y) {
        this.selected = false;
        this.riding = false;
      }
    }
    this.countRiders();
  }
}
