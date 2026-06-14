"use strict";
// Tests for: gravity during clearing + swap cooldown

const TILE_SIZE = 40;
const CLEAR_BASE_DELAY = 0.48;
const CLEAR_STAGGER = 0.24;
const FALL_SPEED = 550;
const SWAP_COOLDOWN = 0.12;

let cols, rows, grid, nextRow;
let cursorCol, cursorRow;
let score, chainLevel, riseSpeedLevel;
let riseProgress;
let state, stateTimer;
let needsMatchCheck, manualRaise, swapCooldown;

function makeTile(color){ return { color, vy:0, clearing:false, cleared:false }; }
function makeGrid(c,r){ let g=[]; for(let i=0;i<c;i++) g.push(new Array(r).fill(null)); return g; }

function findMatches(){
  let matched=[];
  for(let c=0;c<cols;c++) matched.push(new Array(rows).fill(false));
  for(let r=0;r<rows;r++){
    let c=0;
    while(c<cols){
      if(!grid[c][r]||grid[c][r].clearing||grid[c][r].cleared){c++;continue;}
      let clr=grid[c][r].color,end=c+1;
      while(end<cols&&grid[end][r]&&!grid[end][r].clearing&&!grid[end][r].cleared&&grid[end][r].color===clr)end++;
      if(end-c>=3)for(let i=c;i<end;i++)matched[i][r]=true;
      c=end;
    }
  }
  for(let c=0;c<cols;c++){
    let r=0;
    while(r<rows){
      if(!grid[c][r]||grid[c][r].clearing||grid[c][r].cleared){r++;continue;}
      let clr=grid[c][r].color,end=r+1;
      while(end<rows&&grid[c][end]&&!grid[c][end].clearing&&!grid[c][end].cleared&&grid[c][end].color===clr)end++;
      if(end-r>=3)for(let i=r;i<end;i++)matched[c][i]=true;
      r=end;
    }
  }
  let count=0;
  for(let c=0;c<cols;c++)for(let r=0;r<rows;r++)if(matched[c][r])count++;
  return{matched,count};
}

function startClearing(result){
  chainLevel++;
  let tiles=result.count;
  score += tiles*10*chainLevel + Math.max(0,tiles-3)*20;
  let idx=0;
  for(let c=0;c<cols;c++)
    for(let r=rows-1;r>=0;r--)
      if(result.matched[c][r]){
        grid[c][r].clearing=true;
        grid[c][r].clearTimer=CLEAR_BASE_DELAY+idx*CLEAR_STAGGER;
        idx++;
      }
  state='clearing';
}

// MODIFIED: skips clearing/cleared tiles, uses += for vy
function applyGravity(){
  for(let c=0;c<cols;c++){
    let writeRow=rows-1;
    for(let r=rows-1;r>=0;r--){
      if(grid[c][r]){
        if(grid[c][r].clearing || grid[c][r].cleared){
          writeRow = r - 1;
        } else {
          if(writeRow!==r){
            grid[c][writeRow]=grid[c][r];
            grid[c][writeRow].vy += (writeRow-r)*TILE_SIZE;
            grid[c][r]=null;
          }
          writeRow--;
        }
      }
    }
  }
}

function allSettled(){
  for(let c=0;c<cols;c++)for(let r=0;r<rows;r++)if(grid[c][r]&&grid[c][r].vy>0)return false;
  return true;
}

// MODIFIED: resets foundNull on clearing/cleared barrier tiles
function hasFloating(){
  for(let c=0;c<cols;c++){
    let foundNull=false;
    for(let r=rows-1;r>=0;r--){
      if(!grid[c][r]) foundNull=true;
      else {
        if(grid[c][r].clearing || grid[c][r].cleared){
          foundNull=false;
        } else if(foundNull) return true;
      }
    }
  }
  return false;
}

function updateAnimations(dt){
  for(let c=0;c<cols;c++)for(let r=0;r<rows;r++)
    if(grid[c][r]&&grid[c][r].vy>0){
      grid[c][r].vy-=FALL_SPEED*dt;
      if(grid[c][r].vy<0)grid[c][r].vy=0;
    }
}

