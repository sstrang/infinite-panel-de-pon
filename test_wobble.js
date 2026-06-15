"use strict";
// ====================================================================
//  DANGER WOBBLE TEST SUITE
//  Verifies shouldDangerWobble() fires only when a panel is in the danger
//  row (height-1) and no match/chain/gameover suppresses it.
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
function setPanel(stack, row, col, color) {
  const p = stack.panels[row][col];
  p.color = color;
  p.state = 'normal';
  p.stateChanged = true;
  return p;
}

console.log("\n=== DANGER WOBBLE ===\n");

// 1. Empty danger row — no wobble
{
  const s = newStack();
  assert(!s.shouldDangerWobble(), "no wobble when danger row (11) is empty");
}

// 2. Block in danger row (height-1 = 11) — wobble
{
  const s = newStack();
  setPanel(s, 11, 0, 1);
  assert(s.shouldDangerWobble(), "wobble when block in danger row (row 11)");
}

// 3. Block only in row height-2 (10) — no wobble (not close enough)
{
  const s = newStack();
  setPanel(s, 10, 0, 1);
  assert(!s.shouldDangerWobble(), "no wobble when highest block is row 10 (two below threshold)");
}

// 4. Block at top row (height=12) but NOT topped out yet — wobble (it's in danger zone too)
{
  const s = newStack();
  setPanel(s, 12, 0, 1);
  assert(s.shouldDangerWobble(), "wobble when block at row 12 (within one block of threshold)");
}

// 5. Block in danger row, but stop_time > 0 (match resolving) — suppressed
{
  const s = newStack();
  setPanel(s, 11, 2, 3);
  s.stop_time = 30;
  assert(!s.shouldDangerWobble(), "suppressed during stop_time (match resolution)");
}

// 6. Block in danger row, but chain_counter !== 0 — suppressed
{
  const s = newStack();
  setPanel(s, 11, 4, 2);
  s.chain_counter = 3;
  assert(!s.shouldDangerWobble(), "suppressed during chain (chain_counter=3)");
}

// 7. Block in danger row, game over — suppressed
{
  const s = newStack();
  setPanel(s, 11, 1, 4);
  s.game_over = true;
  assert(!s.shouldDangerWobble(), "suppressed when game_over");
}

// 8. Multiple columns — any one in danger triggers
{
  const s = newStack();
  setPanel(s, 5, 0, 1);
  setPanel(s, 3, 1, 2);
  setPanel(s, 11, 5, 3);   // only col 5 reaches danger row
  assert(s.shouldDangerWobble(), "wobble when ANY column has block in danger row");
}

// 9. Color 0 (empty) in danger row — no wobble
{
  const s = newStack();
  setPanel(s, 11, 0, 0);   // explicitly empty
  assert(!s.shouldDangerWobble(), "color-0 panel in danger row does not trigger");
}

// 10. After stop_time clears, wobble resumes
{
  const s = newStack();
  setPanel(s, 11, 0, 1);
  s.stop_time = 20;
  assert(!s.shouldDangerWobble(), "suppressed while stop_time active");
  s.stop_time = 0;
  assert(s.shouldDangerWobble(), "wobble resumes after stop_time clears");
}

// 11. After chain_counter resets to 0, wobble resumes
{
  const s = newStack();
  setPanel(s, 11, 3, 5);
  s.chain_counter = 2;
  assert(!s.shouldDangerWobble(), "suppressed while chain active");
  s.chain_counter = 0;
  assert(s.shouldDangerWobble(), "wobble resumes after chain ends");
}

// 12. pre_stop_time alone DOES suppress (basic 3-match sets pre_stop but not stop_time)
{
  const s = newStack();
  setPanel(s, 11, 0, 1);
  s.pre_stop_time = 5;
  s.stop_time = 0;
  s.chain_counter = 0;
  assert(!s.shouldDangerWobble(), "pre_stop_time > 0 suppresses (basic 3-match path)");
}

console.log("\n=============================");
console.log("DANGER WOBBLE: " + pass + " passed, " + fail + " failed");
console.log("=============================");
process.exit(fail ? 1 : 0);
