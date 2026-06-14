# Infinite Panel de Pon

A browser-based clone of Panel de Pon (Tetris Attack / Puzzle League) built as a
single self-contained HTML5 canvas file with zero external dependencies. All
engine timing is driven by an absolute-millisecond accumulator (`performance.now()`),
so it behaves identically on 60 Hz, 144 Hz, and 240 Hz displays.

## How to Play

Open `index.html` in any modern browser, or serve it over HTTP.

| Control          | Action                              |
|------------------|-------------------------------------|
| Arrow Keys       | Move cursor (single tap + hold DAS) |
| Z / Space        | Swap two adjacent panels            |
| X                | Raise the stack one row (fast)      |

Swap adjacent panels to line up **three or more matching symbols** in a row or
column. Matched panels flash, wince, and pop in a sequential explosion. Panels
above the cleared ones hover briefly, then fall — and if the fall creates a new
match, you score a **chain**. Keep chaining for huge multipliers.

The game ends when the stack rises so high that a panel sits in the top danger
zone when a new row would be pushed onto the board.

---

## Block Types

Six panel types, each with a distinct colour and symbol. Symbols occupy ~90% of
the tile and are drawn in a lighter shade of the block colour for clear
visibility against the gradient fill.

| Colour | Symbol   |
|--------|----------|
| Red    | Heart    |
| Yellow | Star     |
| Blue   | Diamond  |
| Purple | Triangle |
| Green  | Circle   |
| Cyan   | Square   |

The symbol-based design doubles as colourblind-safe identification — each shape
is unique regardless of hue.

---

## Game Mechanics

### Grid & Scaling

The play field starts at **6×12** and expands as your score climbs:

| Score   | Grid Size |
|---------|-----------|
| 0       | 6 × 12    |
| 1,000   | 7 × 13    |
| 2,500   | 8 × 14    |
| 5,000   | 9 × 15    |
| 10,000  | 10 × 16   |

`TILE_SIZE` is recomputed dynamically from the canvas dimensions (400×800 fixed)
whenever the grid dimensions change, so the board always fits the viewport.

### Stack Rising

New rows continuously rise from the bottom. A dimmed "incoming row" sits just
below the board at constant low opacity until it snaps fully onto the grid.
The rise speed scales with your current speed level, which increases with score.
Manual raise (X) triggers a 166.67 ms fast scroll and locks out swapping for its
duration.

### Swapping

- Adjacent panels swap with a **66.67 ms** animated slide.
- **Mid-air trick:** an actively swapping panel can be re-swapped after **50 ms**
  into its 66.67 ms window, enabling sliding techniques.
- After a swap completes, a match check runs. If no match and panels are
  unsupported, gravity applies immediately.

### Matching & Clear Lifecycle

When 3+ matching panels align, they enter a four-phase state machine driven by
absolute elapsed time:

1. **Match Check Delay** — 150.00 ms pause
2. **Flash** — all matched panels flash white for 266.67 ms
3. **Wince** — distressed (darkened) graphic for 166.67 ms
4. **Pop** — sequential explosion, left-to-right / top-to-bottom, each panel
   taking **66.67 ms**. Total pop time = unique panel count × 66.67 ms.

Intersecting matches (e.g. a cross of 5) pop sequentially by total unique panel
count.

### Gravity & Hover

- Panels fall at **1 row per 16.67 ms** (60 rows/sec).
- After a clear, unsupported panels **hover** for a delay before gravity applies:
  - Speed Level 1: **466.67 ms**
  - Speed Level 10: **233.33 ms**
  - Max Speed Level: **100.00 ms** (floor)
- Free tiles with pre-existing gaps fall **concurrently** during clearing —
  gravity respects matched/cleared tiles as immovable pillars, so only genuinely
  unblocked tiles move.

### Chains

When a falling panel forms a new match, `currentChain` increments and a **chain
freeze** pauses the board for skill-chain inputs:

| Chain | Freeze Time |
|-------|-------------|
| 2×    | 733.33 ms   |
| 5×    | 1266.67 ms  |

Freeze time scales linearly with the chain multiplier. `currentChain` resets to 1
the moment the hover/fall queue fully empties.

---

## Scoring

### Combos (Simultaneous Clears)

A flat bonus based on the number of panels cleared in a single match event
(applies only to 4+ panels; a plain 3-match scores 0 bonus):

| Panels | Points |
|--------|--------|
| 3      | 0      |
| 4      | 20     |
| 5      | 30     |
| 6      | 50     |
| 7      | 60     |
| 8      | 70     |
| 9+     | 70 + (panels − 8) × 10 |

### Chains (Consecutive Gravity Clears)

| Chain | Points |
|-------|--------|
| 1×    | 0 (baseline) |
| 2×    | 50     |
| 3×    | 80     |
| 4×    | 150    |
| 5×    | 300    |
| 6×    | 400    |
| 7×    | 500    |
| 8×    | 700    |
| 9×    | 900    |
| 10×   | 1100   |
| 11×   | 1300   |
| 12×   | 1500   |
| 13×   | 1800   |

For **14× and higher**, there is **no cap** — the chain score scales infinitely:
`chainScore(N) = 1800 × (N − 12)` for N ≥ 14, strictly increasing at every level.

### Combos During Chains

Combo and chain bonuses are **additive**. A 4-panel clear on a 3× chain scores
20 (combo) + 80 (chain) = **100 points**.

