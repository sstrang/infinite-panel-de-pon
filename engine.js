"use strict";
/* ======================================================================
   INFINITE PANEL DE PON
   A faithful single-player port of the panel-attack / panel-game engine
   (https://github.com/panel-attack/panel-game).

   ENGINE MODEL (from source):
     - Pure fixed-60Hz DISCRETE-frame simulation. One Stack.run() == one
       game tick. All timers are frame counts, decremented by 1 per tick.
     - Frame execution order inside runPhysics is load-bearing:
         swap  ->  checkMatches  ->  updatePanels  (row 1..N, bottom->top)
     - Swap input is 1-frame latent: queued in run(), executes at the top
       of next frame's runPhysics.
     - Multiplayer, garbage blocks, shock panels, rollback and replays are
       EXCLUDED (single-player endless only).

   SOURCE REFERENCES (verbatim logic): Panel.lua, Stack.lua, checkMatches.lua,
   consts.lua, LevelPresets.lua, PanelGenerator.lua, GeneratorSource.lua.
   ====================================================================== */


/* ----------------------------------------------------------------------
   1. CONSTANTS  (consts.lua + Stack.lua locals)
   ---------------------------------------------------------------------- */

// consts.lua 57-68: SPEED_TO_RISE_TIME = map({942,983,...}, x=>x/16).
// Index 0 == speed 1. rise_timer (frames per 1/16-row of displacement) = raw/16.
const SPEED_TO_RISE_TIME_RAW = [
  942, 983, 838, 790, 755, 695, 649, 604, 570, 515,
  474, 444, 394, 370, 347, 325, 306, 289, 271, 256,
  240, 227, 213, 201, 189, 178, 169, 158, 148, 138,
  129, 120, 112, 105,  99,  92,  86,  82,  77,  73,
   69,  66,  62,  59,  56,  54,  52,  50,  48,  47,
   47,  47,  47,  47,  47,  47,  47,  47,  47,  47,
   47,  47,  47,  47,  47,  47,  47,  47,  47,  47,
   47,  47,  47,  47,  47,  47,  47,  47,  47,  47,
   47,  47,  47,  47,  47,  47,  47,  47,  47,  47,
   47,  47,  47,  47,  47,  47,  47,  47,  47
]; // 99 entries; speeds >= 50 all give 47.
function riseTimeForSpeed(speed) {
  const i = Math.min(Math.max(speed, 1), 99) - 1;
  return SPEED_TO_RISE_TIME_RAW[i] / 16;
}

// Stack.lua 55-65: panels cleared to advance one speed level (classic mode).
// Index 0 == speed 1. Entry for speed 100 (index 99) = Infinity.
const PANELS_TO_NEXT_SPEED = [
   9,  12,  12,  12,  12,  12,  15,  15,  18,  18,
  24,  24,  24,  24,  24,  24,  21,  18,  18,  18,
  36,  36,  36,  36,  36,  36,  36,  36,  36,  36,
  39,  39,  39,  39,  39,  39,  39,  39,  39,  39,
  45,  45,  45,  45,  45,  45,  45,  45,  45,  45,
  45,  45,  45,  45,  45,  45,  45,  45,  45,  45,
  45,  45,  45,  45,  45,  45,  45,  45,  45,  45,
  45,  45,  45,  45,  45,  45,  45,  45,  45,  45,
  45,  45,  45,  45,  45,  45,  45,  45,  45,  45,
  45,  45,  45,  45,  45,  45,  45,  45,  45, Infinity
];
function panelsForSpeed(speed) {
  return PANELS_TO_NEXT_SPEED[Math.min(Math.max(speed, 1), 100) - 1];
}

const DT_SPEED_INCREASE = 15 * 60;        // Stack.lua 49: 900 frames per speed-up (modern time mode)
const DEFAULT_INPUT_REPEAT_DELAY = 20;    // Stack.lua 40: cursor DAS
const SCORE_CAP = 99999;                  // Stack.lua 1755-1758

// Score tables (checkMatches.lua 13-22). The Lua tables are 1-indexed, so a
// leading 0 is prepended on port: JS index == comboSize (combo) / chain_counter
// (chain). Verified against common/data/LevelPresets.lua + checkMatches.lua.
const SCORE_COMBO_TA = [ 0,   0,   0,   0,  20,   // index == comboSize (4 -> 20)
                         30,  50,  60,  70,  80,
                        100, 140, 170, 210, 250,
                        290, 340, 390, 440, 490,
                        550, 610, 680, 750, 820,
                        900, 980,1060,1150,1240,
                       1330];                       // index 30 (cap) = 1330
const SCORE_CHAIN_TA = [  0,   0,  50,  80, 150,   // index == chain_counter (2 -> 50)
                        300, 400, 500, 700, 900,
                       1100,1300,1500,1800];        // index 13 = 1800

// Mode flags for speed increase (LevelData.SPEED_INCREASE_MODES)
const SPEED_TIME = 1;        // modern: every DT_SPEED_INCREASE frames
const SPEED_PANEL_COUNT = 2; // classic: every N panels cleared

// Stop-time formulas (LevelData.STOP_FORMULAS)
const STOP_MODERN = 1;
const STOP_CLASSIC = 2;


/* ----------------------------------------------------------------------
   2. LEVEL PRESETS  (LevelPresets.lua, verbatim values)
   ---------------------------------------------------------------------- */

function makePreset(o) {
  return {
    startingSpeed: o.startingSpeed,
    speedIncreaseMode: o.speedIncreaseMode,
    colorCount: o.colorCount,
    stopFormula: o.stopFormula,
    adjacentDenial: o.adjacentDenial,
    stop: {
      comboConstant: o.stopCombo,
      chainConstant: o.stopChain,
      dangerConstant: o.stopDanger,
      coefficient: o.stopCoeff,
      dangerCoefficient: o.stopDangerCoeff,
    },
    frame: { HOVER: o.hover, FLASH: o.flash, FACE: o.face, POP: o.pop },
    shockFrequency: o.shockFrequency || 999999, // shock disabled in single-player
    shockCap: o.shockCap || 0,
  };
}

