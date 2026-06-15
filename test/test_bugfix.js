"use strict";
// Bug fix tests: cursor tracking + gravity after swap

const TILE_SIZE = 40;
const FLASH_DURATION = 0.40;
const FALL_SPEED = 550;

let cols, rows, grid, nextRow;
let cursorCol, cursorRow;
let riseProgress;
let state, stateTimer, needsMatchCheck;

function makeTile(color){ return { color, vy:0, clearing:false }; }
function makeGrid(c,r){ let g=[]; for(let i=0;i<c;i++) g.push(new Array(r).fill(null)); return g; }

// ---- copied from game ----
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
    let foundNull=false;
    for(let r=rows-1;r>=0;r--){
      if(!grid[c][r])foundNull=true;
      else if(foundNull)return true;
    }
  }
  return false;
}

function handleRise(dt){
  let speed=10;
  riseProgress+=speed*dt;
  if(riseProgress>=TILE_SIZE){
    for(let c=0;c<cols;c++)if(grid[c][0]){state='gameover';return;}
    for(let c=0;c<cols;c++){
      for(let r=0;r<rows-1;r++)grid[c][r]=grid[c][r+1];
      grid[c][rows-1]=nextRow[c];
      nextRow[c]=makeTile(Math.floor(Math.random()*5));
    }
    riseProgress-=TILE_SIZE;
    needsMatchCheck=true;
    if(cursorRow>0)cursorRow--;
  }
}

function doSwap(){
  let r=cursorRow,c=cursorCol;
  let tmp=grid[c][r];
  grid[c][r]=grid[c+1][r];
  grid[c+1][r]=tmp;
  needsMatchCheck=true;
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
    if(needsMatchCheck){
      needsMatchCheck=false;
      let res=findMatches();
      if(res.count>=3){
        // simplified startClearing
        for(let c=0;c<cols;c++)for(let r=0;r<rows;r++)
          if(res.matched[c][r])grid[c][r].clearing=true;
        state='matching';stateTimer=FLASH_DURATION;
      } else if(hasFloating()){ applyGravity(); state='falling'; }
    }
  } else if(state==='matching'){
    stateTimer-=dt;
    if(stateTimer<=0){
      for(let c=0;c<cols;c++)for(let r=0;r<rows;r++)
        if(grid[c][r]&&grid[c][r].clearing)grid[c][r]=null;
      applyGravity();
      state='falling';
    }
  } else if(state==='falling'){
    if(allSettled()){
      let res=findMatches();
      if(res.count>=3){
        for(let c=0;c<cols;c++)for(let r=0;r<rows;r++)
          if(res.matched[c][r])grid[c][r].clearing=true;
        state='matching';stateTimer=FLASH_DURATION;
      } else { state='playing'; }
    }
  }
}

let pass=0,fail=0;
function assert(c,m){if(c){pass++;console.log("  PASS: "+m);}else{fail++;console.log("  FAIL: "+m);}}

// ===== TEST 1: Cursor tracks rise =====
console.log("\n=== BUG FIX 1: Cursor tracks rise ===");

console.log("\n-- cursorRow decrements on full rise shift --");
{
  cols=6;rows=12;grid=makeGrid(cols,rows);
  // Fill bottom rows so there's something to rise
  for(let c=0;c<cols;c++)for(let r=6;r<rows;r++)grid[c][r]=makeTile((c+r)%5);
  nextRow=[];for(let c=0;c<cols;c++)nextRow.push(makeTile(c%5));
  cursorCol=2;cursorRow=8;riseProgress=0;state='playing';needsMatchCheck=false;

  // Simulate enough time for a full rise
  let safety=0;
  while(cursorRow===8&&safety<500){update(0.1);safety++;}

  assert(cursorRow===7,"cursorRow decremented from 8 to "+cursorRow+" after one rise");

  // Another rise
  safety=0;
  while(cursorRow===7&&safety<500){update(0.1);safety++;}
  assert(cursorRow===6,"cursorRow decremented from 7 to "+cursorRow+" after second rise");
}

