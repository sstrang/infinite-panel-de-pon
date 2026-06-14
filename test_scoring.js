"use strict";
// ====================================================================
//  SCORING ENGINE TEST SUITE
//  Validates the combo, chain, and additive (combo-during-chain) scoring
//  logic exactly as specified. Replicates the pure scoring functions
//  standalone (no browser/DOM).
// ====================================================================

// ---- scoring functions mirrored exactly from index.html ----
function comboScore(panels){
  if(panels <= 3) return 0;
  if(panels === 4) return 20;
  if(panels === 5) return 30;
  if(panels === 6) return 50;
  if(panels === 7) return 60;
  if(panels === 8) return 70;
  return 70 + (panels - 8) * 10;
}
function chainScore(level){
  if(level <= 1) return 0;
  const table = [0,0,50,80,150,300,400,500,700,900,1100,1300,1500,1800];
  if(level <= 13) return table[level];
  return 1800 * (level - 12);
}
// total awarded for a single match event
function matchScore(panels, currentChain){
  return comboScore(panels) + chainScore(currentChain);
}

function approx(a,b,eps){ eps=eps||0.001; return Math.abs(a-b)<=eps; }
let pass=0, fail=0;
function assert(c,m){ if(c){pass++;console.log("  PASS: "+m);} else {fail++;console.log("  FAIL: "+m);} }

// ====================================================================
// 1. SIMULTANEOUS CLEARS (COMBOS)
// ====================================================================
console.log("\n=== 1. COMBO TABLE (Simultaneous Clears) ===");
{
  assert(comboScore(3)===0,  "3 panels = 0 (baseline, no bonus)");
  assert(comboScore(4)===20, "4 panels = 20");
  assert(comboScore(5)===30, "5 panels = 30");
  assert(comboScore(6)===50, "6 panels = 50");
  assert(comboScore(7)===60, "7 panels = 60");
  assert(comboScore(8)===70, "8 panels = 70");
  // formula beyond 8: 70 + (panels-8)*10
  assert(comboScore(9)===80,  "9 panels = 70 + 1*10 = 80");
  assert(comboScore(10)===90, "10 panels = 70 + 2*10 = 90");
  assert(comboScore(12)===110,"12 panels = 70 + 4*10 = 110");
  assert(comboScore(20)===190,"20 panels = 70 + 12*10 = 190");
  assert(comboScore(2)===0,   "below 3 = 0 (defensive)");
  assert(comboScore(0)===0,   "0 panels = 0 (defensive)");
}

// ====================================================================
// 2. CONSECUTIVE CLEARS (CHAINS) — full table
// ====================================================================
console.log("\n=== 2. CHAIN TABLE (Consecutive Clears) ===");
{
  assert(chainScore(1)===0,    "1x (baseline) = 0");
  assert(chainScore(2)===50,   "2x = 50");
  assert(chainScore(3)===80,   "3x = 80");
  assert(chainScore(4)===150,  "4x = 150");
  assert(chainScore(5)===300,  "5x = 300");
  assert(chainScore(6)===400,  "6x = 400");
  assert(chainScore(7)===500,  "7x = 500");
  assert(chainScore(8)===700,  "8x = 700");
  assert(chainScore(9)===900,  "9x = 900");
  assert(chainScore(10)===1100,"10x = 1100");
  assert(chainScore(11)===1300,"11x = 1300");
  assert(chainScore(12)===1500,"12x = 1500");
  assert(chainScore(13)===1800,"13x = 1800");
}

