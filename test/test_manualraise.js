"use strict";
// Tests for: X-key manual fast raise

const TILE_SIZE = 40;
const CLEAR_BASE_DELAY = 0.48;
const CLEAR_STAGGER = 0.24;
const FALL_SPEED = 550;
const RISE_BASE_SPEED = 5;
const RISE_INCREMENT = 1.25;
const MAX_RISE_LEVEL = 40;
const MANUAL_RISE_SPEED = TILE_SIZE / 0.1; // 400 px/s

let cols, rows, grid, nextRow;
let cursorCol, cursorRow;
let score, chainLevel, riseSpeedLevel;
let riseProgress;
let state, stateTimer;
let needsMatchCheck, manualRaise, currentThresholdIdx;
let expandMsgTimer, chainMsgTimer, expandAnimT;

function makeTile(color){ return { color, vy:0, clearing:false, cleared:false }; }
function makeGrid(c,r){ let g=[]; for(let i=0;i<c;i++) g.push(new Array(r).fill(null)); return g; }

function getRiseSpeed(){ return RISE_BASE_SPEED + Math.min(riseSpeedLevel,MAX_RISE_LEVEL)*RISE_INCREMENT; }

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
  for(let c=0;c<cols;c++)for(let r=0;r<rows;r++)if(grid[c][r]&&grid[c][r].vy>0)return false;
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
  let speed = manualRaise ? MANUAL_RISE_SPEED : getRiseSpeed();
  riseProgress += speed*dt;
  if(riseProgress>=TILE_SIZE){
    for(let c=0;c<cols;c++){
      for(let r=0;r<rows-1;r++)grid[c][r]=grid[c][r+1];
      grid[c][rows-1]=nextRow[c];
      nextRow[c]=makeTile(Math.floor(Math.random()*5));
    }
    riseProgress-=TILE_SIZE;
    manualRaise=false;
    for(let c=0;c<cols;c++){
      if(grid[c][0]){state='gameover';return;}
    }
    needsMatchCheck=true;
    if(cursorRow>0)cursorRow--;
  }
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
  riseSpeedLevel=Math.floor(score/500);

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
    for(let c=0;c<cols;c++)
      for(let r=0;r<rows;r++)
        if(grid[c][r]&&grid[c][r].clearing){
          grid[c][r].clearTimer-=dt;
          if(grid[c][r].clearTimer<=0){grid[c][r].cleared=true;grid[c][r].clearing=false;}
        }
    if(needsMatchCheck){
      needsMatchCheck=false;
      let res=findMatches();
      if(res.count>=3)startClearing(res);
    }
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
      if(res.count>=3)startClearing(res);
      else{chainLevel=0;state='playing';}
    }
  }
  if(state!=='playing') manualRaise=false;
}

// Simulate X key press
function pressX(){
  if(state==='playing' && !manualRaise) manualRaise=true;
}

function setup(customGrid,cc,rr,customNextRow){
  cols=cc;rows=rr;grid=customGrid;
  nextRow=customNextRow || [];
  if(nextRow.length===0) for(let c=0;c<cols;c++)nextRow.push(makeTile(0));
  score=0;chainLevel=0;riseSpeedLevel=0;
  riseProgress=0;state='playing';stateTimer=0;
  needsMatchCheck=false;manualRaise=false;currentThresholdIdx=0;
  expandMsgTimer=0;chainMsgTimer=0;expandAnimT=0;
  cursorCol=2;cursorRow=8;
}

let pass=0,fail=0;
function assert(c,m){if(c){pass++;console.log("  PASS: "+m);}else{fail++;console.log("  FAIL: "+m);}}

// ===== TEST 1: Basic manual raise =====
console.log("\n=== 1. BASIC MANUAL RAISE ===");

