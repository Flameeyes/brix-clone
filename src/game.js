// @ts-check
import { BLAST_TICKS, BLOCK, Board, LIFT, OUTSIDE, TILE, WALL, isIcon } from './board.js';
import { DEFAULT_NAME, insertHiscore, loadHiscores, placeFor } from './hiscores.js';
import { FIELD_HEIGHT, FIELD_WIDTH, PROBLEMS_PER_CHOICE, TIERS, firstProblemIndex } from './levels.js';
import { COLOR, SCREEN_HEIGHT, SCREEN_WIDTH } from './render.js';

/**
 * @typedef {import('./levels.js').Level} Level
 * @typedef {import('./render.js').Renderer} Renderer
 * @typedef {import('./sound.js').Sound} Sound
 * @typedef {'left' | 'right' | 'up' | 'down' | 'fire' | 'escape' | 'retry' | 'sound' | 'start' | 'hiscores' | 'credits'} Action
 * @typedef {'title' | 'hiscores' | 'credits' | 'tree' | 'ready' | 'play' | 'solved' | 'timeout' | 'gameover' | 'won' | 'name'} Screen
 * @typedef {{tier: number, choice: number}} Node
 */

export const TICKS_PER_SECOND = 60;
const FIELD_X = 96;
const FIELD_Y = 4;
const LIVES = 5;
const RETRIES = 2;
const CONTINUE_SECONDS = 10;
const COMPLETING_BONUS = 500000;
const SPARKLE_TILE = 14;
const SPARKLE_FRAMES = 5;
const SPARKLE_TICKS = 40;
// A sideways move that cannot happen yet (e.g. the icon is still sliding or
// riding a lift into place) is retried for this many ticks.
const MOVE_BUFFER_TICKS = 12;

const TREE_X = 56;
const TREE_Y = 44;
const TREE_DX = 32;
const TREE_DY = 21;

const MENU = /** @type {const} */ ([
  { key: 'F1', alt: 'ENTER', label: 'START GAME', action: 'start' },
  { key: 'F3', alt: 'H', label: 'HIGHSCORES', action: 'hiscores' },
  { key: 'F4', alt: 'R', label: 'RETRY DURING GAME', action: null },
  { key: 'F5', alt: 'S', label: 'SOUND ON..OFF', action: 'sound' },
  { key: 'F7', alt: 'C', label: 'CREDITS', action: 'credits' },
]);
const MENU_Y = 110;
const MENU_STEP = 12;

