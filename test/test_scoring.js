"use strict";
// ====================================================================
//  SCORING ENGINE TEST SUITE  (coupled to the REAL engine)
//  Requires ./engine.js and exercises the actual SCORE_COMBO_TA /
//  SCORE_CHAIN_TA tables and Stack scoring hooks. No mirrored copies.
//  Authentic values verified against panel-attack checkMatches.lua 13-22.
// ====================================================================

const E = require("../engine.js");
const PRESET = E.MODERN_PRESETS[0];          // level 1 modern preset

function newStack() {
  return new E.Stack({ width: 6, height: 12, levelData: PRESET, seed: 1 });
}
// combo bonus for an N-panel simultaneous clear (real table, capped at 30)
function comboBonus(n) { return E.SCORE_COMBO_TA[Math.min(30, n)]; }
// chain bonus for a given chain counter, via the REAL Stack hook
function chainBonus(cc) {
  const s = newStack();
  s.chain_counter = cc;
  s._updateScoreWithChain();
  return s.score;
}
// total score for one match event: N panels popped (+10 each) + combo + chain
function matchEvent(n, cc) {
  const s = newStack();
  s.chain_counter = cc;
  for (let i = 0; i < n; i++) s._onPop(null);   // per-panel base (+10)
  s._updateScoreWithBonus(n);                    // combo + chain
  return s.score;
}

function approx(a, b, eps) { eps = eps || 0.001; return Math.abs(a - b) <= eps; }
let pass = 0, fail = 0;
function assert(c, m) { if (c) { pass++; console.log("  PASS: " + m); } else { fail++; console.log("  FAIL: " + m); } }

// ====================================================================
// 1. COMBO TABLE (authentic lookup, capped at 30) — real SCORE_COMBO_TA
// ====================================================================
console.log("\n=== 1. COMBO TABLE (real SCORE_COMBO_TA, capped at 30) ===");
{
  assert(comboBonus(3) === 0,   "3 panels = 0 combo bonus (baseline)");
  assert(comboBonus(4) === 20,  "4 panels = 20");
  assert(comboBonus(5) === 30,  "5 panels = 30");
  assert(comboBonus(6) === 50,  "6 panels = 50");
  assert(comboBonus(7) === 60,  "7 panels = 60");
  assert(comboBonus(8) === 70,  "8 panels = 70");
  assert(comboBonus(9) === 80,  "9 panels = 80");
  assert(comboBonus(10) === 100, "10 panels = 100");
  assert(comboBonus(11) === 140, "11 panels = 140");
  assert(comboBonus(12) === 170, "12 panels = 170");
  assert(comboBonus(13) === 210, "13 panels = 210");
  assert(comboBonus(15) === 290, "15 panels = 290");
  assert(comboBonus(20) === 550, "20 panels = 550");
  assert(comboBonus(30) === 1330, "30 panels = 1330 (cap)");
  assert(comboBonus(40) === 1330, "40 panels clamped to 30-cap = 1330");
}

// ====================================================================
// 2. CHAIN TABLE (2x..13x) — real Stack._updateScoreWithChain
// ====================================================================
console.log("\n=== 2. CHAIN TABLE (2x..13x via real Stack) ===");
{
  assert(chainBonus(0) === 0,    "non-chain (0) = 0");
  assert(chainBonus(1) === 0,    "chain counter 1 = 0 (never a real chain link)");
  assert(chainBonus(2) === 50,   "2x = 50");
  assert(chainBonus(3) === 80,   "3x = 80");
  assert(chainBonus(4) === 150,  "4x = 150");
  assert(chainBonus(5) === 300,  "5x = 300");
  assert(chainBonus(6) === 400,  "6x = 400");
  assert(chainBonus(9) === 900,  "9x = 900");
  assert(chainBonus(11) === 1300, "11x = 1300");
  assert(chainBonus(12) === 1500, "12x = 1500");
  assert(chainBonus(13) === 1800, "13x = 1800 (capstone, was 0 before fix)");
}

// ====================================================================
// 3. INFINITE CHAIN (N >= 14) — spec #1c: 1800 * (N - 12)
// ====================================================================
console.log("\n=== 3. INFINITE CHAIN (N >= 14, spec #1c) ===");
{
  assert(chainBonus(14) === 3600,  "14x = 1800 * 2 = 3600");
  assert(chainBonus(15) === 5400,  "15x = 1800 * 3 = 5400");
  assert(chainBonus(16) === 7200,  "16x = 1800 * 4 = 7200");
  assert(chainBonus(20) === 14400, "20x = 1800 * 8 = 14400");
  assert(chainBonus(50) === 68400, "50x = 1800 * 38 = 68400");
  assert(chainBonus(100) === 158400, "100x raw = 1800*88 = 158400 (uncapped)");
  let inc = true;
  for (let n = 13; n <= 40; n++) if (chainBonus(n) <= chainBonus(n - 1)) inc = false;
  assert(inc, "chain score strictly increases for every level 13..40");
  assert(chainBonus(14) > chainBonus(13), "14x > 13x (no plateau / no zeroing)");
}

// ====================================================================
// 4. PER-PANEL BASE SCORE (+10 each) — real Stack._onPop
// ====================================================================
console.log("\n=== 4. PER-PANEL BASE (+10 each via real Stack._onPop) ===");
{
  const s = newStack();
  s._onPop(null);
  assert(s.score === 10, "one pop = +10");
  s._onPop(null); s._onPop(null);
  assert(s.score === 30, "three pops = +30");
}

// ====================================================================
// 5. COMBO + CHAIN + PER-PANEL ADDITIVE (full match event)
// ====================================================================
console.log("\n=== 5. ADDITIVE: combo + chain + per-panel (real match event) ===");
{
  // matchEvent(N, cc) = N*10 + comboBonus(N) + chainBonus(cc)
  assert(matchEvent(3, 1) === 30,   "3-panel baseline = 0+0+30 = 30");
  assert(matchEvent(4, 1) === 60,   "4-panel baseline = 20+0+40 = 60");
  assert(matchEvent(5, 1) === 80,   "5-panel baseline = 30+0+50 = 80");
  assert(matchEvent(4, 3) === 140,  "4-panel on 3x = 20+80+40 = 140");
  assert(matchEvent(3, 2) === 80,   "3-panel on 2x = 0+50+30 = 80");
  assert(matchEvent(3, 5) === 330,  "3-panel on 5x = 0+300+30 = 330");
  assert(matchEvent(6, 4) === 260,  "6-panel on 4x = 50+150+60 = 260");
  assert(matchEvent(8, 5) === 450,  "8-panel on 5x = 70+300+80 = 450");
  assert(matchEvent(10, 13) === 2000, "10-panel on 13x = 100+1800+100 = 2000");
  assert(matchEvent(8, 14) === 3750,  "8-panel on 14x = 70+3600+80 = 3750");
  assert(matchEvent(9, 15) === 5570,  "9-panel on 15x = 80+5400+90 = 5570");
}

// ====================================================================
// 6. SCORE (no cap — cap removed per design; score is uncapped)
// ====================================================================
console.log("\n=== 6. SCORE (NO CAP) ===");
{
  const s = newStack();
  for (let i = 0; i < 20000; i++) s._onPop(null);
  assert(s.score === 200000, "score uncapped: 20000 pops * 10 = 200000 (got " + s.score + ")");
}

console.log("\n=========================");
console.log("SCORING RESULTS: " + pass + " passed, " + fail + " failed");
console.log("=========================");
process.exit(fail ? 1 : 0);
