// @ts-check

export const FIELD_WIDTH = 14;
export const FIELD_HEIGHT = 12;
export const TIERS = 7;
export const PROBLEMS_PER_CHOICE = 4;

const RECORD_SIZE = 178;
const GRID_SIZE = FIELD_WIDTH * FIELD_HEIGHT;

/**
 * @typedef {{x: number, y: number}} Point
 * @typedef {{x: number, y: number, direction: 1 | -1}} LiftStart
 * @typedef {{
 *   index: number,
 *   grid: number[],
 *   cursor: Point,
 *   lift: LiftStart | null,
 *   seconds: number,
 * }} Level
 */

/**
 * Parses the original LEVELS file: 112 records of 178 bytes each.
 *
 * Each record holds a 14x12 grid of tile ids, followed by the cursor start
 * position, the lift position, the lift's initial direction (1 = up,
 * 2 = down), four unused bytes and the time limit as minutes and seconds.
 *
 * @param {Uint8Array} data
 * @returns {Level[]}
 */
export function parseLevels(data) {
  if (data.length % RECORD_SIZE !== 0) {
    throw new Error(`LEVELS size ${data.length} is not a multiple of ${RECORD_SIZE}`);
  }
  /** @type {Level[]} */
  const levels = [];
  for (let offset = 0; offset < data.length; offset += RECORD_SIZE) {
    const record = data.subarray(offset, offset + RECORD_SIZE);
    const grid = Array.from(record.subarray(0, GRID_SIZE));
    const trailer = record.subarray(GRID_SIZE);
    const liftX = trailer[2];
    const liftY = trailer[3];
    const hasLift = grid[liftY * FIELD_WIDTH + liftX] === 12;
    levels.push({
      index: levels.length,
      grid,
      cursor: { x: trailer[0], y: trailer[1] },
      lift: hasLift ? { x: liftX, y: liftY, direction: trailer[4] === 2 ? 1 : -1 } : null,
      seconds: trailer[8] * 60 + trailer[9],
    });
  }
  return levels;
}

/**
 * The levels form a triangle: tier N offers N choices, each made of four
 * problems stored consecutively.
 *
 * @param {number} tier 1-based
 * @param {number} choice 1-based
 * @returns {number} index of the first problem of the choice
 */
export function firstProblemIndex(tier, choice) {
  return PROBLEMS_PER_CHOICE * ((tier * (tier - 1)) / 2 + choice - 1);
}