// LevelPresets.lua 8-228: modern[1..11]
const MODERN_PRESETS = [
  // 1
  makePreset({startingSpeed:1,  speedIncreaseMode:SPEED_TIME, colorCount:5, stopFormula:STOP_MODERN,
    adjacentDenial:0,    stopCombo:-20, stopChain:80, stopDanger:160, stopCoeff:20, stopDangerCoeff:20,
    hover:12, flash:44, face:20, pop:9}),
  // 2
  makePreset({startingSpeed:5,  speedIncreaseMode:SPEED_TIME, colorCount:5, stopFormula:STOP_MODERN,
    adjacentDenial:1/7,  stopCombo:-16, stopChain:77, stopDanger:152, stopCoeff:18, stopDangerCoeff:18,
    hover:12, flash:44, face:18, pop:9}),
  // 3
  makePreset({startingSpeed:9,  speedIncreaseMode:SPEED_TIME, colorCount:5,  stopFormula:STOP_MODERN,
    adjacentDenial:2/7,  stopCombo:-12, stopChain:74, stopDanger:144, stopCoeff:16, stopDangerCoeff:16,
    hover:11, flash:42, face:17, pop:8}),
  // 4
  makePreset({startingSpeed:13, speedIncreaseMode:SPEED_TIME, colorCount:5,  stopFormula:STOP_MODERN,
    adjacentDenial:3/7,  stopCombo:-8,  stopChain:71, stopDanger:136, stopCoeff:14, stopDangerCoeff:14,
    hover:10, flash:42, face:16, pop:8}),
  // 5
  makePreset({startingSpeed:17, speedIncreaseMode:SPEED_TIME, colorCount:5,  stopFormula:STOP_MODERN,
    adjacentDenial:4/7,  stopCombo:-3,  stopChain:68, stopDanger:128, stopCoeff:12, stopDangerCoeff:12,
    hover:9,  flash:38, face:15, pop:8}),
  // 6
  makePreset({startingSpeed:21, speedIncreaseMode:SPEED_TIME, colorCount:5,  stopFormula:STOP_MODERN,
    adjacentDenial:5/7,  stopCombo:2,   stopChain:65, stopDanger:120, stopCoeff:10, stopDangerCoeff:10,
    hover:6,  flash:36, face:14, pop:8}),
  // 7
  makePreset({startingSpeed:25, speedIncreaseMode:SPEED_TIME, colorCount:5,  stopFormula:STOP_MODERN,
    adjacentDenial:6/7,  stopCombo:7,   stopChain:62, stopDanger:112, stopCoeff:8,  stopDangerCoeff:8,
    hover:5,  flash:34, face:13, pop:8}),
  // 8
  makePreset({startingSpeed:29, speedIncreaseMode:SPEED_TIME, colorCount:5,  stopFormula:STOP_MODERN,
    adjacentDenial:1,    stopCombo:12,  stopChain:60, stopDanger:104, stopCoeff:6,  stopDangerCoeff:6,
    hover:4,  flash:32, face:12, pop:7}),
  // 9
  makePreset({startingSpeed:27, speedIncreaseMode:SPEED_TIME, colorCount:6,  stopFormula:STOP_MODERN,
    adjacentDenial:1,    stopCombo:17,  stopChain:58, stopDanger:96,  stopCoeff:4,  stopDangerCoeff:4,
    hover:6,  flash:30, face:11, pop:7}),
  // 10
  makePreset({startingSpeed:32, speedIncreaseMode:SPEED_TIME, colorCount:6,   stopFormula:STOP_MODERN,
    adjacentDenial:1,    stopCombo:22,  stopChain:56, stopDanger:88,  stopCoeff:2,  stopDangerCoeff:2,
    hover:6,  flash:28, face:10, pop:7}),
  // 11
  makePreset({startingSpeed:45, speedIncreaseMode:SPEED_TIME, colorCount:6,   stopFormula:STOP_MODERN,
    adjacentDenial:1,    stopCombo:27,  stopChain:53, stopDanger:80,  stopCoeff:1,  stopDangerCoeff:0,
    hover:3,  flash:22, face:8,  pop:6}),
];

// LevelPresets.lua 331-348: classicEndless (deepcopy of classic, easy modified)
const CLASSIC_ENDLESS_PRESETS = {
  'classic-easy': makePreset({startingSpeed:1, speedIncreaseMode:SPEED_PANEL_COUNT, colorCount:5, stopFormula:STOP_CLASSIC,
    adjacentDenial:0, stopCombo:120, stopChain:300, stopDanger:600, stopCoeff:0, stopDangerCoeff:0,
    hover:12, flash:44, face:17, pop:9}),
  'classic-normal': makePreset({startingSpeed:1, speedIncreaseMode:SPEED_PANEL_COUNT, colorCount:6, stopFormula:STOP_CLASSIC,
    adjacentDenial:1, stopCombo:120, stopChain:180, stopDanger:420, stopCoeff:0, stopDangerCoeff:0,
    hover:9, flash:36, face:13, pop:8}),
  'classic-hard': makePreset({startingSpeed:1, speedIncreaseMode:SPEED_PANEL_COUNT, colorCount:6, stopFormula:STOP_CLASSIC,
    adjacentDenial:1, stopCombo:120, stopChain:120, stopDanger:240, stopCoeff:0, stopDangerCoeff:0,
    hover:6, flash:22, face:15, pop:7}),
  'classic-ex': makePreset({startingSpeed:1, speedIncreaseMode:SPEED_PANEL_COUNT, colorCount:6, stopFormula:STOP_CLASSIC,
    adjacentDenial:1, stopCombo:90, stopChain:90, stopDanger:180, stopCoeff:0, stopDangerCoeff:0,
    hover:3, flash:16, face:10, pop:6}),
};


/* ----------------------------------------------------------------------
   3. PANEL GENERATOR  (PanelGenerator.lua + GeneratorSource.lua)
   ---------------------------------------------------------------------- */

