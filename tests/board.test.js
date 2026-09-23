// @ts-check
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { Board, EMPTY, LIFT, TILE, isIcon } from '../src/board.js';
import { FIELD_WIDTH, firstProblemIndex, parseLevels } from '../src/levels.js';

/** @typedef {import('../src/board.js').Blast} Blast */

const levels = parseLevels(new Uint8Array(readFileSync(new URL('../data/LEVELS', import.meta.url))));

/**
 * Builds a board from a small ASCII picture, padded with walls.
 * '#' wall, 'X' block, '.' empty, 'L' lift, digits are icons.
 *
 * @param {string[]} rows
 * @param {{x: number, y: number}} [cursor]
 * @param {1 | -1} [liftDirection]
 */
function boardFrom(rows, cursor = { x: 1, y: 1 }, liftDirection = -1) {
  const grid = new Array(FIELD_WIDTH * 12).fill(11);
  /** @type {{x: number, y: number, direction: 1 | -1} | null} */
  let lift = null;
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const kind = { '#': 11, X: 10, '.': 0, L: 12 }[ch] ?? Number(ch);
      grid[y * FIELD_WIDTH + x] = kind;
      if (kind === LIFT) {
        lift = { x, y, direction: liftDirection };
      }
    });
  });
  return new Board(grid, lift, cursor);
}

/**
 * Runs the board like the game does, three gravity steps per lift step, and
 * resolves blasts immediately.
 *
 * @param {Board} board
 * @param {number} liftSteps
 */
function run(board, liftSteps) {
  /** @type {Blast[]} */
  const blasts = [];
  for (let i = 0; i < liftSteps; i++) {
    for (const step of [() => board.gravityStep(), () => board.liftStep(), () => board.gravityStep(), () => board.gravityStep()]) {
      const blast = step();
      if (blast) {
        blasts.push(blast);
        board.removeBlast(blast);
      }
    }
  }
  return blasts;
}

/** @type {Record<number, string>} */
const SYMBOLS = { 0: '.', 10: 'X', 11: '#', 12: 'L' };

/** @param {Board} board @param {number} rows @param {number} columns */
function picture(board, rows, columns) {
  const lines = [];
  for (let y = 0; y < rows; y++) {
    let line = '';
    for (let x = 0; x < columns; x++) {
      const kind = board.at(x, y);
      line += isIcon(kind) ? String(kind) : SYMBOLS[kind];
    }
    lines.push(line);
  }
  return lines;
}

test('parses all 112 original levels', () => {
  assert.equal(levels.length, 112);
  assert.deepEqual(levels[0].cursor, { x: 3, y: 6 });
  assert.equal(levels[0].seconds, 60);
  assert.equal(levels[111].seconds, 20);
  assert.deepEqual(levels[5].lift, { x: 5, y: 9, direction: -1 });
  assert.deepEqual(levels[37].lift, { x: 6, y: 8, direction: 1 });
});

test('every level has at least two icons of each kind it uses', () => {
  for (const level of levels) {
    assert.equal(new Board(level.grid, level.lift, level.cursor).isStuck(), false, `level ${level.index}`);
  }
});

test('the triangle of choices maps onto the level file', () => {
  assert.equal(firstProblemIndex(1, 1), 0);
  assert.equal(firstProblemIndex(2, 2), 8);
  assert.equal(firstProblemIndex(7, 7), 108);
});

test('icons fall a pixel per gravity step', () => {
  const board = boardFrom(['#####', '#.1.#', '#...#', '#...#', '#####']);
  for (let i = 0; i < TILE; i++) {
    assert.equal(board.at(2, 1), 1);
    board.gravityStep();
  }
  assert.equal(board.at(2, 2), 1);
  run(board, 20);
  assert.deepEqual(picture(board, 5, 5), ['#####', '#...#', '#...#', '#.1.#', '#####']);
});

test('adjacent matching icons blast, counting towards the chain', () => {
  const board = boardFrom(['#####', '#1.1#', '#####']);
  board.toggleSelect();
  assert.ok(board.slide(1));
  const blast = board.gravityStep();
  assert.deepEqual(blast, { cells: [{ x: 2, y: 1 }, { x: 3, y: 1 }], chain: 2 });
  board.removeBlast(/** @type {Blast} */ (blast));
  assert.ok(board.isCleared());
  assert.equal(board.selected, false);
});

test('three icons blast at once', () => {
  const board = boardFrom(['#####', '#2..#', '#X.2#', '#X2X#', '#####']);
  board.toggleSelect();
  assert.ok(board.slide(1));
  const blasts = run(board, 10);
  assert.deepEqual(blasts.map((b) => b.cells.length), [3]);
});

test('nothing can be moved while an icon falls', () => {
  const board = boardFrom(['######', '#1...#', '#X..3#', '#X..X#', '######']);
  board.toggleSelect();
  assert.ok(board.slide(1));
  board.gravityStep();
  assert.ok(board.falling.length > 0);
  assert.equal(board.slide(1), false);
});

test('the cursor follows a grabbed icon while it falls', () => {
  const board = boardFrom(['#####', '#1..#', '#X..#', '#X..#', '#####']);
  board.toggleSelect();
  assert.ok(board.slide(1));
  run(board, 12);
  assert.deepEqual(board.cursor, { x: 2, y: 3 });
  assert.ok(board.selected);
  assert.equal(board.at(2, 3), 1);
});

test('lifts carry icons up, pause and come back down', () => {
  const board = boardFrom(['###', '#.#', '#.#', '#1#', '#L#', '#.#', '###']);
  run(board, 2 * TILE + 1);
  assert.deepEqual(picture(board, 7, 3).slice(1, 3), ['#1#', '#L#']);
  run(board, 10 + 3 * TILE + 1);
  assert.equal(board.at(1, 4), 1);
  assert.equal(board.at(1, 5), LIFT);
  assert.equal(board.at(1, 1), EMPTY);
});

test('an icon on a lift blasts with a neighbour when the lift arrives', () => {
  const board = boardFrom(['####', '#.2#', '#.X#', '#2X#', '#LX#', '####']);
  const blasts = run(board, 2 * TILE + 1);
  assert.deepEqual(blasts.map((b) => b.cells.length), [2]);
});

test('icons keep falling after one lands on a moving lift', () => {
  const board = boardFrom(['#####', '#.1.#', '#...#', '#.L.#', '#...#', '#.2.#', '#.X.#', '#####'], { x: 2, y: 5 });
  run(board, 2 * TILE);
  assert.equal(board.lift?.riders, 1);
  assert.equal(board.fallOffset, 0);
  board.toggleSelect();
  assert.ok(board.slide(1));
  run(board, 8);
  assert.equal(board.at(3, 6), 2);
});

test('an icon stranded as the last of its kind is detected', () => {
  assert.ok(boardFrom(['#####', '#1.2#', '#####']).isStuck());
});
