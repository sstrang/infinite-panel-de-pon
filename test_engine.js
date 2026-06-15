"use strict";
// ====================================================================
//  ENGINE TEST SUITE  (coupled to the REAL engine)
//  Requires ./engine.js. No mirrored constants — every assertion drives
//  the actual Stack/Panel classes and the actual preset/config tables.
//  Authentic references: panel-attack common/engine/*.lua + LevelPresets.lua
// ====================================================================

const E = require("./engine.js");

let pass = 0, fail = 0;
function assert(c, m) { if (c) { pass++; console.log("  PASS: " + m); } else { fail++; console.log("  FAIL: " + m); } }

function newStack(opts) {
  opts = opts || {};
  return new E.Stack({
    width: opts.width || 6,
    height: opts.height || 12,
    levelData: opts.levelData || E.MODERN_PRESETS[0],
    seed: opts.seed != null ? opts.seed : 1,
  });
}
// set a panel to a given color in normal state, flagged as a match candidate
function setPanel(stack, row, col, color) {
  const p = stack.panels[row][col];
  p.color = color;
  p.state = 'normal';
  p.stateChanged = true;
  return p;
}

// ====================================================================
// 1. TIMING PRESETS — MODERN_PRESETS[0] vs authentic LevelPresets.lua
// ====================================================================
console.log("\n=== 1. TIMING PRESETS (MODERN_PRESETS[0] vs LevelPresets.lua) ===");
{
  const L1 = E.MODERN_PRESETS[0];
  const F = L1.frame;
  assert(L1.startingSpeed === 1,  "L1 startingSpeed = 1");
  assert(L1.colorCount === 5,     "L1 colorCount = 5 (6th color arrives L9, not L3)");
  assert(F.HOVER === 12,          "L1 hover = 12 frames");
  assert(F.FLASH === 44,          "L1 flash = 44 frames");
  assert(F.FACE === 20,           "L1 face = 20 frames");
  assert(F.POP === 9,             "L1 pop = 9 frames");
  // 9th preset introduces 6th color (authentic)
  assert(E.MODERN_PRESETS[8].colorCount === 6, "preset 8 (level 9) = 6 colors");
  assert(E.MODERN_PRESETS[7].colorCount === 5, "preset 7 (level 8) = 5 colors");
}

// ====================================================================
// 2. PANEL MATCH LIFECYCLE — matched timer = FLASH+FACE+1
// ====================================================================
console.log("\n=== 2. PANEL MATCH LIFECYCLE ===");
{
  const s = newStack();
  const ft = s.frameTimes;
  // horizontal 3-in-a-row at row 1
  setPanel(s, 1, 0, 1); setPanel(s, 1, 1, 1); setPanel(s, 1, 2, 1);
  s.checkMatches();
  const p = s.panels[1][0];
  assert(p.state === 'matched', "panel enters 'matched' state after checkMatches");
  assert(p.timer === ft.FLASH + ft.FACE + 1, "matched timer = FLASH+FACE+1 (="+(ft.FLASH+ft.FACE+1)+")");
  assert(p.combo_size === 3, "combo_size = 3");
}

// ====================================================================
// 3. POP ORDER — raster: top-to-bottom, left-to-right (authentic
//    sortByPopOrder, NOT zigzag). combo_index assigned 1..N.
// ====================================================================
console.log("\n=== 3. POP ORDER (raster, authentic sortByPopOrder) ===");
{
  const s = newStack();
  const ft = s.frameTimes;
  // 3 horizontal at row 1 (bottom play row), 3 horizontal at row 2 (above)
  for (const c of [0,1,2]) { setPanel(s, 1, c, 1); setPanel(s, 2, c, 1); }
  s.checkMatches();
  // row 2 is higher (top) -> pops before row 1
  assert(s.panels[2][0].combo_index === 1, "top-left (r2c0) combo_index = 1");
  assert(s.panels[2][1].combo_index === 2, "top-mid  (r2c1) combo_index = 2");
  assert(s.panels[2][2].combo_index === 3, "top-right(r2c2) combo_index = 3");
  assert(s.panels[1][0].combo_index === 4, "bot-left (r1c0) combo_index = 4");
  assert(s.panels[1][1].combo_index === 5, "bot-mid  (r1c1) combo_index = 5");
  assert(s.panels[1][2].combo_index === 6, "bot-right(r1c2) combo_index = 6");
}
{
  // left-to-right within a single row (not zigzag/reversed)
  const s = newStack();
  for (const c of [0,1,2]) setPanel(s, 1, c, 2);
  s.checkMatches();
  assert(s.panels[1][0].combo_index === 1, "single-row left  pops 1st");
  assert(s.panels[1][1].combo_index === 2, "single-row mid   pops 2nd");
  assert(s.panels[1][2].combo_index === 3, "single-row right pops 3rd");
}