// PanelGenerator.lua 55-114: generate one row of width `width` using
// `ncolors` colors, avoiding immediate matches with the row below and
// 3-in-a-row horizontally. adjacentDenial: 0 = allow adjacent same colors,
// 1 = forbid (always reroll). Returns Int array length `width` (0-indexed cols).
function generateRow(width, ncolors, prevRow, adjacentDenial, rng) {
  const row = new Array(width).fill(0);
  const below = prevRow || new Array(width).fill(0);
  let adjacentAccepted = 0, adjacentDenied = 0;
  for (let n = 0; n < width; n++) {
    const prevTwoMatch = n > 1 && row[n - 1] === row[n - 2];
    let color = 0, nogood = true;
    while (nogood) {
      color = 1 + Math.floor(rng() * ncolors); // 1..ncolors
      const belowColor = below[n];
      if (color === belowColor) {
        nogood = true;                       // can't match the panel below
      } else if (prevTwoMatch && color === row[n - 1]) {
        nogood = true;                       // can't make three in a row
      } else if (n > 0 && color === row[n - 1]) {
        // adjacent-same: honor adjacentDenialFrequency
        if (adjacentDenial >= 1) {
          nogood = true;
        } else if (adjacentDenial === 0) {
          nogood = false;
        } else {
          const denom = adjacentAccepted + adjacentDenied;
          const freq = denom === 0 ? NaN : adjacentDenied / denom;
          if (!(freq <= adjacentDenial)) {   // NaN<=x is false -> first double accepted
            adjacentAccepted++; nogood = false;
          } else {
            adjacentDenied++; nogood = true;
          }
        }
      } else {
        nogood = false;
      }
    }
    row[n] = color;
  }
  return row;
}

// mulberry32 PRNG (deterministic, seedable) — stands in for love.math RNG.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}


/* ----------------------------------------------------------------------
   4. PANEL  (Panel.lua)  — the 10-state machine
   ---------------------------------------------------------------------- */

class Panel {
  constructor(row, column, id, frameTimes) {
    this._clear(true, true);
    this.row = row;
    this.column = column;
    this.id = id;
    this.frameTimes = frameTimes;
  }

  // Panel.lua 55-101
  _clearFlags(clearChaining) {
    this.state = 'normal';
    this.combo_index = null;
    this.combo_size = null;
    this.isSwappingFromLeft = null;
    this.dont_swap = null;
    this.queuedHover = null;
    if (clearChaining) this.chaining = null;
    this.fell_from_garbage = null;
    this.stateChanged = false;
    this.propagatesChaining = false;
    this.propagatesFalling = false;
    this.matchAnyway = false;
  }

  // Panel.lua 107-151 (garbage fields omitted)
  _clear(clearChaining, clearColor) {
    if (clearColor) this.color = 0;
    this.timer = 0;
    this.matching = false;
    this._clearFlags(clearChaining);
  }

  // Panel.lua 747-779 — dispatch
  update(panels) {
    // reset 1-frame flags BEFORE state logic (stateChanged set during swap/
    // checkMatches this frame is consumed here for match culling next frame)
    this.stateChanged = false;
    this.propagatesChaining = false;
    this.propagatesFalling = false;
    this.matching = false;
    switch (this.state) {
      case 'normal':   this._normalUpdate(panels); break;
      case 'swapping': this._swappingUpdate(panels); break;
      case 'matched':  this._matchedUpdate(panels); break;
      case 'popping':  this._poppingUpdate(panels); break;
      case 'popped':   this._poppedUpdate(panels); break;
      case 'hovering': this._hoverUpdate(panels); break;
      case 'falling':  this._fallingUpdate(panels); break;
      case 'landing':  this._landingUpdate(panels); break;
      case 'dimmed':   this._dimmedUpdate(panels); break;
      case 'dead':     break;
    }
  }

  // ---- helpers (module-private, kept as methods for `this`) ----
  _dec() { if (this.timer > 0) this.timer--; }

  // Panel.lua 301-360
  _normalUpdate(panels) {
    if (this.color === 0) return;
    const below = getPanelBelow(this, panels);
    if (!below || !below.stateChanged) return;
    if (below.state === 'hovering') {
      this._normalEnterHover(below, below.timer, panels);
    } else if (below.color === 0) {
      if (below.propagatesFalling) {
        fall(this, panels);                 // (garbage-driven; inert without garbage)
      } else if (below.state === 'normal') {
        this._normalEnterHover(below, this.frameTimes.HOVER, panels);
      }
      // else: below is swapping -> wait
    } else if (below.queuedHover === true && below.propagatesChaining && below.state === 'swapping') {
      // queued hover through swapping panels: sum swap timers + hover below
      let hoverTime = below.timer;
      let hp = getPanelBelow(below, panels);
      while (hp && hp.state === 'swapping') { hoverTime += hp.timer; hp = getPanelBelow(hp, panels); }
      if (hp && hp.state === 'hovering') hoverTime += hp.timer;
      else hoverTime += this.frameTimes.HOVER;
      this._normalEnterHover(below, hoverTime, panels);
    }
  }

  // Panel.lua 366-398
  _normalEnterHover(below, hoverTime, panels) {
    this._clearFlags(false);
    this.state = 'hovering';
    if (below.propagatesChaining) {
      this.propagatesChaining = true;
      this.chaining = true;
      if (below.color === 0 || below.matchAnyway) {
        this.matchAnyway = true;
      } else {
        let p = below;
        while (p && (p.state === 'swapping' ||
                     (p.stateChanged && p.propagatesChaining && !p.matchAnyway && p.state === 'hovering'))) {
          p = getPanelBelow(p, panels);
        }
        if (p && p.propagatesChaining) this.matchAnyway = (p.color === 0 || p.matchAnyway);
      }
    }
    this.timer = hoverTime;
    this.stateChanged = true;
  }

