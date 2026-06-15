# Stack Engine — JavaScript Porting Specification

Source: `panel-attack/panel-game` Lua codebase. Primary file `common/engine/Stack.lua` (1774 lines).
Supporting: `consts.lua`, `LevelData.lua`, `LevelPresets.lua`, `checkMatches.lua`, `Panel.lua`, `BaseStack.lua`.

All engine timers are **integer frame counts at a fixed 60 Hz simulation**. There is no real-time math anywhere in the engine. For a JS/Canvas port, run a **fixed 60 Hz logic loop** (one tick = one frame = 16.667 ms). Throughout this doc, frame counts are annotated with their ms equivalent as `frames × 16.667 ms`.

Convention used below: `f` = frames. `N f (≈ X ms)`.

---

## 1. STACK OBJECT — Fields & Grid Representation

### 1.1 Grid dimensions & indexing (HARD CONSTANTS)

```lua
s.width = 6      -- Stack.lua line 167
s.height = 12    -- Stack.lua line 168
```

- `panels[row][col]` — a 2D array.
- **Row indexing**: `row = 1` is the **bottommost playable row**. Row index **increases upward**. Row `height` (=12) is the topmost playable row. Update order is **bottom→top, left→right** (Stack.lua:110-112).
- **Column indexing**: `col = 1` is the leftmost; increases rightward; `col = width` (=6) is rightmost.
- **Row 0 — the dimmed buffer row**: it exists *below* row 1. It is created at init and holds the "next" rising row:

```lua
for i = 0, s.height do      -- Stack.lua:219  → note: starts at 0
  s.panels[i] = {}
  for j = 1, s.width do
    s:createPanelAt(i, j)
  end
end
```

Row 0 panels are in the `"dimmed"` state (visually greyed, non-interactive). When the stack rises a full row, `new_row()` shifts all rows up by one and the old row 0 becomes playable row 1 (see §3). Rows above `height` (13+) exist transiently only for garbage / falling panels — **exclude for single-player**.

### 1.2 Field inventory (every instance field)

Pulled from the class docblock + constructor (`Stack.lua:86-288`) and `BaseStack.lua`. Grouped by function. **Items marked ⛔ are garbage/multiplayer/rollback-only — EXCLUDE for single-player (full list in §9).**

**Timing / tick**
| Field | Type | Init | Purpose |
|---|---|---|---|
| `clock` | int | 0 | Increments +1 every `run()`. Chief frame counter. (BaseStack) |
| `stopWatch` | int | 0 | Increments +1 every `runPhysics()`; only runs while simulating (not during countdown). (BaseStack) |
| `stopWatchIsRunning` | bool | true | Whether physics runs this frame. |
| `max_runs_per_frame` | int | 3 | Cap on `run()` calls per render frame (rollback catchup). ⛔ mostly netcode |
| `game_over_clock` | int | -1 | The `clock` value at death; -1 while alive. (BaseStack) |

**Grid**
| Field | Init | Purpose |
|---|---|---|
| `width` | 6 | columns |
| `height` | 12 | rows |
| `panels` | {} | `panels[row][col]` → Panel |
| `panelTemplate` | — | Factory closure for Panels (binds `frameTimes` + onPop/onPopped/onLand callbacks to this Stack). Port: just use a Panel class with a reference to the Stack. |

**Speed / level**
| Field | Init | Purpose |
|---|---|---|
| `speed` | `levelData.startingSpeed` | Index into `SPEED_TO_RISE_TIME`. Range 1–99. |
| `nextSpeedIncreaseClock` | `DT_SPEED_INCREASE` (=900) | mode 1 only: next clock at which speed+1. |
| `panels_to_speedup` | `PANELS_TO_NEXT_SPEED[speed]` | mode 2 only: panels left to clear before speed+1. |
| `levelData` | — | The `LevelData` object (frame constants, stop constants, maxHealth, etc.). |

**Rise**
| Field | Init | Purpose |
|---|---|---|
| `displacement` | 16 | How far (in 16ths of a row) the playfield is below its "full" position. Decrementing it = rising. |
| `rise_timer` | `SPEED_TO_RISE_TIME[speed]` | When hits 0, displacement−1. |
| `rise_lock` | false | True → no passive rise. |
| `has_risen` | false | True once first row inserted (guards init). |
| `manual_raise` | false | Raise button held/active. |
| `manual_raise_yet` | false | Has an in-progress manual raise actually moved the stack yet. |
| `prevent_manual_raise` | false | Inhibits re-raising. |

**Invincibility / stop timers**
| Field | Init | Purpose |
|---|---|---|
| `pre_stop_time` | 0 | Frames of invincibility from the *current pop animation*. Decrements first. |
| `stop_time` | 0 | Stop time earned by chains/combos. Decrements only when pre_stop_time is 0. Blocks rise. |
| `shake_time` | 0 | Garbage-land invincibility. ⛔ garbage-only (always 0 single-player) but still participates in timer/rise_lock logic — keep as a 0 stub or full mechanic. |
| `peak_shake_time` | 0 | ⛔ garbage |
| `shake_time_on_frame` | 0 | ⛔ garbage |
| `prev_shake_time` | 0 | ⛔ garbage (display interp) |

**Health / game over**
| Field | Init | Purpose |
|---|---|---|
| `health` | `levelData.maxHealth` | Decrements while topped out; refills to max otherwise. Game over at ≤0. |
| `wasToppedOut` | false | Snapshot of `isToppedOut()` at frame start. |

**Cursor / input**
| Field | Init | Purpose |
|---|---|---|
| `cur_row` | 7 (or `startingRow`) | Cursor row. |
| `cur_col` | 3 (or `startingCol`) | Cursor **left** column (cursor spans `cur_col` and `cur_col+1`). |
| `top_cur_row` | `height` (12) | Max row cursor may reach (=11 while mid-rise). |
| `cursorDirection` | nil | Current held direction: `"up"|"down"|"left"|"right"`. |
| `cur_timer` | 0 | Ticks the current direction has been held. |
| `cur_wait_time` | 20 | DAS delay before auto-repeat (DEFAULT_INPUT_REPEAT_DELAY, Stack.lua:40). |
| `swapThisFrame` | false | Swap requested this frame. |
| `queuedSwapColumn` | 0 | Queued swap left-col (0 = none). |
| `queuedSwapRow` | 0 | Queued swap row (0 = none). |
| `input_state` | — | The decoded input for the current frame. |
| `confirmedInput` | [] | ⛔ netcode/replay — input buffer; index by `clock+1`. |
| `inputMethod` | "controller"|"touch" | "controller" for keyboard/gamepad port. |

**Scoring / chains**
| Field | Init | Purpose |
|---|---|---|
| `score` | 0 | Capped at 99999. |
| `chain_counter` | 0 | Current chain length (starts at 2 for first chain link; 0 = no chain). |
| `panels_cleared` | 0 | Lifetime cleared-panel count (drives shock-panel queuing). |
| `metalPanelsQueued` | 0 | ⛔ shock/garbage — queued shock panels. |
| `swapCount` | 0 | Total swaps (for puzzle move-limit). |
| `n_active_panels` | 0 | Panels not in normal/landing state this frame. |
| `n_prev_active_panels` | 0 | Same, previous frame. |
| `swappingPanelCount` | 0 | Panels in "swapping" state this frame. |

