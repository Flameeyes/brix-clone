# BRIX

A browser remake of **BRIX**, the 1991 DOS puzzle game by Michael Riedel.
It runs in any modern browser, including phones and tablets, and uses the
original 112 levels, tiles, font and logo. The author released them into the
public domain (see `data/BRIX.DOC`).

## Playing

Grab an icon and push it left or right. Icons fall when there is nothing
below them, and matching icons that touch blast away. Clear every icon before
the time runs out. Watch out for single leftovers: sometimes you need to
bring three icons together at once. Nothing can be moved while something is
falling, and some problems have a lift that carries icons up and down.

The levels form a tree. Level *N* offers *N* problem sets of four problems
each. You can start with any set in levels 1 to 5; every set you finish opens
the two sets next to it at the following level. At level 7 you work your way
down to the goal at the bottom right. If you take longer than ten seconds to
pick a set, the game picks the highlighted one for you.

Scoring follows the original: 100 points per blasted icon beyond the first,
a bonus of 400, 600 or 1000 when a chain of blasts between two of your moves
takes out 4, 5 or 6+ icons, then for each solved problem 1000 × level while
you have never used a retry, plus 100 × level for every second left.

| Key | Action |
| --- | --- |
| Arrows | Move the cursor, or the grabbed icon |
| Space | Grab or release the icon under the cursor |
| Enter / F1 | Start a game |
| R / F4 | Restart the problem; the clock keeps running (two retries per game) |
| S / F5 | Sound on or off |
| H / F3 | High scores |
| C / F7 | Credits |
| Esc | Give up |

With a mouse or on a touch screen, press an icon and drag it sideways.
Touch devices also get an on-screen pad.

If the time runs out, you can continue up to five times.

## Running locally

The game is plain HTML and JavaScript ES modules with no build step. It
needs to be served over HTTP rather than opened as a file:

```sh
npm start        # python3 -m http.server 8000
```

Then open <http://localhost:8000>.

When it's served over HTTPS (for example from GitHub Pages), a service worker
caches the game for offline play, and "Add to Home Screen" installs it as an
app.

## Development

The code is JavaScript typed with JSDoc and checked by TypeScript in strict
mode:

```sh
npm install
npm run typecheck
npm test
```

- `src/levels.js`: parser for the original `LEVELS` file (178-byte records:
  a 14×12 grid, then cursor start, lift position and direction, and time limit)
- `src/board.js`: the playing field rules: gravity, sliding, blasting and lifts
- `src/game.js`: screens, timer, scoring and input handling
- `src/render.js`: draws the original `BLOCKS` tiles, `FONT` and `BRIX.PIC`
  logo with the default VGA palette

The GitHub workflow runs the checks on every push and deploys `main` to
GitHub Pages. Pages has to be enabled once under *Settings → Pages → Source:
GitHub Actions*.

### Faithfulness to the original

The rules and timings come from disassembling `BRIX.EXE`: gravity and lift
speeds (driven by the PC timer chip), how falling icons join a moving lift,
when icons count as matching, the blast freeze, scoring, retries, lives and
the level tree. The playing field logic in `src/board.js` is a port of the
original routines.

Differences: two-player mode is not implemented, high scores are stored in
the browser (the original's `HIGH` file is not read), and a sideways move
pressed while icons are still falling is retried for a moment instead of
being dropped.