  // Panel.lua 402-473
  _swappingUpdate(panels) {
    this._dec();
    if (this.timer === 0) this._swappingChangeState(panels);
    else this._swappingPropagateChaining(panels);
  }
  _swappingFinish() {
    this.state = 'normal'; this.dont_swap = null; this.isSwappingFromLeft = null; this.stateChanged = true;
  }
  _swappingChangeState(panels) {
    const below = getPanelBelow(this, panels);
    if (this.color === 0) { this._swappingFinish(); return; }
    if (below && (below.color === 0 || below.state === 'hovering' || this.queuedHover)) {
      this._swappingEnterHover(below);
    } else {
      this._swappingFinish();
    }
  }
  _swappingPropagateChaining(panels) {
    const below = getPanelBelow(this, panels);
    if (below && below.stateChanged && below.propagatesChaining) {
      this.queuedHover = (this.color !== 0);
      this.stateChanged = true;
      this.propagatesChaining = true;
    }
  }
  _swappingEnterHover(below) {
    this._clearFlags(false);
    this.state = 'hovering';
    this.propagatesChaining = below.propagatesChaining;
    if (below.color !== 0 && below.state === 'hovering') this.matchAnyway = below.matchAnyway;
    else this.matchAnyway = false;
    this.timer = this.frameTimes.HOVER;
    this.stateChanged = true;
  }

  // Panel.lua 477-509
  _matchedUpdate() {
    this._dec();
    if (this.timer === 0) this._matchedChangeState();
  }
  _matchedChangeState() {
    this.state = 'popping';
    this.timer = this.combo_index * this.frameTimes.POP;   // stagger by pop order
    this.stateChanged = true;
  }

  // Panel.lua 530-549
  _poppingUpdate() {
    this._dec();
    if (this.timer === 0) this._poppingChangeState();
  }
  _poppingChangeState() {
    this._onPop();                                         // +10 score, count (Stack hook)
    if (this.combo_size === this.combo_index) {
      this._poppedChangeState();                           // last panel skips 'popped'
    } else {
      this.state = 'popped';
      this.timer = (this.combo_size - this.combo_index) * this.frameTimes.POP;
      this.stateChanged = true;
    }
  }

  // Panel.lua 553-570
  _poppedUpdate() {
    this._dec();
    if (this.timer === 0) this._poppedChangeState();
  }
  _poppedChangeState() {
    this._onPopped();                                      // speedup counter (Stack hook)
    this._clear(true, true);                               // color=0, state=normal, clears chaining
    this.propagatesChaining = true;                        // tell panels above to chain
    this.stateChanged = true;
  }

  // Panel.lua 574-608
  _hoverUpdate() {
    this._dec();
    if (this.matchAnyway) this.matchAnyway = false;        // survives exactly one frame
    if (this.timer === 0) this._hoverChangeState(this._panels);
  }
  _hoverChangeState(panels) {
    const below = getPanelBelow(this, panels);
    if (below) {
      if (below.state === 'hovering') {
        this.timer = below.timer;                          // sync with hover below
      } else if (below.color !== 0) {
        land(this);                                        // supported -> land
      } else {
        fall(this, panels);                                // gap below -> fall
      }
    }
  }

  // Panel.lua 612-650
  _fallingUpdate(panels) {
    if (this.row === 0) { land(this); }
    else if (supportedFromBelow(this, panels)) {
      const below = getPanelBelow(this, panels);
      if (below.state === 'hovering') this._fallingEnterHover(below);
      else land(this);
    } else {
      fall(this, panels);
    }
  }
  _fallingEnterHover(below) {
    this._clearFlags(false);
    this.state = 'hovering';
    this.stateChanged = true;
    this.propagatesChaining = below.propagatesChaining;
    this.timer = below.timer;
  }

  // Panel.lua 654-669
  _landingUpdate(panels) {
    this._normalUpdate(panels);                            // can still fall/hover immediately
    if (!this.stateChanged) {
      this._dec();
      if (this.timer === 0) { this.state = 'normal'; this.stateChanged = true; }
    }
  }

  // Panel.lua 675-685
  _dimmedUpdate() {
    if (this.row >= 1) { this.state = 'normal'; this.stateChanged = true; }
  }

  // Panel.lua 849-861
  match(isChainLink, comboIndex, comboSize) {
    this.state = 'matched';
    this.timer = this.frameTimes.FLASH + this.frameTimes.FACE + 1; // +1: match applied before decrement
    if (isChainLink) this.chaining = true;
    this.combo_index = comboIndex;
    this.combo_size = comboSize;
  }

  // Panel.lua 785-798
  startSwap(isSwappingFromLeft) {
    const chaining = this.chaining;
    this._clearFlags(false);
    this.stateChanged = true;
    this.state = 'swapping';
    this.chaining = chaining;
    this.timer = 4;
    this.isSwappingFromLeft = isSwappingFromLeft;
  }

  // Panel.lua 806-827
  static switch(p1, p2, panels) {
    const r1 = p1.row, c1 = p1.column;
    p1.row = p2.row; p1.column = p2.column;
    p2.row = r1;      p2.column = c1;
    panels[p2.row][p2.column] = p2;
    panels[p1.row][p1.column] = p1;
  }

  // Panel.lua 695-714
  allowsSwap() {
    if (this.dont_swap) return false;
    return this.state === 'normal' || this.state === 'swapping' ||
           this.state === 'falling' || this.state === 'landing';
  }

  // Panel.lua 832-838 (non-garbage branch)
  dangerous() { return this.color !== 0; }
}

// ---- module-private geometry helpers (Panel.lua 188-267) ----
function getPanelBelow(panel, panels) {
  if (panel.row - 1 < 0) return null;
  return panels[panel.row - 1][panel.column];
}
function supportedFromBelow(panel, panels) {
  if (panel.row <= 0) return true;
  return panels[panel.row - 1][panel.column].color !== 0;
}
function fall(panel, panels) {
  const below = getPanelBelow(panel, panels);
  if (!below) return;
  Panel.switch(panel, below, panels);
  if (panel.state !== 'falling') {
    panel.state = 'falling';
    panel.timer = 0;
    panel.stateChanged = true;
  }
}
function land(panel) {
  panel.state = 'landing';
  panel.timer = 12;                       // animation-only (~200ms)
  panel.stateChanged = true;
  if (panel._onLand) panel._onLand();
}