---

## Engine Timing Constants

All values are absolute milliseconds, decoupled from the render loop.

### Cursor & Input
| Constant            | Value (ms) | Description |
|---------------------|------------|-------------|
| `CURSOR_SHIFT`      | 16.67      | Single-press traversal of one grid slot |
| `DAS_INITIAL`       | 200.00     | Hold time before auto-shift activates |
| `DAS_REPEAT`        | 50.00      | Auto-shift interval once DAS active |
| `SWAP_INPUT_BUFFER` | 16.67      | Directional input buffer after a swap |

### Panel Swap Physics
| Constant         | Value (ms) | Description |
|------------------|------------|-------------|
| `SWAP_DURATION`  | 66.67      | Full swap animation duration |
| `SWAP_INTERRUPT` | 50.00      | Re-swap allowed after this point |
| Fall speed       | 16.67/row  | 60 rows/sec (1 row per frame at 60 Hz) |

### Match Lifecycle
| Constant             | Value (ms) | Description |
|----------------------|------------|-------------|
| `MATCH_CHECK_DELAY`  | 150.00     | Pause on alignment detection |
| `FLASH`              | 266.67     | White flash phase |
| `WINCE`              | 166.67     | Distressed graphic phase |
| `POP_PER_PANEL`      | 66.67      | Per-panel pop in sequential explosion |

### Hover & Chain
| Constant          | Value (ms) | Description |
|-------------------|------------|-------------|
| Hover (Level 1)   | 466.67     | Baseline hover delay |
| Hover (Level 10)  | 233.33     | Mid-level hover delay |
| Hover (Max Level) | 100.00     | Minimum hover delay |
| Chain Freeze 2×   | 733.33     | 2-chain skill window |
| Chain Freeze 5×   | 1266.67    | 5-chain skill window |

### Manual Raise
| Constant        | Value (ms) | Description |
|-----------------|------------|-------------|
| `MANUAL_RAISE`  | 166.67     | Scroll duration + full swap lockout |

---

## Options Panel

A side panel to the right of the game board hosts toggleable game options:

- **Lock Speed** — Freezes the rise speed at its current level. When enabled,
  the speed no longer increases as your score grows; the stack rises at a fixed
  pace. Disable it to resume normal speed scaling.

---

## Architecture

### File Layout

| File                     | Purpose |
|--------------------------|---------|
| `index.html`             | The complete game — HTML, CSS, and JS in one file |
| `validate.js`            | Extracts and syntax-checks the JS; validates DOM ID references |
| `test_engine.js`         | Engine timing-constants test suite (47 tests) |
| `test_scoring.js`        | Scoring (combo/chain) test suite (48 tests) |
| `test.js`                | Core gameplay tests (47 tests) |
| `test_bugfix.js`         | Regression tests for patched bugs (21 tests) |
| `test_changes.js`        | Stagger/input/gameover tests (47 tests) |
| `test_ghost.js`          | Ghost-tile & concurrent-match tests (39 tests) |
| `test_manualraise.js`    | Manual raise mechanics tests (22 tests) |
| `test_gravity_swap.js`   | Gravity-during-clearing & swap cooldown tests (64 tests) |

### State Machine

The game cycles through these states, all advanced by accumulated milliseconds:

```
playing → (match detected) → chainfreeze → matchdelay → flash → wince → popping
       ↘ (swap, no match, floating) → falling ↗                          ↓
                                                                   finishClear
                                                                        ↓
                                                                  hover → falling
                                                                        ↓
                                                              (new match?) → chainfreeze …
                                                              (no match)   → playing
```

| State          | Meaning |
|----------------|---------|
| `playing`      | Normal play; stack rises, swaps allowed |
| `chainfreeze`  | Board frozen for skill-chain input (chain ≥ 2) |
| `matchdelay`   | 150 ms pause after alignment detected |
| `flash`        | Matched panels flash white |
| `wince`        | Distressed graphic phase |
| `popping`      | Sequential explosion, one panel per 66.67 ms |
| `hover`        | Unsupported panels hover before gravity |
| `falling`      | Gravity applies; settles → match check or back to playing |
| `gameover`     | Stack reached the top |

### Game Loop

A single `requestAnimationFrame` loop computes delta time from
`performance.now()`, feeds it to `update(dt, dtMs)`, then calls `render()`. All
state transitions depend on accumulated real milliseconds, never on frame
counts, guaranteeing identical behaviour across refresh rates.

### Scoring Hooks

Score changes flow through a single `addScore()` function that mutates the
`score` variable and dispatches a `scorechange` `CustomEvent` on `document`. The
HUD listens for this event and animates a score-text pop (scale + gold flash).

---

## Development

### Running Tests

All test suites are standalone Node.js scripts that replicate the game logic
without a browser:

```sh
node validate.js           # syntax + DOM ID check
node test_engine.js        # engine timing constants
node test_scoring.js       # scoring tables
node test.js               # core gameplay
node test_bugfix.js        # bug regressions
node test_changes.js       # stagger/input/gameover
node test_ghost.js         # ghost tiles & concurrent matches
node test_manualraise.js   # manual raise
node test_gravity_swap.js  # gravity-during-clearing & swap cooldown
```

### Serving Over HTTP

```sh
python3 -m http.server 8080 --bind 0.0.0.0
```

Then open `http://<your-ip>:8080` in a browser.
