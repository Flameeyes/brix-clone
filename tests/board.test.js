// @ts-check
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { BLAST_TICKS, Board, EMPTY, LIFT, isIcon } from '../src/board.js';
import { FIELD_WIDTH, firstProblemIndex, parseLevels } from '../src/levels.js';

const levels = parseLevels(new Uint8Array(readFileSync(new URL('../data/LEVELS', import.meta.url))));

/**
 * Builds a board from a small ASCII picture, padded with walls.
 * '#' wall, 'X' block, '.' empty, 'L' lift, digits are icons.
 *
 * @param {string[]} rows
 * @param {1 | -1} [liftDirection]
 */
function boardFrom(rows, liftDirection = -1) {
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
  return new Board(grid, lift);
}

/** @param {Board} board @param {number} ticks */
function run(board, ticks) {
  const events = [];
  for (let i = 0; i < ticks; i++) {
    events.push(...board.tick());
  }
  return events;
}

/** @param {Board} board @param {number} rows */
function picture(board, rows) {
  const lines = [];
  for (let y = 0; y < rows; y++) {
    let line = '';
    for (let x = 0; x < 6; x++) {
      const kind = board.at(x, y).kind;
      line += isIcon(kind) ? String(kind) : { 0: '.', 10: 'X', 11: '#', 12: 'L' }[kind];
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
    assert.equal(new Board(level.grid, level.lift).isStuck(), false, `level ${level.index}`);
  }
});

test('the triangle of choices maps onto the level file', () => {
  assert.equal(firstProblemIndex(1, 1), 0);
  assert.equal(firstProblemIndex(2, 2), 8);
  assert.equal(firstProblemIndex(7, 7), 108);
});

test('icons fall until they land', () => {
  const board = boardFrom([
    '#####',
    '#.1.#',
    '#...#',
    '#...#',
    '#####',
  ]);
  const events = run(board, 20);
  assert.deepEqual(picture(board, 5).slice(1, 4), ['#...##', '#...##', '#.1.##']);
  assert.equal(events.filter((e) => e.type === 'land').length, 1);
});

test('adjacent matching icons blast away', () => {
  const board = boardFrom([
    '#####',
    '#1.1#',
    '#####',
  ]);
  assert.ok(board.slide(1, 1, 1));
  const events = run(board, 20);
  assert.deepEqual(events, [{ type: 'blast', kind: 1, size: 2, x: 2, y: 1 }]);
  run(board, BLAST_TICKS);
  assert.ok(board.isCleared());
});

test('three icons blast at once', () => {
  const board = boardFrom([
    '#####',
    '#2..#',
    '#X.2#',
    '#X2X#',
    '#####',
  ]);
  assert.ok(board.slide(1, 1, 1));
  const events = run(board, 30);
  assert.deepEqual(events.filter((e) => e.type === 'blast').map((e) => e.type === 'blast' && e.size), [3]);
});

test('icons cannot slide into occupied squares', () => {
  const board = boardFrom([
    '#####',
    '#12.#',
    '#####',
  ]);
  assert.equal(board.slide(1, 1, 1), false);
  assert.equal(board.slide(1, 1, -1), false);
  assert.equal(board.at(1, 1).kind, 1);
});

test('lifts carry icons up and turn around at the ceiling', () => {
  const board = boardFrom([
    '###',
    '#.#',
    '#.#',
    '#1#',
    '#L#',
    '#.#',
    '###',
  ]);
  run(board, 2 * 16 + 1);
  assert.equal(board.at(1, 1).kind, 1);
  assert.equal(board.at(1, 2).kind, LIFT);
  run(board, 3 * 16);
  assert.equal(board.at(1, 4).kind, 1);
  assert.equal(board.at(1, 5).kind, LIFT);
  assert.equal(board.at(1, 1).kind, EMPTY);
});

test('an icon stranded as the last of its kind is detected', () => {
  const board = boardFrom([
    '#####',
    '#1.2#',
    '#####',
  ]);
  assert.ok(board.isStuck());
});
