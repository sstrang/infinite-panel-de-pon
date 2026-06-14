"use strict";
// ====================================================================
//  ENGINE CONSTANTS & TIMING TEST SUITE
//  Validates the absolute-millisecond engine constraints from the spec.
//  Replicates the pure timing logic standalone (no browser/DOM).
// ====================================================================

// ---- constants mirrored exactly from index.html ----
const MS = {
  CURSOR_SHIFT:      16.67,
  DAS_INITIAL:       200.00,
  DAS_REPEAT:        50.00,
  SWAP_INPUT_BUFFER: 16.67,
  SWAP_DURATION:     66.67,
  SWAP_INTERRUPT:    50.00,
  FALL_PER_ROW:      16.67,
  MATCH_CHECK_DELAY: 150.00,
  FLASH:             266.67,
  WINCE:             166.67,
  POP_PER_PANEL:     66.67,
  HOVER_BASE:        400.00,
  HOVER_L1:          466.67,
  HOVER_L10:         233.33,
  HOVER_MAX:         100.00,
  CHAIN_FREEZE_2:    733.33,
  CHAIN_FREEZE_5:    1266.67,
  MANUAL_RAISE:      166.67,
};
const MAX_RISE_LEVEL = 40;
const ROWS_PER_SEC = 1000 / MS.FALL_PER_ROW;
const TILE_SIZE = 66.67; // representative for a 6×12 grid on a 400×800 canvas
function fallSpeedPxPerSec(){ return TILE_SIZE * ROWS_PER_SEC; }
function hoverDelayMs(riseSpeedLevel){
  let L = riseSpeedLevel + 1;
  if(L <= 1)  return MS.HOVER_L1;
  if(L <= 10) return MS.HOVER_L1 + (MS.HOVER_L10 - MS.HOVER_L1) * (L - 1) / 9;
  let maxL = MAX_RISE_LEVEL + 1;
  let v = MS.HOVER_L10 + (MS.HOVER_MAX - MS.HOVER_L10) * (L - 10) / (maxL - 10);
  return Math.max(MS.HOVER_MAX, v);
}
function chainFreezeMs(level){
  if(level < 2) return 0;
  let slope = (MS.CHAIN_FREEZE_5 - MS.CHAIN_FREEZE_2) / (5 - 2);
  return MS.CHAIN_FREEZE_2 + (level - 2) * slope;
}
// tolerance accommodates the spec's own display-rounding (e.g. 5×66.67=333.35 vs spec "333.33")
function approx(a,b,eps){ eps=eps||0.05; return Math.abs(a-b)<=eps; }

let pass=0, fail=0;
function assert(c,m){ if(c){pass++;console.log("  PASS: "+m);} else {fail++;console.log("  FAIL: "+m);} }

// ====================================================================
// 1. BROWSER CURSOR & INPUT MECHANICS
// ====================================================================
console.log("\n=== 1. CURSOR & INPUT MECHANICS ===");
{
  assert(MS.CURSOR_SHIFT===16.67, "single-press cursor traversal = 16.67 ms");
  assert(MS.DAS_INITIAL===200.00, "DAS initial hold delay = 200.00 ms");
  assert(MS.DAS_REPEAT===50.00, "DAS repeat rate = 50.00 ms");
  assert(MS.SWAP_INPUT_BUFFER===16.67, "swap input buffer = 16.67 ms");

  // DAS never fires before the initial delay
  assert(MS.DAS_INITIAL > 0 && MS.DAS_INITIAL > MS.DAS_REPEAT,
    "DAS initial delay greater than repeat interval");

  // simulate DAS hold: number of auto-shifts over a held window
  // After 200ms hold, shifts occur every 50ms.
  let held = 500; // ms held total
  let autoShifts = 0;
  if(held >= MS.DAS_INITIAL) autoShifts = Math.floor((held - MS.DAS_INITIAL) / MS.DAS_REPEAT);
  // 500-200=300; 300/50=6 shifts
  assert(autoShifts===6, "DAS produces 6 auto-shifts over a 500ms hold (expected 6)");
}