**⛔ Garbage / multiplayer / rollback / replay (EXCLUDE — see §9):**
`garbageSizeDropColumnMaps`, `currentGarbageDropColumnIndexes`, `garbageCreatedCount`, `garbageLandedThisFrame`, `highestGarbageIdMatched`, `panelsCreatedCount`, `incomingGarbage`, `outgoingGarbage`, `rollbackBuffer`, `rollbackCount`, `lastRollbackFrame`, `framesBehind`, `framesBehindArray`, `is_local`, `play_to_end`, `swapStallingBackLog`, `warningsTriggered`, `panelSource` (keep a *simplified* row generator instead).

---

## 2. TIMING MODEL (CRITICAL — read this first)

**The engine is a pure discrete, fixed-60 Hz frame simulation.** All timers are integer frame counts that decrement by exactly 1 per simulation tick. There is no `dt`, no sub-frame interpolation in the physics, and no real-time conversion anywhere in the engine core.

- `consts.FRAME_RATE = 1 / 60` (consts.lua:19) is used **only by the client** for wall-clock display, never by the engine.
- The LÖVE client calls `Match:run()` once per render frame. For a **local** stack, `shouldRun` returns `true` whenever there is buffered input (`#confirmedInput - clock > 0`), i.e. essentially **one logic tick per render frame** (Stack.lua:734-735).

```lua
-- Stack.lua:721-753  — how many ticks run per render frame
function Stack:shouldRun(runsSoFar)
  if self:game_ended() then return false end
  if self:behindRollback() then return true end   -- ⛔ netcode
  local buffer_len = #self.confirmedInput - self.clock
  if self.is_local then
    return buffer_len > 0        -- local: 1 tick per frame
  else
    -- ⛔ netcode catchup: up to max_runs_per_frame (3) when far behind
    ...
  end
end
```

### 2.1 The per-tick driver: `Stack:run()`

This is the master routine. One call = one engine frame. Quoted in full (Stack.lua:756-829):

```lua
function Stack:run()
  ...
  self:setupInput()                                   -- pull input for this clock, run controls()

  if self.behaviours.delaySimulationUntil == "countdownEnded"
     and self.clock <= (COUNTDOWN_START + COUNTDOWN_LENGTH) then
    self:runCountdown()                               -- ⛔ optional match-start countdown
    if self.clock == (COUNTDOWN_START + COUNTDOWN_LENGTH) then
      self.stopWatchIsRunning = true
    end
  end

  if self.stopWatchIsRunning then
    self:runPhysics()                                 -- <-- THE SIMULATION (once per tick)
  else
    -- optional "delay simulation until first input/swap" behaviours
    ...
  end

  -- Phase 3: actions per player input
  self:applyCursorDirection(self.cursorDirection)     -- move cursor (DAS)

  if self.inputMethod == "controller" and self.swapThisFrame then
    local leftPanel  = self.panels[self.cur_row][self.cur_col]
    local rightPanel = self.panels[self.cur_row][self.cur_col + 1]
    self:tryQueueSwap(leftPanel, rightPanel)          -- queue swap for NEXT frame
  end

  self:handleManualRaise()                            -- process raise button

  if self.stopWatchIsRunning then
    -- ⛔ garbage drop check (exclude)
    self.stopWatch = self.stopWatch + 1               -- physics tick counter +1
  end

  self.clock = self.clock + 1                         -- master frame counter +1
  self:emitSignal("finishedRun")
end
```

### 2.2 The single simulation step: `Stack:runPhysics()`

Called once per `run()` (when simulating). **Order of operations matters** (Stack.lua:932-1000):

```lua
function Stack:runPhysics()
  table.clear(self.garbageLandedThisFrame)            -- ⛔ garbage
  self.wasToppedOut = self:isToppedOut()              -- snapshot topped-out state

  self:decrementInvincibilityTimers()   -- (1) pre_stop/stop/shake timers -1
  self:updateRiseLock()                 -- (2) recompute rise_lock
  self:updateSpeed()                    -- (3) maybe speed+1

  -- (4) PASSIVE RAISE
  if self.behaviours.passiveRaise then
    if self:advancePassiveRaise() then
      if self:checkGameOver() then self:setGameOver() end
    end
  end

  -- (5) HEALTH REFILL when safe
  if not self.wasToppedOut and not self:hasFallingGarbage() then
    self.health = self.levelData.maxHealth
  end

  if self.displacement % 16 ~= 0 then                 -- mid-rise: restrict cursor
    self.top_cur_row = self.height - 1
  end

  -- (6) execute swap queued LAST frame
  if self:swapQueued() then
    self:swap(self.queuedSwapRow, self.queuedSwapColumn)
    self.queuedSwapColumn = 0
    self.queuedSwapRow = 0
  end

  self:checkMatches()                  -- (7) detect & resolve matches, award stop/score
  self:updatePanels()                  -- (8) every Panel:update() (state machine)
  self:updateActivePanelCount()        -- (9) recount active panels

  -- (10) chain end detection
  if self.chain_counter ~= 0 and not self:hasChainingPanels() then
    self.chain_counter = 0
    -- ⛔ self.outgoingGarbage:finalizeCurrentChain(...)  (garbage)
  end

  -- ⛔ self.outgoingGarbage:processStagedGarbageForClock(...)  (garbage)
  self:removeExtraRows()

  if not self:checkGameWin() then
    if self:checkGameOver() then self:setGameOver() end
  end
end
```

### 2.3 Timer decrement (`decrementInvincibilityTimers`, Stack.lua:1002-1015)

```lua
function Stack:decrementInvincibilityTimers()
  self.prev_shake_time = self.shake_time              -- ⛔ garbage display
  self.shake_time = self.shake_time - 1
  self.shake_time = max(self.shake_time, self.shake_time_on_frame)  -- ⛔ garbage
  if self.shake_time == 0 then self.peak_shake_time = 0 end         -- ⛔ garbage

  if self.pre_stop_time ~= 0 then
    self.pre_stop_time = self.pre_stop_time - 1       -- pre_stop drains first
  elseif self.stop_time ~= 0 then
    self.stop_time = self.stop_time - 1               -- then stop_time
  end
end
```

> **JS port rule:** every decrement is −1 per tick. `pre_stop_time` has priority over `stop_time`. (For single-player, the ⛔ shake lines can be stubbed to `shake_time` always 0.)

### 2.4 JS loop recommendation

Fixed-timestep accumulator:
```js
const STEP = 1000 / 60;            // 16.6667 ms
let acc = 0, last = performance.now();
function frame(now) {
  acc += now - last; last = now;
  acc = Math.min(acc, STEP * 5);   // avoid spiral of death (cap ~5 ticks)
  while (acc >= STEP) { stack.run(); acc -= STEP; }
  render(stack, acc / STEP);       // optional interp alpha
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```
All constants stay in **frames**. Convert to ms for animations only: `ms = frames / 60 * 1000`.

---

## 3. STACK RISE MECHANISM

### 3.1 The rise loop (`advancePassiveRaise`, Stack.lua:1109-1139)