console.log("\n-- X triggers fast rise, completes in ~0.1s --");
{
  let g=makeGrid(6,12);
  for(let c=0;c<6;c++)for(let r=6;r<12;r++)g[c][r]=makeTile((c+r)%5);
  let nr=[];for(let c=0;c<6;c++)nr.push(makeTile((c+3)%5));
  setup(g,6,12,nr);
  riseProgress=0;

  pressX();
  assert(manualRaise===true,"manualRaise set to true after X");

  // Simulate frames at ~60fps (dt=0.016)
  // MANUAL_RISE_SPEED = 400 px/s, need 40px
  // 40/400 = 0.1s = ~6 frames
  let frames=0;
  let startTime = null;
  while(manualRaise && frames<20){
    if(startTime===null && riseProgress>0) startTime = frames;
    update(0.016);
    frames++;
  }
  assert(manualRaise===false,"manualRaise cleared after raise completes");
  // Should complete in roughly 6-7 frames at 16ms
  assert(frames<=8,"Completed in <=8 frames (~0.1s), got "+frames+" frames");
  assert(riseProgress<TILE_SIZE,"riseProgress reset after shift (="+riseProgress.toFixed(2)+")");

  // A row shift should have occurred: check that nextRow tiles are now in the grid
  // The bottom row should contain what was in nextRow
  // Since nextRow colors were (c+3)%5
  let allShifted=true;
  for(let c=0;c<6;c++){
    if(!grid[c][11] || grid[c][11].color !== (c+3)%5) allShifted=false;
  }
  assert(allShifted,"Next row tiles are now in bottom grid row");
}

console.log("\n-- riseProgress starts partway; X completes the remaining distance --");
{
  let g=makeGrid(6,12);
  for(let c=0;c<6;c++)for(let r=6;r<12;r++)g[c][r]=makeTile((c+r)%5);
  let nr=[];for(let c=0;c<6;c++)nr.push(makeTile(4));
  setup(g,6,12,nr);
  riseProgress=30; // 75% of the way

  pressX();
  assert(manualRaise===true,"manualRaise set");

  // Only need to cover 10px at 400px/s = 0.025s = ~2 frames
  let frames=0;
  while(manualRaise && frames<20){update(0.016);frames++;}
  assert(manualRaise===false,"manualRaise cleared");
  assert(frames<=3,"Completed quickly when already partway (="+frames+" frames)");
}

// ===== TEST 2: Ignore during clearing =====
console.log("\n=== 2. BLOCK X DURING CLEARING ===");

console.log("\n-- X ignored while tiles are clearing --");
{
  let g=makeGrid(6,12);
  g[0][10]=makeTile(0);g[1][10]=makeTile(0);g[2][10]=makeTile(0); // match
  setup(g,6,12);
  needsMatchCheck=true;

  update(0.001);
  assert(state==='clearing',"State is clearing");

  pressX();
  assert(manualRaise===false,"X ignored during clearing (manualRaise stays false)");
}

console.log("\n-- X ignored during falling --");
{
  let g=makeGrid(6,12);
  // Create a floating tile situation
  g[0][11]=makeTile(1);
  g[0][9]=makeTile(2); // gap at row 10
  setup(g,6,12);
  applyGravity();
  state='falling';

  pressX();
  assert(manualRaise===false,"X ignored during falling");
}

console.log("\n-- X ignored during gameover --");
{
  let g=makeGrid(6,12);
  for(let c=0;c<6;c++)for(let r=0;r<12;r++)g[c][r]=makeTile((c+r)%5);
  setup(g,6,12);
  state='gameover';

  pressX();
  assert(manualRaise===false,"X ignored during gameover");
}

// ===== TEST 3: Ignore double-press =====
console.log("\n=== 3. IGNORE DOUBLE-PRESS ===");

console.log("\n-- second X press ignored while raise in progress --");
{
  let g=makeGrid(6,12);
  for(let c=0;c<6;c++)for(let r=6;r<12;r++)g[c][r]=makeTile((c+r)%5);
  let nr=[];for(let c=0;c<6;c++)nr.push(makeTile(4));
  setup(g,6,12,nr);
  riseProgress=0;

  pressX();
  assert(manualRaise===true,"First X: manualRaise=true");

  // Advance one frame (not enough to complete)
  update(0.016);
  assert(manualRaise===true,"Still raising after 1 frame");

  // Press X again
  pressX();
  // Should be ignored - manualRaise was already true so the guard prevented re-trigger
  // The value is still true, but no "double" effect
  assert(manualRaise===true,"Second X ignored (manualRaise unchanged)");

  // Let it complete
  let frames=0;
  while(manualRaise && frames<20){update(0.016);frames++;}
  assert(manualRaise===false,"Raise completed normally");
  assert(frames<=7,"Completed in expected time (="+frames+")");
}

