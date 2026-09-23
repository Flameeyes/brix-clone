# BRIX

A browser remake of **BRIX**, the 1991 DOS puzzle game by Michael Riedel.
It runs in any modern browser, including phones and tablets, and uses the
original 112 levels, tiles, font and logo. The author released them into the
public domain (see `data/BRIX.DOC`).

## Playing

Slide icons left or right. They fall when there is nothing below them, and
two or more matching icons that touch blast away. Clear every icon before
the time runs out. Watch out for single leftovers: sometimes you need to
bring three icons together at once.

The levels form a tree. Level *N* offers *N* problem sets of four problems
each, and every set you finish opens the two sets below it at the next level.
The goal is the set at the bottom right.

| Key | Action |
| --- | --- |
| Arrows | Move the cursor, or the grabbed icon |
| Space | Grab or release the icon under the cursor |
| Enter / F1 | Start a game |
| R / F4 | Retry the problem (twice per problem, the clock keeps running, no time bonus) |
| S / F5 | Sound on or off |
| H / F3 | High scores |
| C / F7 | Credits |
| Esc | Give up |

With a mouse or on a touch screen, press an icon and drag it sideways.
Touch devices also get an on-screen pad.

If the time runs out, you can continue up to four times (five lives).

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

### Differences from the original

The rules were reconstructed from the data files and the documentation, not
from the executable. Lift speed and blast duration were tuned until the
timing-based lift puzzles could be solved. Two-player mode is not
implemented. High scores are stored in the browser.