/* ----------------------------------------------------------------------
   5. STACK  (Stack.lua + checkMatches.lua)
   ---------------------------------------------------------------------- */

class Stack {
  constructor(opts) {
    opts = opts || {};
    this.width = opts.width || 6;
    this.height = opts.height || 12;
    this.levelData = opts.levelData;
    this.inputMethod = 'controller';
    this.behaviours = { allowManualRaise: true, passiveRaise: true };

    this.speed = this.levelData.startingSpeed;
    if (this.levelData.speedIncreaseMode === SPEED_TIME) {
      this.nextSpeedIncreaseClock = DT_SPEED_INCREASE;
    } else {
      this.panels_to_speedup = panelsForSpeed(this.speed);
    }
    this.frameTimes = this.levelData.frame;
    this.rng = opts.rng || mulberry32(opts.seed != null ? opts.seed : (Math.random() * 1e9 | 0));
    this.prevRowBuffer = null;            // last generated row, for match-free chaining

    this.max_runs_per_frame = 3;
    this.displacement = 16;
    this.wasToppedOut = false;
    this.rise_timer = riseTimeForSpeed(this.speed);
    this.rise_lock = false;
    this.has_risen = false;

    this.stop_time = 0;
    this.pre_stop_time = 0;
    this.shake_time = 0;

    this.score = 0;
    this.chain_counter = 0;
    this.max_chain = 0;
    this.max_combo = 0;
    this.chain_tally = {};
    this.combo_tally = {};
    this.panels_cleared = 0;

    this.n_active_panels = 0;
    this.n_prev_active_panels = 0;
    this.swappingPanelCount = 0;

    // input
    this.manual_raise = false;
    this.manual_raise_yet = false;
    this.prevent_manual_raise = false;
    this.swapThisFrame = false;
    this.cur_wait_time = DEFAULT_INPUT_REPEAT_DELAY;
    this.cur_timer = 0;
    this.cursorDirection = null;
    this.cursorLock = null;
    this.cur_row = opts.startingRow || 7;
    this.cur_col = opts.startingCol != null ? opts.startingCol : 3;
    // -1 is the "no swap queued" sentinel. (Lua uses 0, but column 0 / row 0
    // are valid indices in this 0-indexed port — 0 would collide.)
    this.queuedSwapColumn = -1;
    this.queuedSwapRow = -1;
    this.top_cur_row = this.height;
    this.swapCount = 0;

    this.clock = 0;
    this.stopWatch = 0;
    this.game_over = false;
    this.game_over_clock = 0;

    this.panelsCreatedCount = 0;
    this.panels = [];
    this._buildInitialPanels();
  }

  _newPanel(row, col) {
    const p = new Panel(row, col, ++this.panelsCreatedCount, this.frameTimes);
    p._onPop = () => this._onPop(p);
    p._onPopped = () => this._onPopped(p);
    p._panels = this.panels;              // hoverUpdate needs panels ref
    return p;
  }

  _buildInitialPanels() {
    // rows 0..height (row 0 = spawn buffer). columns 0..width-1
    for (let r = 0; r <= this.height; r++) {
      this.panels[r] = [];
      for (let c = 0; c < this.width; c++) this.panels[r][c] = this._newPanel(r, c);
    }
  }

  // GeneratorSource.lua 162-189 + Stack.lua 1498-1502
  createNewRow(row) {
    const colors = generateRow(this.width, this.levelData.colorCount, this.prevRowBuffer, this.levelData.adjacentDenial, this.rng);
    this.prevRowBuffer = colors;
    this.panels[row] = [];
    for (let c = 0; c < this.width; c++) {
      const p = this._newPanel(row, c);
      p.color = colors[c];
      p.state = 'dimmed';
      this.panels[row][c] = p;
    }
    return this.panels[row];
  }

  // Stack.lua 1416-1449
  new_row() {
    if (this.cur_row !== 0) this.cur_row = bound(1, this.cur_row + 1, this.top_cur_row);
    if (this.queuedSwapRow !== -1) this.queuedSwapRow++;

    const stackHeight = this.panels.length;     // == highest index + 1
    this.createNewRow(stackHeight);             // new dimmed row at the top

    // switch everything down by one (the new row cascades to row 0)
    for (let row = stackHeight; row >= 1; row--) {
      for (let col = this.width - 1; col >= 0; col--) {
        Panel.switch(this.panels[row][col], this.panels[row - 1][col], this.panels);
      }
    }
    // former row 0 is now row 1 and in play -> override dimmed
    for (let col = 0; col < this.width; col++) {
      this.panels[1][col].state = 'normal';
      this.panels[1][col].stateChanged = true;
    }
    this.displacement = 16;
  }

  // GeneratorSource.lua 44-72 + starting_state (Stack.lua 637-644)
  startingState(startingRows) {
    startingRows = startingRows || 7;
    for (let i = 0; i < startingRows + 1; i++) {
      this.new_row();
      if (this.cur_row > 0) this.cur_row--;
    }
    // jagged top: remove 2*width panels from the top of the starting stack
    this._jaggedTop(startingRows);
    this.cur_row = bound(1, Math.min(startingRows, this.height), this.top_cur_row);
  }

  _jaggedTop(startingRows) {
    // mirror GeneratorSource.generateStartingBoard's "remove 2*width topmost"
    let toRemove = 2 * this.width;
    while (toRemove > 0) {
      const col = Math.floor(this.rng() * this.width);
      // delete the topmost non-empty panel in this column within the starting stack
      for (let r = startingRows; r >= 1; r--) {
        if (this.panels[r][col].color !== 0) { this.panels[r][col].color = 0; break; }
      }
      toRemove--;
    }
  }

