"use strict";
// Tests for: ghost tiles (blocked empty space), concurrent match processing

const TILE_SIZE = 40;
const CLEAR_BASE_DELAY = 0.48;
const CLEAR_STAGGER = 0.24;
const FALL_SPEED = 550;

let cols, rows, grid, nextRow;
let cursorCol, cursorRow;
let score, chainLevel, riseSpeedLevel;
let riseProgress;
let state, stateTimer;
let needsMatchCheck, currentThresholdIdx;
let expandMsgTimer, chainMsgTimer, expandAnimT;

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
    if(needsMatchCheck){
      needsMatchCheck=false;
      let res=findMatches();
      if(res.count>=3)startClearing(res);
      else if(hasFloating()){applyGravity();state='falling';}
    }
  } else if(state==='clearing'){
    // decrement timers
    for(let c=0;c<cols;c++)
      for(let r=0;r<rows;r++)
        if(grid[c][r]&&grid[c][r].clearing){
          grid[c][r].clearTimer-=dt;
          if(grid[c][r].clearTimer<=0){
            grid[c][r].cleared=true;
            grid[c][r].clearing=false;
          }
        }
    // process new matches immediately
    if(needsMatchCheck){
      needsMatchCheck=false;
      let res=findMatches();
      if(res.count>=3)startClearing(res);
    }
    // check if still clearing
    let anyClearing=false;
    outer:
    for(let c=0;c<cols;c++){
      for(let r=0;r<rows;r++){
        if(grid[c][r]&&grid[c][r].clearing){anyClearing=true;break outer;}
      }
    }
    if(!anyClearing){
      for(let c=0;c<cols;c++)
        for(let r=0;r<rows;r++)
          if(grid[c][r]&&grid[c][r].cleared) grid[c][r]=null;
      applyGravity();
      state='falling';
    }
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
  if(grid[c][r]&&(grid[c][r].clearing||grid[c][r].cleared))return;
  if(grid[c+1][r]&&(grid[c+1][r].clearing||grid[c+1][r].cleared))return;
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

// ===== TEST 1: Ghost tiles block gravity =====
console.log("\n=== 1. GHOST TILES BLOCK GRAVITY ===");

console.log("\n-- tile above a cleared tile stays in place until sequence ends --");
{
  let g=makeGrid(6,12);
  g[0][10]=makeTile(0);g[1][10]=makeTile(0);g[2][10]=makeTile(0); // match at row 10
  g[0][8]=makeTile(1); // tile above
  setup(g,6,12);
  needsMatchCheck=true;

  update(0.001);
  assert(state==='clearing',"Match -> clearing");

  // Advance past first tile's clearTimer but not all
  update(CLEAR_BASE_DELAY + 0.01);
  // First tile is now cleared (ghost), but other two still clearing
  assert(grid[0][10]&&grid[0][10].cleared,"Tile (0,10) is ghost (cleared=true)");
  assert(!grid[0][10].clearing,"Tile (0,10) no longer clearing");
  assert(grid[1][10]&&grid[1][10].clearing,"Tile (1,10) still clearing");
  assert(grid[2][10]&&grid[2][10].clearing,"Tile (2,10) still clearing");
  // Tile above should NOT have fallen
  assert(grid[0][8]&&grid[0][8].color===1,"Tile (0,8) still in place (gravity blocked)");
  assert(state==='clearing',"Still clearing");
}

console.log("\n-- after all clearing done, ghost tiles removed, gravity applies --");
{
  let g=makeGrid(6,12);
  g[0][10]=makeTile(0);g[1][10]=makeTile(0);g[2][10]=makeTile(0); // match at row 10
  g[0][8]=makeTile(1); // tile above
  setup(g,6,12);
  needsMatchCheck=true;

  update(0.001);
  assert(state==='clearing',"Match -> clearing");

  // Advance past ALL clear timers
  let totalTime = CLEAR_BASE_DELAY + 2*CLEAR_STAGGER + 0.05;
  update(totalTime);

  // Ghosts should be removed, gravity applied
  assert(state==='falling',"State -> falling after all cleared");
  assert(grid[0][10]===null,"(0,10) is null (ghost removed)");
  assert(grid[1][10]===null,"(1,10) is null (ghost removed)");
  assert(grid[2][10]===null,"(2,10) is null (ghost removed)");
  // Tile above should have fallen
  assert(grid[0][8]===null,"(0,8) empty (tile fell)");
}

console.log("\n-- ghost tile blocks swap --");
{
  let g=makeGrid(6,12);
  g[0][10]=makeTile(0);g[1][10]=makeTile(0);g[2][10]=makeTile(0); // match
  g[0][9]=makeTile(1); // tile above clearing tile
  g[1][9]=makeTile(2); // tile next to it
  setup(g,6,12);
  cursorCol=0;cursorRow=9;
  needsMatchCheck=true;

  update(0.001);
  assert(state==='clearing',"Match -> clearing");

  // Advance past first tile's timer
  update(CLEAR_BASE_DELAY + 0.01);
  assert(grid[0][10]&&grid[0][10].cleared,"(0,10) is ghost");

  // Try to swap (0,9) and (1,9) — neither is ghost, should work
  doSwap();
  assert(grid[0][9].color===2,"Swap succeeded: (0,9)=color2");
  assert(grid[1][9].color===1,"Swap succeeded: (1,9)=color1");

  // Now swap back, but cursor on (0,10)/(1,10) row — these include a ghost
  cursorCol=0;cursorRow=10;
  doSwap();
  // grid[0][10] is ghost (cleared=true) -> swap blocked
  assert(grid[0][10]&&grid[0][10].cleared,"(0,10) still ghost (swap blocked)");
  assert(grid[1][10]&&grid[1][10].clearing,"(1,10) unchanged (swap blocked)");
}

console.log("\n-- ghost tile not matched in findMatches --");
{
  let g=makeGrid(6,12);
  g[0][10]=makeTile(3);g[1][10]=makeTile(3);g[2][10]=makeTile(3); // match color 3
  g[3][10]=makeTile(3);g[4][10]=makeTile(3); // two more color 3
  setup(g,6,12);
  needsMatchCheck=true;

  update(0.001);
  assert(state==='clearing',"Match -> clearing (3 tiles)");

  // Advance to make first tile ghost
  update(CLEAR_BASE_DELAY + 0.01);
  assert(grid[0][10]&&grid[0][10].cleared,"(0,10) is ghost");

  // findMatches should NOT match ghost tiles with non-ghost tiles
  let res=findMatches();
  // (3,10) and (4,10) are color 3, but only 2 — no match
  // (1,10) and (2,10) are clearing — skipped
  assert(res.count<3,"No false match involving ghost tile (count="+res.count+")");
}

// ===== TEST 2: Concurrent match processing =====
console.log("\n=== 2. CONCURRENT MATCH PROCESSING ===");

console.log("\n-- second match starts immediately during clearing --");
{
  let g=makeGrid(6,12);
  // First match: row 10, cols 0-2, color 0
  g[0][10]=makeTile(0);g[1][10]=makeTile(0);g[2][10]=makeTile(0);
  // Potential second match via swap: row 8
  // (2,8)=2, (3,8)=2, (4,8)=1, (5,8)=2 -> swap (4,8)&(5,8) -> (2,8)=2,(3,8)=2,(4,8)=2 match!
  g[2][8]=makeTile(2);g[3][8]=makeTile(2);g[4][8]=makeTile(1);g[5][8]=makeTile(2);
  setup(g,6,12);
  cursorCol=4;cursorRow=8;
  needsMatchCheck=true;

  update(0.001);
  assert(state==='clearing',"First match -> clearing");
  assert(chainLevel===1,"Chain level 1");

  // Swap during clearing to create second match
  doSwap();
  assert(grid[4][8].color===2,"Swap done: (4,8)=color2");
  assert(grid[5][8].color===1,"Swap done: (5,8)=color1");
  assert(needsMatchCheck===true,"needsMatchCheck set");

  // Next update: second match should be processed immediately
  update(0.001);
  assert(chainLevel===2,"Chain level 2 (second match processed during clearing), got chain="+chainLevel);

  // Both sets of tiles should be clearing
  let clearingCount=0;
  for(let c=0;c<cols;c++)
    for(let r=0;r<rows;r++)
      if(grid[c][r]&&grid[c][r].clearing) clearingCount++;
  assert(clearingCount===6,"6 tiles clearing (3+3), got "+clearingCount);
}

console.log("\n-- concurrent matches don't interfere: gravity waits for all --");
{
  let g=makeGrid(6,12);
  // First match: row 10
  g[0][10]=makeTile(0);g[1][10]=makeTile(0);g[2][10]=makeTile(0);
  // Second match from swap: row 5
  g[3][5]=makeTile(1);g[4][5]=makeTile(0);g[5][5]=makeTile(1);
  // Swap (4,5) and (5,5) -> (3,5)=1, (4,5)=1, (5,5)=0 -> no match
  // Better setup: (3,5)=1,(4,5)=0,(5,5)=1, swap (3,5)&(4,5) -> (3,5)=0,(4,5)=1,(5,5)=1 -> nope
  // Simplest: (3,5)=3,(4,5)=0,(5,5)=3, swap (4,5)&(5,5) -> 3,3,3
  g[3][5]=makeTile(3);g[4][5]=makeTile(0);g[5][5]=makeTile(3);
  // Tile above row 5 match that should fall after
  g[3][3]=makeTile(4);
  setup(g,6,12);
  cursorCol=4;cursorRow=5;
  needsMatchCheck=true;

  update(0.001);
  assert(state==='clearing',"First match -> clearing");

  // Create second match during clearing
  doSwap(); // (4,5)=3, (5,5)=0 -> now (3,5)=3,(4,5)=3,(5,5)=0... wait that's only 2x3
  // Actually swap swaps (4,5) and (5,5): was (4,5)=0,(5,5)=3, after: (4,5)=3,(5,5)=0
  // So (3,5)=3, (4,5)=3, (5,5)=0 -> only 2 tiles, no match!
  // Fix: need swap to result in 3 matching. Let me use:
  // (3,5)=3, (4,5)=0, (5,5)=3, and there's a 3 at col 3 and 5
  // Swap (4,5) and (3,5) won't work since cursor is at col 4
  // Let me just set up differently

  // Redo with proper setup
  g=makeGrid(6,12);
  g[0][10]=makeTile(0);g[1][10]=makeTile(0);g[2][10]=makeTile(0);
  // (2,5)=3, (3,5)=0, (4,5)=3 -> swap (3,5) and (4,5) -> (2,5)=3, (3,5)=3, (4,5)=0
  // That's only 2x3. Need (1,5)=3,(2,5)=3,(3,5)=0,(4,5)=3, swap (3,5)&(4,5) -> (1,5)=3,(2,5)=3,(3,5)=3
  g[1][5]=makeTile(3);g[2][5]=makeTile(3);g[3][5]=makeTile(0);g[4][5]=makeTile(3);
  g[1][3]=makeTile(4); // will fall after clear
  setup(g,6,12);
  cursorCol=3;cursorRow=5;
  needsMatchCheck=true;

  update(0.001);
  assert(state==='clearing',"First match -> clearing");

  doSwap(); // swap (3,5)=0 and (4,5)=3 -> (3,5)=3, (4,5)=0
  // Now (1,5)=3,(2,5)=3,(3,5)=3 -> match!
  update(0.001);
  assert(chainLevel===2,"Chain 2 (concurrent match processed)");

  // Advance time: first match tiles should become ghosts before second match tiles
  // First match timers: 0.48, 0.72, 0.96
  // Second match timers: 0.48, 0.72, 0.96 (reset by startClearing)
  update(0.50); // first tiles from both groups become ghosts

  // Tiles above should NOT fall (ghosts block gravity)
  assert(grid[1][3]&&grid[1][3].color===4,"Tile at (1,3) still in place (gravity blocked)");

  // Advance past all timers
  update(1.0);
  assert(state==='falling',"State -> falling after all clears");
  // Now tile at (1,3) should have fallen
  assert(grid[1][3]===null,"(1,3) empty (tile fell after all ghosts removed)");
}

console.log("\n-- non-matching swap during clearing is deferred --");
{
  let g=makeGrid(6,12);
  g[0][10]=makeTile(0);g[1][10]=makeTile(0);g[2][10]=makeTile(0); // match
  g[3][8]=makeTile(1);g[4][8]=makeTile(2); // swappable
  setup(g,6,12);
  cursorCol=3;cursorRow=8;
  needsMatchCheck=true;

  update(0.001);
  assert(state==='clearing',"Match -> clearing");

  doSwap(); // swap colors 1 and 2, no match
  update(0.001); // needsMatchCheck processed, no match found
  assert(chainLevel===1,"Chain still 1 (no new match)");
  assert(state==='clearing',"Still clearing");

  // After clearing finishes, no match -> go to playing
  update(2.0);
  assert(state==='falling'||state==='playing',"Past clearing");
}

console.log("\n=========================");
console.log("GHOST/CONCURRENT RESULTS: "+pass+" passed, "+fail+" failed");
console.log("=========================");
process.exit(fail>0?1:0);
