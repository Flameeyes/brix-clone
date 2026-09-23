// @ts-check
import { BLOCK, Board, LIFT, OUTSIDE, TILE, WALL, isIcon } from './board.js';
import { DEFAULT_NAME, insertHiscore, loadHiscores, placeFor } from './hiscores.js';
import { FIELD_HEIGHT, FIELD_WIDTH, PROBLEMS_PER_CHOICE, TIERS, firstProblemIndex } from './levels.js';
import { COLOR, SCREEN_HEIGHT, SCREEN_WIDTH } from './render.js';

/**
 * @typedef {import('./board.js').Blast} Blast
 * @typedef {import('./levels.js').Level} Level
 * @typedef {import('./render.js').Renderer} Renderer
 * @typedef {import('./sound.js').Sound} Sound
 * @typedef {'left' | 'right' | 'up' | 'down' | 'fire' | 'escape' | 'retry' | 'sound' | 'start' | 'hiscores' | 'credits'} Action
 * @typedef {'title' | 'hiscores' | 'credits' | 'tree' | 'ready' | 'play' | 'solved' | 'timeout' | 'gameover' | 'won' | 'name'} Screen
 * @typedef {{tier: number, choice: number}} Node
 * @typedef {'open' | 'done'} NodeState
 */

// The original times everything with the PC's 1.193182 MHz timer chip; all
// durations below are in its units, as found in BRIX.EXE.
const PIT_UNITS_PER_MS = 1193.182;
const GRAVITY_PERIOD = 15000;
const LIFT_PERIOD = 30000;
/** The clock counts one second every 21 ticks of the 18.2 Hz BIOS timer. */
const GAME_SECOND = 21 * 65536;
const FLASHES = 10;
const FLASH_UNITS = 100000;
const SPARKLE_FRAMES = 5;
const SPARKLE_UNITS = 131250;
const BLAST_UNITS = FLASHES * FLASH_UNITS + SPARKLE_FRAMES * SPARKLE_UNITS;
/** Step of the countdowns on the level tree and the continue screen. */
const COUNTDOWN_STEP = 0x13d620;
const COUNTDOWN_STEPS = 10;
const READY_UNITS = 2 * 1193182;
const BONUS_STEP_UNITS = 25000;
const SOLVED_PAUSE_UNITS = 30 * 65536;

const FIELD_X = 96;
const FIELD_Y = 4;
const LIVES = 5;
const RETRIES = 2;
const START_TIERS = 5;
const COMPLETING_BONUS = 500000;
const SPARKLE_TILE = 14;
const WARNING_SECONDS = 30;
// A sideways move is refused while anything falls; keep trying it this long.
const MOVE_BUFFER_UNITS = 700000;
const KEY_BUFFER_SIZE = 15;

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
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** @param {Node} node */
function nodePosition(node) {
  return { x: TREE_X + (node.tier - 1) * TREE_DX, y: TREE_Y + (node.choice - 1) * TREE_DY };
}

/** @param {Node} node */
const nodeKey = (node) => `${node.tier}/${node.choice}`;

