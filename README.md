# Infinite Panel de Pon

A browser-based clone of Panel de Pon (Tetris Attack / Puzzle League) built as a
single self-contained HTML5 canvas file with zero external dependencies. All
engine timing is driven by an absolute-millisecond accumulator (`performance.now()`),
so it behaves identically on 60 Hz, 144 Hz, and 240 Hz displays.

All frame tables and scoring values are extracted from **panel-attack**
(github.com/sharpobject/panel-attack), a faithful reverse-engineering of the
SNES Panel de Pon / Tetris Attack engine (`globals.lua` + `engine.lua`).

## How to Play

Open `index.html` in any modern browser, or serve it over HTTP.

| Control          | Action                              |
|------------------|-------------------------------------|
| Arrow Keys       | Move cursor (single tap + hold DAS) |
| Z / Space        | Swap two adjacent panels            |
| X (hold)         | Raise the stack faster              |

Swap adjacent panels to line up **three or more matching symbols** in a row or
column. Matched panels flash, wince, and pop in a sequential explosion. Panels
above the cleared ones hover briefly, then fall — and if the fall creates a new
match, you score a **chain**. Keep chaining for huge multipliers.

The game ends when a panel sits in the top danger zone and the hang-time
health counter reaches zero.

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

### Color Count (5 → 6 Transition)

The game starts with **5 colors** (levels 1–2) and adds the **6th color** (Cyan)
from level 3 onward, matching the original game's difficulty curve. Fewer colors
early means more match opportunities.

### Stack Rising

New rows continuously rise from the bottom. A dimmed "incoming row" sits just
below the board at constant low opacity until it snaps fully onto the grid.

The rise speed is driven by the authentic **subpixel table** (99 entries from
panel-attack `speed_to_subpixels`), where each entry converts to rows/sec via
`subpixel × 60 / 4096`. The speed counter increments based on **panels cleared**
(panel-attack `panels_to_next_speed` table), not score — matching the original
game's speedup mechanic.

Manual raise (hold X) pushes the stack at 8 rows/sec while held. It clears any
active stop-time instantly. Swapping remains possible during manual raise (no
lockout).

### Stop Time (Stack Freeze)

After a combo (4+ panels) or chain (2+), the stack **freezes** for a duration
calculated from authentic level-dependent formula coefficients:

- **Chain stop** = `chain_coeff × min(chain, 13) + chain_const` (in frames)
- **Combo stop** = `combo_coeff × combo_size + combo_const` (in frames)

Chain freeze takes priority over combo freeze. At level 1, a 4-combo freezes for
1000 ms; a 2-chain freezes for 2000 ms. Stop times shorten at higher levels.

### Swapping

- Adjacent panels swap with a **66.67 ms** animated slide.
- **Mid-air trick:** an actively swapping panel can be re-swapped after **50 ms**
  into its 66.67 ms window, enabling sliding techniques.
- After a swap completes, a match check runs. If no match and panels are
  unsupported, gravity applies immediately.

### Matching & Clear Lifecycle

When 3+ matching panels align, they enter a three-phase state machine driven by
absolute elapsed time. All durations are **level-dependent** (authentic tables):

1. **Flash** — all matched panels flash white. L1: 733 ms (44f) → L10: 467 ms (28f)
2. **Wince** — distressed (darkened) graphic. L1: 250 ms (15f) → L10: 133 ms (8f)
3. **Pop** — sequential explosion in **zigzag order** (even rows L→R, odd rows
   R→L), each panel taking L1: 150 ms (9f) → L10: 117 ms (7f). Total pop time =
   unique panel count × per-panel duration.

### Gravity & Hover

- Panels fall at **1 row per 16.67 ms** (60 rows/sec).
- After a clear, unsupported panels **hover** for a level-dependent delay:
  - L1: **200 ms** (12f)
  - L9: **50 ms** (3f, fastest)
  - L10: **100 ms** (6f)
- Free tiles with pre-existing gaps fall **concurrently** during clearing —
  gravity respects matched/cleared tiles as immovable pillars, so only genuinely
  unblocked tiles move.

### Chains

When a falling panel forms a new match, `currentChain` increments. The chain
freeze (stop-time) pauses the board for skill-chain inputs. `currentChain` resets
to 1 the moment the hover/fall queue fully empties.

### Hang Time (Game Over Grace)

