# Porting Spec: Panel Object, Match Detection & Clear Lifecycle

**Source:** `panel-attack/panel-game` (Lua) — `common/engine/Panel.lua`, `common/engine/checkMatches.lua`, `common/engine/Match.lua`, plus supporting `Stack.lua` and `LevelData.lua` / `LevelPresets.lua`.
**Target:** JavaScript (canvas) single-player panel game.

> **IMPORTANT structural note:** `Match.lua` is the **multi-stack match *manager*** (game instance orchestration: running stacks, routing garbage between players, win conditions, replay save/load, rollback netcode). It is **NOT** the "match-clear lifecycle." The actual match-clear lifecycle (FLASH→FACE→POP) lives in `checkMatches.lua` (Stack methods) and `Panel.lua` (`matchedState`/`poppingState`/`poppedState`). See §5. Sections of `Match.lua` that matter for a single-player port are minimal and are flagged in §8.

All frame counts assume **60 FPS** (`frames/60 × 1000 = ms`). Grid is `panels[row][col]`, **row 1 = bottom**, row 0 = off-screen spawning row (always `dimmed`). Panels are updated **bottom-to-top** (row 1 → N), which is load-bearing for chaining propagation (a panel inspects the panel *below* that was already updated this frame).

---

## Canonical frame constants (LevelPresets `modern[1]`, standard TA-like level 1)

These are the reference values. They are per-level and stored in `levelData.frameConstants`, copied onto each Panel as `panel.frameTimes`.

| Constant | Frames | ms (÷60×1000) | Meaning |
|----------|-------:|--------------:|---------|
| `HOVER` | 12 | 200 | Time a normal panel hovers above a gap before falling |
| `GARBAGE_HOVER` | 41 | 683 | Hover time for panels converted from garbage (**GARBAGE-ONLY**) |
| `FLASH` | 44 | 733 | Matched panel "flashing" phase (white flash) |
| `FACE` | 20 | 333 | Matched panel "distressed face" phase |
| `POP` | 9 | 150 | Per-panel stagger interval in the sequential pop |

```lua
-- LevelPresets.lua lines 8-26 (modern[1])
modern[1] :setStartingSpeed(1)
          ...
          :setHover(12)
          :setGarbageHover(41)   -- GARBAGE-ONLY; may be nil on non-garbage levels
          :setFlash(44)
          :setFace(20)
          :setPop(9)
```

They map onto `LevelData.frameConstants` and are validated non-nil except `GARBAGE_HOVER`:

```lua
-- LevelData.lua 307-314
elseif not data.frameConstants.HOVER or type(data.frameConstants.HOVER) ~= "number" then
  return false
-- GARBAGE_HOVER can be nil
elseif not data.frameConstants.FLASH or type(data.frameConstants.FLASH) ~= "number" then ...
```

---

## 1. PANEL OBJECT — every field

The constructor. `clear()` sets the defaults; `clear_flags()` resets the transient state fields. Both are quoted below.

```lua
-- Panel.lua 161-170 — CONSTRUCTOR
Panel = class(
function(p, row, column, id, frameTimes)
  clear(p, true, true)
  p.row = row
  p.column = column
  p.id = id
  p.frameTimes = frameTimes
end
)
```

```lua
-- Panel.lua 107-151 — clear() sets all defaults
local function clear(panel, clearChaining, clearColor)
  if clearColor then panel.color = 0 end          -- 0 = empty; 1-7 normal; 8 = [!]shock; 9 = garbage
  panel.timer = 0
  panel.initial_time = nil                         -- GARBAGE-ONLY
  panel.pop_time = nil                             -- GARBAGE-ONLY (garbage pop fx)
  panel.pop_index = nil                            -- GARBAGE-ONLY
  panel.x_offset = nil                             -- GARBAGE-ONLY
  panel.y_offset = nil                             -- GARBAGE-ONLY
  panel.width = nil                                -- GARBAGE-ONLY
  panel.height = nil                               -- GARBAGE-ONLY
  panel.metal = nil                                -- GARBAGE-ONLY (shock garbage)
  panel.shake_time = nil                           -- GARBAGE-ONLY
  panel.isGarbage = false
  clear_flags(panel, clearChaining)
end
```

```lua
-- Panel.lua 55-101 — clear_flags() resets transient state
local function clear_flags(panel, clearChaining)
  panel.state = "normal"
  panel.combo_index = nil       -- pop order index within the match (NON-GARBAGE)
  panel.combo_size = nil        -- size of the match (NON-GARBAGE)
  panel.isSwappingFromLeft = nil
  panel.dont_swap = nil         -- set true by Stack:swap to forbid re-swap
  panel.queuedHover = nil       -- panel above a swapping panel that should hover after
  if clearChaining then panel.chaining = nil end
  panel.fell_from_garbage = nil -- bounce anim timer after falling from garbage
  panel.stateChanged = false    -- 1-frame flag: did this panel's state change?
  panel.propagatesChaining = false  -- 1-frame flag: tells panel above to inherit chaining
  panel.matchAnyway = false     -- lets a hovering panel match on its first hover frame
end
```

**Full field inventory** (grouped; ✅ = port, 🗑️ = GARBAGE/multiplayer-only — exclude):