// ====================================================================
// 3. INFINITE CHAIN (NO 13x CAP)
// ====================================================================
console.log("\n=== 3. INFINITE CHAIN (N >= 14) ===");
{
  // For N >= 14: chainScore(N) = 1800 * (N - 12) — no plateau with 13x
  assert(chainScore(14)===3600,  "14x = 1800 * 2 = 3600");
  assert(chainScore(15)===5400,  "15x = 1800 * 3 = 5400");
  assert(chainScore(16)===7200,  "16x = 1800 * 4 = 7200");
  assert(chainScore(20)===14400, "20x = 1800 * 8 = 14400");
  assert(chainScore(50)===68400, "50x = 1800 * 38 = 68400");
  assert(chainScore(100)===158400,"100x = 1800 * 88 = 158400");
  // monotonic increase — never flat or decreasing
  let mono=true;
  for(let L=1;L<=100;L++) if(chainScore(L) < chainScore(L+1)-0.001){ /* ok */ } else if(L>=14 && chainScore(L) > chainScore(L+1)){ mono=false; }
  // explicitly verify every step 13..40 strictly increases (no plateau at 13→14)
  let strictInc=true;
  for(let L=13;L<40;L++) if(!(chainScore(L+1) > chainScore(L))) strictInc=false;
  assert(strictInc, "chain score strictly increases for every level 13..40 (no plateau at all)");
  // verify the plateau is removed: 14x must be strictly greater than 13x
  assert(chainScore(14) > chainScore(13), "14x > 13x (plateau removed)");
}

// ====================================================================
// 4. COMBOS DURING CHAINS (Additive)
// ====================================================================
console.log("\n=== 4. COMBO + CHAIN ADDITIVE ===");
{
  // example from spec: 4-panel on 3x chain = 20 + 80 = 100
  assert(matchScore(4, 3)===100, "4-panel on 3x = 20 + 80 = 100 (spec example)");

  // plain 3-panel at baseline = 0
  assert(matchScore(3, 1)===0, "3-panel baseline = 0 + 0 = 0");

  // 3-panel during a chain (combo=0, chain only)
  assert(matchScore(3, 2)===50,  "3-panel on 2x = 0 + 50 = 50");
  assert(matchScore(3, 5)===300, "3-panel on 5x = 0 + 300 = 300");

  // 6-panel combo on a 4x chain
  assert(matchScore(6, 4)===200, "6-panel on 4x = 50 + 150 = 200");

  // 8-panel combo on a 5x chain
  assert(matchScore(8, 5)===370, "8-panel on 5x = 70 + 300 = 370");

  // big combo during high chain
  assert(matchScore(10,13)===1890, "10-panel on 13x = 90 + 1800 = 1890");
  let additive=true;
  for(let p=3;p<=15;p++)
    for(let L=1;L<=20;L++)
      if(matchScore(p,L) !== comboScore(p)+chainScore(L)) additive=false;
  assert(additive, "matchScore = comboScore + chainScore for all tested panel/chain combos");

  // explicit big example
  assert(matchScore(10,13)===1890, "10-panel on 13x = 90 + 1800 = 1890");
  assert(matchScore(8,14)===3670,  "8-panel on 14x = 70 + 3600 = 3670");
  assert(matchScore(9,15)===5480,  "9-panel on 15x = 80 + 5400 = 5480");
}

// ====================================================================
// 5. CHAIN RESET SEMANTICS
// ====================================================================
console.log("\n=== 5. CHAIN MULTIPLIER STATE ===");
{
  // currentChain=1 means no active chain (baseline); chainScore(1)=0
  assert(chainScore(1)===0, "currentChain=1 yields 0 chain points (baseline)");
  // a fresh swap match (currentChain stays 1) scores combo only
  assert(matchScore(4,1)===20, "4-panel fresh match (chain=1) = 20 + 0 = 20");
  assert(matchScore(3,1)===0,  "3-panel fresh match (chain=1) = 0 (no combo, no chain)");
  // the first gravity chain bumps to currentChain=2
  assert(chainScore(2)===50, "first gravity chain → currentChain=2 → 50 pts");
}

console.log("\n=========================");
console.log("SCORING RESULTS: "+pass+" passed, "+fail+" failed");
console.log("=========================");
process.exit(fail>0?1:0);