This is the entire passive-rise logic. Quoted verbatim:

```lua
function Stack:advancePassiveRaise()
  if self.manual_raise then
    -- (manual raise path; the final displacement decrement is deferred here)
    if self.displacement == 0 and self.has_risen then
      self.top_cur_row = self.height
      self:new_row()
    end
  else
    if not self.rise_lock and self.stop_time == 0 then   -- <-- RISE GATE
      if self:isToppedOut() then
        self.health = self.health - 1                     -- topped out: lose 1 health, no rise
      else
        self.rise_timer = self.rise_timer - 1
        if self.rise_timer <= 0 then                      -- try to rise one 16th
          self.displacement = self.displacement - 1
          if self.displacement == 0 then                  -- full row risen → insert new row
            self.prevent_manual_raise = false
            self.top_cur_row = self.height
            self:new_row()
          end
          self.rise_timer = self.rise_timer + consts.SPEED_TO_RISE_TIME[self.speed]
        end
      end
      return true
    end
  end
end
```

**How it works:**
- Rise is **gated** by `not rise_lock AND stop_time == 0` (and not manually raising). If either holds, no rise this frame (and no health loss either — the topped-out decrement is inside the same `if`).
- Each frame the gate is open, `rise_timer` decrements by 1. When it reaches ≤ 0, `displacement` decrements by 1 (the playfield rises one 16th of a row), and `rise_timer` is **refilled** by `SPEED_TO_RISE_TIME[speed]` (the add, not set, preserves any overshoot).
- When `displacement` hits 0, a **new row is inserted** via `new_row()` and `displacement` resets to 16.
- If **topped out**, instead of rising, `health -= 1` (see §6).

### 3.2 `displacement` semantics

- Init = 16 (`Stack.lua:228`). Range: 16 → 1 (playable). When it would go to 0, a new row spawns and it snaps back to 16.
- `displacement` represents how many 16ths of a row the field is "low". A displacement of 16 means the field is one full row below full; 0 means fully risen (all 12 rows in play). Comment at Stack.lua:113-116:
  > "This variable being decremented causes the stack to rise. During the automatic rising routine, if this variable is 0, it's reset to 15 [sic — code resets to 16], all the panels are moved up one row, and a new row is generated at the bottom. Only when the displacement is 0 are all 12 rows 'in play.'"
- Visually the field is drawn offset upward by `(16 - displacement)` sixteenths of a row.

### 3.3 `SPEED_TO_RISE_TIME` (consts.lua:56-68) — speed → rise interval

The raw array is **divided by 16** at load:

```lua
consts.SPEED_TO_RISE_TIME = tableUtils.map(
   {942, 983, 838, 790, 755, 695, 649, 604, 570, 515,
    474, 444, 394, 370, 347, 325, 306, 289, 271, 256,
    240, 227, 213, 201, 189, 178, 169, 158, 148, 138,
    129, 120, 112, 105,  99,  92,  86,  82,  77,  73,
     69,  66,  62,  59,  56,  54,  52,  50,  48,  47,
     47,  47,  47,  47,  47,  47,  47,  47,  47,  47,
     47,  47,  47,  47,  47,  47,  47,  47,  47,  47,
     47,  47,  47,  47,  47,  47,  47,  47,  47,  47,
     47,  47,  47,  47,  47,  47,  47,  47,  47,  47,
     47,  47,  47,  47,  47,  47,  47,  47,  47},
   function(x) return x/16 end)
```

**Interpretation:** the *raw* value (before /16) = **frames to rise one full row** (16 sixteenths). So the *stored* value = frames per 1/16 row. Worked examples:

| speed | raw | stored (rise_timer refill) | time per full row | ms per full row |
|---|---|---|---|---|
| 1 | 942 | 58.875 f | 942 f | 15 700 ms |
| 10 | 515 | 32.1875 f | 515 f | 8 583 ms |
| 30 | 138 | 8.625 f | 138 f | 2 300 ms |
| 50+ | 47 | 2.9375 f | 47 f | 783 ms |

> Note index 2 (983) is *slower* than index 1 (942) — confirmed intentional ("2 is slower than 1", consts.lua:56). Indices 50–99 are all 47.

### 3.4 `new_row()` — inserting a row (Stack.lua:1416-1449)

```lua
function Stack:new_row()
  local panels = self.panels
  if self.cur_row ~= 0 then
    self.cur_row = util.bound(1, self.cur_row + 1, self.top_cur_row)   -- cursor shifts up with field
  end
  if self.queuedSwapRow > 0 then self.queuedSwapRow = self.queuedSwapRow + 1 end

  local stackHeight = #panels + 1
  panels[stackHeight] = {}
  self.panelSource:createNewRow(self, stackHeight)            -- fill top with fresh panels

  for row = stackHeight, 1, -1 do                            -- shift everything DOWN one slot
    for col = #panels[row], 1, -1 do
      Panel.switch(panels[row][col], panels[row - 1][col], panels)
    end
  end
  -- the freshly-created top row has now percolated down to row 0 (the new dimmed buffer);
  -- the old row 0 content is now at row 1.

  for col = 1, self.width do                                 -- un-dim new row 1
    panels[1][col].state = "normal"
    panels[1][col].stateChanged = true
  end

  self.displacement = 16                                     -- reset
  self:emitSignal("newRow", self)
end
```

**Port note:** `panelSource:createNewRow` generates the random colors (respecting `levelData.colors`, `adjacentDenialFrequency`, shock queuing). Replace with a simple seeded RNG row generator for the JS port.

### 3.5 `rise_lock` — when the stack refuses to rise (`updateRiseLock`, Stack.lua:1607-1623)

```lua
function Stack:updateRiseLock()
  local previousRiseLock = self.rise_lock
  if self:swapQueued() then
    self.rise_lock = true
  elseif self.shake_time > 0 then            -- ⛔ garbage
    self.rise_lock = true
  elseif self:hasActivePanels() then         -- ANY non-normal/landing panel
    self.rise_lock = true
  else
    self.rise_lock = false
  end
  if previousRiseLock and not self.rise_lock then
    self.prevent_manual_raise = false
  end
end
```

**Rise stops while:** a swap is queued, garbage is shaking (exclude), or **any panel is active** (matching/popping/popping/popped/hovering/falling/swapping). This is why the stack "freezes" during clears/chains/falls.

### 3.6 Manual raise (`handleManualRaise`, Stack.lua:1017-1061)

When raise button held & `behaviours.allowManualRaise` & not rise-locked: sets `stop_time = 0` (instantly clears earned stop!), then decrements `displacement` by 1 per frame; awards `+1` score when displacement reaches 1; defers the final decrement to passive raise. (Full code in §6 region; key lines:)

```lua
if self.behaviours.allowManualRaise and self.manual_raise then
  if not self.rise_lock then
    self.stop_time = 0
    if self.wasToppedOut then
      if self:checkGameOver() then self:setGameOver() end
    else
      self.has_risen = true
      self.displacement = self.displacement - 1
      if self.displacement == 1 then
        if not self.prevent_manual_raise then self:addScore(1) end
        self.manual_raise = false
        self.rise_timer = 1
        self.prevent_manual_raise = true
      end
      self.manual_raise_yet = true
    end
  ...
  end
end
```