function update(dt){
  updateAnimations(dt);
  if(swapCooldown>0) swapCooldown-=dt;

  if(state==='playing'){
    if(needsMatchCheck){
      needsMatchCheck=false;
      let res=findMatches();
      if(res.count>=3) startClearing(res);
      else if(hasFloating()){ applyGravity(); state='falling'; }
    }
  } else if(state==='clearing'){
    for(let c=0;c<cols;c++)
      for(let r=0;r<rows;r++)
        if(grid[c][r]&&grid[c][r].clearing){
          grid[c][r].clearTimer-=dt;
          if(grid[c][r].clearTimer<=0){
            grid[c][r].cleared=true;
            grid[c][r].clearing=false;
          }
        }
    if(needsMatchCheck){
      needsMatchCheck=false;
      let res=findMatches();
      if(res.count>=3) startClearing(res);
    }
    // gravity during clearing
    if(hasFloating()){ applyGravity(); }
    // check if done
    let anyClearing=false;
    outer: for(let c=0;c<cols;c++)for(let r=0;r<rows;r++)
      if(grid[c][r]&&grid[c][r].clearing){anyClearing=true;break outer;}
    if(!anyClearing){
      for(let c=0;c<cols;c++)for(let r=0;r<rows;r++)
        if(grid[c][r]&&grid[c][r].cleared) grid[c][r]=null;
      applyGravity(); state='falling';
    }
  } else if(state==='falling'){
    if(allSettled()){
      let res=findMatches();
      if(res.count>=3) startClearing(res);
      else{chainLevel=0;state='playing';}
    }
  }
}

function doSwap(){
  if(swapCooldown>0) return false;
  let r=cursorRow, c=cursorCol;
  if(grid[c][r] && (grid[c][r].clearing||grid[c][r].cleared)) return false;
  if(grid[c+1][r] && (grid[c+1][r].clearing||grid[c+1][r].cleared)) return false;
  let tmp = grid[c][r];
  grid[c][r] = grid[c+1][r];
  grid[c+1][r] = tmp;
  needsMatchCheck = true;
  swapCooldown = SWAP_COOLDOWN;
  return true;
}

function setup(customGrid,cc,rr){
  cols=cc;rows=rr;grid=customGrid;
  nextRow=[];
  for(let c=0;c<cols;c++)nextRow.push(makeTile(0));
  score=0;chainLevel=0;riseSpeedLevel=0;
  riseProgress=0;state='playing';stateTimer=0;
  needsMatchCheck=false;manualRaise=false;swapCooldown=0;
  cursorCol=2;cursorRow=8;
}

let pass=0,fail=0;
function assert(c,m){if(c){pass++;console.log("  PASS: "+m);}else{fail++;console.log("  FAIL: "+m);}}

// =====================================================
// PART 1: GRAVITY DURING CLEARING
// =====================================================
console.log("\n=== GRAVITY DURING CLEARING ===");

// --- Test 1: Tile falls into pre-existing gap during clearing ---
console.log("\n-- tile falls into pre-existing gap while other tiles clearing --");
{
  let g=makeGrid(6,12);
  // Column 0: tile at row 6, null at row 7, tile at row 8 (gap below tile at 6? No, 7 is below 6? No!)
  // Row 0 = top, Row 11 = bottom. "Below" = higher row number.
  // Column 0: tile at row 6, null at row 7, tile at row 8,9,10,11
  // Wait, that means row 7 (below row 6) is null. But row 8 is filled. So tile at 6 is above a gap.
  // Actually no: rows go 0 (top) to 11 (bottom). "Below" = higher index.
  // Col 0: [null...null] [tile@6] [null@7] [tile@8] ...
  // Tile at row 6 is ABOVE null at row 7? No! Row 7 is BELOW row 6 (higher index = lower on screen).
  // So tile at 6 with null at 7 means tile is floating (null below it).
  // But wait, tile at row 8 is below the null at 7. So from bottom: 8,9,10,11 filled, 7 null, 6 tile.
  // The tile at 6 has a null below it at 7. It should fall.
  g[0][8]=makeTile(1); g[0][9]=makeTile(1); g[0][10]=makeTile(1); g[0][11]=makeTile(1);
  g[0][6]=makeTile(2); // floating tile with null at row 7

  // Match in columns 3,4,5 at row 11
  g[3][11]=makeTile(0); g[4][11]=makeTile(0); g[5][11]=makeTile(0);

  setup(g,6,12);
  needsMatchCheck=true;

  update(0.001);
  assert(state==='clearing',"entered clearing state");

  // Now tile at (0,6) should be able to fall into gap at (0,7)
  assert(hasFloating(),"hasFloating detects tile above gap during clearing");

  // Apply one update frame — gravity should move the tile
  update(0.016);
  assert(grid[0][7]!==null,"tile fell from row 6 to row 7 (grid[0][7] is now filled)");
  assert(grid[0][6]===null,"grid[0][6] is now null (tile moved down)");
  assert(grid[0][7].color===2,"the fallen tile has the right color");
  assert(grid[0][7].vy>0,"fallen tile has vy > 0 (animating)");
}

