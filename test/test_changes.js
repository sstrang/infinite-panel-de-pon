"use strict";
// Tests for: staggered clearing, input during clearing, game over fix

const TILE_SIZE = 40;
const CLEAR_BASE_DELAY = 0.12;
const CLEAR_STAGGER = 0.06;
const FALL_SPEED = 550;
const FLASH_DURATION = 0.40;

let cols, rows, grid, nextRow;
let cursorCol, cursorRow;
let score, chainLevel, riseSpeedLevel;
let riseProgress;
let state, stateTimer;
let needsMatchCheck, currentThresholdIdx;
let expandMsgTimer, chainMsgTimer, expandAnimT;

function makeTile(color){ return { color, vy:0, clearing:false }; }
function makeGrid(c,r){ let g=[]; for(let i=0;i<c;i++) g.push(new Array(r).fill(null)); return g; }

function findMatches(){
  let matched=[];
  for(let c=0;c<cols;c++) matched.push(new Array(rows).fill(false));
  for(let r=0;r<rows;r++){
    let c=0;
    while(c<cols){
      if(!grid[c][r]||grid[c][r].clearing){c++;continue;}
      let clr=grid[c][r].color,end=c+1;
      while(end<cols&&grid[end][r]&&!grid[end][r].clearing&&grid[end][r].color===clr)end++;
      if(end-c>=3)for(let i=c;i<end;i++)matched[i][r]=true;
      c=end;
    }
  }
  for(let c=0;c<cols;c++){
    let r=0;
    while(r<rows){
      if(!grid[c][r]||grid[c][r].clearing){r++;continue;}
      let clr=grid[c][r].color,end=r+1;
      while(end<rows&&grid[c][end]&&!grid[c][end].clearing&&grid[c][end].color===clr)end++;
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
  if(chainLevel>=2) chainMsgTimer=1.6;
}

function applyGravity(){
  for(let c=0;c<cols;c++){
    let wr=rows-1;
    for(let r=rows-1;r>=0;r--){
      if(grid[c][r]){
        if(wr!==r){grid[c][wr]=grid[c][r];grid[c][wr].vy=(wr-r)*TILE_SIZE;grid[c][r]=null;}
        wr--;
      }
    }
  }
}

function allSettled(){
  for(let c=0;c<cols;c++)
    for(let r=0;r<rows;r++)
      if(grid[c][r]&&grid[c][r].vy>0)return false;
  return true;
}

function hasFloating(){
  for(let c=0;c<cols;c++){
    let fn=false;
    for(let r=rows-1;r>=0;r--){
      if(!grid[c][r])fn=true;
      else if(fn)return true;
    }
  }
  return false;
}

function handleRise(dt){
  let speed=10+Math.min(riseSpeedLevel,40)*2.5;
  riseProgress+=speed*dt;
  if(riseProgress>=TILE_SIZE){
    for(let c=0;c<cols;c++){
      for(let r=0;r<rows-1;r++)grid[c][r]=grid[c][r+1];
      grid[c][rows-1]=nextRow[c];
      nextRow[c]=makeTile(Math.floor(Math.random()*5));
    }
    riseProgress-=TILE_SIZE;
    for(let c=0;c<cols;c++){
      if(grid[c][0]){state='gameover';return;}
    }
    needsMatchCheck=true;
    if(cursorRow>0)cursorRow--;
  }
}

function updateAnimations(dt){
  for(let c=0;c<cols;c++)
    for(let r=0;r<rows;r++)
      if(grid[c][r]&&grid[c][r].vy>0){
        grid[c][r].vy-=FALL_SPEED*dt;
        if(grid[c][r].vy<0)grid[c][r].vy=0;
      }
}

function update(dt){
  updateAnimations(dt);
  if(state==='playing'){
    handleRise(dt);
    if(state!=='playing'){}
    else if(needsMatchCheck){
      needsMatchCheck=false;
      let res=findMatches();
      if(res.count>=3)startClearing(res);
      else if(hasFloating()){applyGravity();state='falling';}
    }
  } else if(state==='clearing'){
    let anyClearing=false;
    for(let c=0;c<cols;c++)
      for(let r=0;r<rows;r++)
        if(grid[c][r]&&grid[c][r].clearing){
          grid[c][r].clearTimer-=dt;
          if(grid[c][r].clearTimer<=0)grid[c][r]=null;
          else anyClearing=true;
        }
    if(!anyClearing){applyGravity();state='falling';}
  } else if(state==='falling'){
    if(allSettled()){
      let res=findMatches();
      if(res.count>=3)startClearing(res);
      else{chainLevel=0;state='playing';}
    }
  }
}

function doSwap(){
  let r=cursorRow,c=cursorCol;
  if(grid[c][r]&&grid[c][r].clearing)return;
  if(grid[c+1][r]&&grid[c+1][r].clearing)return;
  let tmp=grid[c][r];
  grid[c][r]=grid[c+1][r];
  grid[c+1][r]=tmp;
  needsMatchCheck=true;
}

function setup(customGrid,cc,rr){
  cols=cc;rows=rr;grid=customGrid;
  nextRow=[];for(let c=0;c<cols;c++)nextRow.push(makeTile(0));
  score=0;chainLevel=0;riseSpeedLevel=0;
  riseProgress=0;state='playing';stateTimer=0;
  needsMatchCheck=false;currentThresholdIdx=0;
  expandMsgTimer=0;chainMsgTimer=0;expandAnimT=0;
  cursorCol=2;cursorRow=8;
}

let pass=0,fail=0;
function assert(c,m){if(c){pass++;console.log("  PASS: "+m);}else{fail++;console.log("  FAIL: "+m);}}

// ===== TEST 1: Staggered clearing - tiles vanish one at a time =====
console.log("\n=== 1. STAGGERED CLEARING ===");

console.log("\n-- 3 tiles get staggered timers, vanish sequentially --");
{
  let g=makeGrid(6,12);
  g[0][5]=makeTile(0);g[1][5]=makeTile(0);g[2][5]=makeTile(0);
  setup(g,6,12);
  needsMatchCheck=true;

  update(0.001); // trigger match detection -> startClearing
  assert(state==='clearing',"State is clearing after match");
  assert(chainLevel===1,"Chain level = 1");

  // All 3 tiles should be clearing with staggered timers
  // Bottom-to-top order: (2,5)=0.12, (1,5)=0.18, (0,5)=0.24
  // Actually column order: (0,5) first (bottom-to-top within col), then (1,5), then (2,5)
  // Wait - the loop is: for c=0..5, for r=11..0
  // c=0, r=5: matched, idx=0, timer=0.12
  // c=1, r=5: matched, idx=1, timer=0.18
  // c=2, r=5: matched, idx=2, timer=0.24
  assert(grid[0][5]&&grid[0][5].clearing,"Tile (0,5) is clearing");
  assert(grid[1][5]&&grid[1][5].clearing,"Tile (1,5) is clearing");
  assert(grid[2][5]&&grid[2][5].clearing,"Tile (2,5) is clearing");

  assert(Math.abs(grid[0][5].clearTimer-0.12)<0.001,"Tile 0 timer = 0.12 (got "+grid[0][5].clearTimer+")");
  assert(Math.abs(grid[1][5].clearTimer-0.18)<0.001,"Tile 1 timer = 0.18 (got "+grid[1][5].clearTimer+")");
  assert(Math.abs(grid[2][5].clearTimer-0.24)<0.001,"Tile 2 timer = 0.24 (got "+grid[2][5].clearTimer+")");

  // Advance time to just past first tile's timer
  update(0.13); // 0.12 elapsed -> tile 0 should vanish
  assert(grid[0][5]===null,"Tile (0,5) vanished first (timer expired)");
  assert(grid[1][5]!==null,"Tile (1,5) still clearing");
  assert(grid[2][5]!==null,"Tile (2,5) still clearing");
  assert(state==='clearing',"Still in clearing state");

  // Advance past second tile's timer
  update(0.07); // total 0.20 -> tile 1 (0.18) should vanish
  assert(grid[1][5]===null,"Tile (1,5) vanished second");
  assert(grid[2][5]!==null,"Tile (2,5) still clearing");

  // Advance past third tile's timer
  update(0.05); // total 0.25 -> tile 2 (0.24) should vanish
  assert(grid[2][5]===null,"Tile (2,5) vanished third");
  assert(state==='falling',"State -> falling after all tiles cleared");
}

console.log("\n-- 5-tile match: staggered, total time ~0.36s --");
{
  let g=makeGrid(6,12);
  for(let i=0;i<5;i++) g[i][5]=makeTile(2);
  setup(g,6,12);
  needsMatchCheck=true;

  update(0.001);
  assert(state==='clearing',"5-tile match -> clearing");

  // Timers: 0.12, 0.18, 0.24, 0.30, 0.36
  let count=0;
  for(let c=0;c<cols;c++) if(grid[c][5]&&grid[c][5].clearing) count++;
  assert(count===5,"5 tiles are clearing");

  // After 0.37s, all should be gone
  for(let i=0;i<37;i++) update(0.01);
  count=0;
  for(let c=0;c<cols;c++) if(grid[c][5]) count++;
  assert(count===0,"All 5 tiles gone after 0.37s");
  // State should be falling right after last tile clears (before tiles settle)
  assert(state==='falling'||state==='playing',"State past clearing (="+state+")");
}

console.log("\n-- tiles above clearing tiles don't fall until ALL cleared --");
{
  let g=makeGrid(6,12);
  g[0][10]=makeTile(0);g[1][10]=makeTile(0);g[2][10]=makeTile(0); // match
  g[0][8]=makeTile(1); // tile above, should stay until all 3 clear
  setup(g,6,12);
  needsMatchCheck=true;

  update(0.001);
  assert(state==='clearing',"Match detected -> clearing");

  // Advance past first tile's timer only
  update(0.13);
  assert(grid[0][10]===null,"First clearing tile gone");
  assert(grid[0][8]!==null,"Tile above (0,8) still in place (waiting for all clears)");
  assert(state==='clearing',"Still clearing");

  // Advance past all timers
  update(0.15);
  assert(state==='falling',"All cleared -> falling");
  // After gravity, tile at (0,8) should fall down
  assert(grid[0][8]===null,"(0,8) is now empty (tile fell)");
}

// ===== TEST 2: Input during clearing =====
console.log("\n=== 2. INPUT DURING CLEARING ===");

console.log("\n-- cursor can move during clearing --");
{
  let g=makeGrid(6,12);
  g[0][5]=makeTile(0);g[1][5]=makeTile(0);g[2][5]=makeTile(0); // match at row 5
  g[3][8]=makeTile(1);g[4][8]=makeTile(2); // non-matching tiles at row 8
  setup(g,6,12);
  cursorCol=3;cursorRow=8;
  needsMatchCheck=true;

  update(0.001);
  assert(state==='clearing',"State is clearing");

  // Simulate cursor movement (this is what the keydown handler would do)
  cursorCol=2;
  cursorRow=7;
  // Game should still be in clearing, movement accepted
  assert(state==='clearing',"Cursor moved during clearing, game continues");

  // Tiles not involved in the match are still there
  assert(grid[3][8]&&grid[3][8].color===1,"Non-matching tile still present");
  assert(grid[4][8]&&grid[4][8].color===2,"Non-matching tile still present");
}

console.log("\n-- can swap non-clearing tiles during clearing --");
{
  let g=makeGrid(6,12);
  g[0][5]=makeTile(0);g[1][5]=makeTile(0);g[2][5]=makeTile(0); // match
  g[3][8]=makeTile(1);g[4][8]=makeTile(2); // swappable pair
  setup(g,6,12);
  cursorCol=3;cursorRow=8;
  needsMatchCheck=true;

  update(0.001);
  assert(state==='clearing',"State is clearing");

  // Swap the non-clearing tiles
  doSwap();
  assert(grid[3][8].color===2,"Tile swapped: (3,8) now color 2");
  assert(grid[4][8].color===1,"Tile swapped: (4,8) now color 1");
  assert(needsMatchCheck===true,"needsMatchCheck set by swap during clearing");

  // Game continues clearing
  assert(state==='clearing',"Still clearing after swap");
}

console.log("\n-- cannot swap a tile that is clearing --");
{
  let g=makeGrid(6,12);
  g[0][5]=makeTile(0);g[1][5]=makeTile(0);g[2][5]=makeTile(0); // match (clearing)
  g[2][8]=makeTile(1); // non-clearing tile next to clearing tile
  setup(g,6,12);
  cursorCol=1;cursorRow=5; // cursor on clearing tiles
  needsMatchCheck=true;

  update(0.001);
  assert(state==='clearing',"State is clearing");

  // Try to swap - should be blocked because grid[1][5] is clearing
  let colorBefore = grid[1][5].color;
  let colorBefore2 = grid[2][5] ? grid[2][5].color : null;
  doSwap();
  // Swap should have been blocked
  assert(grid[1][5]&&grid[1][5].clearing,"Tile (1,5) still clearing (swap blocked)");

  // Now try swapping at row 8 where tiles aren't clearing
  cursorCol=1;cursorRow=8;
  // grid[1][8] is null, grid[2][8] is color 1 - one is null, one isn't clearing
  // This should work (null tiles can be swapped)
  doSwap();
  assert(needsMatchCheck===true,"Swap of non-clearing tile succeeded");
}

console.log("\n-- swap during clearing can create match after clears finish --");
{
  let g=makeGrid(6,12);
  // Match at row 5: (0,5),(1,5),(2,5) all color 0
  g[0][5]=makeTile(0);g[1][5]=makeTile(0);g[2][5]=makeTile(0);
  // At row 9: (3,9)=R, (4,9)=B, (5,9)=R, R at col 3 and 5
  g[3][9]=makeTile(0);g[4][9]=makeTile(1);g[5][9]=makeTile(0);
  setup(g,6,12);
  cursorCol=3;cursorRow=9;
  needsMatchCheck=true;

  update(0.001);
  assert(state==='clearing',"Match detected -> clearing");

  // Swap (3,9) and (4,9): puts R at (4,9), making (3,9)=B, (4,9)=R, (5,9)=R
  // Actually: swap makes (3,9)=color1, (4,9)=color0
  // Then (4,9)=0 and (5,9)=0 - only 2 in a row, no match
  // Let me set it up so the swap DOES create a match
  // (3,9)=B, (4,9)=R, (5,9)=R -> swap (3,9) and (4,9) -> (3,9)=R, (4,9)=B, (5,9)=R -> still no match
  // Need swap to CREATE a 3-in-a-row:
  // Before: (1,9)=2, (2,9)=2, (3,9)=1, (4,9)=2 -- no match
  // Swap (3,9) and (4,9): (1,9)=2, (2,9)=2, (3,9)=2 -- 3-in-a-row!
  g=makeGrid(6,12);
  g[0][5]=makeTile(0);g[1][5]=makeTile(0);g[2][5]=makeTile(0); // clearing match
  g[1][9]=makeTile(2);g[2][9]=makeTile(2);g[3][9]=makeTile(1);g[4][9]=makeTile(2); // swap creates match
  setup(g,6,12);
  cursorCol=3;cursorRow=9;
  needsMatchCheck=true;

  update(0.001);
  assert(state==='clearing',"Clearing started");
  assert(chainLevel===1,"Chain = 1 (first match)");

  // Swap during clearing
  doSwap();
  assert(grid[3][9].color===2&&grid[4][9].color===1,"Swap done during clearing");

  // Let clearing finish
  let safety=0;
  while(state==='clearing'&&safety<100){update(0.02);safety++;}

  // After clearing -> falling -> settle -> check for matches (including swap-induced)
  assert(state==='falling'||state==='clearing',"Past initial clearing");

  safety=0;
  while((state==='falling'||state==='clearing')&&safety<200){
    update(0.02);
    safety++;
  }

  // The swap created a match at (2,9),(3,9),(4,9) all color 2
  // This should have been detected as a chain or new match
  assert(score>30,"Score increased beyond first match (swap match detected), score="+score);
}

// ===== TEST 3: Game over off-by-one fix =====
console.log("\n=== 3. GAME OVER OFF-BY-ONE FIX ===");

console.log("\n-- game over triggers when tiles FIRST reach row 0 after shift --");
{
  let g=makeGrid(6,12);
  // Fill rows 1-11 (row 0 empty)
  for(let c=0;c<6;c++)
    for(let r=1;r<12;r++)
      g[c][r]=makeTile((c+r)%5);
  setup(g,6,12);
  // Use safe nextRow
  for(let c=0;c<6;c++) nextRow[c]=makeTile((c+3)%5);

  riseProgress=TILE_SIZE-0.5; // almost at threshold

  // Run until a rise happens
  let safety=0;
  while(state==='playing'&&safety<200){
    update(0.05);
    safety++;
    if(state==='gameover') break;
  }

  // After the shift: row 1 tiles moved to row 0. With the fix, game over triggers immediately.
  assert(state==='gameover',"Game over when tiles first reach row 0 (not waiting for next rise)");
}

console.log("\n-- no game over when top rows are empty --");
{
  let g=makeGrid(6,12);
  // Only fill rows 6-11 (plenty of room)
  for(let c=0;c<6;c++)
    for(let r=6;r<12;r++)
      g[c][r]=makeTile((c+r)%5);
  setup(g,6,12);
  for(let c=0;c<6;c++) nextRow[c]=makeTile((c+3)%5);

  riseProgress=TILE_SIZE-0.5;
  let safety=0;
  while(state==='playing'&&safety<100){update(0.05);safety++;}

  assert(state!=='gameover',"No game over when plenty of room at top (state="+state+")");
}

console.log("\n-- game over not triggered by match clear emptying top row --");
{
  let g=makeGrid(6,12);
  // Row 0-1 empty, tiles fill from row 2
  for(let c=0;c<6;c++)
    for(let r=2;r<12;r++)
      g[c][r]=makeTile((c+r)%5);
  setup(g,6,12);
  for(let c=0;c<6;c++) nextRow[c]=makeTile((c+3)%5);

  // No rise for a while - should be fine
  let safety=0;
  while(safety<50){update(0.02);safety++;}
  assert(state!=='gameover',"No game over during normal play with empty top");
}

console.log("\n=========================");
console.log("STAGGER/INPUT/GAMEOVER RESULTS: "+pass+" passed, "+fail+" failed");
console.log("=========================");
process.exit(fail>0?1:0);
