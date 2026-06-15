# Panel Attack → JavaScript Porting Spec

**Source:** `panel-attack/panel-game` fork, engine version `049` (WIGGLE_PUNISH).
**Target:** Single-player endless mode on JS canvas (60 fps fixed step).

All Lua quotes are verbatim. Frame counts are annotated with their ms equivalent at 60 fps (`frames → ms = frames/60*1000`).

> **Single-player vs multiplayer — quick map**
> - **KEEP / PORT:** `Stack.lua` (one player's board), `PanelGenerator.lua`, `GeneratorSource.lua`, `checkMatches.lua` (scoring), `LevelData.lua`, `LevelPresets.lua` (classic + classicEndless + modern presets), `StackBehaviours.lua`, `GameModes.lua` (only the `ONE_PLAYER_*` entries), `MatchRules.lua` enums, `consts.lua`, `KeyDataEncoding.lua`, the input pipeline in `inputManager.lua` + `network/PlayerStack.lua:send_controls`.
> - **EXCLUDE (multiplayer / network / CPU only):** `Health.lua` (the simulated "stamina" opponent used by 1P **Challenge** vs CPU and telegraph — see §2.B), `AttackEngine.lua`, `GarbageQueue.lua`, `computerPlayers/*`, `Match.lua`'s `pushGarbageTo` / cross-stack garbage routing, `RollbackBuffer.lua`, `SimulatedStack.lua`, `network/*`, `server/*`, the `Match:shouldRun` "catch-up" branches for non-local stacks, `InputCompression.lua`, `TouchDataEncoding.lua` (unless you want touch), `WigglePay.lua` (v049 swap-stalling punishment — single-player relevant but optional; see §6).

---

## 1. STACK GENERATION

Two files cooperate: `PanelGenerator.lua` (pure RNG row generator) and `GeneratorSource.lua` (the `PanelSource` that fills a `Stack`).

### 1.1 Grid dimensions

From `common/engine/Stack.lua:167-168` (constructor):

```lua
s.width = 6
s.height = 12
```

- **width = 6** columns, **height = 12** rows. Row 1 is the bottom row in play; row 12 is the top. Indexing is `panels[row][column]`, both 1-based. Row 0 and row 13 are used as overflow (off-screen below / above).
- The board does **not** start full. The starting board height comes from `GeneratorSource.lua:38-40`:

```lua
function GeneratorSource:getStartingBoardHeight(stack)
  return 7
end
```

So only the bottom **7 rows** are populated initially; rows 8–12 start empty.

### 1.2 The row generator (`PanelGenerator:generatePanels`)

`common/engine/PanelGenerator.lua:55-114`. Given a `rowWidth` (6), `ncolors` (from `levelData.colors`), and the `previousRow` string, produces a new 6-char numeric string. The RNG is `love.math.newRandomGenerator` seeded once.

```lua
function PanelGenerator:generatePanels(rowWidth, ncolors, previousRow)
  if not previousRow or previousRow == "" then
    previousRow = string.rep("0", rowWidth)
  end
  local newPanels = ""
  if ncolors < 2 then
    error("Trying to generate panels with only " .. ncolors .. " colors")
  end
  for n = 1, rowWidth do
    local previousTwoMatchOnThisRow = n > 2 and PanelGenerator.PANEL_COLOR_TO_NUMBER[string.sub(newPanels, -1, -1)] ==
                                          PanelGenerator.PANEL_COLOR_TO_NUMBER[string.sub(newPanels, -2, -2)]
    local nogood = true
    local color = 0
    local belowColor = PanelGenerator.PANEL_COLOR_TO_NUMBER[string.sub(previousRow, n, n)]
    while nogood do
      color = self:random(1, ncolors)
      if color == belowColor then
        -- can't have the same color as above
        nogood = true
      elseif (previousTwoMatchOnThisRow and color == PanelGenerator.PANEL_COLOR_TO_NUMBER[string.sub(newPanels, -1, -1)]) then
        -- can't have three in a row
        nogood = true
      elseif (n > 1 and color == PanelGenerator.PANEL_COLOR_TO_NUMBER[string.sub(newPanels, -1, -1)]) then
        -- only allow horizontally adjacent colors with a certain frequency
        if self.adjacentDenialFrequency >= 1 then
          nogood = true
        elseif self.adjacentDenialFrequency == 0 then
          nogood = false
        else
          local frequency = self.adjacentDenied / (self.adjacentAccepted + self.adjacentDenied)
          if frequency <= self.adjacentDenialFrequency then
            self.adjacentDenied = self.adjacentDenied + 1
            nogood = true
          else
            self.adjacentAccepted = self.adjacentAccepted + 1
            nogood = false
          end
        end
      else
        nogood = false
      end
    end
    newPanels = newPanels .. tostring(color)
  end
  return newPanels
end
```

**Hard constraints enforced (no initial match possible):**

1. **Vertical:** a panel can never equal the color of the panel directly below it (`color == belowColor` → reroll). This prevents any 3-vertical match from forming across the row boundary by itself (combined with #2).
2. **Horizontal 3-in-a-row forbidden:** if the previous two panels on this row are equal (`previousTwoMatchOnThisRow`), the current panel cannot equal them.
3. **Adjacent-same-color throttle (`adjacentDenialFrequency`):** when the current panel would equal the immediately-left neighbor (but it's not yet a 3-in-a-row), it is rejected with a probability governed by a running ratio `adjacentDenied / (adjacentAccepted + adjacentDenied)` that is kept ≤ `adjacentDenialFrequency`.
   - `adjacentDenialFrequency = 1` → **all** horizontal adjacent same-color pairs rejected (no two same-color panels ever touch horizontally). Used by all classic presets (easy/normal/hard/ex) and modern levels 8–11.
   - `adjacentDenialFrequency = 0` → adjacent same-color pairs always allowed. Used by classicEndless **easy** and modern level 1.
   - Fractional values (modern 2–7): `1/7, 2/7, 3/7, 4/7, 5/7, 6/7`. Note the first adjacent-same-color roll is always accepted because `frequency` evaluates to `NaN` (0/0) and `NaN <= x` is false in Lua/JS.

> **Color codes:** `PanelGenerator.PANEL_COLOR_TO_NUMBER` maps `"1".."9"` → 1..9 and `"A".."I"` / `"a".."i"` → 1..9 (uppercase/lowercase are used later to mark potential *metal/shock* panel slots). Color `0` = empty. Color `9` = special (unmatchable). Color `8` is used internally to represent a resolved shock/metal panel.

### 1.3 The "balanced row" rejection (`isBadRow`)

`GeneratorSource.lua:119-141` — after generating a candidate row, it is rejected and regenerated unless every color appears either 0 or exactly 2 times in the row:

```lua
local counts = {0, 0, 0, 0, 0, 0, 0, 0, 0}
local function isBadRow(rowString)
  for i = 1, #counts do counts[i] = 0 end
  for i = 1, rowString:len() do
    local color = tonumber(rowString:sub(i, i))
    counts[color] = counts[color] + 1
  end
  for color, count in ipairs(counts) do
    if count ~= 0 and count ~= 2 then
      return false
    end
  end
  return true
end
```

So at width 6, every accepted row is made of exactly three color-pairs (e.g. AABBCC in some order). Combined with the no-vertical-match rule, this guarantees the **starting board has zero pre-existing matches**. This is applied in `growPanelBuffer`:

```lua
function GeneratorSource:growPanelBuffer(stack)
  local lastRow = self.panelBuffer:sub(-stack.width)
  local newPanels
  while newPanels == nil or isBadRow(newPanels) do
    newPanels = self.panelGenerator:generatePanels(stack.width, stack.levelData.colors, lastRow)
  end
  if self.shockEnabled then
    newPanels = self.panelGenerator:assignMetalLocations(newPanels, lastRow)
  end
  self.panelBuffer = self.panelBuffer .. newPanels
end
```

### 1.4 Non-uniform starting board shape

`GeneratorSource.lua:44-72`. The starting board is **not** a flat 7-row rectangle. The algorithm:

1. Generate 7 full rows into `panelBuffer`.
2. Build a height map of `[7,7,7,7,7,7]` (each column starts at max height 7).
3. Repeatedly pick a random column and delete its current topmost panel; do this **`2 * stack.width = 12`** times.
4. The result is a jagged starting board where total panel count = `7*6 - 12 = 30`.

```lua
function GeneratorSource:generateStartingBoard(stack)
  for i = 1, self:getStartingBoardHeight(stack) do
    self:growPanelBuffer(stack)
  end
  local startingBoard = string.rep("0", stack.width) .. self.panelBuffer
  self.panelBuffer = ""
  local startingBoardArray = procat(startingBoard)
  local maxStartingHeight = 7
  local height = tableUtils.map(procat(string.rep(maxStartingHeight, stack.width)), function(s) return tonumber(s) end)
  local toRemove = 2 * stack.width
  while toRemove > 0 do
    local idx = self.panelGenerator:random(1, stack.width) -- pick a random column
    if height[idx] > 0 then
      startingBoardArray[idx + stack.width * (-height[idx] + 8)] = "0"
      height[idx] = height[idx] - 1
      toRemove = toRemove - 1
    end
  end
  startingBoard = table.concat(startingBoardArray)
  startingBoard = string.sub(startingBoard, stack.width + 1)
  return startingBoard
end
```

### 1.5 New rows during play (`createNewRow`)

When the stack rises and a new bottom row is needed, `GeneratorSource.lua:162-189` pulls the next buffered row, resolves any queued shock/metal panels, and creates `Panel` objects in `"dimmed"` state (they animate in as the row rises).

```lua
function GeneratorSource:createNewRow(stack, row)
  if string.len(self.panelBuffer) <= 2 * stack.width then
    self:growPanelBuffer(stack)
  end
  local metalPanelsThisRow = 0
  if self.shockEnabled then
    if stack.metalPanelsQueued > 3 then
      stack.metalPanelsQueued = stack.metalPanelsQueued - 2
      metalPanelsThisRow = 2
    elseif stack.metalPanelsQueued > 0 then
      stack.metalPanelsQueued = stack.metalPanelsQueued - 1
      metalPanelsThisRow = 1
    end
  end
  local colors = convertMetalPanels(self.panelBuffer:sub(1, stack.width), metalPanelsThisRow)
  self.panelBuffer = self.panelBuffer:sub(stack.width + 1)
  for col = 1, stack.width do
    local panel = stack:createPanelAt(row, col)
    panel.color = colors[col]
    panel.state = "dimmed"
  end
  return stack.panels[row]
end
```

### 1.6 Shock panels — relevant to endless?

`stack.shockEnabled` is set from the `panelSource`, which is `GeneratorSource(seed, shockEnabled)`. **Shock panels are gated by `levelData.shockCap`:**

- All **classic** and **classicEndless** presets set `shockCap = 0` (`LevelPresets.lua:235, 256, 275, 296`). With shockCap 0, `metalPanelsQueued` can never grow (capped at 0 in `Stack:onPop`, §3) so no shock panels ever spawn.
- The **classicEndless.easy** preset additionally uses 5 colors and `adjacentDenialFrequency = 0`.
- The `assignMetalLocations` step is only run when `shockEnabled` is true (set at GeneratorSource construction, which the match-setup code ties to `shockCap > 0`).

**For a classic endless port:** you can ignore shock panels entirely (set `shockCap = 0`, `shockEnabled = false`, skip `assignMetalLocations` and `convertMetalPanels`). For a faithful modern-level port, implement them — see `PanelGenerator:assignMetalLocations` (lines 119-151): two random distinct columns per row are tagged uppercase/lowercase; if `metalPanelsQueued >= 2` both become metal, if `== 1` only the first becomes metal.

### 1.7 Two RNGs

`GeneratorSource.lua:207-208` — the panel generator and the garbage-panel generator are **separate** RNGs:

```lua
source.panelGenerator = PanelGenerator(self.seed, stack.levelData.adjacentDenialFrequency)
source.garbagePanelGenerator = PanelGenerator(math.floor((self.seed + 5) / 2), 1)
```

The garbage-panel generator (used when garbage blocks are cleared into regular panels) always uses `adjacentDenialFrequency = 1` (no adjacent same colors). For endless with no garbage you can ignore it.

---

## 2. HEALTH / GAME OVER

There are **two completely different "health" systems** in this codebase. Do not confuse them.

### 2.A Player stack health (`Stack.health` + `LevelData.maxHealth`) — **THIS IS THE ONE YOU PORT**

The player's topped-out survival timer. Defined inline in `Stack.lua`, configured by `LevelData.maxHealth`.

**Init** (`Stack.lua:198`): `s.health = s.levelData.maxHealth`

**Decrement** — `Stack.lua:1109-1139`, inside `advancePassiveRaise`. Health drops by 1 each frame the stack **would** passively raise but is currently topped out (and only when not rise-locked and stop_time == 0):

```lua
function Stack:advancePassiveRaise()
  if self.manual_raise then
    -- ... manual raise path, see §4.4 ...
  else
    if not self.rise_lock and self.stop_time == 0 then
      if self:isToppedOut() then
        self.health = self.health - 1
      else
        self.rise_timer = self.rise_timer - 1
        if self.rise_timer <= 0 then -- try to rise
          self.displacement = self.displacement - 1
          if self.displacement == 0 then
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

**Refill** — `Stack.lua:956-958`, at the start of every `runPhysics` step. If you are no longer topped out and have no falling garbage, health snaps back to full:

```lua
if not self.wasToppedOut and not self:hasFallingGarbage() then
  self.health = self.levelData.maxHealth
end
```

(`wasToppedOut` is captured at the very start of `runPhysics` from `self:isToppedOut()`, see below.)

**Topped-out test** — `Stack.lua:859-866`. The stack is "topped out" if any panel in the **top row** (`row == height == 12`) is "dangerous":

```lua
function Stack:isToppedOut()
  for col = 1, self.width do
    if self.panels[self.height][col]:dangerous() then
      return true
    end
  end
  return false
end
```

`Panel:dangerous` (`Panel.lua:832-838`) — a non-garbage panel is dangerous if it has a color (`color ~= 0`); a garbage panel is dangerous unless it's `falling`:

```lua
function Panel.dangerous(self)
  if self.isGarbage then
    return self.state ~= "falling"
  else
    return self.color ~= 0
  end
end
```

**Game-over trigger** — `Stack.lua:1639-1677`. The HEALTH branch:

```lua
function Stack:checkGameOver()
  if self.game_over_clock <= 0 then
    for stackOverCondition, value in pairs(self.stackOverConditions) do
      if stackOverCondition == MatchRules.StackOverConditions.HEALTH then
        if self.health <= value and self.shake_time <= 0 then
          return true
        elseif not self.rise_lock and self.behaviours.allowManualRaise and self.wasToppedOut and self.manual_raise then
          return true
        end
      elseif ...  -- SWAPS / CHAIN conditions, puzzle-only
      end
    end
  else
    return true
  end
end
```

For all endless/time-attack/vs modes, `stackOverConditions = { [HEALTH] = 0 }` (from `GameModes.lua`). So:

- **Primary trigger:** `health <= 0` **AND** `shake_time <= 0`. (`value` is 0.)
- **Secondary trigger (manual-raise suicide):** topped out, holding manual raise, not rise-locked, and `allowManualRaise` is on. Pressing raise while topped out kills you instantly. This is the "classic level 1 tap = death" behavior; on level 10 (maxHealth=1) it's negligible because you die next frame anyway.

`checkGameOver` is called at three points each frame: after passive raise (`Stack.lua:948`), after manual raise while topped (`Stack.lua:1029`), and at the end of `runPhysics` (`Stack.lua:996`). When it returns true, `setGameOver()` records `game_over_clock = self.clock` and emits the `gameOver` signal (`Stack.lua:1201-1214`).

### 2.A.1 Invincibility / grace frames

Three timers act as "grace" before health can kill you. They are decremented at the start of every `runPhysics` in `decrementInvincibilityTimers` (`Stack.lua:1002-1015`):

```lua
function Stack:decrementInvincibilityTimers()
  self.prev_shake_time = self.shake_time
  self.shake_time = self.shake_time - 1
  self.shake_time = max(self.shake_time, self.shake_time_on_frame)
  if self.shake_time == 0 then
    self.peak_shake_time = 0
  end
  if self.pre_stop_time ~= 0 then
    self.pre_stop_time = self.pre_stop_time - 1
  elseif self.stop_time ~= 0 then
    self.stop_time = self.stop_time - 1
  end
end
```

- **`shake_time`** — invincibility from a large garbage block landing. While `> 0`, `checkGameOver` cannot fire (the `shake_time <= 0` guard). Reset upward to `shake_time_on_frame` if a new landing produced more. Source table `GARBAGE_SIZE_TO_SHAKE_FRAMES` (`Stack.lua:42-47`): for garbage of width*height 1..24:
  ```
  {18, 18, 18, 18, 24, 42, 42, 42, 42, 42, 66, 66, 66, 66, 66, 66, 66, 66, 66, 66, 66, 76}
  ```
  → 18..76 frames = **300..1267 ms**.
- **`pre_stop_time`** — invincibility from active matches popping (longest remaining pop duration). Decrements first; while > 0 it blocks `stop_time` from decrementing.
- **`stop_time`** — invincibility earned from chains/combos (see LevelData `stop` table). Decrements only when `pre_stop_time == 0`. **Reset to 0 on manual raise** (`Stack.lua:1023`).

Both `pre_stop_time` and `stop_time` being > 0 set `rise_lock` semantics indirectly: in `advancePassiveRaise`, raising only proceeds when `stop_time == 0` (and not rise-locked), so during stop time the stack doesn't rise and health doesn't decrement.

### 2.A.2 Classic vs modern health

From `LevelPresets.lua`:

| Preset | `maxHealth` | frames topped-out to lose | ms |
|---|---|---|---|
| classic easy/normal/hard/ex (and classicEndless normal/hard/ex) | **1** | 1 | **~16.7 ms** (one frame) |
| classicEndless **easy** | **1** | 1 | ~16.7 ms |
| modern 1 | 121 | 121 | ~2017 ms |
| modern 2 | 101 | 101 | ~1683 ms |
| modern 3 | 81 | 81 | ~1350 ms |
| modern 4 | 66 | 66 | ~1100 ms |
| modern 5 | 51 | 51 | ~850 ms |
| modern 6 | 41 | 41 | ~683 ms |
| modern 7 | 31 | 31 | ~517 ms |
| modern 8 | 21 | 21 | ~350 ms |
| modern 9 | 11 | 11 | ~183 ms |
| modern 10 / 11 | **1** | 1 | ~16.7 ms |

**Classic behavior (maxHealth=1):** the moment the stack is topped out on a frame where passive raise would tick (no stop time, no rise lock, no shake), `health` drops 1→0 and you die next `checkGameOver`. Effectively instant death on top-out unless you have stop/shake invincibility.

**Modern behavior:** you have a buffer of N frames of being topped-out before death; refill to full as soon as you un-top.

### 2.B The OTHER Health class (`common/engine/Health.lua`) — **DO NOT PORT for endless**

`Health.lua` is a **separate simulated health bar** used only by **1P Challenge mode** (`ONE_PLAYER_CHALLENGE`, `stackInteraction = VERSUS`) and the network telegraph. It models a notional opponent that accumulates "lines" over time and dies if it stays topped out too long. It is **not** consulted by the real player's `Stack:checkGameOver`. Confirmed by the fact that `Stack.lua` never imports or instantiates `Health`; it's wired in via the Challenge/CPU path.

Key shape (for reference only):

```lua
function Health:run()
  if self.clock > 0 and self.clock % (15 * 60) == 0 then       -- every 15s
    self.currentRiseSpeed = math.min(self.currentRiseSpeed + 1, 99)
  end
  local risenLines = 1.0 / (consts.SPEED_TO_RISE_TIME[self.currentRiseSpeed] * 16)
  self.currentLines = self.currentLines + risenLines
  local staminaPercent = math.max(0.5, 1 - ((self.clock / 60) * (0.01 / 10)))
  local decrementLines = (self.lineClearRate * (1/60.0)) * staminaPercent
  self.currentLines = math.max(0, self.currentLines - decrementLines)
  if self.currentLines >= self.height then
    self.framesToppedOutToLose = math.max(0, self.framesToppedOutToLose - 1)
  end
  self.clock = self.clock + 1
  return self.framesToppedOutToLose
end
```

Constructor params: `Health(framesToppedOutToLose, lineClearGPM, height, riseSpeed)`. Game-over = `framesToppedOutToLose` reaching 0. It also has rollback save/restore machinery (`saveRollbackCopy`, `rollbackToFrame`) — pure network/Challenge artifact. **Exclude entirely** for a single-player endless port.

---

## 3. SCORING

### 3.1 Score mode

`client/src/globals.lua:2`:

```lua
score_mode = consts.SCOREMODE_TA
```

`consts.SCOREMODE_TA = 1`, `consts.SCOREMODE_PDP64 = 2` ("currently not used"). **Only the `_TA` tables are ever read.** You can hard-code the TA path and drop the PdP64 branch.

### 3.2 The literal tables (`common/engine/checkMatches.lua:12-22`)

```lua
local SCORE_COMBO_TA = {  0,    0,    0,   20,   30,
                         50,   60,   70,   80,  100,
                        140,  170,  210,  250,  290,
                        340,  390,  440,  490,  550,
                        610,  680,  750,  820,  900,
                        980, 1060, 1150, 1240, 1330, [0]=0}

local SCORE_CHAIN_TA = {  0,   50,   80,  150,  300,
                        400,  500,  700,  900, 1100,
                       1300, 1500, 1800, [0]=0}
```

**Combo table** — index = number of panels in the simultaneous match. Index 0–3 = 0 bonus (a 3-match is the minimum and gives no combo bonus). Indices 4..30 give the values above; combos > 30 clamp to the [30] = 1330 value.

**Chain table** — index = current chain length (`chain_counter`). Index 0/1 = 0. Chains > 13 give **0** bonus (see `updateScoreWithChain`: if `chain_bonus > 13` it is set to 0 before lookup).

### 3.3 Where score is added

**(a) Per popped panel — base score +10.** `Stack.lua:1505-1516`:

```lua
function Stack:onPop(panel)
  if not panel.isGarbage then
    self:addScore(10)
    self.panels_cleared = self.panels_cleared + 1
    if self.panels_cleared % self.levelData.shockFrequency == 0 then
          self.metalPanelsQueued = min(self.metalPanelsQueued + 1, self.levelData.shockCap)
    end
  end
  self:emitSignal("panelPop", panel)
end
```

So every cleared non-garbage panel is **+10**. (`onPop` is called by `Panel:update` when a panel transitions from `popping` → `popped`. The `panels_cleared % shockFrequency` clause queues shock panels — irrelevant when `shockCap == 0`.)

**(b) Combo bonus.** `checkMatches.lua:849-861`, called once per match group from `Stack:checkMatches`:

```lua
function Stack:updateScoreWithCombo(comboSize)
  if comboSize > 3 then
    if (score_mode == consts.SCOREMODE_TA) then
      self:addScore(SCORE_COMBO_TA[math.min(30, comboSize)])
    elseif (score_mode == consts.SCOREMODE_PDP64) then
      if (comboSize < 41) then
        self:addScore(SCORE_COMBO_PdP64[comboSize])
      else
        self:addScore(20400 + ((comboSize - 40) * 800))
      end
    end
  end
end
```

Only awarded when `comboSize > 3` (a 3-match gives only the per-panel +30, no combo bonus).

**(c) Chain bonus.** `checkMatches.lua:863-871`, called once per frame a chain is ongoing (`updateScoreWithChain` is invoked from `updateScoreWithBonus` which runs each time matches are detected):

```lua
function Stack:updateScoreWithChain()
  local chain_bonus = self.chain_counter
  if (score_mode == consts.SCOREMODE_TA) then
    if (chain_bonus > 13) then
      chain_bonus = 0
    end
    self:addScore(SCORE_CHAIN_TA[chain_bonus])
  end
end
```

`chain_counter` starts at 2 for the first chain link (a regular match is not a chain). So the first chain link adds `SCORE_CHAIN_TA[2] = 50`, then `[3] = 80`, etc. Up to chain 13 = 1800. Chain 14+ adds 0 (but the chain continues for garbage-attack purposes).

**(d) Manual raise completion — +1.** `Stack.lua:1036-1038`, when a manual raise fully completes a row rise (and `prevent_manual_raise` is false):

```lua
if self.displacement == 1 then
  if not self.prevent_manual_raise then
    self:addScore(1)
  end
  ...
```

So each manual raise that completes a new row = **+1** point.

### 3.4 Score cap

`Stack.lua:1753-1759`:

```lua
function Stack:addScore(score)
  self.score = self.score + score
  if (self.score > 99999) then
    self.score = 99999
  end
end
```

Hard cap **99999**.

### 3.5 Scoring order within a frame

`Stack:checkMatches` → on a detected match group, calls (in order): `awardStopTime` (sets invincibility), `updateScoreWithBonus(comboSize)` which calls `updateScoreWithChain()` first then `updateScoreWithCombo(comboSize)`. The per-panel +10 happens later when each panel actually pops (a few frames after the match, during `Panel:update`).

---

## 4. INPUT MAPPING

### 4.1 The 11 logical keys

`consts.lua:18`:

```lua
KEY_NAMES = {"Up", "Down", "Left", "Right", "Swap1", "Swap2", "TauntUp", "TauntDown", "Raise1", "Raise2", "Start"}
```

For gameplay the relevant ones are: **Up, Down, Left, Right** (cursor), **Swap1 / Swap2** (swap — either triggers a swap), **Raise1 / Raise2** (manual raise — either triggers). TauntUp/TauntDown/Start are non-gameplay.

### 4.2 Default keyboard bindings

`client/src/inputManager.lua:637-664` (`setupDefaultKeyConfigurations`). Two default configs (player 1 and player 2 on one keyboard):

**Config 1 (player 1):**
```lua
{ Up="up", Down="down", Left="left", Right="right",
  Swap1="z", Swap2="x", TauntUp="y", TauntDown="u",
  Raise1="c", Raise2="v", Start="return" }
```

**Config 2 (player 2):**
```lua
{ Up="w", Down="s", Left="a", Right="d",
  Swap1="j", Swap2="k", TauntUp="i", TauntDown="l",
  Raise1="o", Raise2="u", Start="space" }
```

### 4.3 Per-frame input packing — `KeyDataEncoding`

`common/data/KeyDataEncoding.lua` (full file):

```lua
local base64encode = procat("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz1234567890+/")
local base64decode = {}
for i = 1, 64 do
  local val = i - 1
  base64decode[base64encode[i]] = {}
  local bit = 32
  for j = 1, 6 do
    base64decode[base64encode[i]][j] = (val >= bit)
    val = val % bit
    bit = bit / 2
  end
end

local KeyDataEncoding = {
  base64encode = base64encode,
  base64decode = base64decode,
  idle = base64encode[1],   -- "A", value 0
  left = base64encode[3],   -- "C", value 2
  right = base64encode[2],  -- "B", value 1
  up = base64encode[9],     -- "I", value 8
  down = base64encode[5],   -- "E", value 4
  swap = base64encode[17],  -- "Q", value 16
  raise = base64encode[33]  -- "g", value 32
}
```

**Bit layout (6 bits per frame, MSB first):**

| bit position (decode index) | weight | action |
|---|---|---|
| 1 | 32 | Raise |
| 2 | 16 | Swap |
| 3 | 8 | Up |
| 4 | 4 | Down |
| 5 | 2 | Left |
| 6 | 1 | Right |

So each frame of gameplay input is one base64 character encoding the 6 boolean actions. `idle = "A"` (value 0). This packing exists for replay/network serialization; you can keep it as a single integer 0..63 internally.

### 4.4 How the keyboard becomes a packed frame — `send_controls`

`client/src/network/PlayerStack.lua:24-57` (the **definitive** gameplay input path). This runs once per local stack per frame, **only when the engine's input buffer is empty** (i.e. exactly one packed input is produced per engine frame):

```lua
function PlayerStack:send_controls()
  if self.is_local and GAME.netClient:isConnected() and #self.engine.confirmedInput > 0
     and self.garbageTarget and #self.garbageTarget.engine.confirmedInput == 0 then
    return  -- network sync wait; EXCLUDE for single-player
  end
  local buffer_len = #self.engine.confirmedInput - self.engine.clock
  if buffer_len > 0 then
    return  -- already have an input queued for this frame
  end
  local to_send
  if self.inputMethod == "controller" then
    local input = self.player.inputConfiguration
    to_send = KeyDataEncoding.base64encode[
      ((input.isDown["Raise1"] or input.isDown["Raise2"] or input.isPressed["Raise1"] or input.isPressed["Raise2"]) and 32 or 0) +
      ((input.isDown["Swap1"] or input.isDown["Swap2"]) and 16 or 0) +
      ((input.isDown["Up"] or input.isPressed["Up"]) and 8 or 0) +
      ((input.isDown["Down"] or input.isPressed["Down"]) and 4 or 0) +
      ((input.isDown["Left"] or input.isPressed["Left"]) and 2 or 0) +
      ((input.isDown["Right"] or input.isPressed["Right"]) and 1 or 0) + 1
    ]
  elseif self.inputMethod == "touch" then
    to_send = self.touchInputDetector:encodedCharacterForCurrentTouchInput()
  end
  GAME.netClient:sendInput(to_send)   -- network; EXCLUDE for single-player
  self:handle_input_taunt()
  self.engine:receiveConfirmedInput(to_send)  -- <-- this is what feeds the engine
end
```

**Critical details for the JS port:**

- **`isDown[X]`** = key was *pressed* (edge) on this exact frame (true for only one frame). Used for **Swap** and **Raise**.
- **`isPressed[X]`** = key is currently *held* (truthy; actually stores total held duration in seconds). Used for **Up/Down/Left/Right** and **Raise**.
- **Swap is EDGE-triggered:** only `isDown`, not `isPressed`. So holding the swap key produces exactly one swap press.
- **Raise works on EITHER edge or hold:** `isDown OR isPressed`. Holding raise keeps manual_raise asserted.
- **Cursor directions work on edge OR hold** at the input-packing layer, BUT the engine applies its **own DAS** on top (see §4.5) — so the raw held-direction repeats every frame from the keyboard, but the engine's `cur_timer`/`cur_wait_time` gates actual cursor movement.
- Note the `+ 1` at the end: `base64encode` is 1-indexed, so value 0 maps to index 1 = `"A"` = idle.

### 4.5 The engine-side cursor DAS (the IMPORTANT one for gameplay feel)

**Do NOT confuse the menu DAS (`KEY_DELAY`/`KEY_REPEAT_PERIOD`) with the in-game cursor DAS.** They are different mechanisms:

**Menu/UI DAS** — `consts.lua:20-21`:

```lua
KEY_DELAY = .25,        -- 0.25 s = 250 ms initial delay
KEY_REPEAT_PERIOD = .05,-- 0.05 s = 50 ms repeat period (every 3 frames)
```

Used by `inputManager:isPressedWithRepeat` (`inputManager.lua:349-374`) which is only consumed by **menus** (`GridCursor.lua`, `Carousel.lua`, sliders) and `ReplayGame`'s frame-step controls. **The in-game Stack never uses it.** Reproduce it only if you port the menus.

```lua
local function isPressedWithRepeat(inputs, key, delay, repeatPeriod)
  if delay == nil then delay = consts.KEY_DELAY end
  if repeatPeriod == nil then repeatPeriod = consts.KEY_REPEAT_PERIOD end
  ...
  if inputs.isPressed[key] then
    local prevDuration = quantize(inputs.isPressed[key] - currentDt, repeatPeriod)
    local currDuration = quantize(inputs.isPressed[key], repeatPeriod)
    return inputs.isPressed[key] > delay and prevDuration ~= currDuration
  else
    return inputs.isDown[key]
  end
end
```

**In-game cursor DAS** — entirely in `Stack.lua`, frame-based not time-based. Init (`Stack.lua:251-253`):

```lua
s.cur_wait_time = DEFAULT_INPUT_REPEAT_DELAY   -- = 20 (Stack.lua:40)
s.cur_timer = 0
s.cursorDirection = nil
```

`DEFAULT_INPUT_REPEAT_DELAY = 20` frames = **333 ms**. This is the DAS delay before auto-repeat kicks in. The repeat rate after that is **1 tile per frame** (instant once the delay elapses).

Logic in `Stack:controls` (`Stack.lua:693-710`) and `Stack:applyCursorDirection` (`Stack.lua:1064-1077`):

```lua
-- inside controls():
if up then new_dir = "up"
elseif down then new_dir = "down"
elseif left then new_dir = "left"
elseif right then new_dir = "right"
end
if new_dir == self.cursorDirection then
  if self.cur_timer ~= self.cur_wait_time then
    self.cur_timer = self.cur_timer + 1
  end
else
  self.cursorDirection = new_dir
  self.cur_timer = 0
end

-- applyCursorDirection:
function Stack:applyCursorDirection(direction)
  ...
  if direction and (self.cur_timer == 0 or self.cur_timer == self.cur_wait_time) and self.cursorLock == nil then
    local previousRow = self.cur_row
    local previousCol = self.cur_col
    self:moveCursorInDirection(direction)
    ...
```

**Summary of cursor movement timing:**
- On the **first frame** a direction is held (`cur_timer == 0`), the cursor moves 1 tile immediately.
- `cur_timer` then increments each frame the same direction is held, up to `cur_wait_time = 20`.
- Once `cur_timer == 20`, the cursor moves 1 tile **every frame** (60 Hz auto-repeat).
- Changing direction resets `cur_timer = 0` (immediate move + restart of the 20-frame delay).

`DIRECTION_ROW`/`DIRECTION_COLUMN` (`Stack.lua:82-84`) — note **up = +1 row** (row 1 is bottom):

```lua
local DIRECTION_COLUMN = {up = 0, down = 0, left = -1, right = 1}
local DIRECTION_ROW    = {up = 1, down = -1, left = 0, right = 0}
```

### 4.6 Swap rate limit

`Stack.lua:684-691` — a swap is allowed at most every **2nd** frame:

```lua
if self.swapThisFrame and self:swapQueued() then
  -- swapping is allowed at most every second frame
  self.swapThisFrame = false
  self:emitSignal("swapDenied")
end
```

So even if the player holds swap, the effective max swap rate is 30 Hz (every 2 frames ≈ 33 ms). The actual swap executes the **next** frame via the queued-swap mechanism (`Stack.lua:967-971`).

### 4.7 How the engine consumes a frame's input

`Stack.lua:836-847` (`setupInput`) — pulls the next packed input char from the buffer:

```lua
function Stack:setupInput()
  self.input_state = nil
  if self:game_ended() == false then
    self.input_state = self.confirmedInput[self.clock + 1]
  else
    self.input_state = self:idleInput()
  end
  self:controls()
end
```

`controls()` (`Stack.lua:647-719`) decodes the char (controller mode via `KeyDataEncoding.base64decode[sdata]`) into `raise, swap, up, down, left, right` booleans, sets `swapThisFrame`, picks `cursorDirection`, updates `cur_timer`, and sets `manual_raise` if `raise` is asserted.

For a JS single-player port you can **skip the packing entirely** and just feed the 6 booleans directly into a `stack.controls(booleans)` each tick.

---

## 5. GAME LOOP / CLOCK

### 5.1 The LÖVE frame driver (`CustomRun.lua`)

`main.lua:24-30` overrides `love.run` with `CustomRun.run`, whose inner loop is `CustomRun.innerRun` (`client/src/CustomRun.lua:106-186`). It uses **real delta time** but **targets a fixed 1/60 s frame** via adaptive sleep:

```lua
CustomRun.FRAME_RATE = 1 / 60
local maxLeftOverTime = CustomRun.FRAME_RATE / 2     -- 1/120 s
local desiredLeftOverTime = CustomRun.FRAME_RATE / 4 -- 1/240 s
leftover_time = desiredLeftOverTime
```

Per iteration (`innerRun`):

```lua
function CustomRun.innerRun()
  local shouldQuit, restartArg = CustomRun.processEvents()
  if shouldQuit then return shouldQuit, restartArg end
  ...
  if love.timer then
    dt = love.timer.step()
    CustomRun.runMetrics.dt = dt
    leftover_time = (leftover_time - CustomRun.FRAME_RATE + dt) % maxLeftOverTime
  end
  if love.update then
    ...
    love.update(dt)   -- passes REAL dt to the scene
    ...
  end
  ... love.draw() ...
  if love.timer then
    CustomRun.sleep()  -- busy-loops to hit exactly 1/60s wall-clock
  end
end
```

**The LÖVE layer does NOT do fixed-step itself** — it just tries to call `love.update(dt)` once per ~1/60 s of wall clock. The fixed-step accumulation happens one level deeper (§5.2). `CustomRun.sleep` (`CustomRun.lua:28-86`) does an `love.timer.sleep` for the bulk of the wait then a busy-loop to land precisely on the target time.

### 5.2 The engine accumulator (`GameBase:runGame`)

`client/src/scenes/GameBase.lua:297-317`. This is the **fixed-step accumulator** that maps wall-clock to engine frames:

```lua
function GameBase:runGame(dt)
  self:handlePause()
  if self.frameInfo.startTime == nil then
    self.frameInfo.startTime = love.timer.getTime()
  end
  local framesRun = 0
  self.frameInfo.currentTime = love.timer.getTime()
  self.frameInfo.expectedFrameCount = math.ceil((self.frameInfo.currentTime - self.frameInfo.startTime) * 60)
  repeat
    prof.push("Match:run")
    self.frameInfo.frameCount = self.frameInfo.frameCount + 1
    framesRun = framesRun + 1
    self.match:run()
    prof.pop("Match:run")
  until (self.frameInfo.frameCount >= self.frameInfo.expectedFrameCount)
  self.droppedFrameCount = self.droppedFrameCount + (framesRun - 1)
  self:customRun()
end
```

**Algorithm:**
1. `expectedFrameCount = ceil((now - startTime) * 60)` — how many engine frames *should* have elapsed by now.
2. Loop calling `match:run()` once per engine frame until `frameCount >= expectedFrameCount`.
3. If the engine fell behind (e.g. a slow frame), the next `update` will call `match:run()` **multiple** times to catch up. `droppedFrameCount` tracks catch-up runs beyond the first.

Called from `GameBase:update(dt)` (`GameBase.lua:359-379`), which itself is called once per LÖVE update tick. So the structure is:

```
LÖVE (~60Hz, real dt) → GameBase:update(dt) → GameBase:runGame(dt)
   → [match:run() × N to catch up to wall clock] → customRun() → draw
```

**For the JS port:** replicate this exactly. Use `requestAnimationFrame`, track `startTime`, and each rAF callback compute `expectedFrameCount = Math.ceil((performance.now() - startTime) / (1000/60))` and run the engine that many times total. Cap the catch-up to avoid spiral-of-death (the Lua code doesn't, but `Match:shouldRun` indirectly limits via `max_runs_per_frame = 3` for non-local stacks — for a single local stack it just runs once per `match:run()`).

### 5.3 `Match:run` — the per-engine-frame driver

`common/engine/Match.lua:240-292`:

```lua
function Match:run()
  local startTime = love.timer.getTime()
  self:padRewindDataIfNeeded()
  local runs = {}
  for i, _ in ipairs(self.stacks) do runs[i] = 0 end
  local runsSoFar = 0
  while tableUtils.contains(runs, runsSoFar) do
    for i, stack in ipairs(self.stacks) do
      if stack and self:shouldRun(stack, runsSoFar) then
        self:pushGarbageTo(stack)   -- EXCLUDE for single-player (no garbage target)
        stack:run()
        runs[i] = runs[i] + 1
      end
    end
    self:updateClock()
    for i, stack in ipairs(self.stacks) do
      if runs[i] > runsSoFar then
        stack:updateFramesBehind(self.clock)
        if self:shouldSaveRollback(stack) then   -- EXCLUDE (rollback = network)
          stack:saveForRollback()
        end
      end
    end
    self:debugCheckDivergence()
    runsSoFar = runsSoFar + 1
  end
  return runs
end
```

For **single-player**, this collapses to: run `stack:run()` **exactly once** (because `shouldRun` for a local stack returns true iff there is one new input in the buffer, which there is — one per frame from `send_controls`), then `updateClock`, then save rollback (no-op for single player). The `runsSoFar`/`max_runs_per_frame` loop only matters for **catching up a remote opponent** in multiplayer.

`Match:shouldRun` (`Match.lua:616-645`) for a local stack:

```lua
function Match:shouldRun(stack, runsSoFar)
  if not stack:game_ended() then
    if self.timeLimit then
      if stack.stopWatch and stack.stopWatch >= self.timeLimit then
        return false   -- time attack end
      end
    else
      if self.gameOverClock and self.gameOverClock < stack.clock then
        return false
      end
    end
  end
  ... -- debug vsFramesBehind (multiplayer only)
  return stack:shouldRun(runsSoFar)
end
```

`Stack:shouldRun` (`Stack.lua:721-753`) for a **local** stack is simply `buffer_len > 0` where `buffer_len = #confirmedInput - clock`. Since `send_controls` appends exactly one input per frame, this is true once then false.

### 5.4 `Stack:run` — one engine tick

`Stack.lua:756-829` (the heart of the engine). One tick:

```lua
function Stack:run()
  prof.push("Stack:run")
  if self.is_local == false then ... play_to_end (network replay) ... end
  self:setupInput()   -- pull next input char, decode into swapThisFrame/cursorDirection/manual_raise

  if self.behaviours.delaySimulationUntil == "countdownEnded"
     and self.clock <= (consts.COUNTDOWN_START + consts.COUNTDOWN_LENGTH) then
    self:runCountdown()
    if self.clock == (consts.COUNTDOWN_START + consts.COUNTDOWN_LENGTH) then
      self.stopWatchIsRunning = true
    end
  end

  if self.stopWatchIsRunning then
    self:runPhysics()
  else
    -- first-input / first-swap gate (puzzle/endless variants)
    if self.behaviours.delaySimulationUntil == "firstInput" then
      if self.input_state ~= self:idleInput() then
        self.stopWatchIsRunning = true
        self.stopWatch = -1
      end
    elseif self.behaviours.delaySimulationUntil == "firstSwap" then
      if self.swapThisFrame then
        self.stopWatchIsRunning = true
        self.stopWatch = -1
      end
    end
  end

  self:applyCursorDirection(self.cursorDirection)  -- actual cursor move (DAS-gated)
  if self.inputMethod == "controller" and self.swapThisFrame then
    local leftPanel  = self.panels[self.cur_row][self.cur_col]
    local rightPanel = self.panels[self.cur_row][self.cur_col + 1]
    self:tryQueueSwap(leftPanel, rightPanel)       -- queue swap for NEXT frame
  end
  self:handleManualRaise()                          -- manual raise processing
  if self.stopWatchIsRunning then
    if self:shouldDropGarbage() then self:tryDropGarbage() end   -- EXCLUDE (no garbage)
    self.stopWatch = self.stopWatch + 1
  end
  self.clock = self.clock + 1
  self:emitSignal("finishedRun")
end
```

`runPhysics` (`Stack.lua:932-1000`) is the actual board simulation, in strict phase order:

1. `decrementInvincibilityTimers()` (shake/stop/pre_stop timers, §2.A.1)
2. `updateRiseLock()`
3. `updateSpeed()` — speed increase over time
4. **Phase 0:** `advancePassiveRaise()` (rise; decrement health if topped) + `checkGameOver`
5. Health refill (if not topped, no falling garbage → `health = maxHealth`)
6. **Phase 1:** execute queued swap from last frame (`Stack:swap`)
7. **Phase 2:** `checkMatches()` — detect matches, award score/stop/garbage, set panels to `matched`→`popping`→`popped`
8. `updatePanels()` — call `Panel:update` on every panel (drives pop/fall/hover state machines; emits `onPop` → +10 score)
9. `updateActivePanelCount()`
10. End-of-chain detection (`chain_counter` reset when no chaining panels)
11. `processStagedGarbage` (EXCLUDE for endless)
12. `removeExtraRows()`
13. `checkGameWin()` / `checkGameOver()` → `setGameOver()` if needed

**Countdown:** `consts.COUNTDOWN_START = 8` frames, `consts.COUNTDOWN_LENGTH = 180` frames (3 s). So the first 188 frames are the countdown with `rise_lock = true` and the cursor auto-animating. The board does not simulate during countdown. `stopWatchIsRunning` flips true at `clock == 188`.

### 5.5 What to EXCLUDE from the loop for single-player endless

- All `pushGarbageTo` / `tryDropGarbage` / `incomingGarbage` / `outgoingGarbage` / `AttackEngine` — these only exist to route garbage between players. Endless has `stackInteraction = NONE`.
- `saveForRollback` / `rollbackToFrame` / `RollbackBuffer` / `padRewindDataIfNeeded` — pure network/replay.
- `debugCheckDivergence` / `vsFramesBehind` — multiplayer sync debug.
- `play_to_end` / `is_local == false` branches — spectator/replay.
- The `max_runs_per_frame = 3` catch-up path — only for remote opponent catch-up.

---

## 6. STACK BEHAVIOURS / GAME MODES

### 6.1 `StackBehaviours.lua` (full file, 35 lines)

```lua
local StackBehaviour = {}

function StackBehaviour.getV048Default()
  return {
    passiveRaise = true,
    allowManualRaise = true,
    swapStallingMode = 0,
    swapStallingPunish = 0,
    delaySimulationUntilFirstInput = nil,
  }
end

function StackBehaviour.getV049Default()
  return {
    passiveRaise = true,
    allowManualRaise = true,
    swapStallingMode = 1,
    swapStallingPunish = 4,
    delaySimulationUntilFirstInput = nil,
  }
end

function StackBehaviour.getDefault()
  return StackBehaviour.getV049Default()   -- current engine version is 049
end
```

**Fields:**
- `passiveRaise` (bool) — whether the stack rises on its own. **True for endless.**
- `allowManualRaise` (bool) — whether the player can press raise. **True for endless.** When false, the manual-raise suicide game-over branch is disabled.
- `swapStallingMode` (0 or 1) + `swapStallingPunish` — v049 "wiggle pay" feature: swaps that would have caused health loss but were used to dodge it incur a deferred health cost. Implemented in `WigglePay.lua`. **Mode 0 = disabled (v048), Mode 1 = enabled (v049, punish=4).** For a faithful endless port you can include this; for simplicity you may start with v048 behaviour (mode 0).
- `delaySimulationUntil` (`"firstSwap"` | `"firstInput"` | `"countdownEnded"` | nil) — gates when physics starts. For endless with `doCountdown = true`, this is set to `"countdownEnded"` by `Stack:setCountdown` (`Stack.lua:1762-1772`), so the board doesn't simulate until the 3-s countdown finishes.

### 6.2 `GameModes.lua` — the 8 mode presets

`GameModes.IDs` (`GameModes.lua:213-222`):

```lua
GameModes.IDs = {
  TWO_PLAYER_VS,
  ONE_PLAYER_TIME_ATTACK,
  ONE_PLAYER_ENDLESS,
  ONE_PLAYER_TRAINING,
  ONE_PLAYER_CHALLENGE,
  ONE_PLAYER_VS_SELF,
  ONE_PLAYER_PUZZLE,
  TWO_PLAYER_TIME_ATTACK,
}
```

**Single-player modes (relevant candidates for the port):**

| ID | name | gameScene | stackInteraction | win criteria | doCountdown |
|---|---|---|---|---|---|
| `ONE_PLAYER_ENDLESS` | `endless` | `EndlessGame` | **NONE** | SCORE (highest) then GAME_OVER_CLOCK | true |
| `ONE_PLAYER_TIME_ATTACK` | `timeattack` | `TimeAttackGame` | **NONE** | SCORE (highest), TIME_LIMIT = 120*60 frames = 120 s | true |
| `ONE_PLAYER_VS_SELF` | `vsSelf` | `VsSelfGame` | **SELF** | GAME_OVER_CLOCK | true |
| `ONE_PLAYER_PUZZLE` | `puzzle` | `PuzzleGame` | NONE | TIME (lowest) | false |
| `ONE_PLAYER_TRAINING` | `training` | `GameBase` | **ATTACK_ENGINE** | GAME_OVER_CLOCK | true |
| `ONE_PLAYER_CHALLENGE` | `challenge` | `Game1pChallenge` | **VERSUS** | GAME_OVER_CLOCK | true |

`stackInteraction` enum (`GameModes.lua:45`): `NONE = 0, VERSUS = 1, SELF = 2, ATTACK_ENGINE = 3`.

- **NONE** = no garbage at all (pure solo board). → **Endless and Time Attack.**
- **SELF** = your own attacks are routed back to yourself (vs-self practice).
- **VERSUS / ATTACK_ENGINE** = there is another stack (human or CPU/AttackEngine) sending garbage. → Challenge, Training, 2P VS.

**For the port, target `ONE_PLAYER_ENDLESS`:**

```lua
local OnePlayerEndless = GameMode({
  gameScene = "EndlessGame",
  name = "endless",
  playerCount = 1,
  stackInteraction = StackInteractions.NONE,
  matchRules = {
    matchEndConditions = { [MatchRules.MatchEndConditions.STACKS_ACTIVE] = 0 },
    matchWinRuleset = { {[MatchRules.MatchWinCriterias.SCORE] = MatchRules.orders.HIGHEST},
                        {[MatchRules.MatchWinCriterias.GAME_OVER_CLOCK] = MatchRules.orders.HIGHEST} },
    stackOverConditions = { [MatchRules.StackOverConditions.HEALTH] = 0 },
    stackWinConditions = {},
    stackSetupModifications = {},
    doCountdown = true,
  },
})
```

- `matchEndConditions.STACKS_ACTIVE = 0` — match ends when 0 stacks are still active (i.e. the single player dies).
- `stackOverConditions.HEALTH = 0` — a stack is "over" when health ≤ 0 (and shake_time ≤ 0).
- `doCountdown = true` — 3-s countdown before physics starts.

**Multiplayer modes to EXCLUDE:** `TWO_PLAYER_VS`, `TWO_PLAYER_TIME_ATTACK`, and the `stackInteraction = VERSUS/ATTACK_ENGINE` branches of Challenge/Training.

### 6.3 `MatchRules.lua` enums (full file, 32 lines)

```lua
MatchRules.MatchEndConditions  = { STACKS_ACTIVE = "STACKS_ACTIVE", TIME_LIMIT = "TIME_LIMIT" }
MatchRules.MatchWinCriterias   = { GAME_OVER_CLOCK = "GAME_OVER_CLOCK", SCORE = "SCORE", TIME = "TIME" }
MatchRules.orders              = { LOWEST = "LOWEST", HIGHEST = "HIGHEST" }
MatchRules.StackOverConditions = { HEALTH = "HEALTH", SWAPS = "SWAPS", CHAIN = "CHAIN" }
MatchRules.StackWinConditions  = { MATCHABLE_PANELS = "MATCHABLE_PANELS",
                                   MATCHABLE_GARBAGE_PANELS = "MATCHABLE_GARBAGE_PANELS",
                                   SCORE = "SCORE" }
```

For endless you need only: `MatchEndConditions.STACKS_ACTIVE`, `MatchWinCriterias.SCORE` + `GAME_OVER_CLOCK`, `StackOverConditions.HEALTH`. The `SWAPS`/`CHAIN` over-conditions and `MATCHABLE_*` win-conditions are puzzle-specific.

### 6.4 Level data you'll plug into endless

From `LevelPresets.lua` — endless uses `LevelPresets.getClassicEndless(difficulty)` (classic style) or `LevelPresets.getModern(level)` (modern style). The classic endless presets are deepcopies of the classic presets with two diffs for easy:

- **classicEndless.easy:** 5 colors, `adjacentDenialFrequency = 0`, `shockCap = 0`, `maxHealth = 1`, speed mode = CLEARED_PANEL_COUNT, classic stop formula, `hover=12, flash=44, face=17, pop=9`.
- **classicEndless.normal / hard / ex:** identical to classic normal/hard/ex (6 colors, `adjacentDenialFrequency = 1`, `shockCap = 0`, `maxHealth = 1`).

`LevelData` fields used by the engine (`LevelData.lua:26-36`):

```lua
startingSpeed        -- 1..99, index into SPEED_TO_RISE_TIME
speedIncreaseMode    -- TIME_INTERVAL (1) or CLEARED_PANEL_COUNT (2)
shockFrequency       -- panels cleared per shock panel queued (irrelevant if shockCap=0)
shockCap             -- max queued shock panels; 0 disables
colors               -- 4..7 (5 for classicEndless.easy, 6 otherwise)
adjacentDenialFrequency  -- 0..1
maxHealth            -- topped-out survival frames
stop.formula         -- MODERN (1) or CLASSIC (2)
stop.comboConstant, stop.chainConstant, stop.dangerConstant, stop.coefficient, stop.dangerCoefficient
frameConstants.HOVER, frameConstants.GARBAGE_HOVER, frameConstants.FLASH, frameConstants.FACE, frameConstants.POP
```

### 6.5 Speed system (rise rate)

`consts.SPEED_TO_RISE_TIME` (`consts.lua:57-68`) — frames-per-row-rise for each speed level 1..99 (already divided by 16, so the value is in "rise_timer ticks per displacement unit"; 16 units = one full row):

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

> Note: speed 2 (983) is **slower** than speed 1 (942) — confirmed by the source comment "Yes, 2 is slower than 1 and 50..99 are the same." Levels 50–99 all clamp to 47 ticks per displacement unit.

Speed increase:
- **TIME_INTERVAL mode (modern):** `DT_SPEED_INCREASE = 15 * 60 = 900` frames = **15 s** per speed level (`Stack.lua:49`). `updateSpeed` increments `speed` every 900 clock ticks.
- **CLEARED_PANEL_COUNT mode (classic):** `PANELS_TO_NEXT_SPEED` table (`Stack.lua:55-65`) — panels to clear to advance:

```lua
local PANELS_TO_NEXT_SPEED =
  {9, 12, 12, 12, 12, 12, 15, 15, 18, 18,
   24, 24, 24, 24, 24, 24, 21, 18, 18, 18,
   36, 36, 36, 36, 36, 36, 36, 36, 36, 36,
   39, 39, 39, 39, 39, 39, 39, 39, 39, 39,
   45, 45, 45, 45, 45, 45, 45, 45, 45, 45,
   45, 45, 45, 45, 45, 45, 45, 45, 45, 45,
   45, 45, 45, 45, 45, 45, 45, 45, 45, 45,
   45, 45, 45, 45, 45, 45, 45, 45, 45, 45,
   45, 45, 45, 45, 45, 45, 45, 45, 45, 45,
   45, 45, 45, 45, 45, 45, 45, 45, math.huge}
```

Index 0 = before first increase (i.e. to go from speed 1 to 2 you clear 9 panels). Last entry `math.huge` = speed 99 is the cap.

---

## 7. PORTING CHECKLIST (TL;DR for the JS dev)

**Constants to hardcode for classic endless:**
- `WIDTH = 6`, `HEIGHT = 12`, `STARTING_BOARD_HEIGHT = 7`.
- `PANELS_TO_REMOVE_FROM_START = 2 * WIDTH = 12`.
- `DEFAULT_INPUT_REPEAT_DELAY = 20` frames (333 ms cursor DAS).
- `DT_SPEED_INCREASE = 900` frames (15 s, modern only).
- `COUNTDOWN_START = 8`, `COUNTDOWN_LENGTH = 180` (3 s), `COUNTDOWN_CURSOR_SPEED = 4`.
- `KEY_DELAY = 0.25` s, `KEY_REPEAT_PERIOD = 0.05` s (**menus only**).
- `FRAME_RATE = 1/60` s.
- Score cap `99999`.
- Speed table `SPEED_TO_RISE_TIME` (§6.5) and `PANELS_TO_NEXT_SPEED` (§6.5) — copy verbatim.

**Per frame (60 Hz fixed step), for a single local stack:**
1. Read keyboard → 6 booleans `{raise, swap, up, down, left, right}` (swap & raise edge-triggered; directions held).
2. `stack.run()`:
   - `setupInput` → `controls(booleans)` (sets `swapThisFrame`, `cursorDirection`, `manual_raise`, updates `cur_timer`).
   - If countdown not done: `runCountdown()` (no physics).
   - Else `runPhysics()`:
     - decrement invincibility timers (shake/pre_stop/stop)
     - `advancePassiveRaise` (rise or decrement health if topped)
     - refill health if not topped
     - execute queued swap
     - `checkMatches` (award score: combo table + chain table; set panels matched)
     - `updatePanels` (each pop → +10 score; drive fall/hover FSMs)
     - `checkGameOver` → if `health <= 0 && shake_time <= 0`: game over
   - `applyCursorDirection` (DAS-gated move; immediate on frame 0, then 20-frame delay, then 1/frame)
   - queue swap if `swapThisFrame` (executes next frame; max one swap per 2 frames)
   - `handleManualRaise` (raise button; +1 score on completion)
   - `clock++`

**Scoring formula per match event:**
- For each panel that pops: `+10`.
- If `comboSize > 3`: `+ SCORE_COMBO_TA[min(30, comboSize)]`.
- If `chain_counter > 1`: `+ SCORE_CHAIN_TA[chain_counter > 13 ? 0 : chain_counter]`.
- On manual-raise row completion: `+1`.
- Clamp total to `99999`.

**Game over:** `health <= 0` AND `shake_time <= 0`, where `health` decrements each frame the top row has a non-empty panel AND the stack would otherwise passively raise (not during stop_time / rise_lock), and refills to `maxHealth` the moment the top row clears.

**Exclude entirely:** Health.lua (§2.B), AttackEngine, GarbageQueue, RollbackBuffer, SimulatedStack, network/, server/, Match.lua's garbage routing & remote catch-up, InputCompression, TouchDataEncoding (optional), WigglePay (optional v049 feature).