| Field | Type | Init | Meaning |
|-------|------|------|---------|
| `id` | int | ctor | unique id per stack ✅ |
| `row` | int | ctor | current grid row (1 = bottom) ✅ |
| `column` | int | ctor | current grid column ✅ |
| `frameTimes` | table | ctor | `{HOVER,GARBAGE_HOVER,FLASH,FACE,POP}` ✅ |
| `state` | string | `"normal"` | current state name (see §2) ✅ |
| `stateChanged` | bool | `false` | set true whenever state changes; read by panels above & by match scan; **reset at top of each `Panel:update`** ✅ |
| `color` | int | `0` | 0 empty, 1-7 normal, 8 shock, 9 garbage ✅ (8/9 may be excluded if no shock/garbage) |
| `timer` | int | `0` | remaining frames in current state ✅ |
| `matching` | bool\|int | `false` | 1-frame flag, set by `checkMatches`; non-false ⇒ panel is part of a match this frame; reset at top of `update` ✅ |
| `matchesMetal` | bool | `false` | 1-frame flag (garbage adjacency) 🗑️ |
| `matchesGarbage` | bool | `false` | 1-frame flag (garbage adjacency) 🗑️ |
| `propagatesFalling` | bool | `false` | makes panel above skip hover & fall immediately (set when garbage falls) — mostly 🗑️ but referenced in normal-fall path |
| `chaining` | bool? | `nil` | if true, this panel will form a chain link if matched now ✅ (core chain mechanic) |
| `propagatesChaining` | bool | `false` | 1-frame flag so panels above inherit chaining ✅ |
| `matchAnyway` | bool | `false` | lets a freshly-hovering panel be matchable for 1 frame ✅ |
| `combo_index` | int? | `nil` | pop-order index within the match (NON-GARBAGE) ✅ |
| `combo_size` | int? | `nil` | total panels in the match ✅ |
| `isSwappingFromLeft` | bool? | `nil` | direction of swap ✅ |
| `dont_swap` | bool? | `nil` | forbid swap (set by `Stack:swap`) ✅ |
| `queuedHover` | bool? | `nil` | panel above a swapping panel must hover after ✅ |
| `fell_from_garbage` | int? | `nil` | bounce anim timer (set to 12 on garbage→normal conversion) ✅ (visual only; set 12) |
| `isGarbage` | bool | `false` | 🗑️ |
| `garbageId` | int? | — | 🗑️ |
| `metal` | bool? | — | 🗑️ (shock garbage) |
| `x_offset`,`y_offset`,`width`,`height` | int? | — | 🗑️ garbage block geometry |
| `initial_time` | int? | — | 🗑️ garbage total match time |
| `pop_time` | int? | — | 🗑️ garbage pop fx timing |
| `pop_index` | int? | — | 🗑️ garbage pop order |
| `shake_time` | int? | — | 🗑️ garbage invincibility grant |
| `debug_tag` | string? | — | dev only 🗑️ |

Three override callbacks are declared but left as `error()` stubs to be implemented by a subclass/UI layer; the JS port should replace them with plain function hooks or events:

```lua
-- Panel.lua 863-873
function Panel:onPop()    error("Did not implement Panel:onPop()")    end
function Panel:onPopped() error("Did not implement Panel:onPopped()") end
function Panel:onLand()   error("Did not implement Panel:onLand()")   end
```

---

## 2. PANEL STATES — complete list & per-tick behaviour

States are declared as tables (`normalState`, `swappingState`, …) each exposing `update(panel, panels)` and `changeState(...)`. `Panel.update` is the dispatcher:

```lua
-- Panel.lua 747-780 — the per-tick dispatcher
function Panel.update(self, panels)
  -- reset all flags that only count for 1 frame
  self.stateChanged = false
  self.propagatesChaining = false
  self.propagatesFalling = false
  self.matching = false
  self.matchesMetal = false
  self.matchesGarbage = false

  if self.state == "normal" then normalState.update(self, panels)
  elseif self.state == "swapping" then swappingState.update(self, panels)
  elseif self.state == "matched" then matchedState.update(self, panels)
  elseif self.state == "popping" then poppingState.update(self, panels)
  elseif self.state == "popped" then poppedState.update(self, panels)
  elseif self.state == "hovering" then hoverState.update(self, panels)
  elseif self.state == "falling" then fallingState.update(self, panels)
  elseif self.state == "landing" then landingState.update(self, panels)
  elseif self.state == "dimmed" then dimmedState.update(self, panels)
  elseif self.state == "dead" then deadState.update(self, panels) end
end
```

**Complete state list (literal strings):** `normal`, `swapping`, `matched`, `popping`, `popped`, `hovering`, `falling`, `landing`, `dimmed`, `dead`.

### 2a. `normal` — idle; reacts to panel below
Enter: default; also the exit state of `landing`, finished swaps, etc.
Per-tick: if not garbage and `color != 0`, looks at the panel directly below and may enter hover, fall, or do nothing. (Garbage branch 🗑️.)

```lua
-- Panel.lua 301-360 (normal, non-garbage path shown)
normalState.update = function(panel, panels)
  -- ... garbage branch omitted (🗑️) ...
  if panel.color ~= 0 then
    local panelBelow = getPanelBelow(panel, panels)
    if panelBelow.stateChanged then
      if panelBelow.state == "hovering" then
        -- inherit hover time from panel below
        normalState.enterHoverState(panel, panelBelow, panelBelow.timer, panels)
      elseif panelBelow.color == 0 then
        if panelBelow.propagatesFalling then
          fall(panel, panels)                       -- skip hover, fall with garbage below
        elseif panelBelow.state == "normal" then
          normalState.enterHoverState(panel, panelBelow, panel.frameTimes.HOVER, panels)  -- fresh HOVER (12f/200ms)
        end
        -- else: panelBelow is swapping → wait
      elseif panelBelow.queuedHover == true
        and panelBelow.propagatesChaining
        and panelBelow.state == "swapping" then
        -- sum remaining swap times of swapping panels below + first hover panel's timer
        local hoverTime = panelBelow.timer
        local hoverPanel = getPanelBelow(panelBelow, panels)
        while hoverPanel and hoverPanel.state == "swapping" do
          hoverTime = hoverTime + hoverPanel.timer
          hoverPanel = getPanelBelow(hoverPanel, panels)
        end
        if hoverPanel.state == "hovering" then
          hoverTime = hoverTime + hoverPanel.timer
        else
          hoverTime = hoverTime + panel.frameTimes.HOVER
        end
        normalState.enterHoverState(panel, panelBelow, hoverTime, panels)
      end
    end
  end
end
```

`enterHoverState` (normal→hovering) — this is where `chaining` and `matchAnyway` propagate upward:

```lua
-- Panel.lua 366-398
normalState.enterHoverState = function(panel, panelBelow, hoverTime, panels)
  clear_flags(panel, false)
  panel.state = "hovering"
  if panelBelow.propagatesChaining then
    panel.propagatesChaining = true
    panel.chaining = true
    if panelBelow.color == 0 or panelBelow.matchAnyway then
      panel.matchAnyway = true      -- matchable for 1 frame right after entering hover
    else
      -- drill down past swapping/non-matchAnyway panels to find the real match source
      while panelBelow.state == "swapping"
      or (panelBelow.stateChanged and panelBelow.propagatesChaining and not panelBelow.matchAnyway and panelBelow.state == "hovering") do
        panelBelow = getPanelBelow(panelBelow, panels)
      end
      if panelBelow.propagatesChaining then
        panel.matchAnyway = panelBelow.color == 0 or panelBelow.matchAnyway
      end
    end
  end
  panel.timer = hoverTime
  panel.stateChanged = true
end
```

Exit: → `hovering` (via enterHoverState), or → `falling` (via `fall()`), or set to `swapping`/`matched`/`dead` by Stack routines.