/** @param {number} seconds */
function formatTime(seconds) {
  const clamped = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(clamped / 60)}:${String(clamped % 60).padStart(2, '0')}`;
}

/** @param {Node} node */
function nodePosition(node) {
  return { x: TREE_X + (node.tier - 1) * TREE_DX, y: TREE_Y + (node.choice - 1) * TREE_DY };
}

export class Game {
  /**
   * @param {Level[]} levels
   * @param {Renderer} renderer
   * @param {Sound} sound
   * @param {(score: number, place: number) => Promise<string>} askName
   */
  constructor(levels, renderer, sound, askName) {
    this.levels = levels;
    this.renderer = renderer;
    this.sound = sound;
    this.askName = askName;
    this.hiscores = loadHiscores();
    /** @type {Screen} */
    this.screen = 'title';
    this.frame = 0;
    this.screenTicks = 0;

    this.score = 0;
    this.lives = LIVES;
    /** @type {Node[]} */
    this.path = [];
    /** @type {Node} */
    this.treeCursor = { tier: 1, choice: 1 };
    this.problem = 0;
    this.retries = RETRIES;
    this.retried = false;
    this.timeLeft = 0;
    this.bonusLeft = 0;
    this.continueLeft = 0;
    /** @type {Board} */
    this.board = new Board(levels[0].grid, levels[0].lift);
    this.cursor = { x: 0, y: 0 };
    /** @type {number | null} */
    this.grabbed = null;
    /** @type {{dx: -1 | 1, ticks: number} | null} */
    this.pendingSlide = null;
    /** @type {{x: number, y: number, points: number, ticks: number}[]} */
    this.popups = [];
  }

  /** @param {Screen} screen */
  show(screen) {
    this.screen = screen;
    this.screenTicks = 0;
  }

  get tier() {
    return this.path.length + 1;
  }

  get currentLevel() {
    const node = this.treeCursor;
    return this.levels[firstProblemIndex(node.tier, node.choice) + this.problem];
  }

  /** @returns {Node[]} */
  availableNodes() {
    const last = this.path.at(-1);
    if (!last) {
      return [{ tier: 1, choice: 1 }];
    }
    if (last.tier === TIERS) {
      return [];
    }
    return [
      { tier: last.tier + 1, choice: last.choice },
      { tier: last.tier + 1, choice: last.choice + 1 },
    ];
  }

  newGame() {
    this.score = 0;
    this.lives = LIVES;
    this.path = [];
    this.treeCursor = { tier: 1, choice: 1 };
    this.show('tree');
  }

  startProblem() {
    const level = this.currentLevel;
    this.board = new Board(level.grid, level.lift);
    this.cursor = { ...level.cursor };
    this.release();
    this.popups = [];
    this.show('ready');
  }

  beginChoice() {
    this.problem = 0;
    this.retries = RETRIES;
    this.retried = false;
    this.timeLeft = this.currentLevel.seconds;
    this.startProblem();
  }

  retry() {
    if (this.screen !== 'play' || this.retries === 0) {
      return;
    }
    this.retries -= 1;
    this.retried = true;
    const level = this.currentLevel;
    this.board = new Board(level.grid, level.lift);
    this.release();
    this.sound.fail();
  }

  continueGame() {
    this.lives -= 1;
    this.retries = RETRIES;
    this.retried = false;
    this.timeLeft = this.currentLevel.seconds;
    this.startProblem();
  }

  gameOver() {
    this.release();
    this.show('gameover');
  }

  async enterHiscore() {
    const place = placeFor(this.hiscores, this.score);
    if (place < 0) {
      this.show('hiscores');
      return;
    }
    this.show('name');
    const name = (await this.askName(this.score, place + 1)).trim().toUpperCase().slice(0, 14) || DEFAULT_NAME;
    this.hiscores = insertHiscore(this.hiscores, { name, score: this.score });
    this.show('hiscores');
  }

  /** @param {Action} action */
  handle(action) {
    if (action === 'sound') {
      this.sound.toggle();
      return;
    }
    switch (this.screen) {
      case 'title':
        if (action === 'start' || action === 'fire') {
          this.newGame();
        } else if (action === 'hiscores') {
          this.show('hiscores');
        } else if (action === 'credits') {
          this.show('credits');
        }
        break;
      case 'hiscores':
      case 'credits':
        this.show('title');
        break;
      case 'tree':
        this.handleTree(action);
        break;
      case 'ready':
        if (action === 'fire' || action === 'start') {
          this.show('play');
        } else if (action === 'escape') {
          this.gameOver();
        }
        break;
      case 'play':
        this.handlePlay(action);
        break;
      case 'solved':
        if (action === 'fire' || action === 'start') {
          this.score += this.bonusLeft * this.bonusFactor();
          this.bonusLeft = 0;
        }
        break;
      case 'timeout':
        if (action === 'fire' || action === 'start') {
          this.continueGame();
        } else if (action === 'escape') {
          this.gameOver();
        }
        break;
      case 'gameover':
      case 'won':
        if (this.screenTicks > TICKS_PER_SECOND && (action === 'fire' || action === 'start' || action === 'escape')) {
          void this.enterHiscore();
        }
        break;
      case 'name':
        break;
    }
  }

  /** @param {Action} action */
  handleTree(action) {
    const available = this.availableNodes();
    const index = available.findIndex((node) => node.choice === this.treeCursor.choice && node.tier === this.treeCursor.tier);
    if (action === 'up' || action === 'left') {
      this.treeCursor = available[Math.max(0, index - 1)];
      this.sound.move();
    } else if (action === 'down' || action === 'right') {
      this.treeCursor = available[Math.min(available.length - 1, index + 1)];
      this.sound.move();
    } else if (action === 'fire' || action === 'start') {
      this.beginChoice();
    } else if (action === 'escape') {
      this.gameOver();
    }
  }

  /** @param {Action} action */
  handlePlay(action) {
    switch (action) {
      case 'left':
      case 'right': {
        const dx = action === 'left' ? -1 : 1;
        if (this.grabbed !== null) {
          this.pendingSlide = { dx, ticks: MOVE_BUFFER_TICKS };
          this.trySlide();
        } else {
          this.moveCursor(dx, 0);
        }
        break;
      }
      case 'up':
      case 'down':
        if (this.grabbed === null) {
          this.moveCursor(0, action === 'up' ? -1 : 1);
        }
        break;
      case 'fire':
        if (this.grabbed !== null) {
          this.release();
        } else {
          this.grab();
        }
        break;
      case 'retry':
        this.retry();
        break;
      case 'escape':
        this.gameOver();
        break;
    }
  }

  trySlide() {
    if (!this.pendingSlide) {
      return;
    }
    const { dx } = this.pendingSlide;
    if (this.board.slide(this.cursor.x, this.cursor.y, dx)) {
      this.cursor.x += dx;
      this.pendingSlide = null;
      this.sound.move();
    } else if (--this.pendingSlide.ticks <= 0) {
      this.pendingSlide = null;
    }
  }

  release() {
    this.grabbed = null;
    this.pendingSlide = null;
  }

  grab() {
    if (this.board.canGrab(this.cursor.x, this.cursor.y)) {
      this.grabbed = this.board.at(this.cursor.x, this.cursor.y).id;
      this.sound.grab();
    }
  }

  /** @param {number} dx @param {number} dy */
  moveCursor(dx, dy) {
    const x = this.cursor.x + dx;
    const y = this.cursor.y + dy;
    const kind = this.board.at(x, y).kind;
    if (kind !== OUTSIDE && kind !== WALL) {
      this.cursor = { x, y };
    }
  }

  /**
   * @param {number} px screen x
   * @param {number} py screen y
   * @returns {{x: number, y: number} | null}
   */
  fieldCell(px, py) {
    const x = Math.floor((px - FIELD_X) / TILE);
    const y = Math.floor((py - FIELD_Y) / TILE);
    return this.board.inside(x, y) ? { x, y } : null;
  }

  /** @param {number} px @param {number} py */
  pointerDown(px, py) {
    switch (this.screen) {
      case 'title': {
        const row = Math.floor((py - MENU_Y + 2) / MENU_STEP);
        const entry = MENU[row];
        this.handle(entry?.action ?? 'start');
        break;
      }
      case 'tree': {
        const node = this.availableNodes().find((candidate) => {
          const { x, y } = nodePosition(candidate);
          return Math.abs(px - x - 8) < 14 && Math.abs(py - y - 8) < 11;
        });
        if (node) {
          this.treeCursor = node;
          this.beginChoice();
        }
        break;
      }
      case 'play': {
        const cell = this.fieldCell(px, py);
        if (!cell) {
          return;
        }
        const kind = this.board.at(cell.x, cell.y).kind;
        if (kind !== OUTSIDE && kind !== WALL) {
          this.cursor = cell;
          this.grab();
        }
        break;
      }
      default:
        this.handle('fire');
    }
  }

  /** @param {number} px */
  pointerMove(px) {
    if (this.screen !== 'play' || this.grabbed === null) {
      return;
    }
    const target = Math.floor((px - FIELD_X) / TILE);
    if (target !== this.cursor.x) {
      this.handlePlay(target < this.cursor.x ? 'left' : 'right');
    }
  }

  pointerUp() {
    if (this.screen === 'play') {
      this.release();
    }
  }

  bonusFactor() {
    return 10 * this.tier;
  }

  update() {
    this.frame += 1;
    this.screenTicks += 1;
    switch (this.screen) {
      case 'ready':
        if (this.screenTicks > 2 * TICKS_PER_SECOND) {
          this.show('play');
        }
        break;
      case 'play':
        this.updatePlay();
        break;
      case 'solved':
        this.updateSolved();
        break;
      case 'gameover':
        if (this.screenTicks === 4 * TICKS_PER_SECOND) {
          void this.enterHiscore();
        }
        break;
      case 'timeout':
        if (this.screenTicks % TICKS_PER_SECOND === 0) {
          this.continueLeft -= 1;
          this.sound.tick();
          if (this.continueLeft < 0) {
            this.gameOver();
          }
        }
        break;
    }
    this.popups = this.popups.filter((popup) => --popup.ticks > 0);
  }

  updatePlay() {
    for (const event of this.board.tick()) {
      if (event.type === 'blast') {
        const points = 5 * event.size * event.size * this.tier;
        this.score += points;
        this.popups.push({ x: event.x, y: event.y, points, ticks: BLAST_TICKS + 20 });
        this.sound.blast(event.size);
      } else {
        this.sound.land();
      }
    }
    if (this.grabbed !== null) {
      const found = this.board.find(this.grabbed);
      if (found && !found.cell.falling) {
        this.cursor = { x: found.x, y: found.y };
        this.trySlide();
      } else {
        this.release();
      }
    }
    if (this.board.isCleared()) {
      this.bonusLeft = this.retried ? 0 : Math.ceil(this.timeLeft);
      this.sound.solved();
      this.show('solved');
      return;
    }
    const before = Math.ceil(this.timeLeft);
    this.timeLeft -= 1 / TICKS_PER_SECOND;
    const after = Math.ceil(this.timeLeft);
    if (after !== before && after <= 10) {
      this.sound.tick();
    }
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.release();
      this.sound.fail();
      if (this.lives > 1) {
        this.continueLeft = CONTINUE_SECONDS;
        this.show('timeout');
      } else {
        this.lives = 0;
        this.gameOver();
      }
    }
  }

  updateSolved() {
    if (this.screenTicks < TICKS_PER_SECOND) {
      return;
    }
    if (this.bonusLeft > 0) {
      this.bonusLeft -= 1;
      this.score += this.bonusFactor();
      if (this.bonusLeft % 2 === 0) {
        this.sound.bonus();
      }
      return;
    }
    if (this.screenTicks < 2 * TICKS_PER_SECOND) {
      return;
    }
    if (this.problem < PROBLEMS_PER_CHOICE - 1) {
      this.problem += 1;
      this.retries = RETRIES;
      this.retried = false;
      this.timeLeft = this.currentLevel.seconds;
      this.startProblem();
      return;
    }
    this.path.push(this.treeCursor);
    const next = this.availableNodes();
    if (next.length === 0) {
      if (this.treeCursor.choice === TIERS) {
        this.score += COMPLETING_BONUS;
      }
      this.show('won');
    } else {
      this.treeCursor = next[0];
      this.show('tree');
    }
  }

  draw() {
    const r = this.renderer;
    r.clear();
    switch (this.screen) {
      case 'title':
        this.drawTitle();
        break;
      case 'hiscores':
      case 'name':
        this.drawHiscores();
        break;
      case 'credits':
        this.drawCredits();
        break;
      case 'tree':
        this.drawTree();
        break;
      case 'ready':
      case 'play':
      case 'solved':
      case 'timeout':
      case 'gameover':
        this.drawPlay();
        break;
      case 'won':
        this.drawWon();
        break;
    }
  }

  drawTitle() {
    const r = this.renderer;
    r.centered('RADIESEL PRESENTS ...', 8, COLOR.lightGrey);
    r.drawLogo((SCREEN_WIDTH - r.logoWidth) / 2, 26, this.frame / 2);
    r.centered('WRITTEN BY MICHAEL RIEDEL 1991', 88, COLOR.cyan);
    MENU.forEach((entry, i) => {
      const y = MENU_Y + i * MENU_STEP;
      r.text(entry.key, 32, y, COLOR.yellow);
      r.text(entry.alt, 56, y, COLOR.grey);
      r.text(entry.label, 112, y, COLOR.white);
    });
    r.centered(`HI SCORE ${this.hiscores[0].score}`, 176, COLOR.red);
    r.centered(`SOUND ${this.sound.enabled ? 'ON' : 'OFF'}`, 188, COLOR.grey);
  }

  drawHiscores() {
    const r = this.renderer;
    r.centered('HALL OF FAME', 16, COLOR.yellow);
    r.text('RANK    SCORE  NAME', 48, 40, COLOR.cyan);
    this.hiscores.forEach((entry, i) => {
      const y = 56 + i * 12;
      r.text(`${String(i + 1).padStart(3)}.`, 48, y, COLOR.white);
      r.text(String(entry.score).padStart(8), 88, y, COLOR.yellow);
      r.text(entry.name, 168, y, COLOR.white);
    });
  }

  drawCredits() {
    const r = this.renderer;
    const lines = [
      ['BRIX', COLOR.yellow],
      ['WRITTEN BY M.RIEDEL 1991', COLOR.white],
      ['', COLOR.white],
      ['THANKS TO:', COLOR.cyan],
      ['JUERGEN EGELING (FFT)', COLOR.white],
      ['FOR SOME NICE LEVELS AND', COLOR.white],
      ['RAINER STOBER (DUR)', COLOR.white],
      ['FOR TECHNICAL SUPPORT', COLOR.white],
      ['', COLOR.white],
      ['BROWSER REMAKE 2026', COLOR.cyan],
      ['ORIGINAL LEVELS AND GRAPHICS', COLOR.white],
      ['RELEASED TO THE PUBLIC DOMAIN', COLOR.white],
    ];
    lines.forEach(([text, color], i) => r.centered(String(text), 24 + i * 12, Number(color)));
  }

  drawTree() {
    const r = this.renderer;
    r.centered('PLEASE SELECT PROBLEM', 4, COLOR.yellow);
    r.text('LEVEL', 8, 26, COLOR.cyan);
    const available = this.availableNodes();
    const isAvailable = (/** @type {Node} */ node) => available.some((a) => a.tier === node.tier && a.choice === node.choice);
    const isDone = (/** @type {Node} */ node) => this.path.some((p) => p.tier === node.tier && p.choice === node.choice);
    for (let tier = 1; tier <= TIERS; tier++) {
      r.text(String(tier), TREE_X + (tier - 1) * TREE_DX + 4, 26, COLOR.cyan);
      for (let choice = 1; choice <= tier && tier < TIERS; choice++) {
        const from = nodePosition({ tier, choice });
        for (const next of [choice, choice + 1]) {
          const to = nodePosition({ tier: tier + 1, choice: next });
          const walked = isDone({ tier, choice }) && (isDone({ tier: tier + 1, choice: next }) || isAvailable({ tier: tier + 1, choice: next }));
          r.line(from.x + 8, from.y + 8, to.x + 8, to.y + 8, walked ? COLOR.yellow : COLOR.grey, walked ? 2 : 1);
        }
      }
    }
    for (let tier = 1; tier <= TIERS; tier++) {
      for (let choice = 1; choice <= tier; choice++) {
        const node = { tier, choice };
        const { x, y } = nodePosition(node);
        const selected = this.treeCursor.tier === tier && this.treeCursor.choice === choice;
        if (isDone(node)) {
          r.tile(20 + choice, x, y);
        } else if (isAvailable(node)) {
          r.tile(40 + choice, x, y);
          if (selected && this.frame % 30 < 20) {
            r.frame(x - 3, y - 3, 22, 22, COLOR.white);
          }
        } else {
          r.tile(WALL, x, y);
        }
      }
    }
    const goal = nodePosition({ tier: TIERS, choice: TIERS });
    r.text('GOAL', goal.x + 20, goal.y + 4, this.frame % 60 < 30 ? COLOR.yellow : COLOR.orange);
    r.text(`SCORE ${this.score}`, 8, 190, COLOR.white);
    r.text(`LIVES ${this.lives}`, 248, 190, COLOR.white);
  }

  drawPlay() {
    this.drawPanel();
    this.drawField();
    const r = this.renderer;
    const centerX = FIELD_X + (FIELD_WIDTH * TILE) / 2;
    /** @param {string[]} lines @param {number} color */
    const banner = (lines, color) => {
      const height = lines.length * 12 + 8;
      const top = FIELD_Y + (FIELD_HEIGHT * TILE - height) / 2;
      r.fill(FIELD_X + 16, top, FIELD_WIDTH * TILE - 32, height, COLOR.black);
      r.frame(FIELD_X + 16, top, FIELD_WIDTH * TILE - 32, height, color);
      lines.forEach((line, i) => r.centered(line, top + 6 + i * 12, color, centerX));
    };
    switch (this.screen) {
      case 'ready':
        banner([`LEVEL ${this.tier}  PROBLEM ${this.problem + 1}`, `TIME ${formatTime(this.timeLeft)}`, 'GET READY!'], COLOR.yellow);
        break;
      case 'solved': {
        const lines = ['CLEAR...'];
        if (this.retried) {
          lines.push('NO BONUS AFTER RETRY');
        } else {
          lines.push('BONUS', `${formatTime(this.bonusLeft)} * ${this.bonusFactor()}`);
        }
        banner(lines, COLOR.green);
        break;
      }
      case 'timeout':
        banner(['TIME OUT!', `CONTINUE ${Math.max(0, this.continueLeft)}`, `PRESS SPACE (${this.lives - 1} LEFT)`], COLOR.red);
        break;
      case 'gameover':
        banner(['GAME OVER', `SCORE ${this.score}`], COLOR.red);
        break;
      case 'play':
        if (this.board.isStuck() && this.frame % 60 < 40) {
          banner(this.retries > 0 ? ['STUCK!', 'F4 OR R TO RETRY'] : ['STUCK!', 'ESC TO GIVE UP'], COLOR.magenta);
        }
        break;
    }
  }

  drawPanel() {
    const r = this.renderer;
    r.text('LEVEL', 4, 6, COLOR.cyan);
    r.text(String(this.tier), 68, 6, COLOR.white);
    r.text('PROBLEM', 4, 18, COLOR.cyan);
    r.text(`${this.problem + 1}/${PROBLEMS_PER_CHOICE}`, 64, 18, COLOR.white);
    r.text('TIME', 4, 34, COLOR.cyan);
    const time = this.screen === 'solved' ? formatTime(this.bonusLeft) : formatTime(this.timeLeft);
    r.bigDigits(time, 8, 44, this.timeLeft <= 10 && this.screen === 'play' ? 'red' : 'blue');
    r.text('SCORE', 4, 66, COLOR.cyan);
    r.text(String(this.score).padStart(11), 0, 76, COLOR.white);
    const counts = this.board.iconCounts();
    for (let kind = 1; kind <= 8; kind++) {
      const x = 4 + ((kind - 1) % 2) * 44;
      const y = 92 + Math.floor((kind - 1) / 2) * 16;
      const count = counts.get(kind) ?? 0;
      r.tile(kind, x, y, 12);
      r.text(`${count}`, x + 16, y + 3, count === 1 ? COLOR.red : count ? COLOR.white : COLOR.grey);
    }
    r.text('LIVES', 4, 164, COLOR.cyan);
    r.text(String(this.lives), 68, 164, COLOR.white);
    r.text('RETRY', 4, 176, COLOR.cyan);
    r.text(String(this.retries), 68, 176, COLOR.white);
    r.text(this.sound.enabled ? '' : 'SOUND OFF', 4, 190, COLOR.grey);
  }

  drawField() {
    const r = this.renderer;
    const board = this.board;
    r.clipped(FIELD_X, FIELD_Y, FIELD_WIDTH * TILE, FIELD_HEIGHT * TILE, () => {
      for (let y = 0; y < FIELD_HEIGHT; y++) {
        for (let x = 0; x < FIELD_WIDTH; x++) {
          const kind = board.at(x, y).kind;
          if (kind === OUTSIDE || kind === WALL || kind === BLOCK) {
            r.tile(kind, FIELD_X + x * TILE, FIELD_Y + y * TILE);
          }
        }
      }
      for (let y = 0; y < FIELD_HEIGHT; y++) {
        for (let x = 0; x < FIELD_WIDTH; x++) {
          const cell = board.at(x, y);
          const px = FIELD_X + x * TILE + cell.ox;
          const py = FIELD_Y + y * TILE + cell.oy;
          if (cell.kind === LIFT) {
            r.tile(9, px, py - 4);
          } else if (isIcon(cell.kind)) {
            if (cell.blast === 0) {
              r.tile(cell.kind, px, py);
            } else if (cell.blast > SPARKLE_TICKS) {
              if (cell.blast % 6 < 3) {
                r.tile(cell.kind, px, py);
              }
            } else {
              r.tile(SPARKLE_TILE + Math.floor(((SPARKLE_TICKS - cell.blast) * SPARKLE_FRAMES) / SPARKLE_TICKS), px, py);
            }
          }
        }
      }
      if (this.screen === 'play') {
        const cell = board.at(this.cursor.x, this.cursor.y);
        const grabbed = this.grabbed !== null;
        const px = FIELD_X + this.cursor.x * TILE + (grabbed ? cell.ox : 0);
        const py = FIELD_Y + this.cursor.y * TILE + (grabbed ? cell.oy : 0);
        if (grabbed) {
          r.frame(px, py, TILE, TILE, COLOR.yellow);
          r.frame(px + 1, py + 1, TILE - 2, TILE - 2, COLOR.yellow);
        } else if (this.frame % 40 < 28) {
          r.frame(px, py, TILE, TILE, COLOR.white);
        }
      }
      for (const popup of this.popups) {
        const text = String(popup.points);
        const rise = (BLAST_TICKS + 20 - popup.ticks) / 3;
        r.text(text, FIELD_X + popup.x * TILE + 8 - text.length * 4, FIELD_Y + popup.y * TILE + 4 - rise, COLOR.yellow);
      }
    });
  }

  drawWon() {
    const r = this.renderer;
    r.drawLogo((SCREEN_WIDTH - r.logoWidth) / 2, 16, this.frame / 2);
    r.centered('YOU MADE IT!', 90, COLOR.yellow);
    if (this.treeCursor.choice === TIERS) {
      r.centered('COMPLETING BONUS', 110, COLOR.cyan);
      r.centered(String(COMPLETING_BONUS), 122, COLOR.white);
    } else {
      r.centered('NOW TRY THE GOAL AT THE BOTTOM!', 110, COLOR.cyan);
    }
    r.centered(`SCORE:${this.score}`, 146, COLOR.white);
    r.centered('PRESS SPACE', SCREEN_HEIGHT - 20, COLOR.grey);
  }
}
