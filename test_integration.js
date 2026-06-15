"use strict";
// ====================================================================
//  INTEGRATION TEST SUITE  (coupled to the REAL engine)
//  Drives the actual Stack through the real physics loop (_runPhysics)
//  frame-by-frame: match detection -> popping state machine -> clear ->
//  score accrual. No mirrored constants — single source of truth in
//  engine.js. Replaces the pre-refactor ms-based integration test.
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
// place a colored panel in normal state, flagged as a match candidate
function place(stack, row, col, color) {
  const p = stack.panels[row][col];
  p.color = color; p.state = 'normal'; p.stateChanged = true;
  return p;
}
// step the REAL physics loop until no active panels remain (settled),
// with a safety cap
function runUntilSettled(stack, maxFrames) {
  maxFrames = maxFrames || 400;
  for (let f = 0; f < maxFrames; f++) {
    stack._runPhysics();
    if (stack.n_active_panels === 0 && f > 0) return f;
  }
  return maxFrames;
}

// ====================================================================
// 1. 3-IN-A-ROW END-TO-END: clears, score = 30 (no combo), 3 cleared
// ====================================================================
console.log("\n=== 1. 3-IN-A-ROW FULL RESOLUTION ===");
{
  const s = newStack();
  place(s, 1, 0, 1); place(s, 1, 1, 1); place(s, 1, 2, 1);
  runUntilSettled(s);
  assert(s.score === 30, "3-panel clear scores 30 (3x10, no combo)");
  assert(s.panels_cleared === 3, "panels_cleared = 3");
  assert(s.panels[1][0].color === 0 && s.panels[1][1].color === 0 && s.panels[1][2].color === 0, "all 3 panels cleared (color=0)");
  assert(s.panels[1][0].state === 'normal', "cleared panels back to 'normal' state");
}

// ====================================================================
// 2. 4-IN-A-ROW END-TO-END: combo bonus 20 + 4x10 = 60
// ====================================================================
console.log("\n=== 2. 4-IN-A-ROW WITH COMBO ===");
{
  const s = newStack();
  place(s, 1, 0, 1); place(s, 1, 1, 1); place(s, 1, 2, 1); place(s, 1, 3, 1);
  runUntilSettled(s);
  assert(s.score === 60, "4-panel clear scores 60 (combo 20 + 4x10)");
  assert(s.panels_cleared === 4, "panels_cleared = 4");
}

// ====================================================================
// 3. TWO SIMULTANEOUS MATCHES: 6 panels, treated as one 6-combo
//    (authentic: all simultaneous matches count as a single combo)
// ====================================================================
console.log("\n=== 3. TWO SIMULTANEOUS 3-IN-A-ROWS (one 6-combo) ===");
{
  const s = newStack();
  // row 1: cols 0-2 color 1; cols 3-5 color 2
  for (const c of [0,1,2]) place(s, 1, c, 1);
  for (const c of [3,4,5]) place(s, 1, c, 2);
  runUntilSettled(s);
  assert(s.panels_cleared === 6, "two 3-rows clear 6 panels");
  assert(s.score === 110, "two 3-rows = one 6-combo: 110 (combo 50 + 6x10)");
}

// ====================================================================
// 4. CROSS MATCH (both arms >= 3): 5 connected panels clear together
// ====================================================================
console.log("\n=== 4. CROSS MATCH (5-panel plus shape) ===");
{
  const s = newStack();
  // horizontal 3 at row 1: c0,c1,c2 = color 1
  place(s, 1, 0, 1); place(s, 1, 1, 1); place(s, 1, 2, 1);
  // vertical 3 at col 1: rows 1,2,3 (shares corner r1c1) = color 1
  place(s, 2, 1, 1); place(s, 3, 1, 1);
  runUntilSettled(s);
  assert(s.panels_cleared === 5, "plus-shape clears all 5 connected panels");
  assert(s.score === 80, "5-panel cross = 80 (combo 30 + 5x10)");
}

// ====================================================================
// 5. COMBO SCALING: 5, 6 panels verified end-to-end
// ====================================================================
console.log("\n=== 5. COMBO SCALING END-TO-END ===");
{
  // 5-in-a-row: 30 combo + 50 base = 80
  const s5 = newStack();
  for (const c of [0,1,2,3,4]) place(s5, 1, c, 1);
  runUntilSettled(s5);
  assert(s5.score === 80, "5-panel clear = 80 (combo 30 + 5x10)");
  // 6-in-a-row: 50 combo + 60 base = 110
  const s6 = newStack({width:6});
  for (const c of [0,1,2,3,4,5]) place(s6, 1, c, 1);
  runUntilSettled(s6);
  assert(s6.score === 110, "6-panel clear = 110 (combo 50 + 6x10)");
}

// ====================================================================
// 6. NO FALSE MATCH: pre-positioned non-matching board stays put
// ====================================================================
console.log("\n=== 6. NO FALSE MATCHES ===");
{
  const s = newStack();
  // alternating colors — no 3-in-a-row
  for (let c = 0; c < 6; c++) place(s, 1, c, (c % 2) + 1);
  const scoreBefore = s.score;
  runUntilSettled(s, 30);
  assert(s.score === scoreBefore, "alternating colors never match (score unchanged)");
  assert(s.panels_cleared === 0, "nothing cleared");
}

// ====================================================================
// 7. STABILITY: a settled board with random play stays within score cap
//    and never throws — drives run() with random input over many frames
// ====================================================================
console.log("\n=== 7. LONG-RUN STABILITY (random input, 600 frames) ===");
{
  let rng = E.mulberry32(42);
  let crashed = false, errMsg = "";
  try {
    const s = newStack();
    s.startingState(7);
    for (let f = 0; f < 600; f++) {
      s.input_state = {
        up:    rng() < 0.1, down:  rng() < 0.1,
        left:  rng() < 0.1, right: rng() < 0.1,
        swap:  rng() < 0.05, raise: rng() < 0.05,
      };
      s.run();
    }
    assert(s.score >= 0 && s.score <= E.SCORE_CAP, "score stays in [0, SCORE_CAP] after 600 frames ("+s.score+")");
    assert(s.clock > 0, "engine ran at least one frame (clock="+s.clock+", game_over="+s.game_over+")");
  } catch (e) { crashed = true; errMsg = e.message; }
  assert(!crashed, "no crash over 600 frames" + (crashed ? " ("+errMsg+")" : ""));
}

// ====================================================================
// 8. GAME OVER DETECTION (top-out) — engine reports game_over on overflow
// ====================================================================
console.log("\n=== 8. GAME OVER DETECTION ===");
{
  const s = newStack();
  assert(!s.game_ended(), "fresh stack not game over");
  s.setGameOver();
  assert(s.game_ended(), "setGameOver marks game ended");
  // run() is a no-op once game over
  const clk = s.clock;
  s.run();
  assert(s.clock === clk, "run() no-ops after game over");
}

console.log("\n===============================");
console.log("INTEGRATION RESULTS: " + pass + " passed, " + fail + " failed");
console.log("===============================");
process.exit(fail ? 1 : 0);