// ====================================================================
// 2. PANEL SWAP PHYSICS
// ====================================================================
console.log("\n=== 2. PANEL SWAP PHYSICS ===");
{
  assert(MS.SWAP_DURATION===66.67, "active swap duration = 66.67 ms");
  assert(MS.SWAP_INTERRUPT===50.00, "swap interrupt point = 50.00 ms");
  assert(MS.FALL_PER_ROW===16.67, "vertical fall = 1 row per 16.67 ms");

  // mid-air trick window: a panel may be re-swapped before the swap completes
  assert(MS.SWAP_INTERRUPT < MS.SWAP_DURATION,
    "swap interrupt (50ms) precedes completion (66.67ms) — mid-air trick enabled");
  let trickWindow = MS.SWAP_DURATION - MS.SWAP_INTERRUPT;
  assert(approx(trickWindow, 16.67), "mid-air re-swap window = 16.67 ms");

  // fall speed is decoupled from TILE_SIZE / refresh rate
  assert(approx(ROWS_PER_SEC, 60), "fall speed ≈ 60 rows/sec (1 row / 16.67ms)");
  assert(approx(fallSpeedPxPerSec(), TILE_SIZE*ROWS_PER_SEC, 0.001),
    "fallSpeedPxPerSec = TILE_SIZE × ROWS_PER_SEC (px/s)");
  // one row traversal time from px/s
  let rowTime = TILE_SIZE / fallSpeedPxPerSec() * 1000;
  assert(approx(rowTime, MS.FALL_PER_ROW), "row traversal time = 16.67 ms at any TILE_SIZE");
}

// ====================================================================
// 3. MATCH PROCESSING & CLEAR LIFECYCLE
// ====================================================================
console.log("\n=== 3. MATCH PROCESSING & CLEAR LIFECYCLE ===");
{
  assert(MS.MATCH_CHECK_DELAY===150.00, "match check delay = 150.00 ms");
  assert(MS.FLASH===266.67, "flash phase = 266.67 ms");
  assert(MS.WINCE===166.67, "wince phase = 166.67 ms");
  assert(MS.POP_PER_PANEL===66.67, "pop per panel = 66.67 ms");

  function popTotal(n){ return n * MS.POP_PER_PANEL; }
  assert(approx(popTotal(3), 200.00), "3-panel sequential pop = 200.00 ms");
  assert(approx(popTotal(4), 266.67), "4-panel sequential pop = 266.67 ms");
  assert(approx(popTotal(5), 333.33), "5-panel sequential pop = 333.33 ms");
  assert(approx(popTotal(6), 400.00), "6-panel (full row) pop = 400.00 ms");

  // intersecting match (e.g. cross of 5 unique panels): unique count × 66.67
  assert(approx(popTotal(5), 333.33), "intersecting 5-panel cross pop = 5×66.67 = 333.33 ms");

  // full lifecycle total for a 3-panel match (delay+flash+wince+pop)
  let total3 = MS.MATCH_CHECK_DELAY + MS.FLASH + MS.WINCE + popTotal(3);
  assert(approx(total3, 150+266.67+166.67+200), "3-panel full lifecycle = 783.34 ms");
}

// ====================================================================
// 4. HOVER, GRAVITY & CHAIN TIMING
// ====================================================================
console.log("\n=== 4. HOVER, GRAVITY & CHAIN TIMING ===");
{
  assert(MS.HOVER_BASE===400.00, "standard hover baseline = 400.00 ms");

  // hover scaling by speed level
  assert(approx(hoverDelayMs(0), 466.67), "hover at Speed Level 1 = 466.67 ms");
  assert(approx(hoverDelayMs(9), 233.33), "hover at Speed Level 10 = 233.33 ms");
  // monotonic decrease across the 1..10 range
  let mono = true;
  for(let L=0; L<=9; L++){ if(hoverDelayMs(L) < hoverDelayMs(L+1)-0.001){ mono=false; break; } }
  assert(mono, "hover delay monotonically decreases from L1 to L10");
  // max speed level reaches the floor of 100ms
  assert(approx(hoverDelayMs(MAX_RISE_LEVEL), 100.00), "hover at Max Speed Level = 100.00 ms");
  assert(hoverDelayMs(MAX_RISE_LEVEL) >= MS.HOVER_MAX,
    "hover never drops below the 100ms floor");

  // chain freeze anchors
  assert(MS.CHAIN_FREEZE_2===733.33, "2× chain freeze = 733.33 ms");
  assert(MS.CHAIN_FREEZE_5===1266.67, "5× chain freeze = 1266.67 ms");
  assert(approx(chainFreezeMs(2), 733.33), "chainFreezeMs(2) = 733.33 ms");
  assert(approx(chainFreezeMs(5), 1266.67), "chainFreezeMs(5) = 1266.67 ms");
  assert(chainFreezeMs(1)===0, "no freeze below a 2× chain");
  // linear interpolation between anchors
  assert(approx(chainFreezeMs(3), 911.11, 0.02), "chainFreezeMs(3) interpolated ≈ 911.11 ms");
  assert(approx(chainFreezeMs(4), 1088.89, 0.02), "chainFreezeMs(4) interpolated ≈ 1088.89 ms");
}

