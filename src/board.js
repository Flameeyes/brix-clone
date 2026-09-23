// @ts-check
import { FIELD_HEIGHT, FIELD_WIDTH } from './levels.js';

export const EMPTY = 0;
export const BLOCK = 10;
export const WALL = 11;
export const LIFT = 12;
export const OUTSIDE = 13;

export const TILE = 16;
export const FALL_SPEED = 4;
export const SLIDE_SPEED = 2;
export const LIFT_SPEED = 1;
export const BLAST_TICKS = 60;

/** @param {number} kind */
export const isIcon = (kind) => kind >= 1 && kind <= 9;

/**
 * A single square of the playing field. Moving things are stored in the
 * square they are heading to, with an offset (in pixels) from its center
 * that shrinks towards zero at `speed` pixels per tick.
 *
 * @typedef {{
 *   id: number,
 *   kind: number,
 *   ox: number,
 *   oy: number,
 *   speed: number,
 *   falling: boolean,
 *   blast: number,
 * }} Cell
 *
 * @typedef {{x: number, y: number, direction: 1 | -1}} Lift
 *
 * @typedef {
 *   | {type: 'blast', kind: number, size: number, x: number, y: number}
 *   | {type: 'land'}
 * } BoardEvent
 */

let nextCellId = 1;

/** @param {number} kind @returns {Cell} */
const makeCell = (kind) => ({ id: nextCellId++, kind, ox: 0, oy: 0, speed: 0, falling: false, blast: 0 });

/** @param {number} value @param {number} step */
const approachZero = (value, step) => (value > 0 ? Math.max(0, value - step) : Math.min(0, value + step));

export class Board {
  /**
   * @param {number[]} grid
   * @param {{x: number, y: number, direction: 1 | -1} | null} lift
   */
  constructor(grid, lift) {
    /** @type {Cell[]} */
    this.cells = grid.map(makeCell);
    /** @type {Lift[]} */
    this.lifts = [];
    this.cells.forEach((cell, i) => {
      if (cell.kind === LIFT) {
        const x = i % FIELD_WIDTH;
        const y = Math.floor(i / FIELD_WIDTH);
        const direction = lift && lift.x === x && lift.y === y ? lift.direction : -1;
        this.lifts.push({ x, y, direction });
      }
    });
  }

  /** @param {number} x @param {number} y */
  inside(x, y) {
    return x >= 0 && y >= 0 && x < FIELD_WIDTH && y < FIELD_HEIGHT;
  }

  /** @param {number} x @param {number} y @returns {Cell} */
  at(x, y) {
    if (!this.inside(x, y)) {
      return makeCell(OUTSIDE);
    }
    return this.cells[y * FIELD_WIDTH + x];
  }

  /** @param {number} x @param {number} y @param {Cell} cell */
  put(x, y, cell) {
    this.cells[y * FIELD_WIDTH + x] = cell;
  }

  /** @param {number} x @param {number} y */
  isStill(x, y) {
    const cell = this.at(x, y);
    return cell.ox === 0 && cell.oy === 0 && cell.blast === 0;
  }

  /**
   * An icon can take part in a blast once it stands still on something that
   * is not about to disappear.
   *
   * @param {number} x @param {number} y
   * @returns {boolean}
   */
  isResting(x, y) {
    const cell = this.at(x, y);
    if (!isIcon(cell.kind) || cell.falling || !this.isStill(x, y)) {
      return false;
    }
    const below = this.at(x, y + 1);
    if (below.kind === BLOCK || below.kind === WALL || below.kind === OUTSIDE) {
      return true;
    }
    if (below.kind === LIFT) {
      return below.oy === 0;
    }
    return isIcon(below.kind) && this.isResting(x, y + 1);
  }

  /** @param {number} x @param {number} y */
  canGrab(x, y) {
    const cell = this.at(x, y);
    return isIcon(cell.kind) && !cell.falling && cell.blast === 0 && cell.ox === 0;
  }

  /**
   * Slides the icon at (x, y) one square sideways.
   *
   * @param {number} x @param {number} y @param {-1 | 1} dx
   * @returns {boolean} whether the icon moved
   */
  slide(x, y, dx) {
    if (!this.canGrab(x, y) || this.at(x + dx, y).kind !== EMPTY) {
      return false;
    }
    const cell = this.at(x, y);
    // An icon riding a lift may be between two rows; make sure the row it is
    // overlapping in the target column is free as well.
    if (cell.oy !== 0 && this.at(x + dx, y + Math.sign(cell.oy)).kind !== EMPTY) {
      return false;
    }
    this.put(x + dx, y, { ...cell, ox: -dx * TILE, speed: SLIDE_SPEED });
    this.put(x, y, makeCell(EMPTY));
    return true;
  }

  /**
   * @param {number} id
   * @returns {{x: number, y: number, cell: Cell} | null}
   */
  find(id) {
    const index = this.cells.findIndex((cell) => cell.id === id);
    if (index < 0) {
      return null;
    }
    return { x: index % FIELD_WIDTH, y: Math.floor(index / FIELD_WIDTH), cell: this.cells[index] };
  }

  /** @returns {Map<number, number>} remaining icons by kind, including ones being blasted */
  iconCounts() {
    /** @type {Map<number, number>} */
    const counts = new Map();
    for (const cell of this.cells) {
      if (isIcon(cell.kind)) {
        counts.set(cell.kind, (counts.get(cell.kind) ?? 0) + 1);
      }
    }
    return counts;
  }