// ====================================================================
// 4. MATCH DETECTION — horizontal & vertical, >=3 required, no false +
// ====================================================================
console.log("\n=== 4. MATCH DETECTION (horizontal & vertical) ===");
{
  // horizontal 3
  const s = newStack();
  setPanel(s, 1, 0, 1); setPanel(s, 1, 1, 1); setPanel(s, 1, 2, 1);
  s.checkMatches();
  assert(s.panels[1][0].state === 'matched', "horizontal 3-in-a-row matches");
  // vertical 3
  const s2 = newStack();
  setPanel(s2, 1, 0, 2); setPanel(s2, 2, 0, 2); setPanel(s2, 3, 0, 2);
  s2.checkMatches();
  assert(s2.panels[1][0].state === 'matched', "vertical 3-in-a-row matches");
  // only 2 -> no match
  const s3 = newStack();
  setPanel(s3, 1, 0, 3); setPanel(s3, 1, 1, 3);
  s3.checkMatches();
  assert(s3.panels[1][0].state === 'normal', "2-in-a-row does NOT match");
  // different colors -> no match
  const s4 = newStack();
  setPanel(s4, 1, 0, 4); setPanel(s4, 1, 1, 5); setPanel(s4, 1, 2, 4);
  s4.checkMatches();
  assert(s4.panels[1][0].state === 'normal', "non-uniform row does NOT match");
  // 4-in-a-row counts all 4
  const s5 = newStack();
  for (const c of [0,1,2,3]) setPanel(s5, 1, c, 1);
  s5.checkMatches();
  assert(s5.panels[1][0].combo_size === 4, "4-in-a-row -> combo_size = 4");
}

// ====================================================================
// 5. CHAIN COUNTER INCREMENT — 0 -> 2 -> 3 ... (authentic, checkMatches 405-411)
// ====================================================================
console.log("\n=== 5. CHAIN COUNTER INCREMENT ===");
{
  const s = newStack();
  assert(s.chain_counter === 0, "fresh stack chain_counter = 0");
  s._incrementChainCounter();
  assert(s.chain_counter === 2, "first chain link -> 2 (not 1)");
  s._incrementChainCounter();
  assert(s.chain_counter === 3, "second chain link -> 3");
  s._incrementChainCounter();
  assert(s.chain_counter === 4, "third chain link -> 4");
  // checkMatches with a chaining panel increments
  const s2 = newStack();
  s2.chain_counter = 0;
  setPanel(s2, 1, 0, 1); setPanel(s2, 1, 1, 1); setPanel(s2, 1, 2, 1);
  s2.panels[1][0].chaining = true;       // marks this as a chain link
  s2.checkMatches();
  assert(s2.chain_counter === 2, "checkMatches on chaining panel -> counter=2");
}

// ====================================================================
// 6. SPEED INCREASE — DT_SPEED_INCREASE = 15*60 frames; panelsForSpeed table
// ====================================================================
console.log("\n=== 6. SPEED INCREASE (time mode) ===");
{
  assert(E.DT_SPEED_INCREASE === 15 * 60, "DT_SPEED_INCREASE = 900 frames (15s @ 60Hz)");
  assert(E.panelsForSpeed(1) === E.PANELS_TO_NEXT_SPEED[0], "panelsForSpeed(1) = table[0]");
  // time-mode stack arms the speed-increase clock
  const s = newStack();
  assert(s.nextSpeedIncreaseClock === E.DT_SPEED_INCREASE, "time-mode arms nextSpeedIncreaseClock");
}

// ====================================================================
// 7. RISE TABLES — SPEED_TO_RISE_TIME_RAW indexed speed-1 (correct 0-port)
// ====================================================================
console.log("\n=== 7. RISE TABLES (speed-1 indexing) ===");
{
  assert(E.riseTimeForSpeed(1) === E.SPEED_TO_RISE_TIME_RAW[0] / 16, "riseTimeForSpeed(1) = raw[0]/16");
  assert(E.riseTimeForSpeed(5) === E.SPEED_TO_RISE_TIME_RAW[4] / 16, "riseTimeForSpeed(5) = raw[4]/16");
  // engine raw table matches authentic consts.lua:58-67 byte-for-byte
  const authentic = [942, 983, 838, 790, 755, 695, 649, 604, 570, 515,
                     474, 444, 394, 370, 347, 325, 306, 289, 271, 256,
                     240, 227, 213, 201, 189, 178, 169, 158, 148, 138,
                     129, 120, 112, 105,  99,  92,  86,  82,  77,  73,
                      69,  66,  62,  59,  56,  54,  52,  50,  48,  47];
  let match = true;
  for (let i = 0; i < authentic.length; i++) if (E.SPEED_TO_RISE_TIME_RAW[i] !== authentic[i]) match = false;
  assert(match, "rise table first 50 entries match authentic consts.lua exactly");
  // the 942->983 increase (speed1->2) is an authentic quirk, NOT monotonic
  assert(E.SPEED_TO_RISE_TIME_RAW[0] === 942 && E.SPEED_TO_RISE_TIME_RAW[1] === 983, "authentic 942->983 quirk at speed 1->2 preserved");
  // converges to floor 47 at high speed
  assert(E.SPEED_TO_RISE_TIME_RAW[49] === 47, "rise table floors at 47 (speed 50+)");
}