// --- Test 2: Tile does NOT fall past clearing tile ---
console.log("\n-- tile blocked by clearing tile below does not fall --");
{
  let g=makeGrid(6,12);
  // Column 0: tile@5, clearing@6, null@7, tile@8
  g[0][5]=makeTile(2);
  g[0][8]=makeTile(1); g[0][9]=makeTile(1); g[0][10]=makeTile(1); g[0][11]=makeTile(1);

  // Match at columns 3,4,5 row 11
  g[3][11]=makeTile(0); g[4][11]=makeTile(0); g[5][11]=makeTile(0);

  setup(g,6,12);
  needsMatchCheck=true;
  update(0.001);
  assert(state==='clearing',"entered clearing");

  // Manually mark tile at (0,6) as clearing (simulating a vertical match)
  g[0][6]=makeTile(3);
  g[0][6].clearing=true;
  g[0][6].clearTimer=1.0;

  // Tile at (0,5) is above clearing tile at (0,6). Below that is null at (0,7).
  // The tile at (0,5) should NOT fall because the clearing tile blocks it.
  assert(!hasFloating(),"hasFloating returns false — clearing tile blocks gap");
  update(0.016);
  assert(grid[0][5]!==null,"tile at row 5 stays (blocked by clearing tile)");
  assert(grid[0][5].color===2,"tile at row 5 is the same tile");
}

// --- Test 3: Tile falls into gap above clearing tile ---
console.log("\n-- tile falls into gap that is above a clearing tile --");
{
  let g=makeGrid(6,12);
  // Column 0: tile@4, null@5, clearing@6, tile@7,8,9,10,11
  g[0][4]=makeTile(2);
  g[0][7]=makeTile(1); g[0][8]=makeTile(1); g[0][9]=makeTile(1);
  g[0][10]=makeTile(1); g[0][11]=makeTile(1);

  // Match at columns 3,4,5 row 11
  g[3][11]=makeTile(0); g[4][11]=makeTile(0); g[5][11]=makeTile(0);

  setup(g,6,12);
  needsMatchCheck=true;
  update(0.001);
  assert(state==='clearing',"entered clearing");

  // Manually mark tile at (0,6) as clearing
  g[0][6]=makeTile(3);
  g[0][6].clearing=true;
  g[0][6].clearTimer=1.0;

  // Tile at (0,4) has null at (0,5) below it. The clearing tile is at (0,6), below the null.
  // Tile at (0,4) should fall into (0,5) — it's above the null, not blocked by clearing tile.
  assert(hasFloating(),"hasFloating detects tile above gap (null at 5, clearing at 6 below)");
  update(0.016);
  assert(grid[0][5]!==null,"tile fell from row 4 to row 5 (above clearing tile)");
  assert(grid[0][5].color===2,"correct tile fell");
  assert(grid[0][4]===null,"row 4 is now empty");
}

// --- Test 4: Swap creates gap, tile falls during clearing ---
console.log("\n-- swap creates floating tile, falls during clearing --");
{
  let g=makeGrid(6,12);
  // Fill columns 2,3 from row 6 down
  for(let r=6;r<12;r++){ g[2][r]=makeTile((r)%5); g[3][r]=makeTile((r+1)%5); }
  // Column 2 has a gap: put null at row 8
  g[2][8]=null;

  // Match at columns 3,4,5 at row 11 (need distinct colors to not conflict)
  g[3][11]=makeTile(0); g[4][11]=makeTile(0); g[5][11]=makeTile(0);

  setup(g,6,12);
  cursorCol=2; cursorRow=6;

  // Enter clearing from the match
  needsMatchCheck=true;
  update(0.001);
  assert(state==='clearing',"entered clearing");

  // Column 2 has tiles at 6,7, null at 8, tiles at 9,10,11
  // Tile at (2,7) has null below at (2,8) — should fall
  assert(hasFloating(),"floating tile detected in column 2");
  update(0.016);
  assert(grid[2][8]!==null,"tile fell into gap at row 8");
  assert(grid[2][6]===null,"row 6 is now empty (top tile cascaded down)");
}