  isCleared() {
    return this.cells.every((cell) => !isIcon(cell.kind));
  }

  /** An icon that is the last of its kind can never be blasted. */
  isStuck() {
    return [...this.iconCounts().values()].some((count) => count === 1);
  }

  /** @returns {BoardEvent[]} */
  tick() {
    /** @type {BoardEvent[]} */
    const events = [];
    this.advanceMotion();
    this.finishBlasts();
    this.applyGravity(events);
    this.findBlasts(events);
    this.moveLifts();
    return events;
  }

  advanceMotion() {
    for (const cell of this.cells) {
      if (cell.ox !== 0 || cell.oy !== 0) {
        cell.ox = approachZero(cell.ox, cell.speed);
        cell.oy = approachZero(cell.oy, cell.speed);
      }
    }
  }

  finishBlasts() {
    this.cells.forEach((cell, i) => {
      if (cell.blast > 0) {
        cell.blast -= 1;
        if (cell.blast === 0) {
          this.cells[i] = makeCell(EMPTY);
        }
      }
    });
  }

  /** @param {BoardEvent[]} events */
  applyGravity(events) {
    for (let y = FIELD_HEIGHT - 2; y >= 0; y--) {
      for (let x = 0; x < FIELD_WIDTH; x++) {
        const cell = this.at(x, y);
        if (!isIcon(cell.kind) || !this.isStill(x, y)) {
          continue;
        }
        const below = this.at(x, y + 1);
        if (below.kind === EMPTY) {
          // Never overtake whatever is sinking in the square underneath.
          const beneath = this.at(x, y + 2);
          const speed = beneath.oy < 0 ? Math.min(FALL_SPEED, beneath.speed) : FALL_SPEED;
          this.put(x, y + 1, { ...cell, oy: -TILE, speed, falling: true });
          this.put(x, y, makeCell(EMPTY));
        } else if (cell.falling && !(isIcon(below.kind) && below.falling)) {
          cell.falling = false;
          events.push({ type: 'land' });
        }
      }
    }
  }

  /** @param {BoardEvent[]} events */
  findBlasts(events) {
    const seen = new Set();
    for (let y = 0; y < FIELD_HEIGHT; y++) {
      for (let x = 0; x < FIELD_WIDTH; x++) {
        const start = y * FIELD_WIDTH + x;
        if (seen.has(start) || !this.isResting(x, y)) {
          continue;
        }
        const kind = this.at(x, y).kind;
        const group = [start];
        seen.add(start);
        for (let i = 0; i < group.length; i++) {
          const gx = group[i] % FIELD_WIDTH;
          const gy = Math.floor(group[i] / FIELD_WIDTH);
          for (const [nx, ny] of [[gx - 1, gy], [gx + 1, gy], [gx, gy - 1], [gx, gy + 1]]) {
            const index = ny * FIELD_WIDTH + nx;
            if (this.inside(nx, ny) && !seen.has(index) && this.at(nx, ny).kind === kind && this.isResting(nx, ny)) {
              seen.add(index);
              group.push(index);
            }
          }
        }
        if (group.length > 1) {
          for (const index of group) {
            this.cells[index].blast = BLAST_TICKS;
          }
          events.push({ type: 'blast', kind, size: group.length, x, y });
        }
      }
    }
  }

  moveLifts() {
    for (const lift of this.lifts) {
      if (!this.isStill(lift.x, lift.y)) {
        continue;
      }
      const verdict = this.canLiftMove(lift);
      if (verdict === 'blocked') {
        lift.direction = lift.direction === 1 ? -1 : 1;
      } else if (verdict === 'go') {
        this.shiftLift(lift);
      }
    }
  }

  /**
   * @param {Lift} lift
   * @returns {'go' | 'wait' | 'blocked'}
   */
  canLiftMove(lift) {
    const riders = this.riders(lift);
    if (riders === null) {
      return 'wait';
    }
    const target = lift.direction === -1
      ? this.at(lift.x, lift.y - riders - 1)
      : this.at(lift.x, lift.y + 1);
    if (target.kind === EMPTY) {
      return 'go';
    }
    if (isIcon(target.kind) && (target.falling || target.blast > 0 || target.ox !== 0)) {
      return 'wait';
    }
    return 'blocked';
  }

  /**
   * @param {Lift} lift
   * @returns {number | null} how many icons are stacked on the lift, or null
   *   while any of them is still moving on its own
   */
  riders(lift) {
    let count = 0;
    for (let y = lift.y - 1; y >= 0 && isIcon(this.at(lift.x, y).kind); y--) {
      if (!this.isStill(lift.x, y)) {
        return null;
      }
      count += 1;
    }
    return count;
  }

  /** @param {Lift} lift */
  shiftLift(lift) {
    const riders = this.riders(lift) ?? 0;
    const top = lift.y - riders;
    const column = [];
    for (let y = top; y <= lift.y; y++) {
      column.push(this.at(lift.x, y));
    }
    for (let y = top; y <= lift.y; y++) {
      this.put(lift.x, y, makeCell(EMPTY));
    }
    column.forEach((cell, i) => {
      this.put(lift.x, top + i + lift.direction, {
        ...cell,
        oy: -lift.direction * TILE,
        speed: LIFT_SPEED,
        falling: false,
      });
    });
    lift.y += lift.direction;
  }
}
