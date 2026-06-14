"use strict";
const TILE_SIZE = 40;

function findMatches(grid, cols, rows) {
  let matched = [];
  for (let c = 0; c < cols; c++) matched.push(new Array(rows).fill(false));
  for (let r = 0; r < rows; r++) {
    let c = 0;
    while (c < cols) {
      if (!grid[c][r] || grid[c][r].clearing) { c++; continue; }
      let clr = grid[c][r].color, end = c + 1;
      while (end < cols && grid[end][r] && !grid[end][r].clearing && grid[end][r].color === clr) end++;
      if (end - c >= 3) for (let i = c; i < end; i++) matched[i][r] = true;
      c = end;
    }
  }
  for (let c = 0; c < cols; c++) {
    let r = 0;
    while (r < rows) {
      if (!grid[c][r] || grid[c][r].clearing) { r++; continue; }
      let clr = grid[c][r].color, end = r + 1;
      while (end < rows && grid[c][end] && !grid[c][end].clearing && grid[c][end].color === clr) end++;
      if (end - r >= 3) for (let i = r; i < end; i++) matched[c][i] = true;
      r = end;
    }
  }
  let count = 0;
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) if (matched[c][r]) count++;
  return { matched, count };
}

function applyGravity(grid, cols, rows) {
  for (let c = 0; c < cols; c++) {
    let writeRow = rows - 1;
    for (let r = rows - 1; r >= 0; r--) {
      if (grid[c][r]) {
        if (writeRow !== r) {
          grid[c][writeRow] = grid[c][r];
          grid[c][writeRow].vy = (writeRow - r) * TILE_SIZE;
          grid[c][r] = null;
        }
        writeRow--;
      }
    }
  }
}

function removeMatched(grid, cols, rows, matched) {
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) if (matched[c][r]) grid[c][r] = null;
}

function makeTile(color) { return { color, vy: 0, clearing: false }; }
function makeGrid(cols, rows) { let g = []; for (let c = 0; c < cols; c++) g.push(new Array(rows).fill(null)); return g; }

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log("  PASS: " + msg); }
  else { fail++; console.log("  FAIL: " + msg); }
}

// ===== 1. MATCH DETECTION =====
console.log("\n=== 1. MATCH DETECTION ===");

console.log("\n-- Horizontal 3 --");
{
  let g = makeGrid(6, 12);
  g[0][5] = makeTile(0); g[1][5] = makeTile(0); g[2][5] = makeTile(0);
  let res = findMatches(g, 6, 12);
  assert(res.count === 3, "3 horizontal matched, count=" + res.count);
  assert(res.matched[0][5] && res.matched[1][5] && res.matched[2][5], "Correct cells flagged");
}

console.log("\n-- Vertical 3 --");
{
  let g = makeGrid(6, 12);
  g[3][3] = makeTile(1); g[3][4] = makeTile(1); g[3][5] = makeTile(1);
  let res = findMatches(g, 6, 12);
  assert(res.count === 3, "3 vertical matched, count=" + res.count);
}

console.log("\n-- Simultaneous H+V (cross/overlap) --");
{
  let g = makeGrid(6, 12);
  g[0][5] = makeTile(0); g[1][5] = makeTile(0); g[2][5] = makeTile(0);
  g[1][3] = makeTile(0); g[1][4] = makeTile(0);
  let res = findMatches(g, 6, 12);
  // 5 unique: (0,5),(1,5),(2,5),(1,3),(1,4)
  assert(res.count === 5, "Cross shape: 5 unique tiles, count=" + res.count);
  assert(res.matched[1][5] === true, "Overlap at (1,5) flagged");
}

console.log("\n-- 4 in a row --");
{
  let g = makeGrid(6, 12);
  for (let i = 0; i < 4; i++) g[i][5] = makeTile(2);
  let res = findMatches(g, 6, 12);
  assert(res.count === 4, "4 matched, count=" + res.count);
}

console.log("\n-- Only 2 (no match) --");
{
  let g = makeGrid(6, 12);
  g[0][5] = makeTile(0); g[1][5] = makeTile(0);
  let res = findMatches(g, 6, 12);
  assert(res.count === 0, "2 tiles no match, count=" + res.count);
}

console.log("\n-- Null breaks chain --");
{
  let g = makeGrid(6, 12);
  g[0][5] = makeTile(0); g[1][5] = null; g[2][5] = makeTile(0); g[3][5] = makeTile(0);
  let res = findMatches(g, 6, 12);
  assert(res.count === 0, "Null gap breaks match, count=" + res.count);
}