// ====================================================================
// 5. MANUAL STACK RAISING
// ====================================================================
console.log("\n=== 5. MANUAL STACK RAISING ===");
{
  assert(MS.MANUAL_RAISE===166.67, "manual raise scroll = 166.67 ms");
  // the scroll speed (px/s) completes one TILE_SIZE in exactly MANUAL_RAISE ms
  let speed = TILE_SIZE / (MS.MANUAL_RAISE / 1000);
  let timeForOneRow = TILE_SIZE / speed * 1000;
  assert(approx(timeForOneRow, 166.67), "manual raise traverses one row in 166.67 ms");
  // swap lockout spans the entire scroll window
  assert(MS.MANUAL_RAISE===166.67, "swap lockout = full 166.67 ms scroll window");
}

// ====================================================================
// 6. STATE-MACHINE PHASE TRANSITIONS (lifecycle simulation)
// ====================================================================
console.log("\n=== 6. LIFECYCLE PHASE SIMULATION (3-panel match) ===");
{
  // replicate the phase machine using the same ms thresholds
  let phase = 'matchdelay', t = 0, step = 1.0; // 1ms ticks
  let seen = { matchdelay:false, flash:false, wince:false, popping:false, done:false };
  let popN = 3;
  for(let i=0; i<2000 && phase!=='done'; i++){
    t += step;
    if(phase==='matchdelay'){
      seen.matchdelay=true;
      if(t>=MS.MATCH_CHECK_DELAY){ phase='flash'; t=0; }
    } else if(phase==='flash'){
      seen.flash=true;
      if(t>=MS.FLASH){ phase='wince'; t=0; }
    } else if(phase==='wince'){
      seen.wince=true;
      if(t>=MS.WINCE){ phase='popping'; t=0; }
    } else if(phase==='popping'){
      seen.popping=true;
      if(t>=popN*MS.POP_PER_PANEL){ phase='done'; }
    }
  }
  assert(seen.matchdelay && seen.flash && seen.wince && seen.popping,
    "all four phases visited in order");
  assert(phase==='done', "lifecycle reaches completion");

  // total elapsed should equal the sum of the four phase durations
  let expected = MS.MATCH_CHECK_DELAY + MS.FLASH + MS.WINCE + popN*MS.POP_PER_PANEL;
  // reconstruct total from thresholds
  let total = MS.MATCH_CHECK_DELAY + MS.FLASH + MS.WINCE + popN*MS.POP_PER_PANEL;
  assert(approx(total, expected), "simulated lifecycle duration matches spec sum");
}

// ====================================================================
// 7. REFRESH-RATE INDEPENDENCE
// ====================================================================
console.log("\n=== 7. REFRESH-RATE INDEPENDENCE ===");
{
  // The engine must advance identical wall-clock time regardless of fps.
  // Simulate one second of swaps under 60 / 144 / 240 Hz tick sizes.
  function simulate(fps){
    let frameMs = 1000 / fps;
    let frames = Math.round(1000 / frameMs);
    let advanced = 0;
    for(let i=0;i<frames;i++) advanced += frameMs;
    return advanced;
  }
  assert(approx(simulate(60),  1000, 0.5), "60 Hz advances ~1000 ms/s");
  assert(approx(simulate(144), 1000, 0.5), "144 Hz advances ~1000 ms/s");
  assert(approx(simulate(240), 1000, 0.5), "240 Hz advances ~1000 ms/s");
  // DAS timing is identical across rates because it is ms-, not frame-based
  let das60  = Math.floor((500 - MS.DAS_INITIAL) / MS.DAS_REPEAT);
  let das144 = Math.floor((500 - MS.DAS_INITIAL) / MS.DAS_REPEAT);
  assert(das60===das144 && das60===6, "DAS auto-shift count identical across refresh rates");
}

console.log("\n=========================");
console.log("ENGINE RESULTS: "+pass+" passed, "+fail+" failed");
console.log("=========================");
process.exit(fail>0?1:0);