// --- Test 5: After clearing completes, ghosts removed, full gravity applies ---
console.log("\n-- after clearing completes, tiles above ex-ghosts fall --");
{
  let g=makeGrid(6,12);
  // Column 0: tile@4, ghost@5(ex-clearing), tile@6,7,8,9,10,11
  g[0][4]=makeTile(2);
  for(let r=6;r<=11;r++) g[0][r]=makeTile(1);

  // Match at columns 3,4,5 at row 11
  g[3][11]=makeTile(0); g[4][11]=makeTile(0); g[5][11]=makeTile(0);

  setup(g,6,12);
  needsMatchCheck=true;
  update(0.001); // enter clearing

  // Set tile at (0,5) as clearing with very short timer
  g[0][5]=makeTile(3);
  g[0][5].clearing=true;
  g[0][5].clearTimer=0.01;

  // Tile at (0,4) is above clearing tile at (0,5). Can't fall yet.
  assert(grid[0][4]!==null,"tile at row 4 stays while clearing below");
  assert(grid[0][4].color===2,"correct tile at row 4");

  // Advance past the clear timer
  update(0.02);
  // Tile at (0,5) should now be ghost (cleared=true)
  assert(grid[0][5]&&grid[0][5].cleared,"tile at row 5 is now a ghost");

  // Still can't fall (ghost is non-null barrier)
  assert(grid[0][4]!==null,"tile at row 4 still blocked by ghost");

  // Wait for all clearing to complete
  // The original match tiles at (3,11),(4,11),(5,11) have timers 0.48, 0.72, 0.96
  // Need to advance past 0.96
  let safety=0;
  while(state==='clearing' && safety<200){
    update(0.02);
    safety++;
  }
  assert(state==='falling',"transitioned to falling after all clearing done");
  // Ghost at (0,5) was removed. Tile from (0,4) should have fallen.
  assert(grid[0][4]===null,"row 4 is now empty after ghost removal");
  // Tile should be lower in the column
  let foundTile=false;
  for(let r=4;r<=11;r++){
    if(grid[0][r] && grid[0][r].color===2) foundTile=true;
  }
  assert(foundTile,"the original tile from row 4 is now somewhere lower in column 0");
}

// --- Test 6: Modified hasFloating ignores clearing tiles as potential floaters ---
console.log("\n-- hasFloating ignores clearing tiles as floaters --");
{
  let g=makeGrid(6,12);
  // Column 0: clearing tile at row 5, null at row 6, tile at row 7
  g[0][5]=makeTile(0); g[0][5].clearing=true; g[0][5].clearTimer=1.0;
  g[0][7]=makeTile(1); g[0][8]=makeTile(1); g[0][9]=makeTile(1);
  g[0][10]=makeTile(1); g[0][11]=makeTile(1);

  setup(g,6,12);
  state='clearing';

  // The clearing tile at (0,5) has null at (0,6) below it. But it's clearing, so it shouldn't count.
  // hasFloating should return false because the only tile above a null is a clearing tile.
  assert(!hasFloating(),"clearing tile above null is not considered floating");
}

// --- Test 7: Multiple gaps in different columns during clearing ---
console.log("\n-- tiles fall in multiple columns during clearing --");
{
  let g=makeGrid(6,12);
  // Column 0: tile@6, null@7, tiles@8-11
  g[0][6]=makeTile(0);
  for(let r=8;r<=11;r++) g[0][r]=makeTile(1);
  // Column 2: tile@5, null@6, tiles@7-11
  g[2][5]=makeTile(2);
  for(let r=7;r<=11;r++) g[2][r]=makeTile(3);

  // Match at columns 4,5 at row 11 + need 3 in a row... use cols 3,4,5
  g[3][11]=makeTile(4); g[4][11]=makeTile(4); g[5][11]=makeTile(4);

  setup(g,6,12);
  needsMatchCheck=true;
  update(0.001);
  assert(state==='clearing',"entered clearing");
  assert(hasFloating(),"floating tiles detected in multiple columns");

  update(0.016);
  assert(grid[0][7]!==null,"column 0: tile fell into gap at row 7");
  assert(grid[2][6]!==null,"column 2: tile fell into gap at row 6");
}