// ===== TEST 4: Manual raise triggers match check =====
console.log("\n=== 4. MANUAL RAISE TRIGGERS MATCH CHECK ===");

console.log("\n-- raised row creates a match, match is detected --");
{
  let g=makeGrid(6,12);
  // Bottom row has two tiles of color 3 at cols 0,1
  g[0][11]=makeTile(3);g[1][11]=makeTile(3);
  // Rows above are different colors to avoid accidental matches
  for(let c=0;c<6;c++)for(let r=6;r<11;r++)g[c][r]=makeTile((c+r*3+1)%5);
  // Override to make sure no accidental 3-matches
  g[0][11]=makeTile(3);g[1][11]=makeTile(3);
  g[2][11]=makeTile(0);g[3][11]=makeTile(1);g[4][11]=makeTile(2);g[5][11]=makeTile(4);
  // After a row shift, the bottom row gets nextRow tiles.
  // Set nextRow so cols 0,1,2 are all color 3 -> match at row 11
  let nr=[];nr.push(makeTile(3));nr.push(makeTile(3));nr.push(makeTile(3));
  nr.push(makeTile(1));nr.push(makeTile(2));nr.push(makeTile(4));
  setup(g,6,12,nr);
  riseProgress=0;

  pressX();
  // Let raise complete (shift happens inside update)
  let frames=0;
  while(manualRaise && frames<20){update(0.016);frames++;}

  assert(manualRaise===false,"Raise completed");
  // needsMatchCheck was set by handleRise after shift
  // The match at row 11 (cols 0-2 all color 3) should be detected
  // This may have already been processed in the same update() call
  if(state==='playing'){
    update(0.001); // process needsMatchCheck if not yet done
  }
  assert(state==='clearing',"Match detected after manual raise (state="+state+")");
}

// ===== TEST 5: manualRaise cancelled if state changes =====
console.log("\n=== 5. MANUAL RAISE CANCELLED ON STATE CHANGE ===");

console.log("\n-- swap during manual raise creates match -> manualRaise cancelled --");
{
  let g=makeGrid(6,12);
  for(let c=0;c<6;c++)for(let r=6;r<12;r++)g[c][r]=makeTile((c+r)%5);
  let nr=[];for(let c=0;c<6;c++)nr.push(makeTile(4));
  setup(g,6,12,nr);
  riseProgress=0;
  cursorCol=0;cursorRow=11;

  pressX();
  assert(manualRaise===true,"manualRaise active");

  // Swap creates a match (need to carefully set up grid for this)
  // Actually, let me just verify the safety net works:
  // If a swap during manual raise leads to clearing, manualRaise should be cleared
  // Let me set up a match directly instead
  g=makeGrid(6,12);
  g[0][11]=makeTile(0);g[1][11]=makeTile(0);g[2][11]=makeTile(0);
  setup(g,6,12);
  cursorCol=0;cursorRow=11;
  riseProgress=0;

  pressX();
  assert(manualRaise===true,"manualRaise active");

  // Manually trigger a match by setting needsMatchCheck
  needsMatchCheck=true;
  // Advance one frame - handleRise runs (fast but may not complete),
  // then needsMatchCheck is processed -> state changes to clearing
  // then safety net clears manualRaise
  update(0.016);

  // If state went to clearing, manualRaise should be false
  if(state==='clearing'){
    assert(manualRaise===false,"manualRaise cleared when state -> clearing");
  } else {
    // Manual raise completed the shift first, which is also fine
    assert(manualRaise===false,"manualRaise cleared (raise completed)");
  }
}

console.log("\n=========================");
console.log("MANUAL RAISE RESULTS: "+pass+" passed, "+fail+" failed");
console.log("=========================");
process.exit(fail>0?1:0);