// ====================================================================
// 8. PANEL POPPING STATE MACHINE — matched -> popping -> popped frame counts
//    matched timer = FLASH+FACE+1; popping timer = combo_index*POP
// ====================================================================
console.log("\n=== 8. POPPING STATE MACHINE (frame counts) ===");
{
  const s = newStack();
  const ft = s.frameTimes;
  setPanel(s, 1, 0, 1); setPanel(s, 1, 1, 1); setPanel(s, 1, 2, 1);
  s.checkMatches();
  const p = s.panels[1][0];      // combo_index 1 (only row)
  assert(p.state === 'matched', "starts in 'matched'");
  // advance FLASH+FACE+1 frames -> should transition to 'popping'
  for (let i = 0; i < ft.FLASH + ft.FACE + 1; i++) p.update(s.panels);
  assert(p.state === 'popping', "after FLASH+FACE+1 frames -> 'popping'");
  assert(p.timer === p.combo_index * ft.POP, "popping timer = combo_index*POP (="+(p.combo_index*ft.POP)+")");
}

// ====================================================================
// 9. STOP TIME — modern formula (STOP_MODERN), combo & chain branches
// ====================================================================
console.log("\n=== 9. STOP TIME (modern formula) ===");
{
  const s = newStack();
  const st = s.levelData.stop;   // STOP_MODERN: coefficient 20, comboConstant -20, chainConstant 80
  assert(st.coefficient === 20, "modern stop coefficient = 20");
  assert(st.comboConstant === -20, "modern stop comboConstant = -20");
  assert(st.chainConstant === 80, "modern stop chainConstant = 80");
  // combo: 20*N - 20 for N>3
  assert(s._calculateStopTime(4, false, false, 0) === 20*4 - 20, "4-combo stop = 60");
  assert(s._calculateStopTime(6, false, false, 0) === 20*6 - 20, "6-combo stop = 100");
  // chain: 20*min(cc,13) + 80
  assert(s._calculateStopTime(3, false, true, 2) === 20*2 + 80, "2x chain stop = 120");
  assert(s._calculateStopTime(3, false, true, 13) === 20*13 + 80, "13x chain stop = 340");
  assert(s._calculateStopTime(3, false, true, 20) === 20*13 + 80, "20x chain stop capped at 13x = 340");
  // 3-panel non-chain -> 0
  assert(s._calculateStopTime(3, false, false, 0) === 0, "3-panel non-chain stop = 0");
}

// ====================================================================
// 10. SWAP PIPELINE — leftmost column (col 0) regression + rightmost
//     The 0-as-sentinel bug silently dropped swaps when the cursor sat
//     at col 0. Verifies col 0 and col 4<->5 both execute end-to-end.
// ====================================================================
console.log("\n=== 10. SWAP PIPELINE (col 0 regression + col 4/5) ===");
{
  const NOIN = {up:false,down:false,left:false,right:false,swap:false,raise:false};
  // leftmost column (col 0)
  const s = newStack();
  for (let i=0;i<5;i++){s.input_state=NOIN;s.run();}   // advance past clock<=1 guard
  for (let c=0;c<6;c++) setPanel(s,1,c,0);
  setPanel(s,1,0,1); setPanel(s,1,1,2);
  const a=s.panels[1][0].color, b=s.panels[1][1].color;
  s.cur_row=1; s.cur_col=0;
  s.input_state=Object.assign({},NOIN,{swap:true}); s.run();
  s.input_state=NOIN; s.run();
  assert(s.panels[1][0].color===b && s.panels[1][1].color===a, "leftmost column (col 0) swap executes");
  assert(s.swapCount>=1, "swapCount incremented after col-0 swap");
  // rightmost columns (col 4 <-> 5)
  const s2 = newStack();
  for (let i=0;i<5;i++){s2.input_state=NOIN;s2.run();}
  for (let c=0;c<6;c++) setPanel(s2,1,c,0);
  setPanel(s2,1,4,3); setPanel(s2,1,5,4);
  const a2=s2.panels[1][4].color, b2=s2.panels[1][5].color;
  s2.cur_row=1; s2.cur_col=4;
  s2.input_state=Object.assign({},NOIN,{swap:true}); s2.run();
  s2.input_state=NOIN; s2.run();
  assert(s2.panels[1][4].color===b2 && s2.panels[1][5].color===a2, "rightmost columns (col 4<->5) swap executes");
}