---

## 4. SPEED INCREASE — both modes (`updateSpeed`, Stack.lua:1091-1106)

```lua
function Stack:updateSpeed()
  if self.levelData.speedIncreaseMode == 1 then           -- MODE 1: TIME INTERVAL (modern)
    if self.clock == self.nextSpeedIncreaseClock then
      self.speed = min(self.speed + 1, 99)
      self.nextSpeedIncreaseClock = self.nextSpeedIncreaseClock + DT_SPEED_INCREASE
    end
  elseif self.panels_to_speedup <= 0 then                -- MODE 2: CLEARED PANEL COUNT (classic)
    self.speed = min(self.speed + 1, 99)
    self.panels_to_speedup = self.panels_to_speedup + PANELS_TO_NEXT_SPEED[self.speed]
  end
end
```

- `DT_SPEED_INCREASE = 15 * 60 = 900` frames (= 15 s = 15 000 ms). **Mode 1: speed +1 every 900 frames.**
- Mode 1 init: `nextSpeedIncreaseClock = 900` (Stack.lua:193).
- Mode 2 decremented on each panel pop via `onPopped` (Stack.lua:1519-1523):

```lua
function Stack:onPopped(panel)
  if self.panels_to_speedup then
    self.panels_to_speedup = self.panels_to_speedup - 1
  end
end
```

### 4.1 `PANELS_TO_NEXT_SPEED` table (Stack.lua:55-65)

Indexed by the **new** speed. I.e. to advance from speed *k* to *k+1*, clear `PANELS_TO_NEXT_SPEED[k+1]` panels.

```lua
local PANELS_TO_NEXT_SPEED =
  {9, 12, 12, 12, 12, 12, 15, 15, 18, 18,        -- indices 1-10
   24, 24, 24, 24, 24, 24, 21, 18, 18, 18,       -- 11-20
   36, 36, 36, 36, 36, 36, 36, 36, 36, 36,       -- 21-30
   39, 39, 39, 39, 39, 39, 39, 39, 39, 39,       -- 31-40
   45, 45, 45, 45, 45, 45, 45, 45, 45, 45,       -- 41-50
   45, 45, 45, 45, 45, 45, 45, 45, 45, 45,       -- 51-60
   45, 45, 45, 45, 45, 45, 45, 45, 45, 45,       -- 61-70
   45, 45, 45, 45, 45, 45, 45, 45, 45, 45,       -- 71-80
   45, 45, 45, 45, 45, 45, 45, 45, 45, 45,       -- 81-90
   45, 45, 45, 45, 45, 45, 45, 45, math.huge}    -- 91-99 (index 99 = ∞ = cap)
```

Speed is hard-capped at 99 (`min(speed+1, 99)`).

---

## 5. INPUT → CURSOR

### 5.1 Input acquisition (`setupInput` + `controls`, Stack.lua:837-719)

```lua
function Stack:setupInput()
  self.input_state = nil
  if self:game_ended() == false then
    self.input_state = self.confirmedInput[self.clock + 1]    -- ⛔ netcode buffer
  else
    self.input_state = self:idleInput()
  end
  self:controls()
end
```

For the JS port, **replace `confirmedInput[clock+1]`** with the live polled/queued input for this frame (a 6-bit set: `{raise, swap, up, down, left, right}`).

### 5.2 `controls()` — direction DAS + swap/raise flags (Stack.lua:647-719, controller branch)

```lua
local raise, swap, up, down, left, right = unpack(KeyDataEncoding.base64decode[sdata])

self.swapThisFrame = swap
if self.swapThisFrame and self:swapQueued() then
  -- swap allowed at most every other frame:
  self.swapThisFrame = false
  self:emitSignal("swapDenied")
end

if up then new_dir = "up"
elseif down then new_dir = "down"
elseif left then new_dir = "left"
elseif right then new_dir = "right" end

if new_dir == self.cursorDirection then
  if self.cur_timer ~= self.cur_wait_time then
    self.cur_timer = self.cur_timer + 1            -- hold: climb timer up to DAS limit
  end
else
  self.cursorDirection = new_dir
  self.cur_timer = 0                               -- direction changed: reset
end

if raise then
  if not self.prevent_manual_raise then
    self.manual_raise = true
    self.manual_raise_yet = false
  end
end
```

### 5.3 Cursor movement (`applyCursorDirection`, Stack.lua:1064-1089)

```lua
function Stack:applyCursorDirection(direction)
  -- (touch branch excluded)
  if direction
     and (self.cur_timer == 0 or self.cur_timer == self.cur_wait_time)   -- MOVE CONDITION
     and self.cursorLock == nil then
    local previousRow, previousCol = self.cur_row, self.cur_col
    self:moveCursorInDirection(direction)
    self:emitSignal("cursorMoved", previousRow, previousCol)
  else
    self.cur_row = util.bound(1, self.cur_row, self.top_cur_row)
  end
  if self.cur_timer ~= self.cur_wait_time then
    self.cur_timer = self.cur_timer + 1            -- NOTE: timer also incremented here
  end
end

function Stack:moveCursorInDirection(direction)
  self.cur_row = util.bound(1, self.cur_row + DIRECTION_ROW[direction], self.top_cur_row)
  self.cur_col = util.bound(1, self.cur_col + DIRECTION_COLUMN[direction], self.width - 1)
end
```

Direction deltas (Stack.lua:82-84):
```lua
DIRECTION_COLUMN = {up = 0, down = 0, left = -1, right = 1}
DIRECTION_ROW    = {up = +1, down = -1, left = 0, right = 0}
```

**Net cursor behaviour (DAS):**
- **On the first frame a new direction is pressed**, `cur_timer == 0` → cursor **moves immediately** (1 cell).
- Then the cursor **holds still** while `cur_timer` climbs from 1 → `cur_wait_time` (= **20 f ≈ 333 ms**) — this is the DAS delay.
- Once `cur_timer == cur_wait_time`, the cursor **moves once per frame** (auto-repeat at 1 cell/frame).
- **Bounds:** `cur_row ∈ [1, top_cur_row]`; `cur_col ∈ [1, width-1]` = `[1,5]` because the cursor occupies two columns (`cur_col` and `cur_col+1`).
- `top_cur_row` is normally 12, but drops to 11 while `displacement % 16 != 0` (mid-rise) (Stack.lua:960-962), and returns to 12 after `new_row()`.

> ⚠️ The timer is incremented in **both** `controls()` and `applyCursorDirection()` within the same frame — a known quirk. Preserve this exact double-increment for frame-accurate parity.

### 5.4 Swap queueing & execution

**Queueing** (in `run()`, after cursor move): if `swapThisFrame`, call `tryQueueSwap` on the two panels under the cursor (Stack.lua:807-811). `tryQueueSwap` (Stack.lua:1219-1233) validates via `canSwap`, then stores the swap for **next frame**:

```lua
function Stack:tryQueueSwap(panel1, panel2)
  local canSwap, healthCost = self:canSwap(panel1, panel2)
  if canSwap then
    -- ⛔ WigglePay.registerSwap(self, panel1, panel2, healthCost or 0)  (stalling, exclude)
    self.swapCount = self.swapCount + 1
    self.queuedSwapColumn = math.min(panel1.column, panel2.column)   -- left panel
    self.queuedSwapRow    = panel1.row
    return true
  else
    self:emitSignal("swapDenied")
    return false
  end
end
```