### 2b. `swapping` — mid-swap countdown
Enter: `Panel.startSwap` sets `state="swapping"`, `timer=4` (4 frames = ~66ms), `isSwappingFromLeft`:

```lua
-- Panel.lua 785-798
function Panel.startSwap(self, isSwappingFromLeft)
  local chaining = self.chaining
  clear_flags(self)
  self.stateChanged = true
  self.state = "swapping"
  self.chaining = chaining          -- PRESERVE chaining across the swap
  self.timer = 4                    -- swap lasts 4 frames (~66ms)
  self.isSwappingFromLeft = isSwappingFromLeft
  if self.fell_from_garbage then self.fell_from_garbage = nil end
end
```

Per-tick: decrement timer; when it hits 0 → `changeState`; otherwise propagate chaining upward:

```lua
-- Panel.lua 402-409
swappingState.update = function(panel, panels)
  decrementTimer(panel)
  if panel.timer == 0 then swappingState.changeState(panel, panels)
  else swappingState.propagateChaining(panel, panels) end
end
```

Exit (`changeState`): if color==0 (air) → finish swap to normal. Else if the panel below is empty/hovering or `queuedHover` → enter hover; else → finish to normal:

```lua
-- Panel.lua 421-438
swappingState.changeState = function(panel, panels)
  local panelBelow = getPanelBelow(panel, panels)
  if panel.color == 0 then
    swappingStateFinishSwap(panel)
  else
    if panelBelow then
      if panelBelow.color == 0 or panelBelow.state == "hovering" or panel.queuedHover then
        swappingState.enterHoverState(panel, panelBelow)
      else swappingStateFinishSwap(panel) end
    else swappingStateFinishSwap(panel) end
  end
end
-- 412-417
local function swappingStateFinishSwap(panel)
  panel.state = "normal"
  panel.dont_swap = nil
  panel.isSwappingFromLeft = nil
  panel.stateChanged = true
end
```

`swappingState.enterHoverState` — swapping panels get **full HOVER** (not inherited) and `matchAnyway = panelBelow.matchAnyway`:

```lua
-- Panel.lua 456-473
swappingState.enterHoverState = function(panel, panelBelow)
  clear_flags(panel, false)
  panel.state = "hovering"
  panel.propagatesChaining = panelBelow.propagatesChaining
  if panelBelow.color ~= 0 and panelBelow.state == "hovering" then
    panel.matchAnyway = panelBelow.matchAnyway
  else panel.matchAnyway = false end
  panel.timer = panel.frameTimes.HOVER       -- always 12f/200ms
  panel.stateChanged = true
end
```

### 2c. `matched` — FLASH+FACE phase (the panel is part of a clearing match)
Enter: `Panel:match(isChainLink, comboIndex, comboSize)` sets `state="matched"`, `timer = FLASH + FACE + 1` (the `+1` because match is applied before timer decrements this frame), `chaining=true` if chain link:

```lua
-- Panel.lua 849-861
function Panel:match(isChainLink, comboIndex, comboSize)
  self.state = "matched"
  self:setTimer(self.frameTimes.FLASH + self.frameTimes.FACE + 1)   -- 44+20+1 = 65f (~1083ms)
  if isChainLink then self.chaining = true end
  if self.fell_from_garbage then self.fell_from_garbage = nil end
  self.combo_index = comboIndex
  self.combo_size = comboSize
end
```

Per-tick: decrement; at `timer==0` → `popping` (with pop stagger timer = `combo_index * POP`):

```lua
-- Panel.lua 477-508
matchedState.update = function(panel, panels)
  decrementTimer(panel)
  if panel.isGarbage and panel.timer == panel.pop_time then panel:onPop() end   -- 🗑️ garbage
  if panel.timer == 0 then matchedState.changeState(panel, panels) end
end

matchedState.changeState = function(panel, panels)
  if panel.isGarbage then ... end                -- 🗑️ garbage branch (492-508)
  -- non-garbage:
  panel.state = "popping"
  panel.timer = panel.combo_index * panel.frameTimes.POP   -- stagger: index*9f
  panel.stateChanged = true
end
```

So a panel spends `FLASH+FACE` (64f ≈ 1066ms) in `matched`, then enters `popping` with a staggered delay `combo_index * POP`.

