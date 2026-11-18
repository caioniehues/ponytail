#!/usr/bin/env node
// Band behaviour is tested through engine events in tests/band.test.tsx, so a rewrite that keeps the behaviour keeps
// its tests. A JS test reading hooks/band/ as text breaks on such a rewrite: drive the band from band.test.tsx instead.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// [test file, band file it reads, why text is the right check]
const ALLOWED = [
  ['band-import.test.js', 'metrics.ts', 'CSV_HEADER: the import and the band write the same columns, and a JS test cannot import the TS'],
  ['band-mod.test.js', 'register.tsx', 'a tool.call hook must stay absent (docs/adr/0001-band-reads-tool-calls-from-the-transcript.md)'],
];

const dir = __dirname;
const found = [];
for (const name of fs.readdirSync(dir).filter(f => f.endsWith('.js') && f !== path.basename(__filename))) {
  const text = fs.readFileSync(path.join(dir, name), 'utf8');
  for (const m of text.matchAll(/readFileSync\([^;\n]*(?:'hooks',\s*'band',\s*'([^']+)'|hooks\/band\/([\w.]+))/g)) found.push([name, m[1] ?? m[2]]);
}
const unexpected = found.filter(([name, band]) => !ALLOWED.some(([n, b]) => n === name && b === band));
assert.deepStrictEqual(unexpected, [], 'a test reads hooks/band/ as text: test the behaviour in tests/band.test.tsx');
for (const [name, band] of ALLOWED) assert.ok(found.some(([n, b]) => n === name && b === band), `${name} no longer reads ${band}: drop it from ALLOWED`);

console.log('band source-read checks passed');
