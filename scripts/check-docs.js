#!/usr/bin/env node
// Fails on a Markdown line where a list item runs into the one before it (`…).- next`, `…done.2. **Next**`): the mark an
// edit leaves when it drops the line break along with a sentence.
const { execFileSync } = require('child_process');
const fs = require('fs');

const GLUED = /[.)`]- |[a-z)]\.[0-9]+\. \*\*/;
const files = execFileSync('git', ['ls-files', '*.md'], { encoding: 'utf8' }).split('\n')
  .filter((f) => f && !f.startsWith('rust/app-cases/'));
const hits = [];
for (const file of files) {
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (GLUED.test(line)) hits.push(file + ':' + (i + 1) + ': ' + line.match(GLUED)[0].trim() + ' (a list item glued to the text before it)');
  });
}
if (hits.length) {
  console.error('check-docs: ' + hits.length + ' problem(s)\n' + hits.join('\n'));
  process.exit(1);
}