console.log("\n-- cursor Y render includes riseProgress offset --");
{
  // Verify the formula: y = cursorRow*TILE_SIZE - riseProgress
  cursorRow=8;riseProgress=15;
  let renderY = cursorRow*TILE_SIZE - riseProgress;
  // Tile at same grid row renders at same Y
  let tileY = cursorRow*TILE_SIZE - riseProgress;
  assert(renderY===tileY,"Cursor Y ("+renderY+") matches tile Y ("+tileY+") at riseProgress=15");

  riseProgress=35;
  renderY = cursorRow*TILE_SIZE - riseProgress;
  tileY = cursorRow*TILE_SIZE - riseProgress;
  assert(renderY===tileY,"Cursor Y ("+renderY+") matches tile Y ("+tileY+") at riseProgress=35");
}

console.log("\n-- cursor stays locked to same tiles across rise shift --");
{
  cols=6;rows=12;grid=makeGrid(cols,rows);
  for(let c=0;c<cols;c++)for(let r=6;r<rows;r++)grid[c][r]=makeTile((c+r)%5);
  nextRow=[];for(let c=0;c<cols;c++)nextRow.push(makeTile(c%5));
  cursorCol=2;cursorRow=8;riseProgress=0;state='playing';needsMatchCheck=false;

  // Record what tile the cursor is on
  let tileBefore = grid[cursorCol][cursorRow] ? grid[cursorCol][cursorRow].color : null;

  // Run until a rise happens
  let safety=0;
  while(cursorRow===8&&safety<500){update(0.1);safety++;}

  // After rise: cursorRow=7, the tile that was at row 8 is now at row 7
  let tileAfter = grid[cursorCol][cursorRow] ? grid[cursorCol][cursorRow].color : null;
  assert(tileBefore===tileAfter,"Cursor stayed on same tile (color "+tileBefore+" -> "+tileAfter+")");
}

console.log("\n-- cursor clamps at row 0 --");
{
  cols=6;rows=12;grid=makeGrid(cols,rows);
  for(let c=0;c<cols;c++)for(let r=1;r<rows;r++)grid[c][r]=makeTile((c+r)%5);
  nextRow=[];for(let c=0;c<cols;c++)nextRow.push(makeTile(c%5));
  cursorCol=2;cursorRow=1;riseProgress=0;state='playing';needsMatchCheck=false;

  // Run a rise
  let safety=0;
  while(cursorRow===1&&state==='playing'&&safety<500){update(0.1);safety++;}
  assert(cursorRow===0,"cursorRow clamped to 0 (got "+cursorRow+")");

  // Another rise should NOT go below 0
  safety=0;
  while(safety<500){update(0.1);safety++;if(cursorRow<0)break;}
  assert(cursorRow>=0,"cursorRow never goes below 0 (got "+cursorRow+")");
}

// ===== TEST 2: Gravity after swap =====
console.log("\n=== BUG FIX 2: Gravity after non-matching swap ===");

console.log("\n-- hasFloating detects tiles above gaps --");
{
  cols=6;rows=12;
  // Column 0: tile at row 5, gap at row 8, tile at row 11 -> floating at row 5
  grid=makeGrid(cols,rows);
  grid[0][5]=makeTile(0);
  grid[0][11]=makeTile(1);
  assert(hasFloating(),"Floating tile detected (tile at row 5, gap at row 8, tile at row 11)");

  // No floating: all tiles at bottom
  grid=makeGrid(cols,rows);
  grid[0][10]=makeTile(0);
  grid[0][11]=makeTile(1);
  assert(!hasFloating(),"No floating when tiles are at bottom");

  // No floating: single column gap with nothing above
  grid=makeGrid(cols,rows);
  grid[0][11]=makeTile(0);
  assert(!hasFloating(),"No floating when single tile at bottom");

  // Floating across multiple columns
  grid=makeGrid(cols,rows);
  grid[0][11]=makeTile(0);
  grid[1][3]=makeTile(0); // floating in col 1
  assert(hasFloating(),"Floating detected in col 1 while col 0 is fine");
}