// ====================================================================
// 11. MAX CHAIN / MAX COMBO TRACKING — engine retains peak values
// ====================================================================
console.log("\n=== 11. MAX CHAIN / MAX COMBO TRACKING ===");
{
  const s = newStack();
  assert(s.max_chain === 0 && s.max_combo === 0, "fresh stack: max_chain=0, max_combo=0");

  // combo: 3 in a row
  setPanel(s, 1, 0, 1); setPanel(s, 1, 1, 1); setPanel(s, 1, 2, 1);
  s.checkMatches();
  assert(s.max_combo === 3, "3-panel combo -> max_combo=3 (got "+s.max_combo+")");
  assert(s.max_chain === 0, "no chain -> max_chain=0");

  // larger combo: clear and set 4 in a row
  const s2 = newStack();
  for (const c of [0,1,2,3]) setPanel(s2, 1, c, 1);
  s2.checkMatches();
  assert(s2.max_combo === 4, "4-panel combo -> max_combo=4 (got "+s2.max_combo+")");

  // chain: simulate _incrementChainCounter
  const s3 = newStack();
  s3._incrementChainCounter();
  assert(s3.max_chain === 2, "first chain link -> max_chain=2 (got "+s3.max_chain+")");
  s3._incrementChainCounter();
  assert(s3.max_chain === 3, "second chain link -> max_chain=3 (got "+s3.max_chain+")");
  s3.chain_counter = 0;  // chain resets
  assert(s3.max_chain === 3, "max_chain retains peak after chain resets");
  s3._incrementChainCounter();
  assert(s3.max_chain === 3, "smaller chain (2) does not lower max_chain");
}

// ====================================================================
// 12. CHAIN TALLY / COMBO TALLY — per-size completion counts
// ====================================================================
console.log("\n=== 12. CHAIN TALLY / COMBO TALLY ===");
{
  const NOIN = {up:false,down:false,left:false,right:false,swap:false,raise:false};

  // --- combo tally ---
  const s = newStack();
  assert(Object.keys(s.combo_tally).length === 0, "fresh: empty combo_tally");
  setPanel(s, 1, 0, 1); setPanel(s, 1, 1, 1); setPanel(s, 1, 2, 1);
  s.checkMatches();
  assert(s.combo_tally[3] === 1, "3-panel combo -> combo_tally[3]=1 (got " + (s.combo_tally[3]||0) + ")");

  const s2 = newStack();
  for (const c of [0,1,2,3]) setPanel(s2, 1, c, 1);
  s2.checkMatches();
  assert(s2.combo_tally[4] === 1, "4-panel combo -> combo_tally[4]=1 (got " + (s2.combo_tally[4]||0) + ")");
  // 3-panel combo on same stack
  setPanel(s2, 2, 0, 2); setPanel(s2, 2, 1, 2); setPanel(s2, 2, 2, 2);
  s2.checkMatches();
  assert(s2.combo_tally[3] === 1, "second combo (3) -> combo_tally[3]=1 (got " + (s2.combo_tally[3]||0) + ")");
  assert(s2.combo_tally[4] === 1, "combo_tally[4] still 1 (got " + (s2.combo_tally[4]||0) + ")");

  // --- chain tally (recorded when chain sequence completes) ---
  const s3 = newStack();
  for (let i=0;i<5;i++){s3.input_state=NOIN;s3.run();}  // advance past clock guard
  assert(Object.keys(s3.chain_tally).length === 0, "fresh: empty chain_tally");
  // simulate a 7x chain ending
  s3.chain_counter = 7;
  s3.input_state = NOIN;
  s3.run();  // chain completes (no chaining panels) -> tally[7] += 1
  assert(s3.chain_tally[7] === 1, "7x chain completed -> chain_tally[7]=1 (got " + (s3.chain_tally[7]||0) + ")");
  assert(s3.chain_counter === 0, "chain_counter reset after completion");

  // second 7x chain
  s3.chain_counter = 7;
  s3.input_state = NOIN;
  s3.run();
  assert(s3.chain_tally[7] === 2, "second 7x chain -> chain_tally[7]=2 (got " + (s3.chain_tally[7]||0) + ")");

  // a 3x chain
  s3.chain_counter = 3;
  s3.input_state = NOIN;
  s3.run();
  assert(s3.chain_tally[3] === 1, "3x chain -> chain_tally[3]=1 (got " + (s3.chain_tally[3]||0) + ")");
  assert(s3.chain_tally[7] === 2, "chain_tally[7] unaffected (got " + (s3.chain_tally[7]||0) + ")");
}

console.log("\n===========================");
console.log("ENGINE RESULTS: " + pass + " passed, " + fail + " failed");
console.log("===========================");
process.exit(fail ? 1 : 0);