  // ---- main per-frame entry (Stack.lua 756-828) ----
  run() {
    if (this.game_over) return;
    this._controls();
    this._runPhysics();
    this.applyCursorDirection(this.cursorDirection);
    if (this.inputMethod === 'controller' && this.swapThisFrame) this.tryQueueSwap();
    this._handleManualRaise();
    this.clock++;
    if (!this.game_over) this.stopWatch++;
  }

  // Stack.lua 647-718 (controller branch, no touch)
  _controls() {
    // input_state is set externally each tick by the client; sample it here.
    const s = this.input_state || {};
    let newDir = null;
    if (s.swap) {
      this.swapThisFrame = true;
      if (this.swapQueued()) {             // at most every other frame
        this.swapThisFrame = false;
      }
    } else {
      this.swapThisFrame = false;
    }
    if (s.up) newDir = 'up';
    else if (s.down) newDir = 'down';
    else if (s.left) newDir = 'left';
    else if (s.right) newDir = 'right';

    if (newDir === this.cursorDirection) {
      if (this.cur_timer !== this.cur_wait_time) this.cur_timer++;
    } else {
      this.cursorDirection = newDir;
      this.cur_timer = 0;
    }
    this._raiseHeld = !!s.raise;
    if (s.raise && !this.prevent_manual_raise) {
      this.manual_raise = true;
      this.manual_raise_yet = false;
    }
  }

  // Stack.lua 932-1000
  _runPhysics() {
    this.wasToppedOut = this.isToppedOut();
    // decrement timers (invincibility/stop)
    if (this.stop_time > 0) this.stop_time--;
    if (this.pre_stop_time > 0) this.pre_stop_time--;
    if (this.shake_time > 0) this.shake_time--;

    this.updateRiseLock();
    this.updateSpeed();
    this.advancePassiveRaise();

    if (this.displacement % 16 !== 0) this.top_cur_row = this.height - 1;

    // execute the swap queued LAST frame
    if (this.swapQueued()) {
      this._swap(this.queuedSwapRow, this.queuedSwapColumn);
      this.queuedSwapColumn = -1;
      this.queuedSwapRow = -1;
    }

    this.checkMatches();
    this.updatePanels();
    this.updateActivePanelCount();

    // chain ends when no chaining panels remain — record final length
    if (this.chain_counter !== 0 && !this.hasChainingPanels()) {
      const len = this.chain_counter;
      this.chain_tally[len] = (this.chain_tally[len] || 0) + 1;
      this.chain_counter = 0;
    }

    this.removeExtraRows();
    // Game over: the instant any block reaches the top row. No health buffer.
    if (this.isToppedOut()) this.setGameOver();
  }

  // Stack.lua 859-866
  isToppedOut() {
    for (let col = 0; col < this.width; col++) {
      if (this.panels[this.height][col].dangerous()) return true;
    }
    return false;
  }

  // Stack.lua 1607-1623
  updateRiseLock() {
    const prev = this.rise_lock;
    if (this.swapQueued()) this.rise_lock = true;
    else if (this.shake_time > 0) this.rise_lock = true;
    else if (this.hasActivePanels()) this.rise_lock = true;
    else this.rise_lock = false;
    if (prev && !this.rise_lock) this.prevent_manual_raise = false;
  }

  // Stack.lua 1091-1106
  updateSpeed() {
    if (this.levelData.speedIncreaseMode === SPEED_TIME) {
      if (this.clock === this.nextSpeedIncreaseClock) {
        this.speed = Math.min(this.speed + 1, 99);
        this.nextSpeedIncreaseClock += DT_SPEED_INCREASE;
      }
    } else {
      if (this.panels_to_speedup <= 0) {
        this.speed = Math.min(this.speed + 1, 99);
        this.panels_to_speedup += panelsForSpeed(this.speed);
      }
    }
  }

  // Stack.lua 1108-1139
  advancePassiveRaise() {
    if (this.manual_raise) {
      if (this.displacement === 0 && this.has_risen) {
        this.top_cur_row = this.height;
        this.new_row();
      }
    } else {
      if (!this.rise_lock && this.stop_time === 0 && !this.isToppedOut()) {
        this.rise_timer--;
        if (this.rise_timer <= 0) {
          this.displacement--;
          if (this.displacement === 0) {
            this.prevent_manual_raise = false;
            this.top_cur_row = this.height;
            this.new_row();
          }
          this.rise_timer += riseTimeForSpeed(this.speed);
        }
      }
    }
  }

  // Stack.lua 1020-1061
  _handleManualRaise() {
    if (!(this.behaviours.allowManualRaise && this.manual_raise)) return;
    if (!this.rise_lock) {
      this.stop_time = 0;
      if (this.wasToppedOut) {
        // topped out: game over is handled in _runPhysics; manual raise does nothing
      } else {
        this.has_risen = true;
        this.displacement--;
        if (this.displacement === 1) {
          if (!this.prevent_manual_raise) this.addScore(1);
          this.manual_raise = false;
          this.rise_timer = 1;
          this.prevent_manual_raise = true;
        }
        this.manual_raise_yet = true;
      }
    } else if (!this.manual_raise_yet) {
      this.manual_raise = false;
    }
    // (falling-garbage interrupt branch omitted: no garbage)
  }

  // Stack.lua 1064-1089
  applyCursorDirection(direction) {
    if (direction && (this.cur_timer === 0 || this.cur_timer === this.cur_wait_time) && this.cursorLock == null) {
      this.moveCursorInDirection(direction);
    } else {
      this.cur_row = bound(1, this.cur_row, this.top_cur_row);
    }
    if (this.cur_timer !== this.cur_wait_time) this.cur_timer++;
  }
  moveCursorInDirection(direction) {
    const DR = { up: 1, down: -1, left: 0, right: 0 };
    const DC = { up: 0, down: 0, left: -1, right: 1 };
    this.cur_row = bound(1, this.cur_row + DR[direction], this.top_cur_row);
    this.cur_col = bound(0, this.cur_col + DC[direction], this.width - 2);
  }