/** @param {number} chain */
function chainBonus(chain) {
  if (chain <= 3) {
    return 0;
  }
  return chain === 4 ? 400 : chain === 5 ? 600 : 1000;
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
    /** Time spent on the current screen, in timer units. */
    this.screenUnits = 0;
    this.frame = 0;

    this.score = 0;
    this.lives = LIVES;
    this.retries = RETRIES;
    /** @type {Map<string, NodeState>} */
    this.tree = new Map();
    /** @type {Node} */
    this.treeCursor = { tier: 1, choice: 1 };
    this.problem = 0;
    this.iconShift = 0;
    this.seconds = 0;
    this.secondUnits = 0;
    this.bonusSeconds = 0;
    this.clearBonus = 0;
    this.countdown = 0;

    this.board = new Board(levels[0].grid, levels[0].lift, levels[0].cursor);
    this.gravityUnits = 0;
    this.liftUnits = 0;
    /** @type {{blast: Blast, units: number} | null} */
    this.blasting = null;
    /** @type {{dx: -1 | 1, units: number} | null} */
    this.pendingSlide = null;
    this.dragging = false;
    // Keys pressed during a blast wait in the keyboard buffer, like on DOS.
    /** @type {Action[]} */
    this.queued = [];
    /** @type {{text: string, x: number, y: number, units: number}[]} */
    this.popups = [];
  }

  /** @param {Screen} screen */
  show(screen) {
    this.screen = screen;
    this.screenUnits = 0;
  }

  get tier() {
    return this.treeCursor.tier;
  }

  get currentLevel() {
    const node = this.treeCursor;
    return this.levels[firstProblemIndex(node.tier, node.choice) + this.problem];
  }

  /** @returns {Node[]} */
  openNodes() {
    return [...this.tree.entries()]
      .filter(([, state]) => state === 'open')
      .map(([key]) => {
        const [tier, choice] = key.split('/').map(Number);
        return { tier, choice };
      })
      .sort((a, b) => a.tier - b.tier || a.choice - b.choice);
  }

  newGame() {
    this.score = 0;
    this.lives = LIVES;
    this.retries = RETRIES;
    this.tree = new Map();
    for (let tier = 1; tier <= START_TIERS; tier++) {
      for (let choice = 1; choice <= tier; choice++) {
        this.tree.set(nodeKey({ tier, choice }), 'open');
      }
    }
    this.treeCursor = { tier: 1, choice: 1 };
    this.showTree();
  }

  showTree() {
    this.countdown = COUNTDOWN_STEPS;
    this.show('tree');
  }

  chooseNode() {
    for (const node of this.openNodes()) {
      if (nodeKey(node) !== nodeKey(this.treeCursor)) {
        this.tree.delete(nodeKey(node));
      }
    }
    this.problem = 0;
    this.iconShift = Math.floor(Math.random() * 8);
    this.startProblem(true);
  }

  /** @param {boolean} resetClock */
  startProblem(resetClock) {
    const level = this.currentLevel;
    const grid = level.grid.map((kind) => (isIcon(kind) ? ((kind + this.iconShift) % 8) + 1 : kind));
    this.board = new Board(grid, level.lift, level.cursor);
    if (resetClock) {
      this.seconds = level.seconds;
      this.secondUnits = 0;
    }
    this.gravityUnits = 0;
    this.liftUnits = 0;
    this.blasting = null;
    this.pendingSlide = null;
    this.queued = [];
    this.popups = [];
    this.show('ready');
  }

  retry() {
    if (this.screen !== 'play' || this.blasting) {
      return;
    }
    if (this.retries === 0) {
      this.timeOut();
      return;
    }
    this.retries -= 1;
    this.startProblem(false);
  }

  timeOut() {
    this.sound.fail();
    if (this.lives === 0) {
      this.gameOver();
      return;
    }
    this.countdown = COUNTDOWN_STEPS;
    this.show('timeout');
  }

  continueGame() {
    this.lives -= 1;
    this.startProblem(true);
  }

  gameOver() {
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
          this.score += this.bonusSeconds * this.tier * 100;
          this.bonusSeconds = 0;
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
        if (this.screenUnits > 1193182 && (action === 'fire' || action === 'start' || action === 'escape')) {
          void this.enterHiscore();
        }
        break;
      case 'name':
        break;
    }
  }

  /** @param {Action} action */
  handleTree(action) {
    const open = this.openNodes();
    const { tier, choice } = this.treeCursor;
    /** @type {Node | undefined} */
    let target;
    if (action === 'up' || action === 'down') {
      const column = open.filter((node) => node.tier === tier);
      target = action === 'up'
        ? column.filter((node) => node.choice < choice).at(-1)
        : column.find((node) => node.choice > choice);
    } else if (action === 'left' || action === 'right') {
      const nextTier = tier + (action === 'left' ? -1 : 1);
      const column = open.filter((node) => node.tier === nextTier);
      target = column.find((node) => node.choice === Math.min(choice, nextTier)) ?? column[0];
    } else if (action === 'fire' || action === 'start') {
      this.chooseNode();
    } else if (action === 'escape') {
      this.gameOver();
    }
    if (target) {
      this.treeCursor = target;
      this.sound.move();
    }
  }

  /** @param {Action} action */
  handlePlay(action) {
    if (this.blasting && action !== 'escape') {
      if (this.queued.length < KEY_BUFFER_SIZE) {
        this.queued.push(action);
      }
      return;
    }
    const board = this.board;
    switch (action) {
      case 'left':
      case 'right': {
        const dx = action === 'left' ? -1 : 1;
        if (board.selected) {
          this.pendingSlide = { dx, units: MOVE_BUFFER_UNITS };
          this.trySlide();
        } else if (board.moveCursor(dx, 0)) {
          this.sound.move();
        }
        break;
      }
      case 'up':
      case 'down':
        if (board.moveCursor(0, action === 'up' ? -1 : 1)) {
          this.sound.move();
        }
        break;
      case 'fire':
        if (board.toggleSelect()) {
          this.sound.grab();
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
    if (this.board.slide(this.pendingSlide.dx)) {
      this.pendingSlide = null;
      this.sound.move();
    } else if (!this.board.selected) {
      this.pendingSlide = null;
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
        this.handle(MENU[row]?.action ?? 'start');
        break;
      }
      case 'tree': {
        const node = this.openNodes().find((candidate) => {
          const { x, y } = nodePosition(candidate);
          return Math.abs(px - x - 8) < 14 && Math.abs(py - y - 8) < 11;
        });
        if (node) {
          this.treeCursor = node;
          this.chooseNode();
        }
        break;
      }
      case 'play': {
        const cell = this.fieldCell(px, py);
        const board = this.board;
        if (!cell || this.blasting) {
          return;
        }
        if (board.selected && (cell.x !== board.cursor.x || cell.y !== board.cursor.y)) {
          board.release();
        }
        if (!board.selected) {
          const kind = board.at(cell.x, cell.y);
          if (kind === WALL || kind === OUTSIDE) {
            return;
          }
          board.cursor = cell;
          if (board.toggleSelect()) {
            this.sound.grab();
          }
        }
        this.dragging = board.selected;
        break;
      }
      default:
        this.handle('fire');
    }
  }

  /** @param {number} px */
  pointerMove(px) {
    if (this.screen !== 'play' || !this.dragging || !this.board.selected || this.pendingSlide) {
      return;
    }
    const target = Math.floor((px - FIELD_X) / TILE);
    if (target !== this.board.cursor.x) {
      this.handlePlay(target < this.board.cursor.x ? 'left' : 'right');
    }
  }

  pointerUp() {
    if (this.screen === 'play' && this.dragging) {
      this.dragging = false;
    // Keys pressed during a blast wait in the keyboard buffer, like on DOS.
    /** @type {Action[]} */
    this.queued = [];
      this.pendingSlide = null;
      this.board.release();
    }
  }

  /** @param {number} ms real time since the last update */
  update(ms) {
    const units = ms * PIT_UNITS_PER_MS;
    this.frame += 1;
    this.screenUnits += units;
    this.popups = this.popups.filter((popup) => (popup.units -= units) > 0);
    switch (this.screen) {
      case 'tree':
        this.updateCountdown(() => this.chooseNode());
        break;
      case 'ready':
        if (this.screenUnits > READY_UNITS) {
          this.show('play');
        }
        break;
      case 'play':
        this.updatePlay(units);
        break;
      case 'solved':
        this.updateSolved();
        break;
      case 'timeout':
        this.updateCountdown(() => this.gameOver());
        break;
      case 'gameover':
        if (this.screenUnits > 4 * 1193182) {
          void this.enterHiscore();
        }
        break;
    }
  }

  /** @param {() => void} done */
  updateCountdown(done) {
    if (this.screenUnits < COUNTDOWN_STEP) {
      return;
    }
    this.screenUnits -= COUNTDOWN_STEP;
    this.countdown -= 1;
    this.sound.tick();
    if (this.countdown === 0) {
      done();
    }
  }

  /** @param {number} units */
  updatePlay(units) {
    if (this.pendingSlide) {
      this.pendingSlide.units -= units;
      this.trySlide();
      if (this.pendingSlide && this.pendingSlide.units <= 0) {
        this.pendingSlide = null;
      }
    }
    let budget = units;
    while (budget > 0 && this.screen === 'play') {
      if (this.blasting) {
        budget = this.advanceBlast(budget);
        continue;
      }
      const step = Math.min(budget, GRAVITY_PERIOD - this.gravityUnits, LIFT_PERIOD - this.liftUnits);
      budget -= step;
      this.gravityUnits += step;
      this.liftUnits += step;
      this.advanceClock(step);
      if (this.liftUnits >= LIFT_PERIOD) {
        this.liftUnits = 0;
        if (this.startBlast(this.board.gravityStep()) || this.startBlast(this.board.liftStep())) {
          continue;
        }
      }
      if (this.gravityUnits >= GRAVITY_PERIOD) {
        this.gravityUnits = 0;
        this.startBlast(this.board.gravityStep());
      }
    }
  }

  /** @param {number} units */
  advanceClock(units) {
    this.secondUnits += units;
    if (this.secondUnits < GAME_SECOND) {
      return;
    }
    this.secondUnits -= GAME_SECOND;
    this.seconds -= 1;
    if (this.seconds < WARNING_SECONDS) {
      this.sound.tick();
    }
    if (this.seconds <= 0) {
      this.seconds = 0;
      this.timeOut();
    }
  }

  /** @param {Blast | null} blast */
  startBlast(blast) {
    if (!blast) {
      return false;
    }
    const points = (blast.cells.length - 1) * 100;
    const bonus = chainBonus(blast.chain);
    this.score += points + bonus;
    const first = blast.cells[0];
    this.popups.push({ text: String(points), x: first.x, y: first.y, units: BLAST_UNITS + 600000 });
    this.blasting = { blast, units: 0 };
    this.sound.blast();
    return true;
  }

  /**
   * The original stops everything, the clock included, while icons blast.
   *
   * @param {number} budget
   * @returns {number} units left over
   */
  advanceBlast(budget) {
    const blasting = /** @type {{blast: Blast, units: number}} */ (this.blasting);
    const used = Math.min(budget, BLAST_UNITS - blasting.units);
    blasting.units += used;
    if (blasting.units >= BLAST_UNITS) {
      this.board.removeBlast(blasting.blast);
      this.blasting = null;
      if (this.board.isCleared()) {
        this.solved();
        return 0;
      }
      for (const action of this.queued.splice(0)) {
        this.handlePlay(action);
      }
    }
    return budget - used;
  }

  solved() {
    this.clearBonus = this.retries === RETRIES ? this.tier * 1000 : 0;
    this.score += this.clearBonus;
    this.bonusSeconds = this.seconds;
    this.sound.solved();
    this.show('solved');
  }

  updateSolved() {
    if (this.screenUnits < 1193182) {
      return;
    }
    while (this.bonusSeconds > 0 && this.screenUnits >= 1193182 + BONUS_STEP_UNITS) {
      this.screenUnits -= BONUS_STEP_UNITS;
      this.bonusSeconds -= 1;
      this.score += this.tier * 100;
      this.sound.bonus();
    }
    if (this.bonusSeconds > 0 || this.screenUnits < 1193182 + SOLVED_PAUSE_UNITS) {
      return;
    }
    if (this.problem < PROBLEMS_PER_CHOICE - 1) {
      this.problem += 1;
      this.startProblem(true);
      return;
    }
    this.finishChoice();
  }

  finishChoice() {
    const { tier, choice } = this.treeCursor;
    this.tree.set(nodeKey(this.treeCursor), 'done');
    /** @type {Node[]} */
    let next;
    if (tier < TIERS) {
      next = [{ tier: tier + 1, choice }, { tier: tier + 1, choice: choice + 1 }];
    } else if (choice < TIERS) {
      next = [{ tier, choice: choice + 1 }];
    } else {
      this.score += COMPLETING_BONUS;
      this.show('won');
      return;
    }
    for (const node of next) {
      this.tree.set(nodeKey(node), 'open');
    }
    this.treeCursor = next[0];
    this.showTree();
  }

  draw() {
    this.renderer.clear();
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
    r.text(String(this.countdown), 296, 4, COLOR.red);
    r.text('LEVEL', 8, 26, COLOR.cyan);
    const state = (/** @type {Node} */ node) => this.tree.get(nodeKey(node));
    for (let tier = 1; tier <= TIERS; tier++) {
      r.text(String(tier), TREE_X + (tier - 1) * TREE_DX + 4, 26, COLOR.cyan);
      for (let choice = 1; choice <= tier && tier < TIERS; choice++) {
        const from = nodePosition({ tier, choice });
        for (const next of [choice, choice + 1]) {
          const to = nodePosition({ tier: tier + 1, choice: next });
          const walked = state({ tier, choice }) === 'done' && state({ tier: tier + 1, choice: next }) !== undefined;
          r.line(from.x + 8, from.y + 8, to.x + 8, to.y + 8, walked ? COLOR.yellow : COLOR.grey, walked ? 2 : 1);
        }
      }
    }
    for (let choice = 1; choice < TIERS; choice++) {
      const from = nodePosition({ tier: TIERS, choice });
      const to = nodePosition({ tier: TIERS, choice: choice + 1 });
      const walked = state({ tier: TIERS, choice }) === 'done';
      r.line(from.x + 8, from.y + 8, to.x + 8, to.y + 8, walked ? COLOR.yellow : COLOR.grey, walked ? 2 : 1);
    }
    for (let tier = 1; tier <= TIERS; tier++) {
      for (let choice = 1; choice <= tier; choice++) {
        const node = { tier, choice };
        const { x, y } = nodePosition(node);
        const selected = this.treeCursor.tier === tier && this.treeCursor.choice === choice;
        if (state(node) === 'done') {
          r.tile(20 + choice, x, y);
        } else if (state(node) === 'open') {
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
        banner(['GET READY PLAYER', `LEVEL ${this.tier}  PROBLEM ${this.problem + 1}`, `TIME ${formatTime(this.seconds)}`], COLOR.yellow);
        break;
      case 'solved': {
        const lines = ['CLEAR...'];
        if (this.clearBonus > 0) {
          lines.push(`BONUS ${this.clearBonus}`);
        }
        lines.push(`${formatTime(this.bonusSeconds)} * ${this.tier * 100}`);
        banner(lines, COLOR.green);
        break;
      }
      case 'timeout':
        banner([this.retries === 0 && this.seconds > 0 ? 'NO RETRIES LEFT' : 'TIME OUT!', `CONTINUE ${this.countdown}`, `PRESS SPACE (${this.lives} LEFT)`], COLOR.red);
        break;
      case 'gameover':
        banner(['GAME OVER', `SCORE ${this.score}`], COLOR.red);
        break;
      case 'play': {
        const chain = this.blasting ? chainBonus(this.blasting.blast.chain) : 0;
        if (chain > 0 && this.frame % 20 < 14) {
          banner([`BONUS ${chain}`], COLOR.yellow);
        } else if (!this.blasting && this.board.isStuck() && this.frame % 60 < 40) {
          banner(['STUCK!', this.retries > 0 ? 'F4 OR R TO RETRY' : 'ESC TO GIVE UP'], COLOR.magenta);
        }
        break;
      }
    }
  }

  drawPanel() {
    const r = this.renderer;
    r.text('LEVEL', 4, 6, COLOR.cyan);
    r.text(String(this.tier), 68, 6, COLOR.white);
    r.text('PROBLEM', 4, 18, COLOR.cyan);
    r.text(`${this.problem + 1}/${PROBLEMS_PER_CHOICE}`, 64, 18, COLOR.white);
    r.text('TIME', 4, 34, COLOR.cyan);
    const seconds = this.screen === 'solved' ? this.bonusSeconds : this.seconds;
    r.bigDigits(formatTime(seconds), 8, 44, seconds < WARNING_SECONDS && this.screen === 'play' ? 'red' : 'blue');
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

  /**
   * @param {number} x
   * @param {number} y
   * @returns {number} vertical drawing offset of whatever is at (x, y)
   */
  motionOffset(x, y) {
    const board = this.board;
    if (board.isFalling(x, y)) {
      return board.fallOffset;
    }
    const lift = board.lift;
    if (lift && x === lift.x && y <= lift.y && y >= lift.y - lift.riders) {
      return lift.offset;
    }
    return 0;
  }

  drawField() {
    const r = this.renderer;
    const board = this.board;
    const blasting = this.blasting;
    const isBlasting = (/** @type {number} */ x, /** @type {number} */ y) => blasting?.blast.cells.some((c) => c.x === x && c.y === y);
    r.clipped(FIELD_X, FIELD_Y, FIELD_WIDTH * TILE, FIELD_HEIGHT * TILE, () => {
      for (let y = 0; y < FIELD_HEIGHT; y++) {
        for (let x = 0; x < FIELD_WIDTH; x++) {
          const kind = board.at(x, y);
          if (kind === OUTSIDE || kind === WALL || kind === BLOCK) {
            r.tile(kind, FIELD_X + x * TILE, FIELD_Y + y * TILE);
          }
        }
      }
      for (let y = 0; y < FIELD_HEIGHT; y++) {
        for (let x = 0; x < FIELD_WIDTH; x++) {
          const kind = board.at(x, y);
          if (kind !== LIFT && !isIcon(kind)) {
            continue;
          }
          const px = FIELD_X + x * TILE;
          const py = FIELD_Y + y * TILE + this.motionOffset(x, y);
          if (blasting && isBlasting(x, y)) {
            const flash = Math.floor(blasting.units / FLASH_UNITS);
            if (flash < FLASHES) {
              if (flash % 2 === 1) {
                r.tile(kind, px, py);
              }
            } else {
              const frame = Math.floor((blasting.units - FLASHES * FLASH_UNITS) / SPARKLE_UNITS);
              r.tile(SPARKLE_TILE + Math.min(SPARKLE_FRAMES - 1, frame), px, py);
            }
          } else {
            r.tile(kind, px, py);
          }
        }
      }
      if (this.screen === 'play') {
        const { x, y } = board.cursor;
        let offset = 0;
        if (board.following) {
          offset = board.fallOffset;
        } else if (board.riding && board.lift) {
          offset = board.lift.offset;
        }
        r.frame(FIELD_X + x * TILE, FIELD_Y + y * TILE + offset, TILE, TILE, board.selected ? COLOR.white : COLOR.red);
        if (board.selected) {
          r.frame(FIELD_X + x * TILE + 1, FIELD_Y + y * TILE + offset + 1, TILE - 2, TILE - 2, COLOR.white);
        }
      }
      for (const popup of this.popups) {
        const rise = Math.max(0, BLAST_UNITS + 600000 - popup.units - BLAST_UNITS) / 60000;
        r.text(popup.text, FIELD_X + popup.x * TILE + 8 - popup.text.length * 4, FIELD_Y + popup.y * TILE + 4 - rise, COLOR.yellow);
      }
    });
  }

  drawWon() {
    const r = this.renderer;
    r.drawLogo((SCREEN_WIDTH - r.logoWidth) / 2, 16, this.frame / 2);
    r.centered('YOU MADE IT!', 90, COLOR.yellow);
    r.centered('COMPLETING BONUS', 110, COLOR.cyan);
    r.centered(String(COMPLETING_BONUS), 122, COLOR.white);
    r.centered(`SCORE:${this.score}`, 146, COLOR.white);
    r.centered('PRESS SPACE', SCREEN_HEIGHT - 20, COLOR.grey);
  }
}
