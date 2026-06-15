// Extract and syntax-check the JavaScript from index.html
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const match = html.match(/<script>([\s\S]*?)<\/script>/);
if (!match) { console.log('ERROR: No <script> tag found'); process.exit(1); }

const js = match[1];

// Try to parse the JS (throws SyntaxError if invalid)
try {
  new vm.Script(js, { filename: 'index.html' });
  console.log('JavaScript syntax: OK (' + js.split('\n').length + ' lines)');
} catch (e) {
  console.log('JavaScript syntax ERROR: ' + e.message);
  process.exit(1);
}

// Check all getElementById calls have matching HTML elements
const ids = [];
const idMatches = html.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g);
for (const m of idMatches) ids.push(m[1]);

const htmlIds = [];
const htmlIdMatches = html.matchAll(/id="([^"]+)"/g);
for (const m of htmlIdMatches) htmlIds.push(m[1]);

console.log('JS references IDs: ' + JSON.stringify(ids));
console.log('HTML defines IDs: ' + JSON.stringify(htmlIds));

let missing = ids.filter(id => !htmlIds.includes(id));
if (missing.length > 0) {
  console.log('MISSING HTML elements for JS IDs: ' + JSON.stringify(missing));
  process.exit(1);
} else {
  console.log('All JS-referenced IDs exist in HTML: OK');
}

// Check key constants
const checks = [
  ['THRESHOLDS', /const THRESHOLDS/],
  ['5 colors', /COLORS.*name.*main.*light.*dark/s],
  ['requestAnimationFrame', /requestAnimationFrame\(loop\)/],
  ['canvas', /getElementById\('game'\)/],
  ['roundRect polyfill', /roundRect/],
  ['match detection', /findMatches/],
  ['gravity', /applyGravity/],
  ['chain', /chainLevel/],
  ['expansion', /expandGrid/],
  ['game over', /gameover/],
  ['restart', /resetGame/],
];
console.log('\nFeature checks:');
for (const [name, re] of checks) {
  console.log('  ' + name + ': ' + (re.test(js) ? 'OK' : 'MISSING'));
}