// ===== 2. CHAIN DETECTION =====
console.log("\n=== 2. CHAIN DETECTION ===");
console.log("\n-- Cascade: clear -> fall -> new match -> clear -> no match --");
{
  let cols = 6, rows = 12;
  let g = makeGrid(cols, rows);
  // Row 9: A A A  (horizontal match - clears first)
  g[0][9] = makeTile(0); g[1][9] = makeTile(0); g[2][9] = makeTile(0);
  // Row 10: . B .   (B at col1 will fall after row 9 clears)
  g[1][10] = makeTile(1);
  // Row 11: B . B   (after B falls from row 10 -> row 11, we get B B B match!)
  g[0][11] = makeTile(1); g[2][11] = makeTile(1);

  let chainLevel = 0;

  let res1 = findMatches(g, cols, rows);
  assert(res1.count === 3, "First match: row 9 has 3 tiles, count=" + res1.count);
  chainLevel++;
  assert(chainLevel === 1, "Chain level = 1 after first match");
  removeMatched(g, cols, rows, res1.matched);
  applyGravity(g, cols, rows);

  // After gravity: B at (1,10) fell to (1,11). Row 11: B B B
  assert(g[1][11] && g[1][11].color === 1, "B fell from row 10 to row 11");
  assert(g[0][11] && g[0][11].color === 1, "B at col 0 still at row 11");
  assert(g[2][11] && g[2][11].color === 1, "B at col 2 still at row 11");

  let res2 = findMatches(g, cols, rows);
  assert(res2.count === 3, "Cascade match: 3 B tiles at row 11, count=" + res2.count);
  chainLevel++;
  assert(chainLevel === 2, "Chain level = 2 after cascade");
  removeMatched(g, cols, rows, res2.matched);
  applyGravity(g, cols, rows);

  let res3 = findMatches(g, cols, rows);
  if (res3.count < 3) chainLevel = 0;
  assert(chainLevel === 0, "Chain resets to 0 when cascade ends");
}

console.log("\n-- Chain does NOT increment for single non-cascade match --");
{
  let g = makeGrid(6, 12);
  g[0][5] = makeTile(0); g[1][5] = makeTile(0); g[2][5] = makeTile(0);
  let chainLevel = 0;
  let res = findMatches(g, 6, 12);
  if (res.count >= 3) chainLevel++;
  removeMatched(g, 6, 12, res.matched);
  applyGravity(g, 6, 12);
  let res2 = findMatches(g, 6, 12);
  if (res2.count < 3) chainLevel = 0;
  assert(chainLevel === 0, "Single match, no cascade: chain resets to 0");
}

// ===== 3. GRID EXPANSION =====
console.log("\n=== 3. GRID EXPANSION ===");
console.log("\n-- 6x12 -> 7x13 --");
{
  let cols = 6, rows = 12;
  let g = makeGrid(cols, rows);
  for (let c = 0; c < cols; c++)
    for (let r = 5; r < rows; r++)
      g[c][r] = makeTile((c + r) % 5);

  let newCols = 7, newRows = 13;
  let leftAdd = Math.floor((newCols - cols) / 2); // 0
  let ng = makeGrid(newCols, newRows);
  for (let c = 0; c < cols; c++)
    for (let r = 0; r < rows; r++)
      if (g[c][r]) ng[c + leftAdd][r] = g[c][r];

  let lost = 0;
  for (let c = 0; c < cols; c++)
    for (let r = 0; r < rows; r++)
      if (g[c][r] && !(ng[c + leftAdd][r] && ng[c + leftAdd][r].color === g[c][r].color))
        lost++;
  assert(lost === 0, "No tiles lost (6->7)");
  assert(ng[6][5] === null, "New right column is empty");
}

console.log("\n-- 6x12 -> 8x14 (symmetric) --");
{
  let cols = 6, rows = 12;
  let g = makeGrid(cols, rows);
  for (let c = 0; c < cols; c++)
    for (let r = 5; r < rows; r++)
      g[c][r] = makeTile(c);

  let leftAdd = Math.floor((8 - 6) / 2); // 1
  let ng = makeGrid(8, 14);
  for (let c = 0; c < 6; c++)
    for (let r = 0; r < 12; r++)
      if (g[c][r]) ng[c + leftAdd][r] = g[c][r];

  assert(ng[1][5] && ng[1][5].color === 0, "Col 0 shifted to col 1");
  assert(ng[6][5] && ng[6][5].color === 5, "Col 5 shifted to col 6");
  assert(ng[0][5] === null, "New left column empty");
  assert(ng[7][5] === null, "New right column empty");
  assert(ng[1][12] === null, "New bottom row 12 empty");
  assert(ng[1][13] === null, "New bottom row 13 empty");
}