**Swap rate limit:** a swap is denied if one is already queued (`if self.swapThisFrame and self:swapQueued()`, §5.2) → **at most one swap every 2 frames**.

**Execution** (next frame, in `runPhysics`, Stack.lua:967-971): `if self:swapQueued() then self:swap(row, col); clear queue`.

### 5.5 `canSwap` validity (Stack.lua:1239-1298) — core rules

```lua
function Stack:canSwap(panel1, panel2)
  if math.abs(panel1.column - panel2.column) ~= 1 or panel1.row ~= panel2.row then
    return false                                     -- not horizontally adjacent
  elseif self.do_countdown or self.clock <= 1 then
    return false                                     -- no swap during countdown / frame 1
  elseif panel1.color == 0 and panel2.color == 0 then
    return false                                     -- can't swap two empty spaces
  elseif not panel1:allowsSwap() or not panel2:allowsSwap() then
    return false                                     -- state/garbage/dont_swap forbid
  end
  -- (then: panels above/below can't be "hovering" in a way that breaks physics;
  --  and complex air+swapping adjacency checks; see lines 1257-1291)
  -- ⛔ swapStallingMode / WigglePay check at the end (exclude)
  return true
end
```

`Panel.allowsSwap` (Panel.lua:695-714):
```lua
function Panel.allowsSwap(self)
  if self.dont_swap then return false
  elseif self.isGarbage then return false          -- ⛔ garbage
  else
    return (self.state == "normal" or "swapping" or "falling" or "landing")
    -- i.e. matched/popping/popped/hovering/dimmed/dead → NOT swappable
  end
end
```

> **"Can a swapping panel be swapped again?" — YES.** The `"swapping"` state is in the swappable set. This codebase has no field literally named `could_swap`; the equivalent control flags are **`isSwappingFromLeft`** (swap direction marker, Panel.lua:791) and **`dont_swap`** (one-shot inhibitor set by `Stack:swap` when a panel would immediately fall after swapping — see §5.6).

### 5.6 `Stack:swap` — the actual swap (Stack.lua:1301-1336)

```lua
function Stack:swap(row, col)
  local panels = self.panels
  local leftPanel  = panels[row][col]
  local rightPanel = panels[row][col + 1]
  leftPanel:startSwap(true)            -- true = coming from the left
  rightPanel:startSwap(false)
  Panel.switch(leftPanel, rightPanel, panels)    -- swap positions in the grid + update row/col
  leftPanel, rightPanel = rightPanel, leftPanel  -- re-alias for readability

  -- If swapping a panel into a position above empty/falling space, it can't be swapped back
  if row ~= 1 then
    if (leftPanel.color ~= 0) and (panels[row-1][col].color == 0
        or panels[row-1][col].state == "falling") then
      leftPanel.dont_swap = true
    end
    if (rightPanel.color ~= 0) and (panels[row-1][col+1].color == 0
        or panels[row-1][col+1].state == "falling") then
      rightPanel.dont_swap = true
    end
  end
  -- If swapping an empty space under a panel, that space can't swap back either
  if row ~= self.height then
    if leftPanel.color == 0 and panels[row+1][col].color ~= 0 then
      leftPanel.dont_swap = true
    end
    if rightPanel.color == 0 and panels[row+1][col+1].color ~= 0 then
      rightPanel.dont_swap = true
    end
  end
end
```

### 5.7 Swap timing (`Panel.startSwap`, Panel.lua:785-798)

```lua
function Panel.startSwap(self, isSwappingFromLeft)
  local chaining = self.chaining
  clear_flags(self)
  self.stateChanged = true
  self.state = "swapping"
  self.chaining = chaining
  self.timer = 4                              -- <-- SWAP LASTS 4 FRAMES (≈66.7 ms)
  self.isSwappingFromLeft = isSwappingFromLeft
  if self.fell_from_garbage then self.fell_from_garbage = nil end
end
```

`swappingState.update` decrements `timer`; at 0 it resolves (Panel.lua:402-438): if the panel sits above empty/hovering/queuedHover → enters hover; else returns to normal. **Swap duration = 4 frames.** The `timer` value (4→0) also drives the slide animation offset.

---

## 6. HEALTH / GAME OVER

> ⚠️ **`Health.lua` (the `HealthEngine` class) is for `SimulatedStack` only** (the AI/attack-engine opponent). The real `Stack` uses a **plain integer `self.health`** field. **Do NOT port `Health.lua` for a single-player game.**

### 6.1 Health field lifecycle

- Init: `self.health = self.levelData.maxHealth` (Stack.lua:198).
- **Refill** every frame the stack is *not* topped out (and no garbage falling) — Stack.lua:956-958:

```lua
if not self.wasToppedOut and not self:hasFallingGarbage() then
  self.health = self.levelData.maxHealth
end
```

- **Decrement** during passive raise while topped out (Stack.lua:1122-1123, inside `advancePassiveRaise`):

```lua
if self:isToppedOut() then
  self.health = self.health - 1
else
  -- ... normal rise ...
end
```