  // ---- swap pipeline (Stack.lua 1219-1336) ----
  swapQueued() { return this.queuedSwapColumn !== -1 && this.queuedSwapRow !== -1; }
  tryQueueSwap() {
    const p1 = this.panels[this.cur_row][this.cur_col];
    const p2 = this.panels[this.cur_row][this.cur_col + 1];
    if (this.canSwap(p1, p2)) {
      this.swapCount++;
      this.queuedSwapColumn = Math.min(p1.column, p2.column);
      this.queuedSwapRow = p1.row;
      return true;
    }
    return false;
  }
  canSwap(p1, p2) {
    if (Math.abs(p1.column - p2.column) !== 1 || p1.row !== p2.row) return false;
    if (this.clock <= 1) return false;
    if (p1.color === 0 && p2.color === 0) return false;
    if (!p1.allowsSwap() || !p2.allowsSwap()) return false;
    const row = p1.row;
    if (row < this.height) {
      const a1 = this.panels[row + 1][p1.column];
      const a2 = this.panels[row + 1][p2.column];
      if (a1.state === 'hovering' || a2.state === 'hovering') return false;
    }
    // "air under panel" anti-glitch (Stack.lua 590-605)
    if (p1.color === 0 || p2.color === 0) {
      if (row < this.height) {
        const a1 = this.panels[row + 1][p1.column];
        const a2 = this.panels[row + 1][p2.column];
        if (a1.state === 'swapping' && a2.state === 'swapping' &&
            (a1.color === 0 || a2.color === 0) && (a1.color !== 0 || a2.color !== 0)) return false;
      }
      if (row > 0) {
        const b1 = this.panels[row - 1][p1.column];
        const b2 = this.panels[row - 1][p2.column];
        if (b1.state === 'swapping' && b2.state === 'swapping' &&
            (b1.color === 0 || b2.color === 0) && (b1.color !== 0 || b2.color !== 0)) return false;
      }
    }
    return true;
  }
  _swap(row, col) {
    const left = this.panels[row][col];
    const right = this.panels[row][col + 1];
    left.startSwap(true);
    right.startSwap(false);
    Panel.switch(left, right, this.panels);
    // now `left` variable refers to the originally-right panel object
    const L = this.panels[row][col], R = this.panels[row][col + 1];
    // lock swaps over gaps/falling (Stack.lua 628-640)
    if (row !== 0) {
      if (L.color !== 0 && (this.panels[row - 1][col].color === 0 || this.panels[row - 1][col].state === 'falling')) L.dont_swap = true;
      if (R.color !== 0 && (this.panels[row - 1][col + 1].color === 0 || this.panels[row - 1][col + 1].state === 'falling')) R.dont_swap = true;
    }
    if (row !== this.height) {
      if (L.color === 0 && this.panels[row + 1][col].color !== 0) L.dont_swap = true;
      if (R.color === 0 && this.panels[row + 1][col + 1].color !== 0) R.dont_swap = true;
    }
  }

  // ---- match detection (checkMatches.lua) ----
  // 95-109
  _canMatch(p) {
    if (p.color === 0) return false;
    return p.state === 'normal' || p.state === 'landing' ||
           (p.matchAnyway && p.state === 'hovering');
  }
  // 312-403
  getMatchingPanels() {
    const matching = [];
    const candidates = [];
    for (let row = 1; row < this.panels.length; row++) {
      for (let col = 0; col < this.width; col++) {
        const p = this.panels[row][col];
        if (p.stateChanged && this._canMatch(p)) candidates.push(p);
      }
    }
    for (const cand of candidates) {
      const vert = [], horiz = [];
      // below
      for (let r = cand.row - 1; r >= 0; r--) {
        const p = this.panels[r][cand.column];
        if (p.color === cand.color && this._canMatch(p)) vert.push(p); else break;
      }
      // above
      for (let r = cand.row + 1; r < this.panels.length; r++) {
        const p = this.panels[r][cand.column];
        if (p.color === cand.color && this._canMatch(p)) vert.push(p); else break;
      }
      // left
      for (let c = cand.column - 1; c >= 0; c--) {
        const p = this.panels[cand.row][c];
        if (p.color === cand.color && this._canMatch(p)) horiz.push(p); else break;
      }
      // right
      for (let c = cand.column + 1; c < this.width; c++) {
        const p = this.panels[cand.row][c];
        if (p.color === cand.color && this._canMatch(p)) horiz.push(p); else break;
      }

      if ((vert.length >= 2 || horiz.length >= 2) && !cand.matching) { cand.matching = true; matching.push(cand); }
      if (vert.length >= 2) for (const p of vert) if (!p.matching) { p.matching = true; matching.push(p); }
      if (horiz.length >= 2) for (const p of horiz) if (!p.matching) { p.matching = true; matching.push(p); }
    }
    // hovering matched panels can never chain (checkMatches.lua 396-399)
    for (const p of matching) if (p.state === 'hovering') p.chaining = null;
    return matching;
  }
  // 111-153
  checkMatches() {
    const matching = this.getMatchingPanels();
    const comboSize = matching.length;
    if (comboSize > 0) {
      this.combo_tally[comboSize] = (this.combo_tally[comboSize] || 0) + 1;
      if (comboSize > this.max_combo) this.max_combo = comboSize;
      const isChain = matching.some(p => p.chaining === true);
      if (isChain) this._incrementChainCounter();
      this.manual_raise = false;
      this.rise_lock = true;
      this._applyMatchToPanels(matching, isChain, comboSize);
      const preStop = this.frameTimes.FLASH + this.frameTimes.FACE + this.frameTimes.POP * comboSize;
      this.pre_stop_time = Math.max(this.pre_stop_time, preStop);
      this._awardStopTime(isChain, comboSize);
      this._updateScoreWithBonus(comboSize);
    }
    this._clearChainingFlags();
  }
  // 73-81
  // 405-411
  _incrementChainCounter() {
    if (this.chain_counter !== 0) this.chain_counter++;
    else this.chain_counter = 2;
    if (this.chain_counter > this.max_chain) this.max_chain = this.chain_counter;
  }
  // 39-61 + 413-423 (sort top->bottom, left->right; assign combo_index)
  _applyMatchToPanels(matching, isChain, comboSize) {
    matching.sort((a, b) => a.row === b.row ? a.column - b.column : b.row - a.row);
    for (let i = 0; i < comboSize; i++) matching[i].match(isChain, i + 1, comboSize);
  }
  // 795-830
  _awardStopTime(isChain, comboSize) {
    const stopTime = this._calculateStopTime(comboSize, this.wasToppedOut, isChain, this.chain_counter);
    if (stopTime > this.stop_time) this.stop_time = stopTime;
  }
  _calculateStopTime(comboSize, toppedOut, isChain, chainCounter) {
    let t = 0; const s = this.levelData.stop;
    if (comboSize > 3 || isChain) {
      if (toppedOut && isChain) {
        if (s.dangerCoefficient) { const len = chainCounter > 4 ? 6 : chainCounter; t = s.dangerConstant + (len - 1) * s.dangerCoefficient; }
        else t = s.dangerConstant;
      } else if (toppedOut) {
        t = s.coefficient * (comboSize < 9 ? 2 : 3) + s.chainConstant;
      } else if (isChain) {
        t = s.coefficient * Math.min(chainCounter, 13) + s.chainConstant;
      } else {
        t = s.coefficient * comboSize + s.comboConstant;
      }
    }
    return t;
  }
  // 841-871
  _updateScoreWithBonus(comboSize) {
    this._updateScoreWithChain();
    this._updateScoreWithCombo(comboSize);
  }
  _updateScoreWithCombo(comboSize) {
    if (comboSize > 3) this.addScore(SCORE_COMBO_TA[Math.min(30, comboSize)] || 0);
  }
  _updateScoreWithChain() {
    const cb = this.chain_counter;
    if (cb <= 1) return;                    // no chain bonus outside a chain link
    if (cb <= 13) this.addScore(SCORE_CHAIN_TA[cb]);
    else this.addScore(1800 * (cb - 12));   // infinite scaling past 13x (spec #1c)
  }
  // 873-894
  _clearChainingFlags() {
    const top = Math.min(this.panels.length, this.height + 2);
    for (let row = 0; row < top; row++) {
      for (let col = 0; col < this.width; col++) {
        const p = this.panels[row][col];
        if (!p.matching && p.chaining && !p.matchAnyway && (this._canMatch(p))) {
          if (row > 0) {
            if (this.panels[row - 1][col].state !== 'swapping') p.chaining = null;
          } else {
            p.chaining = null;
          }
        }
      }
    }
  }