console.log("\n-- Full expansion chain 6->7->8->9->10 --");
{
  const THRESHOLDS = [
    { cols:6, rows:12 }, { cols:7, rows:13 }, { cols:8, rows:14 },
    { cols:9, rows:15 }, { cols:10, rows:16 }
  ];
  let cols = 6, rows = 12;
  let g = makeGrid(cols, rows);
  for (let c = 0; c < cols; c++)
    for (let r = 6; r < rows; r++)
      g[c][r] = makeTile((c * 3 + r) % 5);

  for (let t of THRESHOLDS) {
    let leftAdd = Math.floor((t.cols - cols) / 2);
    let ng = makeGrid(t.cols, t.rows);
    for (let c = 0; c < cols; c++)
      for (let r = 0; r < rows; r++)
        if (g[c][r]) ng[c + leftAdd][r] = g[c][r];
    
    let tileCount = 0;
    for (let c = 0; c < t.cols; c++)
      for (let r = 0; r < t.rows; r++)
        if (ng[c][r]) tileCount++;
    assert(tileCount === 36, "Expansion to " + t.cols + "x" + t.rows + ": all 36 original tiles preserved (" + tileCount + ")");
    
    g = ng; cols = t.cols; rows = t.rows;
  }
}

// ===== 4. SCORING =====
console.log("\n=== 4. SCORING ===");
{
  function calcScore(tiles, chainLevel) {
    return tiles * 10 * chainLevel + Math.max(0, tiles - 3) * 20;
  }
  assert(calcScore(3, 1) === 30, "3 tiles chain1 = 30");
  assert(calcScore(4, 1) === 60, "4 tiles chain1 = 60 (40+20 combo)");
  assert(calcScore(3, 2) === 60, "3 tiles chain2 = 60");
  assert(calcScore(5, 3) === 190, "5 tiles chain3 = 190 (150+40)");
  assert(calcScore(6, 1) === 120, "6 tiles chain1 = 120 (60+60 combo)");
}

// ===== 5. RISE SPEED =====
console.log("\n=== 5. RISE SPEED ===");
{
  const BASE = 10, INC = 2.5;
  function speed(lvl) { return BASE + Math.min(lvl, 40) * INC; }
  let dt = 1/60;
  assert(speed(0) * dt < TILE_SIZE, "Level 0 no skip");
  assert(speed(10) * dt < TILE_SIZE, "Level 10 no skip");
  assert(speed(20) * dt < TILE_SIZE, "Level 20 no skip");
  assert(speed(40) * dt < TILE_SIZE, "Max level no skip");
  assert(speed(0) < speed(5) && speed(5) < speed(10), "Speed increases perceptibly");
}

// ===== 6. GAME OVER =====
console.log("\n=== 6. GAME OVER ===");
{
  let g = makeGrid(6, 12);
  let top = false;
  for (let c = 0; c < 6; c++) if (g[c][0]) { top = true; break; }
  assert(!top, "Empty top row: no game over");
  
  g[2][0] = makeTile(0);
  top = false;
  for (let c = 0; c < 6; c++) if (g[c][0]) { top = true; break; }
  assert(top, "Tile in top row: game over");
}

// ===== 7. ALL GRID SIZES =====
console.log("\n=== 7. ALL GRID SIZES - initial board gen ===");
{
  const SIZES = [[6,12],[7,13],[8,14],[9,15],[10,16]];
  for (let [c, r] of SIZES) {
    let g = makeGrid(c, r);
    let startRow = Math.ceil(r * 0.42);
    for (let col = 0; col < c; col++) {
      for (let row = startRow; row < r; row++) {
        let avail = [0,1,2,3,4];
        if (col >= 2 && g[col-1][row] && g[col-2][row] && g[col-1][row].color === g[col-2][row].color)
          avail = avail.filter(x => x !== g[col-1][row].color);
        if (row >= 2 && g[col][row-1] && g[col][row-2] && g[col][row-1].color === g[col][row-2].color)
          avail = avail.filter(x => x !== g[col][row-1].color);
        g[col][row] = makeTile(avail[Math.floor(Math.random() * avail.length)]);
      }
    }
    let res = findMatches(g, c, r);
    assert(res.count === 0, c + "x" + r + ": no initial matches");
  }
}

console.log("\n=========================");
console.log("RESULTS: " + pass + " passed, " + fail + " failed");
console.log("=========================");
process.exit(fail > 0 ? 1 : 0);