The game doesn't instantly end when panels reach the top. A **health counter**
counts down while any panel occupies the top row:

- L1: **121 frames** (~2 seconds of grace)
- L10: **1 frame** (effectively instant)

Health regenerates fully when panels drop below the top row. The stack cannot
rise while panels are in the danger zone.

---

## Scoring

Every popped panel earns **10 base points** plus any applicable combo and chain
bonuses:

```
matchScore = comboBonus + chainBonus + (panelCount × 10)
```

### Combos (Simultaneous Clears)

Authentic lookup table (capped at 30 panels). A plain 3-match earns 0 combo
bonus (but still scores 30 from per-panel points):

| Panels | Combo Bonus |
|--------|-------------|
| 3      | 0           |
| 4      | 20          |
| 5      | 30          |
| 6      | 50          |
| 7      | 60          |
| 8      | 70          |
| 9      | 80          |
| 10     | 100         |
| 11     | 140         |
| 12     | 170         |
| 13     | 210         |
| 15     | 290         |
| 20     | 550         |
| 30+    | 1330 (cap)  |

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

Combo, chain, and per-panel bonuses are all **additive**. A 4-panel clear on a
3× chain scores 20 (combo) + 80 (chain) + 40 (per-panel) = **140 points**.

---

## Engine Timing Constants

All values are absolute milliseconds (converted from NTSC 60fps frames at
16.6667 ms/frame), decoupled from the render loop.

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
| Fall speed       | 16.67/row  | 60 rows/sec |

### Match Lifecycle (Level-Dependent, in frames → ms)

| Level | Flash | Wince | Pop/Panel | Hover |
|-------|-------|-------|-----------|-------|
| 1     | 44f (733ms)  | 15f (250ms)  | 9f (150ms)   | 12f (200ms) |
| 5     | 38f (633ms)  | 12f (200ms)  | 8f (133ms)   | 9f (150ms)  |
| 10    | 28f (467ms)  | 8f (133ms)   | 7f (117ms)   | 6f (100ms)  |

### Hang Time (Health, in frames → ms)

| Level | Hang Frames | Hang Time |
|-------|-------------|-----------|
| 1     | 121         | ~2017 ms  |
| 5     | 50          | ~833 ms   |
| 10    | 1           | ~17 ms    |

### Stop-Time Coefficients (Level-Dependent)

`stop_frames = coeff × size + const` (chain capped at 13, combo requires 4+)

| Level | Combo Coeff | Combo Const | Chain Coeff | Chain Const |
|-------|-------------|-------------|-------------|-------------|
| 1     | 20          | -20         | 20          | 80          |
| 10    | 2           | 22          | 2           | 56          |

### Rise Speed (Authentic Subpixel Table)

99-entry table from panel-attack `speed_to_subpixels`. Converts to rows/sec via
`subpixel × 60 / 4096`. Speed 1 = ~1.04 rows/s; max (0x1000) = 15 rows/s.
Speed increments based on panels cleared (`panels_to_next_speed` table).

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
| `test_engine.js`         | Engine timing & level-dependent tables test suite (62 tests) |
| `test_scoring.js`        | Scoring (combo/chain/per-panel) test suite (59 tests) |

### State Machine

The game cycles through these states, all advanced by accumulated milliseconds:

```
playing → (match detected) → flash → wince → popping
       ↘ (swap, no match, floating) → falling ↗            ↓
                                                    finishClear
                                                         ↓
                                                   hover → falling
                                                         ↓
                                                 (new match?) → flash … (chain++)
                                                 (no match)   → playing
```

| State      | Meaning |
|------------|---------|
| `playing`  | Normal play; stack rises, swaps allowed, stop-time/hang-time ticks |
| `flash`    | Matched panels flash white (level-dependent duration) |
| `wince`    | Distressed graphic phase (level-dependent duration) |
| `popping`  | Sequential explosion in zigzag order (level-dependent per-panel) |
| `hover`    | Unsupported panels hover before gravity (level-dependent delay) |
| `falling`  | Gravity applies; settles → match check or back to playing |
| `gameover` | Hang-time health reached zero |

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
node test_engine.js        # engine timing & level-dependent tables
node test_scoring.js       # scoring tables (combo/chain/per-panel)
```

### Serving Over HTTP

```sh
python3 -m http.server 8080 --bind 0.0.0.0
```

Then open `http://<your-ip>:8080` in a browser.