  // Stack.lua 868-878
  updatePanels() {
    for (let row = 1; row < this.panels.length; row++) {
      for (let col = 0; col < this.width; col++) {
        this.panels[row][col].update(this.panels);
      }
    }
  }
  // Stack.lua 1570-1605
  updateActivePanelCount() {
    this.n_prev_active_panels = this.n_active_panels;
    let n = 0, swapping = 0;
    for (let row = 1; row < this.panels.length; row++) {
      for (let col = 0; col < this.width; col++) {
        const p = this.panels[row][col];
        const st = p.state;
        if (st === 'matched' || st === 'popping' || st === 'popped' ||
            st === 'hovering' || st === 'falling') n++;
        if (st === 'swapping') swapping++;
      }
    }
    this.n_active_panels = n;
    this.swappingPanelCount = swapping;
  }
  hasActivePanels() { return this.n_active_panels > 0 || this.n_prev_active_panels > 0; }
  hasChainingPanels() {
    for (let row = 0; row < this.panels.length; row++) {
      for (let col = 0; col < this.width; col++) {
        const p = this.panels[row][col];
        if (p.chaining && p.color !== 0) return true;
      }
    }
    return false;
  }
  // Stack.lua 1339-1350
  removeExtraRows() {
    for (let row = this.panels.length - 1; row >= this.height + 1; row--) {
      let any = false;
      for (let col = 0; col < this.width; col++) {
        if (this.panels[row][col].color !== 0) { any = true; break; }
      }
      if (any) return;
      this.panels.length = row;
    }
  }

  // ---- scoring hooks (Stack.lua 1505-1523, 1753-1759) ----
  _onPop(panel) {
    this.addScore(10);
    this.panels_cleared++;
  }
  _onPopped(panel) {
    if (this.panels_to_speedup != null) this.panels_to_speedup--;
  }
  addScore(v) {
    this.score += v;
  }

  // ---- game over (Stack.lua 1201-1207, 1639-1677) ----
  setGameOver() {
    if (!this.game_over) { this.game_over = true; this.game_over_clock = this.clock; }
  }
  checkGameOver() {
    if (this.game_over_clock > 0) return false;
    return this.isToppedOut();
  }

  game_ended() { return this.game_over; }
}

function bound(lo, v, hi) { return v < lo ? lo : (v > hi ? hi : v); }


/* ----------------------------------------------------------------------
   6. ENGINE EXPORT  (for Node testing — DOM code below is guarded)
   ---------------------------------------------------------------------- */

const ENGINE = {
  Panel, Stack, bound, getPanelBelow, supportedFromBelow, fall, land,
  riseTimeForSpeed, panelsForSpeed, generateRow, mulberry32,
  SPEED_TO_RISE_TIME_RAW, PANELS_TO_NEXT_SPEED, SCORE_COMBO_TA, SCORE_CHAIN_TA,
  DT_SPEED_INCREASE, DEFAULT_INPUT_REPEAT_DELAY, SCORE_CAP,
  SPEED_TIME, SPEED_PANEL_COUNT, STOP_MODERN, STOP_CLASSIC,
  MODERN_PRESETS, CLASSIC_ENDLESS_PRESETS, makePreset,
};
if (typeof module !== 'undefined' && module.exports) module.exports = ENGINE;
if (typeof globalThis !== 'undefined') globalThis.PDP_ENGINE = ENGINE;