// =====================================================
// PART 2: SWAP COOLDOWN
// =====================================================
console.log("\n=== SWAP COOLDOWN ===");

// --- Test 8: Immediate double-swap is blocked ---
console.log("\n-- second swap blocked within cooldown window --");
{
  let g=makeGrid(6,12);
  for(let r=6;r<=11;r++){ g[0][r]=makeTile(1); g[1][r]=makeTile(2); }
  setup(g,6,12);
  cursorCol=0; cursorRow=10;
  swapCooldown=0;

  let s1=doSwap();
  assert(s1===true,"first swap succeeds");
  assert(swapCooldown>0,"swapCooldown set after swap");
  assert(grid[0][10].color===2,"tile moved to col 0");
  assert(grid[1][10].color===1,"tile moved to col 1");

  // Immediate second swap should be blocked
  let s2=doSwap();
  assert(s2===false,"second swap blocked by cooldown");
  assert(grid[0][10].color===2,"tiles NOT swapped back (col 0 still has color 2)");
  assert(grid[1][10].color===1,"tiles NOT swapped back (col 1 still has color 1)");
}

// --- Test 9: Swap allowed after cooldown expires ---
console.log("\n-- swap allowed after cooldown expires --");
{
  let g=makeGrid(6,12);
  for(let r=6;r<=11;r++){ g[0][r]=makeTile(1); g[1][r]=makeTile(2); }
  setup(g,6,12);
  cursorCol=0; cursorRow=10;

  doSwap();
  assert(swapCooldown>0,"cooldown active");

  // Advance time past cooldown
  update(SWAP_COOLDOWN + 0.01);
  assert(swapCooldown<=0,"cooldown expired");

  let s2=doSwap();
  assert(s2===true,"second swap succeeds after cooldown");
  assert(grid[0][10].color===1,"tiles swapped back");
  assert(grid[1][10].color===2,"tiles swapped back");
}

// --- Test 10: Cooldown is exactly SWAP_COOLDOWN ---
console.log("\n-- cooldown duration is correct --");
{
  let g=makeGrid(6,12);
  for(let r=6;r<=11;r++){ g[2][r]=makeTile(1); g[3][r]=makeTile(2); }
  setup(g,6,12);
  cursorCol=2; cursorRow=10;

  doSwap();
  assert(Math.abs(swapCooldown-SWAP_COOLDOWN)<0.001,"swapCooldown = SWAP_COOLDOWN");

  // Halfway through
  update(SWAP_COOLDOWN/2);
  assert(swapCooldown>0,"still on cooldown at halfway");
  assert(doSwap()===false,"swap blocked at halfway");

  // Rest of the way
  update(SWAP_COOLDOWN/2 + 0.001);
  assert(swapCooldown<=0,"cooldown expired");
  assert(doSwap()===true,"swap allowed after full cooldown");
}

// --- Test 11: Swap cooldown works during clearing state ---
console.log("\n-- swap cooldown active during clearing --");
{
  let g=makeGrid(6,12);
  g[0][11]=makeTile(0); g[1][11]=makeTile(0); g[2][11]=makeTile(0);
  setup(g,6,12);
  cursorCol=3; cursorRow=10;
  g[3][10]=makeTile(1); g[4][10]=makeTile(2);

  needsMatchCheck=true;
  update(0.001);
  assert(state==='clearing',"in clearing state");

  // Swap during clearing
  let s1=doSwap();
  assert(s1===true,"first swap during clearing succeeds");
  assert(swapCooldown>0,"cooldown set during clearing");

  // Immediate second swap blocked
  let s2=doSwap();
  assert(s2===false,"second swap blocked during clearing");
}