So health drains **only** on frames where the stack would otherwise have risen *but is topped out*. If `stop_time`/`rise_lock` block the rise gate entirely, health does NOT decrement that frame (it's inside the `if not rise_lock and stop_time==0` block).

### 6.2 "Topped out" test (`isToppedOut`, Stack.lua:859-866)

```lua
function Stack:isToppedOut()
  for col = 1, self.width do
    if self.panels[self.height][col]:dangerous() then   -- any panel in row 12
      return true
    end
  end
  return false
end
```

`Panel.dangerous` (Panel.lua:832-838): a non-garbage panel is dangerous if `color ~= 0`; a garbage panel is dangerous if `state ~= "falling"`.

### 6.3 Game-over condition (`checkGameOver`, Stack.lua:1639-1677) — HEALTH branch

```lua
function Stack:checkGameOver()
  if self.game_over_clock <= 0 then
    for stackOverCondition, value in pairs(self.stackOverConditions) do
      if stackOverCondition == MatchRules.StackOverConditions.HEALTH then
        if self.health <= value and self.shake_time <= 0 then
          return true
        elseif not self.rise_lock and self.behaviours.allowManualRaise
               and self.wasToppedOut and self.manual_raise then
          return true                              -- instant death: manual-raising while topped out
        end
      elseif ...   -- ⛔ SWAPS / CHAIN puzzle conditions (exclude)
      end
    end
  else
    return true
  end
end
```

**The HEALTH threshold `value` is `0` in every shipped game mode** (verified in `GameModes.lua`: all modes set `[StackOverConditions.HEALTH] = 0`).

> **Exact game-over rule:** `gameOver = (health <= 0 AND shake_time <= 0)` OR (manual-raising while topped-out & not rise-locked). With single-player (shake always 0): **`gameOver = health <= 0`**.

### 6.4 Classic (maxHealth=1) = instant death

`classic` presets all set `maxHealth = 1`. On the **first** topped-out passive-raise frame: `health 1 → 0`, then `checkGameOver` → `health(0) <= 0` → game over. So classic modes kill on the first frame the stack can't rise because it's full. (There is no grace period unless `shake_time` or `stop_time`/`pre_stop_time` are holding the rise gate shut — but those gate closures also skip the health decrement, buying time.)

### 6.5 `maxHealth` values by preset (from LevelPresets.lua)

| Preset | maxHealth | meaning |
|---|---|---|
| modern[1] | 121 | ≈2 s topped-out grace (121 f ≈ 2017 ms) |
| modern[2] | 101 | |
| modern[3] | 81 | |
| modern[4] | 66 | |
| modern[5] | 51 | |
| modern[6] | 41 | |
| modern[7] | 31 | |
| modern[8] | 21 | |
| modern[9] | 11 | |
| modern[10] | **1** | instant (≈classic) |
| modern[11] | **1** | instant |
| classic[1..4], classicEndless[*] | **1** | instant |

### 6.6 Setting game over (`setGameOver`, Stack.lua:1201-1214)

```lua
function Stack:setGameOver()
  if self.game_over_clock > 0 then
    assert(self.clock == self.game_over_clock, "...")  -- guard double-set
    return
  end
  self.game_over_clock = self.clock
  self:emitSignal("gameOver", self)
end
```

`game_ended()` (Stack.lua:1191-1197): true once `clock >= game_over_clock` (which is set ≥ 0 on death).

---

## 7. STOP TIME

Two layered timers block the rise and (for the topped-out case) delay health loss:
- **`pre_stop_time`** — automatic invincibility equal to the duration of the *current pop/match animation*. Set on every match. Drains first.
- **`stop_time`** — bonus invincibility earned by chains/combos. Drains only after `pre_stop_time` hits 0. **Also directly gates the rise** (`stop_time == 0` required in `advancePassiveRaise`). Reset to 0 on manual raise.

### 7.1 Award on match (`checkMatches`, checkMatches.lua:111-153)

On every frame that produces a match (comboSize > 0):

```lua
local preStopTime = frameConstants.FLASH + frameConstants.FACE
                    + frameConstants.POP * (comboSize + garbagePanelCountOnScreen)
self.pre_stop_time = math.max(self.pre_stop_time, preStopTime)
self:awardStopTime(isChainLink, comboSize)
```

- `garbagePanelCountOnScreen` ⛔ → 0 for single-player. So **`preStopTime = FLASH + FACE + POP * comboSize`**.
- `pre_stop_time` takes the **max** with existing (a longer ongoing animation isn't shortened).
- `isChainLink` = true if any matched panel has its `chaining` flag (this match continues a chain).

### 7.2 `awardStopTime` + `calculateStopTime` (checkMatches.lua:795-837) — THE FORMULAS

```lua
function Stack:awardStopTime(isChain, comboSize)
  local stopTime = self:calculateStopTime(comboSize, self.wasToppedOut, isChain, self.chain_counter)
  if stopTime > self.stop_time then
    self.stop_time = stopTime          -- takes the MAX with current stop_time (not additive)
  end
end

function Stack:calculateStopTime(comboSize, toppedOut, isChain, chainCounter)
  local stopTime = 0
  local stop = self.levelData.stop
  if comboSize > 3 or isChain then                     -- only combos ≥4 or chains award stop
    if toppedOut and isChain then
      if stop.formula == MODERN then
        local length = (chainCounter > 4) and 6 or chainCounter
        stopTime = stop.dangerConstant + (length - 1) * stop.dangerCoefficient
      elseif stop.formula == CLASSIC then
        stopTime = stop.dangerConstant
      end
    elseif toppedOut then                              -- combo while topped out
      if stop.formula == MODERN then
        local length = (comboSize < 9) and 2 or 3
        stopTime = stop.coefficient * length + stop.chainConstant
      elseif stop.formula == CLASSIC then
        stopTime = stop.dangerConstant
      end
    elseif isChain then                                -- chain, not topped
      if stop.formula == MODERN then
        local length = math.min(chainCounter, 13)
        stopTime = stop.coefficient * length + stop.chainConstant
      elseif stop.formula == CLASSIC then
        stopTime = stop.chainConstant
      end
    else                                               -- combo (≥4), not topped
      if stop.formula == MODERN then
        stopTime = stop.coefficient * comboSize + stop.comboConstant
      elseif stop.formula == CLASSIC then
        stopTime = stop.comboConstant
      end
    end
  end
  return stopTime
end
```

**The four cases (MODERN):**

| Situation | Formula |
|---|---|
| combo (≥4), not topped | `coefficient * comboSize + comboConstant` |
| chain, not topped | `coefficient * min(chainCounter,13) + chainConstant` |
| combo, topped out | `coefficient * (comboSize<9?2:3) + chainConstant` |
| chain, topped out | `dangerConstant + (min(chainCounter,6? actually: chainCounter>4?6:chainCounter) − 1) * dangerCoefficient` |

**CLASSIC** is flat per category: `comboConstant` / `chainConstant` / `dangerConstant` (no coefficient scaling).

### 7.3 Stop constants per preset (LevelPresets.lua)

| Preset | formula | comboConst | chainConst | dangerConst | coefficient | dangerCoeff |
|---|---|---|---|---|---|---|
| modern[1] | MODERN | -20 | 80 | 160 | 20 | 20 |
| modern[2] | MODERN | -16 | 77 | 152 | 18 | 18 |
| modern[3] | MODERN | -12 | 74 | 144 | 16 | 16 |
| modern[4] | MODERN | -8 | 71 | 136 | 14 | 14 |
| modern[5] | MODERN | -3 | 68 | 128 | 12 | 12 |
| modern[6] | MODERN | 2 | 65 | 120 | 10 | 10 |
| modern[7] | MODERN | 7 | 62 | 112 | 8 | 8 |
| modern[8] | MODERN | 12 | 60 | 104 | 6 | 6 |
| modern[9] | MODERN | 17 | 58 | 96 | 4 | 4 |
| modern[10] | MODERN | 22 | 56 | 88 | 2 | 2 |
| modern[11] | MODERN | 27 | 53 | 80 | 1 | 0 |
| classic[1] (easy) | CLASSIC | 120 | 300 | 600 | 0 | 0 |
| classic[2] (normal) | CLASSIC | 120 | 180 | 420 | 0 | 0 |
| classic[3] (hard) | CLASSIC | 120 | 120 | 240 | 0 | 0 |
| classic[4] (ex) | CLASSIC | 90 | 90 | 180 | 0 | 0 |

Worked example — **modern[1], a 5-panel combo, not topped:** `stop = 20*5 + (-20) = 80 f (≈1333 ms)`.
Worked example — **modern[1], a 3-chain, not topped:** `stop = 20*min(3,13) + 80 = 140 f (≈2333 ms)`.

### 7.4 Frame constants per preset (LevelPresets.lua) — drive pre_stop + panel physics

| Preset | HOVER | GARBAGE_HOVER ⛔ | FLASH | FACE | POP |
|---|---|---|---|---|---|
| modern[1] | 12 | 41 | 44 | 20 | 9 |
| modern[2] | 12 | 36 | 44 | 18 | 9 |
| modern[3] | 11 | 31 | 42 | 17 | 8 |
| modern[4] | 10 | 26 | 42 | 16 | 8 |
| modern[5] | 9 | 21 | 38 | 15 | 8 |
| modern[6] | 6 | 16 | 36 | 14 | 8 |
| modern[7] | 5 | 13 | 34 | 13 | 8 |
| modern[8] | 4 | 10 | 32 | 12 | 7 |
| modern[9] | 6 | 7 | 30 | 11 | 7 |
| modern[10] | 6 | 4 | 28 | 10 | 7 |
| modern[11] | 3 | 3 | 22 | 8 | 6 |
| classic[1] | 12 | (nil) | 44 | 17 | 9 |
| classic[2] | 9 | | 36 | 13 | 8 |
| classic[3] | 6 | | 22 | 15 | 7 |
| classic[4] | 3 | | 16 | 10 | 6 |

These feed the Panel state machine: a matched panel sits in `"matched"` for `FLASH + FACE` frames (then `"popping"`/`"popped"` staggered by `POP`), and a panel hovers above empty space for `HOVER` frames before falling.

### 7.5 Where stop time blocks the rise

Only `stop_time` blocks the rise (not `pre_stop_time` directly):

```lua
-- advancePassiveRaise:
if not self.rise_lock and self.stop_time == 0 then   -- <-- stop_time gate
  if self:isToppedOut() then self.health = self.health - 1 else ... rise ... end
end
```

So while `stop_time > 0`: **no rise AND no health loss** (the topped-out decrement is inside the same gate). `pre_stop_time` only affects the decrement ordering (§2.3) — but because `stop_time` can't drain while `pre_stop_time > 0`, an ongoing pop animation effectively also pauses the rise/health drain.

### 7.6 Stop time reset

- **Manual raise sets `stop_time = 0`** instantly (Stack.lua:1023, §3.6).
- `pre_stop_time` is overwritten with `max(existing, newPreStop)` on each match (§7.1).

---

## 8. SCORING

### 8.1 `addScore` (Stack.lua:1753-1759) — capped

```lua
function Stack:addScore(score)
  self.score = self.score + score
  if (self.score > 99999) then self.score = 99999 end   -- hard cap
end
```

### 8.2 Per-panel base points (`onPop`, Stack.lua:1505-1516)

```lua
function Stack:onPop(panel)
  if not panel.isGarbage then               -- ⛔ garbage gives no base points
    self:addScore(10)                       -- 10 points per popped panel
    self.panels_cleared = self.panels_cleared + 1
    if self.panels_cleared % self.levelData.shockFrequency == 0 then
      self.metalPanelsQueued = min(self.metalPanelsQueued + 1, self.levelData.shockCap)   -- ⛔ shock
    end
  end
  self:emitSignal("panelPop", panel)
end
```

**Base = 10 points per cleared panel.** (Garbage panel pops: 0 base — exclude.)

### 8.3 Combo & chain bonus (`updateScoreWithBonus`, checkMatches.lua:841-871)

Called once per match frame, **after** the chain counter is incremented:

```lua
function Stack:updateScoreWithBonus(comboSize)
  self:updateScoreWithChain()        -- always (uses chain_counter)
  self:updateScoreWithCombo(comboSize)
end

function Stack:updateScoreWithCombo(comboSize)
  if comboSize > 3 then
    if (score_mode == consts.SCOREMODE_TA) then       -- score_mode defaults to 1 (TA)
      self:addScore(SCORE_COMBO_TA[math.min(30, comboSize)])
    -- ⛔ elseif SCOREMODE_PDP64 ... (unused)
    end
  end
end

function Stack:updateScoreWithChain()
  local chain_bonus = self.chain_counter
  if (score_mode == consts.SCOREMODE_TA) then
    if (chain_bonus > 13) then chain_bonus = 0 end    -- chains beyond 13 give 0 chain bonus
    self:addScore(SCORE_CHAIN_TA[chain_bonus])
  end
end
```

### 8.4 Score tables (checkMatches.lua:13-22) — `SCOREMODE_TA` (the only used mode)

```lua
local SCORE_COMBO_TA = {  0,    0,    0,   20,   30,        -- index 0..5  (only ≥4 matter)
                         50,   60,   70,   80,  100,        -- 6..10
                        140,  170,  210,  250,  290,        -- 11..15
                        340,  390,  440,  490,  550,        -- 16..20
                        610,  680,  750,  820,  900,        -- 21..25
                        980, 1060, 1150, 1240, 1330, [0]=0} -- 26..30

local SCORE_CHAIN_TA = {  0,   50,   80,  150,  300,        -- index 0..5  (0=not chained)
                        400,  500,  700,  900, 1100,        -- 6..10
                       1300, 1500, 1800, [0]=0}             -- 11..13
```

- **Combo bonus**: lookup `SCORE_COMBO_TA[min(comboSize, 30)]`; only awarded when `comboSize > 3`. (A 3-match = 0.)
- **Chain bonus**: lookup `SCORE_CHAIN_TA[chain_counter]` (chain_counter clamped to 0 if >13). Awarded every match frame (including non-chain matches, where chain_counter may be 0 → +0).

### 8.5 Other score sources
- **Manual raise** to displacement 1: `addScore(1)` (Stack.lua:1037, §3.6).
- (Garbage/shock-related scoring is all ⛔ excluded.)

### 8.6 Score events summary (per match frame)
1. `+ SCORE_CHAIN_TA[chain_counter]` (clamped)
2. `+ SCORE_COMBO_TA[min(comboSize,30)]` if `comboSize > 3`
3. Later, as each panel pops: `+ 10` per panel (via `onPop`, spread across pop frames)
4. Manual raise completion: `+ 1`

---

## 9. GARBAGE / MULTIPLAYER / NETCODE TO EXCLUDE

For a single-player (or single-board) JS port, omit everything below. These are the exact fields/functions/files.

### 9.1 In `Stack.lua` — fields to drop
`incomingGarbage`, `outgoingGarbage`, `garbageSizeDropColumnMaps`, `currentGarbageDropColumnIndexes`, `garbageCreatedCount`, `garbageLandedThisFrame`, `highestGarbageIdMatched`, `rollbackBuffer`, `rollbackCount`, `lastRollbackFrame`, `framesBehind`, `framesBehindArray`, `is_local`, `play_to_end`, `swapStallingBackLog`, `warningsTriggered`, `confirmedInput` (replace with live input), `metalPanelsQueued`.

### 9.2 In `Stack.lua` — functions to drop
- **Garbage**: `tryDropGarbage`, `shouldDropGarbage`, `dropGarbage`, `getGarbageSpawnColumn`, `shakeFramesForGarbageSize`, `onGarbageLand`, `hasMatchableGarbage`, `hasFallingGarbage`, `hasMatchableGarbage`, `toPuzzleInfo`, `getAttackPatternData`.
- **Rollback/netcode**: `rollbackCopy`, `rollbackCopyPanels`, `rollbackToFrame`, `rewindToFrame`, `internalRollbackToFrame`, `saveForRollback`, `behindRollback`, `shouldRun` (replace with: run once per frame), `updateFramesBehind`, `deinit`, `rollbackPanelBuffer` global.
- **Replay/input encoding**: `receiveConfirmedInput`, `getConfirmedInputCount`, `toReplayStack`, all `KeyDataEncoding`/`TouchDataEncoding`/`InputCompression` usage (decode your own input bits).
- **WigglePay stalling**: `WigglePay.registerSwap`, the `swapStallingMode` branch in `canSwap`, `swapStallingBackLog`.
- **Signals** (`createSignal`/`emitSignal`/`Signal`): optional — replace with plain callbacks or remove if you drive SFX/gfx differently.
- **Countdown** (`runCountdown`, `setCountdown`): match-start 3-2-1; optional. Constants `COUNTDOWN_START=8`, `COUNTDOWN_LENGTH=180` (3 s), `COUNTDOWN_CURSOR_SPEED=4`.

### 9.3 In `checkMatches.lua` — drop
- **Garbage matching**: `getConnectedGarbagePanels2`, `getConnectedGarbagePanels` (deprecated), `matchGarbagePanels`, `convertGarbagePanels`, `matchOnContact`, `getMetalCount`, the `COMBO_GARBAGE` table, `getOnScreenCount`, `sortByPopOrder`'s garbage branch.
- **Outgoing attack**: `pushGarbage`.
- In `checkMatches` itself, drop the `garbagePanels`/`matchGarbagePanels` calls and the `metalCount`/`pushGarbage` block. Keep `getMatchingPanels`, `applyMatchToPanels`, `awardStopTime`, `updateScoreWithBonus`, `clearChainingFlags`, `incrementChainCounter`.
- In `calculateStopTime` the formulas stay; just ignore the `garbagePanelCountOnScreen` term in preStopTime (=0).

### 9.4 In `Panel.lua` — fields/branches to drop
- **Garbage-exclusive fields**: `isGarbage`, `garbageId`, `metal`, `x_offset`, `y_offset`, `width`, `height`, `initial_time`, `pop_time`, `pop_index`, `shake_time`, `matchesMetal`, `matchesGarbage`.
- **Garbage state branches**: `supportedFromBelow`'s garbage branch, `matchedState`'s garbage branches (`matchedState.enterHoverState` for garbage→panel conversion), garbage handling in `fall`/`land`/`fallingState`.
- Keep: the full non-garbage state machine (normal/swapping/matched/popping/popped/hovering/falling/landing/dimmed), `startSwap`, `switch`, `allowsSwap` (non-garbage branch), `dangerous` (non-garbage branch), `match`, `update`.

### 9.5 Entire files to NOT port (single-player)
- `Health.lua` — only used by `SimulatedStack` (the attack-engine/AI opponent). Real Stack uses the integer `health` field.
- `Match.lua` — multiplayer match orchestration, garbage routing, rollback, winner determination. (Port a trivial single-board driver instead: `while running: stack.run()`.)
- `SimulatedStack.lua` — AI opponent wrapper (uses `Health` + `AttackEngine`).
- `AttackEngine.lua` — scripted attack pattern player.
- `GarbageQueue.lua` — incoming/outgoing garbage queues.
- `WigglePay.lua` — swap-stalling punishment.
- `RollbackBuffer.lua`, `KeyDataEncoding.lua`, `TouchDataEncoding.lua`, `InputCompression.lua`, `ReplayV3.lua`, `GeneratorSource`/`PuzzleSource`/`LegacyPanelSource` rollback methods.

### 9.6 Behaviours flags (`StackBehaviours`) — set for single-player
- `passiveRaise = true` (stack auto-rises) — **required**.
- `allowManualRaise = true/false` (raise button).
- `swapStallingMode` — set to 0 / ignore (excludes WigglePay).
- `delaySimulationUntil` — `nil` (no countdown delay) or `"countdownEnded"`.

---

## Appendix A — Panel State Machine (port intact, minus garbage)

States & transitions (Panel.lua). All durations in frames (÷60 for ms).

| State | Entered via | Duration (timer) | Next |
|---|---|---|---|
| `normal` | default / after swap-land / after landing timer | — | hover (if empty below), matched (by checkMatches), swapping (by swap) |
| `swapping` | `startSwap` | 4 f (≈66.7 ms) | normal OR hovering (if now above empty) |
| `matched` | `Panel:match` | `FLASH + FACE` f (e.g. 64 f modern[1]) | `popping` |
| `popping` | after matched | `combo_index * POP` f (staggered) | `popped` (or cleared if last) |
| `popped` | after popping (non-last) | `(combo_size - combo_index) * POP` f | cleared (color→0, `propagatesChaining=true`) |
| `hovering` | panel below empty / after garbage clear | `HOVER` f (e.g. 12 f modern[1]) | land / fall / match another hover timer |
| `falling` | hover ends above empty | immediate per-frame | land (row 1 or supported) |
| `landing` | `land()` | 12 f (animation only) | normal |
| `dimmed` | row 0 panels | — | normal (when promoted to row 1 by new_row) |
| `dead` | game over | — | — |

Match pop timing (`Panel:match`, Panel.lua:849-861):
```lua
function Panel:match(isChainLink, comboIndex, comboSize)
  self.state = "matched"
  self:setTimer(self.frameTimes.FLASH + self.frameTimes.FACE + 1)   -- +1: match occurs before decrement
  if isChainLink then self.chaining = true end
  self.combo_index = comboIndex
  self.combo_size  = comboSize
end
```
Then `matchedState` → `popping` with `timer = combo_index * POP`, and `popped` with `timer = (combo_size - combo_index) * POP`. So panels in a combo pop in sequence (cascade), each `POP` frames apart — the `combo_index` determines order.

## Appendix B — Chain detection

- A match is a **chain link** (`isChainLink`) iff any matched panel has `chaining == true` (checkMatches.lua:73-81, `isNewChainLink`).
- `chaining` is set when a panel enters hover **because a panel below it popped** (propagated up via `propagatesChaining`). Cleared by `clearChainingFlags` if the panel wasn't actually matched and isn't supported by a swapping panel below (checkMatches.lua:873-895).
- `incrementChainCounter` (checkMatches.lua:405-411): first link → `chain_counter = 2`; subsequent → `+1`.
- Chain **ends** when `chain_counter != 0` AND no panel has `chaining` set (Stack.lua:979-986) → reset to 0.

## Appendix C — `levelData` minimal schema (LevelData.lua) needed per preset

```
startingSpeed      int (1–99)   -- index into SPEED_TO_RISE_TIME
speedIncreaseMode  1 (TIME_INTERVAL) | 2 (CLEARED_PANEL_COUNT)
shockFrequency     int           -- ⛔ shock (set high/ignore)
shockCap           int           -- ⛔ shock (0 disables)
colors             int (4–7)     -- panel color count for RNG
adjacentDenialFrequency 0..1     -- probability of rerolling same-color horizontal neighbors
maxHealth          int (≥1)      -- topped-out grace frames
stop.formula       1 (MODERN) | 2 (CLASSIC)
stop.comboConstant, chainConstant, dangerConstant, coefficient, dangerCoefficient  (ints)
frameConstants.HOVER, FLASH, FACE, POP   (ints, frames)
frameConstants.GARBAGE_HOVER  (int|nil)  -- ⛔ garbage (nil disables garbage)
```