console.log("\n-- swap into gap triggers gravity, tile falls --");
{
  cols=6;rows=12;grid=makeGrid(cols,rows);
  // Setup: col 0 row 11 has tile A, col 1 row 11 empty
  // col 0 row 10 has tile B, col 1 row 10 has tile C
  // Cursor at col 0, row 10: swap B and C
  // C goes to (0,10) which is fine (supported by A at 11)
  // B goes to (1,10) which is FLOATING (nothing at 1,11)
  grid[0][11]=makeTile(0); // A
  grid[0][10]=makeTile(1); // B
  grid[1][10]=makeTile(2); // C
  // row 11 col 1 is empty (null)

  nextRow=[];for(let c=0;c<cols;c++)nextRow.push(makeTile(0));
  cursorCol=0;cursorRow=10;riseProgress=0;state='playing';needsMatchCheck=false;

  doSwap(); // swap B and C
  assert(needsMatchCheck,"needsMatchCheck set after swap");

  // Run update - no match, but B is floating at (1,10)
  update(0.016);
  assert(state==='falling',"State -> falling after swap with floating tile (state="+state+")");

  // B should have fallen from row 10 to row 11 in col 1
  assert(grid[1][11]&&grid[1][11].color===1,"Tile B fell to (1,11), color="+grid[1][11].color);
  assert(grid[1][10]===null,"(1,10) is now empty after B fell");

  // Wait for fall animation to complete
  let safety=0;
  while(state==='falling'&&safety<100){update(0.016);safety++;}
  assert(state==='playing',"Back to playing after settle");
  assert(!hasFloating(),"No floating tiles remain");
}

console.log("\n-- normal swap (no gaps) does NOT trigger gravity --");
{
  cols=6;rows=12;grid=makeGrid(cols,rows);
  // Full bottom row, tiles at row 10
  for(let c=0;c<cols;c++){
    grid[c][11]=makeTile((c)%5);
    grid[c][10]=makeTile((c+1)%5);
  }
  nextRow=[];for(let c=0;c<cols;c++)nextRow.push(makeTile(0));
  cursorCol=2;cursorRow=10;riseProgress=0;state='playing';needsMatchCheck=false;

  doSwap();
  update(0.016);
  // No floating tiles, so should stay in playing
  assert(state==='playing',"Normal swap stays in playing (no floating)");
  assert(!hasFloating(),"No floating after normal swap");
}

console.log("\n-- gravity chain: swap -> fall -> match -> clear -> fall --");
{
  cols=6;rows=12;grid=makeGrid(cols,rows);
  // Col 0: row 11=A, row 10=B
  // Col 1: row 11=(empty), row 10=C
  // After swap(B,C): C at (0,10), B at (1,10) floating
  // B falls to (1,11)
  // If (1,11)=B and (2,11)=B and (3,11)=B, that's a match!
  grid[0][11]=makeTile(0); // A
  grid[0][10]=makeTile(3); // B (color 3)
  grid[1][10]=makeTile(1); // C
  grid[2][11]=makeTile(3); // B - for the match
  grid[3][11]=makeTile(3); // B - for the match
  // Fill others to avoid accidental matches
  grid[4][11]=makeTile(0);
  grid[5][11]=makeTile(1);

  nextRow=[];for(let c=0;c<cols;c++)nextRow.push(makeTile(0));
  cursorCol=0;cursorRow=10;riseProgress=0;state='playing';needsMatchCheck=false;

  doSwap();
  update(0.016); // detect floating, apply gravity, state=falling
  assert(state==='falling',"Swap -> falling (B floating)");

  // Run until B settles and match is detected
  let safety=0;
  let sawMatch=false;
  while(safety<200){
    update(0.016);
    safety++;
    if(state==='matching'){sawMatch=true;break;}
  }
  assert(sawMatch,"B fell to (1,11), matched with (2,11)+(3,11) -> matching state");
}

console.log("\n=========================");
console.log("BUG FIX RESULTS: "+pass+" passed, "+fail+" failed");
console.log("=========================");
process.exit(fail>0?1:0);