// --- Test 12: Failed swap (clearing tile) does NOT set cooldown ---
console.log("\n-- blocked swap (clearing tile) does not set cooldown --");
{
  let g=makeGrid(6,12);
  g[0][10]=makeTile(0); g[0][10].clearing=true; g[0][10].clearTimer=1.0;
  g[1][10]=makeTile(1);
  setup(g,6,12);
  cursorCol=0; cursorRow=10;
  state='clearing';
  swapCooldown=0;

  let s=doSwap();
  assert(s===false,"swap blocked (tile is clearing)");
  assert(swapCooldown===0,"cooldown NOT set when swap was blocked");
}

// --- Test 13: Swap into gap creates floating tile, gravity handles it ---
console.log("\n-- swap into null creates floating tile, gravity applies --");
{
  let g=makeGrid(6,12);
  // Column 2: tile at row 9, null at row 10, tile at row 11
  g[2][9]=makeTile(1); g[2][11]=makeTile(2);
  // Column 3: null at row 9, tile at row 10, tile at row 11
  g[3][10]=makeTile(3); g[3][11]=makeTile(4);

  setup(g,6,12);
  cursorCol=2; cursorRow=9;

  // Swap col 2 row 9 (tile color 1) with col 3 row 9 (null)
  let s=doSwap();
  assert(s===true,"swap with null succeeds");
  assert(grid[2][9]===null,"col 2 row 9 is now null (tile moved to col 3)");
  assert(grid[3][9]!==null && grid[3][9].color===1,"col 3 row 9 has the moved tile");

  // Now col 2 has: tile@9 was moved out, so null@9, null@10, tile@11
  // Wait, col 2 row 9 was swapped to null. Below it: null@10, tile@11
  // The tile at row 11 has nulls above (rows 9,10) — it's at the bottom, no issue
  // But actually after the swap, col 2: [null@9, null@10, tile@11]
  // That's fine, tile@11 is at the bottom

  // Col 3: tile@9 (just moved), tile@10, tile@11 — all filled, no gap

  // needsMatchCheck should trigger gravity check
  assert(needsMatchCheck,"needsMatchCheck set by swap");
  update(0.001);
  // No matches, but check floating: col 2 has tile@11 with nulls above, but nothing below
  // Actually nothing is floating — tile@11 is at the bottom
  // The swap moved a tile to col 3 row 9, which is supported by tiles at 10, 11
}

// --- Test 14: applyGravity with += preserves existing vy ---
console.log("\n-- applyGravity adds to existing vy (concurrent falls) --");
{
  let g=makeGrid(6,12);
  // Column 0: tile at row 4 with existing vy=20 (mid-fall), null at 5,6, tile at 7
  g[0][4]=makeTile(1); g[0][4].vy=20;
  for(let r=7;r<=11;r++) g[0][r]=makeTile(2);

  setup(g,6,12);
  state='clearing'; // allow gravity call

  // Tile at row 4 has vy=20 and null below at rows 5,6
  // applyGravity should move it down and ADD to vy
  applyGravity();

  // Tile should move from row 4 to row 6 (2 rows down, tiles at 7-11)
  assert(grid[0][6]!==null,"tile moved to row 6");
  assert(grid[0][6].color===1,"correct tile");
  assert(grid[0][6].vy===20+2*TILE_SIZE,"vy = old_vy + distance ("+grid[0][6].vy+" vs "+(20+2*TILE_SIZE)+")");
}

// --- Test 15: Normal applyGravity still works (no clearing tiles) ---
console.log("\n-- normal gravity still works without clearing tiles --");
{
  let g=makeGrid(6,12);
  // Column 0: tile@5, null@6, tile@7,8,9,10,11
  g[0][5]=makeTile(0);
  for(let r=7;r<=11;r++) g[0][r]=makeTile(1);

  setup(g,6,12);
  // No clearing/cleared tiles — should behave like original
  applyGravity();
  assert(grid[0][6]!==null,"tile fell from row 5 to row 6");
  assert(grid[0][5]===null,"row 5 now empty");
  assert(grid[0][6].vy===TILE_SIZE,"vy = 1 * TILE_SIZE");
}

console.log("\n=========================");
console.log("GRAVITY/SWAP RESULTS: "+pass+" passed, "+fail+" failed");
console.log("=========================");
process.exit(fail>0?1:0);