### 2d. `popping` — waiting for this panel's turn to pop
Enter: from `matched`. Per-tick: decrement; at 0 → `changeState` (which fires `onPop`, then either → `popped` or skips straight to removed if it's the last panel):

```lua
-- Panel.lua 530-549
poppingState.update = function(panel, panels)
  decrementTimer(panel)
  if panel.timer == 0 then poppingState.changeState(panel, panels) end
end

poppingState.changeState = function(panel, panels)
  panel:onPop()                                          -- UI hook (pop FX)
  if panel.combo_size == panel.combo_index then
    poppedState.changeState(panel, panels)               -- last panel skips "popped"
  else
    panel.state = "popped"
    panel.timer = (panel.combo_size - panel.combo_index) * panel.frameTimes.POP
    panel.stateChanged = true
  end
end
```

### 2e. `popped` — already popped, waiting to vanish
Per-tick: decrement; at 0 → remove permanently (`clear(color)`, set `propagatesChaining=true` so panels above chain):

```lua
-- Panel.lua 553-570
poppedState.update = function(panel, panels)
  decrementTimer(panel)
  if panel.timer == 0 then poppedState.changeState(panel, panels) end
end

poppedState.changeState = function(panel, panels)
  panel:onPopped()                       -- UI hook
  clear(panel, true, true)               -- color=0, state="normal", clears chaining
  panel.propagatesChaining = true        -- tell panels above to chain
  panel.stateChanged = true
end
```

### 2f. `hovering` — sitting above a gap, counting down before falling
Per-tick: decrement; clear `matchAnyway` after one frame; count down `fell_from_garbage`. At 0 → either match panel-below's hover timer, land (if supported), or fall:

```lua
-- Panel.lua 574-608
hoverState.update = function(panel, panels)
  decrementTimer(panel)
  if panel.matchAnyway then panel.matchAnyway = false end
  if panel.timer == 0 then hoverState.changeState(panel, panels) end
  if not panel.stateChanged and panel.fell_from_garbage then
    panel.fell_from_garbage = panel.fell_from_garbage - 1
  end
end

hoverState.changeState = function(panel, panels)
  local panelBelow = getPanelBelow(panel, panels)
  if panelBelow then
    if panelBelow.state == "hovering" then
      panel.timer = panelBelow.timer          -- sync with hover below
    elseif panelBelow.color ~= 0 then
      land(panel)                             -- supported → land
    else
      fall(panel, panels)                     -- gap below → fall
    end
  else error("Hovering panel in row 1 detected, commencing self-destruction sequence") end
end
```

### 2g. `falling` — moving down
Per-tick: if row 1 → land; if supported below → land (or enter hover if below is hovering); else `fall()` again:

```lua
-- Panel.lua 612-650
fallingState.update = function(panel, panels)
  if panel.row == 1 then land(panel)
  elseif supportedFromBelow(panel, panels) then
    if panel.isGarbage then land(panel)       -- 🗑️
    else
      local panelBelow = getPanelBelow(panel, panels)
      if panelBelow.state == "hovering" then fallingState.enterHoverState(panel, panelBelow)
      else land(panel) end
    end
  else fall(panel, panels) end
  if not panel.stateChanged and panel.fell_from_garbage then
    panel.fell_from_garbage = panel.fell_from_garbage - 1
  end
end

fallingState.enterHoverState = function(panel, panelBelow)
  clear_flags(panel, false)
  panel.state = "hovering"
  panel.stateChanged = true
  -- NOTE: don't add chaining since we didn't finish falling
  panel.propagatesChaining = panelBelow.propagatesChaining
  panel.timer = panelBelow.timer              -- inherit hover time
end
```

`fall()` switches the panel with the one below and sets `state="falling"`, `timer=0`:

```lua
-- Panel.lua 235-249
local function fall(panel, panels)
  local panelBelow = getPanelBelow(panel, panels)
  Panel.switch(panel, panelBelow, panels)
  if panel.isGarbage then panelBelow.propagatesFalling = true; panelBelow.stateChanged = true end  -- 🗑️
  if panel.state ~= "falling" then
    panel.state = "falling"
    panel.timer = 0
    panel.stateChanged = true
  end
end
```

`land()` → `landing` with `timer=12` (animation-only), fires `onLand`:

```lua
-- Panel.lua 253-267
local function land(panel)
  panel:onLand()
  if panel.isGarbage then panel.state = "normal"        -- 🗑️
  else
    if panel.fell_from_garbage then panel.fell_from_garbage = nil end
    panel.state = "landing"
    panel.timer = 12          -- ~200ms, animation-only
  end
  panel.stateChanged = true
end
```

### 2h. `landing` — squash animation after landing, then normal
Runs `normalState.update` FIRST (so it can still fall/hover), and only if that didn't change state, decrements its own timer:

```lua
-- Panel.lua 654-669
landingState.update = function(panel, panels)
  normalState.update(panel, panels)
  if not panel.stateChanged then
    decrementTimer(panel)
    if panel.timer == 0 then landingState.changeState(panel) end
  end
end
landingState.changeState = function(panel)
  panel.state = "normal"
  panel.stateChanged = true
end
```

### 2i. `dimmed` — row 0 off-screen spawning row
Mostly handled by Stack new-row logic; panel-side: once `row >= 1` → normal.

```lua
-- Panel.lua 675-685
dimmedState.update = function(panel, panels)
  if panel.row >= 1 then dimmedState.changeState(panel) end
end
dimmedState.changeState = function(panel)
  panel.state = "normal"; panel.stateChanged = true
end
```

### 2j. `dead` — terminal
```lua
-- Panel.lua 687-689
deadState.update = function(panel, panels) -- dead is dead end
```

### Swap-allowance predicate (used by `Stack.canSwap`)
```lua
-- Panel.lua 695-714
function Panel.allowsSwap(self)
  if self.dont_swap then return false
  elseif self.isGarbage then return false           -- 🗑️
  else
    if self.state == "normal" or self.state == "swapping"
    or self.state == "falling" or self.state == "landing" then return true
    else return false end   -- matched/popping/popped/hovering/dimmed/dead
  end
end
```
→ A panel may be swapped only in `normal`, `swapping`, `falling`, `landing`. Hovering/matched/popping/popped panels cannot be swapped.

---

## 3. SWAP MECHANICS

**Two-stage:** input on frame N is **queued** (`tryQueueSwap`); it executes at the **start of frame N+1's `runPhysics`** via `Stack:swap`. This 1-frame latency is intentional.

### 3a. Queueing (`Stack:run`, controller path; touch queues inside `controls`)
```lua
-- Stack.lua 807-811 (controller)
if self.inputMethod == "controller" and self.swapThisFrame then
  local leftPanel  = self.panels[self.cur_row][self.cur_col]
  local rightPanel = self.panels[self.cur_row][self.cur_col + 1]
  self:tryQueueSwap(leftPanel, rightPanel)
end
```
```lua
-- Stack.lua 1219-1233
function Stack:tryQueueSwap(panel1, panel2)
  local canSwap, healthCost = self:canSwap(panel1, panel2)
  if canSwap then
    WigglePay.registerSwap(self, panel1, panel2, healthCost or 0)   -- 🗑️ health/wiggle system (drop for port, or simplify)
    self.swapCount = self.swapCount + 1
    self.queuedSwapColumn = math.min(panel1.column, panel2.column)  -- by convention the left col
    self.queuedSwapRow = panel1.row
    return true
  else self:emitSignal("swapDenied"); return false end
end
```
**Rate limit:** swaps are allowed at most every other frame — a second swap attempt while one is already queued is denied:
```lua
-- Stack.lua 684-691
if self.swapThisFrame and self:swapQueued() then
  -- swapping is allowed at most every second frame
  self.swapThisFrame = false
  self:emitSignal("swapDenied")
end
```

### 3b. `canSwap` — when a swap is legal (exclude garbage/health branches for port)
```lua
-- Stack.lua 1239-1298
function Stack:canSwap(panel1, panel2)
  if math.abs(panel1.column - panel2.column) ~= 1 or panel1.row ~= panel2.row then return false
  elseif self.do_countdown or self.clock <= 1 then return false          -- no swap during countdown / frame 1
  elseif self.stackOverConditions[...SWAPS] and ... <= self.swapCount then return false   -- move-puzzle limit
  elseif panel1.color == 0 and panel2.color == 0 then return false       -- can't swap two empty
  elseif not panel1:allowsSwap() or not panel2:allowsSwap() then return false
  local row = panel1.row
  local panelAbove1, panelAbove2
  if row < self.height then
    panelAbove1 = self.panels[row + 1][panel1.column]
    panelAbove2 = self.panels[row + 1][panel2.column]
    if panelAbove1.state == "hovering" or panelAbove2.state == "hovering" then return false end  -- no swap if either-above hovering
  end
  -- extra "air under panel" anti-glitch rules when either cursor panel is air:
  if panel1.color == 0 or panel2.color == 0 then
    if panelAbove1 and panelAbove2
    and (panelAbove1.state == "swapping" and panelAbove2.state == "swapping")
    and (panelAbove1.color == 0 or panelAbove2.color == 0) and (panelAbove1.color ~= 0 or panelAbove2.color ~= 0) then
      return false
    end
    if row > 1 then
      local panelBelow1 = self.panels[row - 1][panel1.column]
      local panelBelow2 = self.panels[row - 1][panel2.column]
      if (panelBelow1.state == "swapping" and panelBelow2.state == "swapping")
      and (panelBelow1.color == 0 or panelBelow2.color == 0) and (panelBelow1.color ~= 0 or panelBelow2.color ~= 0) then
        return false
      end
    end
  end
  if self.behaviours.swapStallingMode == 1 then return WigglePay.canSwap(self, panel1, panel2) end  -- 🗑️
  return true
end
```

### 3c. `Stack:swap` — the actual swap (visual + grid happen together here)
Both panels get `startSwap` (timer=4), then `Panel.switch` swaps their `row/column` and the grid array entries **immediately** (the 4-frame timer is purely the *animation* window; logically they're swapped on frame 1). Then `dont_swap` is set to forbid pulling a panel back over a gap/falling panel:

```lua
-- Stack.lua 1301-1336
function Stack:swap(row, col)
  local panels = self.panels
  local leftPanel  = panels[row][col]
  local rightPanel = panels[row][col + 1]
  leftPanel:startSwap(true)           -- isSwappingFromLeft = true
  rightPanel:startSwap(false)
  Panel.switch(leftPanel, rightPanel, panels)
  leftPanel, rightPanel = rightPanel, leftPanel   -- now leftPanel == the originally-right one

  self:emitSignal("panelsSwapped")

  -- swapping a real panel onto a gap/falling slot locks it (can't swap back)
  if row ~= 1 then
    if (leftPanel.color ~= 0) and (panels[row - 1][col].color == 0 or panels[row - 1][col].state == "falling") then
      leftPanel.dont_swap = true
    end
    if (rightPanel.color ~= 0) and (panels[row - 1][col + 1].color == 0 or panels[row - 1][col + 1].state == "falling") then
      rightPanel.dont_swap = true
    end
  end
  -- swapping a blank under a panel locks it (panel should start falling)
  if row ~= self.height then
    if leftPanel.color == 0 and panels[row + 1][col].color ~= 0 then leftPanel.dont_swap = true end
    if rightPanel.color == 0 and panels[row + 1][col + 1].color ~= 0 then rightPanel.dont_swap = true end
  end
end
```

`Panel.switch` (used by both swap and fall):
```lua
-- Panel.lua 806-827
function Panel.switch(panel1, panel2, panels)
  assert(panel1.id == panels[panel1.row][panel1.column].id)
  assert(panel2.id == panels[panel2.row][panel2.column].id)
  assert(math.abs((panel1.row - panel2.row) + (panel1.column - panel2.column)) == 1)  -- adjacent
  local p1row, p1col = panel1.row, panel1.column
  panel1.row, panel1.column = panel2.row, panel2.column
  panel2.row, panel2.column = p1row, p1col
  panels[panel2.row][panel2.column] = panel2
  panels[panel1.row][panel1.column] = panel1
end
```

**Re-swap / mid-swap logic:** a panel already in `swapping` is still `allowsSwap()==true`, so it CAN be re-swapped (subject to the every-other-frame queue limit). `chaining` is explicitly preserved across `startSwap` (line 790). When a swap finishes (`swappingState.changeState`), if the cell below is now empty/hovering the panel enters `hovering` with full HOVER instead of returning to `normal`.

---

## 4. MATCH DETECTION (`checkMatches.lua`)

### 4a. `canMatch` — eligibility for matching
```lua
-- checkMatches.lua 95-109
local function canMatch(panel)
  if panel.color == 0 or panel.color == 9 then return false     -- empty or garbage can't match
  else
    if panel.state == "normal" or panel.state == "landing"
    or (panel.matchAnyway and panel.state == "hovering") then return true
    else return false end   -- swapping/matched/popping/popped/hover(plain)/falling/dimmed/dead
  end
end
```
→ Matchable: `normal`, `landing`, or a `hovering` panel with `matchAnyway==true`. Everything else is unmatchable.

### 4b. The active detection algorithm — `Stack:getMatchingPanels`
Scans only panels whose `stateChanged` is true this frame (optimization: only panels that changed can newly match). For each candidate, walks up/down/left/right while the neighbor has the **same color** and `canMatch`. If either the vertical run or horizontal run has ≥2 neighbors (i.e. run length ≥3 including the candidate), all those panels are flagged `matching=true` and added to the result. Intersecting runs (L/T/+) merge naturally because a panel already flagged `matching` is just skipped (no duplicate), but it still participates in other runs.

```lua
-- checkMatches.lua 312-403
function Stack:getMatchingPanels()
  table.clear(candidatePanels)
  local matchingPanels = {}
  local panels = self.panels

  for row = 1, self.height do
    for col = 1, self.width do
      local panel = panels[row][col]
      if panel.stateChanged and canMatch(panel) then
        candidatePanels[#candidatePanels + 1] = panel
      end
    end
  end

  local panel
  for _, candidatePanel in ipairs(candidatePanels) do
    -- below
    for row = candidatePanel.row - 1, 1, -1 do
      panel = panels[row][candidatePanel.column]
      if panel.color == candidatePanel.color and canMatch(panel) then verticallyConnected[#verticallyConnected + 1] = panel
      else break end
    end
    -- above
    for row = candidatePanel.row + 1, self.height do
      panel = panels[row][candidatePanel.column]
      if panel.color == candidatePanel.color and canMatch(panel) then verticallyConnected[#verticallyConnected + 1] = panel
      else break end
    end
    -- left
    for column = candidatePanel.column - 1, 1, -1 do
      panel = panels[candidatePanel.row][column]
      if panel.color == candidatePanel.color and canMatch(panel) then horizontallyConnected[#horizontallyConnected + 1] = panel
      else break end
    end
    -- right
    for column = candidatePanel.column + 1, self.width do
      panel = panels[candidatePanel.row][column]
      if panel.color == candidatePanel.color and canMatch(panel) then horizontallyConnected[#horizontallyConnected + 1] = panel
      else break end
    end

    if (#verticallyConnected >= 2 or #horizontallyConnected >= 2) and not candidatePanel.matching then
      matchingPanels[#matchingPanels + 1] = candidatePanel
      candidatePanel.matching = true
    end
    if #verticallyConnected >= 2 then
      for j = 1, #verticallyConnected do
        if not verticallyConnected[j].matching then
          verticallyConnected[j].matching = true
          matchingPanels[#matchingPanels + 1] = verticallyConnected[j]
        end
      end
    end
    if #horizontallyConnected >= 2 then
      for j = 1, #horizontallyConnected do
        if not horizontallyConnected[j].matching then
          horizontallyConnected[j].matching = true
          matchingPanels[#matchingPanels + 1] = horizontallyConnected[j]
        end
      end
    end
    table.clear(verticallyConnected)
    table.clear(horizontallyConnected)
  end

  -- hovering panels that match can NEVER chain
  for i = 1, #matchingPanels do
    if matchingPanels[i].state == "hovering" then
      matchingPanels[i].chaining = nil
    end
  end

  return matchingPanels
end
```
**Key rule (line 396-399):** any matched panel that is currently `hovering` has its `chaining` flag **cleared** — a match involving a hovering panel is never a chain link.

### 4c. `Stack:checkMatches` — orchestration (non-garbage essentials)
```lua
-- checkMatches.lua 111-153
function Stack:checkMatches()
  local matchingPanels = self:getMatchingPanels()
  local comboSize = #matchingPanels

  if comboSize > 0 then
    local frameConstants = self.levelData.frameConstants
    local metalCount = getMetalCount(matchingPanels)                 -- 🗑️ (shock)
    local isChainLink = isNewChainLink(matchingPanels)               -- any panel.chaining == true
    if isChainLink then self:incrementChainCounter() end
    self.manual_raise = false
    self.rise_lock = true

    local attackGfxOrigin = self:applyMatchToPanels(matchingPanels, isChainLink, comboSize)
    -- 🗑️ garbage block: getConnectedGarbagePanels2 + matchGarbagePanels (lines 129-137) — EXCLUDE
    local preStopTime = frameConstants.FLASH + frameConstants.FACE + frameConstants.POP * comboSize
    self.pre_stop_time = math.max(self.pre_stop_time, preStopTime)
    self:awardStopTime(isChainLink, comboSize)
    self:emitSignal("matched", self, attackGfxOrigin, isChainLink, comboSize, metalCount, 0)
    -- 🗑️ pushGarbage (multiplayer attack) — line 144-146 — EXCLUDE for single-player
    self:updateScoreWithBonus(comboSize)
  end

  self:clearChainingFlags()      -- strips chaining from eligible-but-unmatched panels
end
```
Note: in the full code `preStopTime` includes `+ garbagePanelCountOnScreen`; for a no-garbage port it's just `FLASH + FACE + POP*comboSize`.

`isNewChainLink` (a match is a chain link iff ANY matched panel has `chaining==true`):
```lua
-- checkMatches.lua 73-81
local function isNewChainLink(matchingPanels)
  for _, panel in ipairs(matchingPanels) do
    if panel.chaining then return true end
  end
  return false
end
```

### 4d. `applyMatchToPanels` — assign pop order & call `Panel:match`
```lua
-- checkMatches.lua 39-61 + 413-423
local function sortByPopOrder(panelList, isGarbage)
  table.sort(panelList, function(a, b)
    if a.row == b.row then
      if isGarbage then return a.column > b.column   -- garbage: right→left 🗑️
      else return a.column < b.column end            -- matches: LEFT→RIGHT
    else
      if isGarbage then return a.row < b.row         -- garbage: bottom→top 🗑️
      else return a.row > b.row end                  -- matches: TOP→BOTTOM
    end
  end)
  return panelList
end

function Stack:applyMatchToPanels(matchingPanels, isChain, comboSize)
  matchingPanels = sortByPopOrder(matchingPanels, false)   -- sort: top→bottom, left→right
  for i = 1, comboSize do
    matchingPanels[i]:match(isChain, i, comboSize)         -- combo_index = i (1-based)
  end
  local firstCellToPop = {row = matchingPanels[1].row, column = matchingPanels[1].column}
  return firstCellToPop
end
```
**Pop order = `combo_index`:** panels are sorted **top-row first, then left-to-right within a row**, and assigned index 1..N. Index 1 pops first.

### 4e. `clearChainingFlags` — strip stale chain flags at end of frame
```lua
-- checkMatches.lua 873-894
function Stack:clearChainingFlags()
  for row = 1, math.min(#self.panels, self.height + 2) do
    for column = 1, self.width do
      local panel = self.panels[row][column]
      -- if a chaining panel wasn't matched but was eligible, remove its chain flag
      if not panel.matching and panel.chaining and not panel.matchAnyway
         and (canMatch(panel) or panel.color == 9) then
        if row > 1 then
          if self.panels[row - 1][column].state ~= "swapping" then panel.chaining = nil end
        else panel.chaining = nil end
      end
    end
  end
end
```
→ A panel keeps `chaining` only if it sits above a swapping panel (the chain is "in flight" through a swap). Otherwise an unmatched eligible chaining panel loses the flag (chain opportunity expires).

---

## 5. MATCH-CLEAR LIFECYCLE (frame-by-frame)

This is the temporal sequence from "match detected" to "panels gone". Constants reference a 3-panel example: FLASH=44, FACE=20, POP=9.

**Phase timeline for a single panel with `combo_index = i`, `combo_size = N`:**

| Elapsed (frames from match) | State | timer value | What happens |
|---:|---|---:|---|
| 0 | → `matched` | `FLASH+FACE+1` = 65 | `Panel:match` sets it; FLASH phase begins (white flash art) |
| 0..43 | `matched` (FLASH) | 65→22 | decrement each tick |
| 44..63 | `matched` (FACE) | 21→2 | "distressed face" art; still `matched` |
| 64 | `matched` | 1 | |
| 65 | → `popping` | `i*POP` = `i*9` | `matchedState.changeState`: staggered by index |
| 65..65+i*9-1 | `popping` | i*9→1 | waits its turn |
| 65+i*9 | → fires `onPop`; if `i==N` skip to removed, else → `popped` | `(N-i)*POP` | |
| … | `popped` | …→1 | already gone visually |
| end | → `poppedState.changeState` | — | `clear(color)`, `propagatesChaining=true` |

**Verified by `matchedState.changeState`** (Panel.lua 505-507): `timer = combo_index * POP`.
**Verified by `poppingState.changeState`** (545-547): `timer = (combo_size - combo_index) * POP`.
**Last panel** (`combo_index == combo_size`) skips `popped` entirely (542-543) → straight to removal.

The core quoted blocks (matchedState, poppingState, poppedState) are in §2c–2e. The `Panel:match` entry is in §2c.

**Pop ordering recap:** panels pop in ascending `combo_index` order, which is **top-to-bottom, then left-to-right** (from `sortByPopOrder` §4d). Within one match the pops are evenly staggered by `POP` (9f = 150ms) each. The whole clear takes, end-to-end, `FLASH + FACE + POP*comboSize` frames (= `pre_stop_time` used in `Stack:checkMatches`). For a 3-match at level-1 constants that's `44+20+9*3 = 91` frames ≈ 1517ms.

---

## 6. GRAVITY, HOVER & FALLING

**When a panel starts HOVERING vs falling immediately** is decided in `normalState.update` (§2a) and `hoverState.changeState` (§2f):

- A `normal` panel whose panel-below just became empty **and is itself `normal`** → enters `hovering` with full `HOVER` (12f/200ms).
- If the empty panel below has `propagatesFalling==true` (set when garbage fell out beneath) → falls **immediately**, no hover (🗑️ garbage-driven; keep the field/branch if you support garbage, else drop).
- If the panel below is `hovering` → inherit its remaining timer.
- Special "queued hover through swapping panels" path sums remaining swap timers + HOVER (§2a, lines 326-351).

`hoverState.changeState` (§2f) at timer 0: if below is hovering → sync timers; if below is solid (`color != 0`) → `land()`; if below is empty → `fall()`.

**Landing:** `land()` (§2g) sets `state="landing"`, `timer=12` (animation), calls `onLand`. `landingState` (§2h) first runs `normalState.update` (so a freshly-landed panel can immediately re-hover/fall if supported conditions changed) and only counts its own timer if no state change occurred → eventually back to `normal`.

**Re-triggering matches / chain on landing:** a landed panel is in `landing` state, which is `canMatch==true`. On the frame its `stateChanged` flips, `getMatchingPanels` will consider it. The chain linkage is carried by the `chaining` flag that was set when the panel *entered hover after a pop* (see §7), not by landing itself.

`supportedFromBelow` (simplified non-garbage branch):
```lua
-- Panel.lua 201-230 (non-garbage path)
local function supportedFromBelow(panel, panels)
  if panel.row <= 1 then return true end
  if panel.isGarbage then ... end   -- 🗑️ garbage width-check
  return panels[panel.row - 1][panel.column].color ~= 0
end
```

---

## 7. CHAIN DETECTION

A **chain** = a match where at least one matched panel has `chaining == true`. `chaining` is set true when a panel enters `hovering` because the panel below it propagated chaining — i.e. it is falling/hovering as a *consequence of a previous clear*.

### 7a. How `chaining` gets set
- `normalState.enterHoverState` (§2a): if `panelBelow.propagatesChaining` → `panel.chaining = true; panel.propagatesChaining = true`.
- `Panel:match` (§2c): if the match is a chain link (`isChainLink`) → `self.chaining = true`.
- `poppedState.changeState` (§2e): after a panel vanishes it sets `propagatesChaining = true`, so the panel directly above (detected next tick via `normalState.enterHoverState`) inherits chaining → that panel's subsequent match is a chain link.
- `matchedState.enterHoverState` (garbage→normal conversion, 🗑️) sets `chaining=true`.

### 7b. Chain counter on the Stack
```lua
-- checkMatches.lua 405-411
function Stack:incrementChainCounter()
  if self.chain_counter ~= 0 then self.chain_counter = self.chain_counter + 1
  else self.chain_counter = 2 end          -- first chain link sets it to 2 (the base match is "1")
end
```
So `chain_counter`: 0 = no chain; 2 = first chain link; 3 = second; … It is incremented **inside `checkMatches`** only when `isChainLink` is true (i.e. a chaining panel participated in the match).

### 7c. When a chain ENDS
At the end of `runPhysics`, if the chain counter is non-zero but no chaining panels remain, it resets to 0:

```lua
-- Stack.lua 978-986
if self.chain_counter ~= 0 and not self:hasChainingPanels() then
  self.chain_counter = 0
  if self.outgoingGarbage then
    self.outgoingGarbage:finalizeCurrentChain(self.stopWatch)   -- 🗑️ multiplayer
  end
end
```
```lua
-- Stack.lua 1556-1563
function Stack:hasChainingPanels()
  for row = 1, #self.panels do
    for col = 1, self.width do
      local panel = self.panels[row][col]
      if panel.chaining and panel.color ~= 0 then return true end
    end
  end
  -- (returns false at end)
end
```
And `clearChainingFlags` (§4e) strips `chaining` from eligible panels that did **not** get matched this frame (unless they're above a swapping panel). Together: a chain continues only while at least one `chaining` panel still exists on the board; the moment all chain panels have cleared/matched-out without producing new chaining panels, the counter resets.

---

## 8. GARBAGE / MULTIPLAYER-ONLY — EXCLUDE LIST (for a single-player no-garbage port)

Everything below is **garbage-block or multiplayer** specific. A faithful single-player panel-clearing port can **omit** all of it. Listed exhaustively so the porter knows exactly what to drop.

### 8a. Panel fields to drop
`isGarbage`, `garbageId`, `metal`, `x_offset`, `y_offset`, `width`, `height`, `initial_time`, `pop_time`, `pop_index`, `shake_time`, `matchesMetal`, `matchesGarbage`. Also `frameTimes.GARBAGE_HOVER` (may simply be undefined).

### 8b. Panel states / branches to drop
- All `if panel.isGarbage then … end` branches inside `normalState.update`, `fall()`, `land()`, `fallingState.update`, `supportedFromBelow`, `matchedState.changeState`, `matchedState.enterHoverState` (the garbage→normal conversion at Panel.lua 492-526), `Panel.allowsSwap`, `Panel.dangerous`.
- `matchedState.update` line 480-484 (`if panel.isGarbage and panel.timer == panel.pop_time then panel:onPop() end`).

### 8c. checkMatches.lua to drop
- `getMetalCount` (shock `[!]` count) and the `metalCount` usage.
- The entire garbage match pipeline: `getConnectedGarbagePanels2` (lines 457-592), `getConnectedGarbagePanels` (deprecated, 598-713), `matchOnContact`, the `AABBGarbage` logic, `matchGarbagePanels` (715-733), `convertGarbagePanels` (736-754).
- In `Stack:checkMatches`: the `garbagePanels` block (129-137) and the `garbagePanelCountOnScreen` term in `preStopTime` (use `FLASH+FACE+POP*comboSize`).
- `getOnScreenCount` (used only for garbage).
- `pushGarbage` (756-792) — this is the **outgoing attack generator** for VS mode. Drop entirely for single-player. (The `COMBO_GARBAGE` table and `SCORE_CHAIN_TA`/`SCORE_COMBO_*` tables are score/attack data; keep score tables if you want TA scoring, drop attack tables.)
- `self:pushGarbageTo`, `garbageTargets`/`garbageSources`, `outgoingGarbage`, `incomingGarbage`, `highestGarbageIdMatched` — all multiplayer/garbage plumbing.

### 8d. Match.lua (the multi-stack manager) — almost entirely multiplayer/rollback
**`Match.lua` does NOT contain the clear lifecycle.** It is the game-instance manager: it owns `stacks[]`, routes garbage between them (`garbageTargets`/`garbageSources`), runs the per-frame loop (`Match:run`), implements **netcode rollback** (`rollbackToFrame`, `rollbackToStopWatch`, `shouldSaveRollback`, `isIrrecoverablyDesynced`, `debugCheckDivergence`), win-condition resolution (`getWinners`, `hasEnded`), replay save/load (`createNewReplay`, `createFromReplay`), and countdown/time-limit handling.

**For a single-player canvas port you can replace `Match.lua` with a thin game loop that owns ONE stack.** The only concept worth borrowing is the **per-frame ordering** of `Stack:run` + `runPhysics` (see §9). Everything else — garbage routing, rollback, win conditions across multiple stacks, replay, `SimulatedStack` (the AI attack engine) — is out of scope.

### 8e. Other files with garbage/multiplayer code (not in the 3 requested, listed for awareness)
`Stack.lua` contains: `dropGarbage`, `tryDropGarbage`, `shouldDropGarbage`, `getGarbageSpawnColumn`, garbage shake/invincibility (`decrementInvincibilityTimers`, `shake_time`), `hasFallingGarbage`, `WigglePay` (health/swap-stalling), passive-raise game-over, `top_cur_row`/displacement rising mechanics, countdown. The rising/countdown mechanics are **single-player relevant** (keep); the garbage-drop and WigglePay pieces are **not** (drop).

---

## 9. BONUS: per-frame execution order (essential for a correct port)

`Stack:run()` (one game tick) order, from `Stack.lua` 756-828 + `runPhysics` 932-1000:

```
Stack:run()                                   # once per frame
 ├─ setupInput() → controls()                 # parse input; touch may queue swap here
 ├─ (countdown phase if applicable)
 ├─ if stopWatchIsRunning: runPhysics()       # ← core simulation
 │    ├─ wasToppedOut = isToppedOut()
 │    ├─ decrementInvincibilityTimers()       # shake/pre_stop/stop timers
 │    ├─ updateRiseLock(); updateSpeed()
 │    ├─ advancePassiveRaise()  (may setGameOver)
 │    ├─ health reset (if not topped out & no falling garbage)
 │    ├─ top_cur_row adjust
 │    ├─ if swapQueued: swap(row,col)         # ★ swap queued LAST frame executes NOW
 │    ├─ checkMatches()                       # ★ match detection (sets matched panels)
 │    ├─ updatePanels()                       # ★ per-panel update, row 1→N (BOTTOM→TOP)
 │    ├─ updateActivePanelCount()
 │    ├─ if chain_counter!=0 and !hasChainingPanels: chain_counter=0   # chain ends
 │    ├─ processStagedGarbage()               # 🗑️
 │    ├─ removeExtraRows()
 │    └─ checkGameWin()/checkGameOver()
 ├─ applyCursorDirection()
 ├─ if controller & swapThisFrame: tryQueueSwap()   # ★ queue swap for NEXT frame
 ├─ handleManualRaise()
 ├─ if stopWatchIsRunning: shouldDropGarbage/tryDropGarbage; stopWatch++   # 🗑️ garbage part
 └─ clock++
```

**Critical ordering facts for the port:**
1. **Swap input is 1 frame latent**: queued in `run()` (after physics), executed at the *top* of next frame's `runPhysics`.
2. **Order within physics: `swap` → `checkMatches` → `updatePanels`**. So a just-executed swap is immediately match-tested the same frame, and panels update *after* matches are applied.
3. **`updatePanels` iterates row 1→N (bottom→top)** because chaining propagation reads the panel *below* which must already have been updated this tick.
4. **`Panel.update` resets the 1-frame flags (`stateChanged`, `propagatesChaining`, `propagatesFalling`, `matching`, etc.) at its very top** — so `stateChanged` set during `checkMatches`/`swap` (before `updatePanels`) is visible to the panel's own update and to panels above, then cleared.

---

## 10. Suggested JS port shape (quick map)

- `Panel` → class with the ✅ fields from §1; a `state` string; methods `update(panels)`, `startSwap`, `switch`, `match`, `allowsSwap`, `clear/clearFlags`. Replace `onPop/onPopped/onLand` with event emissions.
- Implement 10 state handler objects (`normalState` … `deadState`) each with `update(panel, panels)` and `changeState`/`enterHoverState` as quoted. A dispatch `switch(state)` in `update`.
- `frameTimes` → `{ HOVER:12, FLASH:44, FACE:20, POP:9 }` (drop `GARBAGE_HOVER` unless you add garbage later).
- `Stack` → owns `panels[row][col]` (row 0 reserved/spawn), `chain_counter`, `clock`, `stopWatch`. Methods: `runPhysics`, `checkMatches`, `getMatchingPanels`, `applyMatchToPanels`, `canSwap`, `tryQueueSwap`, `swap`, `updatePanels`, `hasChainingPanels`, `clearChainingFlags`.
- Drop entirely: §8 garbage/multiplayer/rollback/WigglePay. Keep: rising/countdown/speed-up if you want a full TA-like endless mode (those are in `Stack.lua`, not the 3 requested files).
- Use a fixed-step 60 Hz update loop; render interpolation is separate from simulation.

— End of spec. Every quoted block is verbatim from the Lua source. All frame counts → ms: HOVER 200, GARBAGE_HOVER 683 (🗑️), FLASH 733, FACE 333, POP 150, swap 4≈66, landing 12=200, fell_from_garbage 12=200.
