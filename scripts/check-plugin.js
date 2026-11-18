#!/usr/bin/env node
// Plugin guard. `claude plugin validate` reads the manifests and the band's
// hooks module the way the engine will, and type-checks the module and its
// tests against the engine's own types. It reports type errors as warnings and
// still exits 0, so this check fails on every error or warning it prints.
// Files git ignores are skipped (the editor's laid types), and so are the
// warnings in ACCEPTED, each with its reason.

const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');

// [file, start of the message, why it stays]
const ACCEPTED = [
  ['CLAUDE.local.md', 'CLAUDE.local.md at the plugin root is not loaded as project context',
    "the fork's agent config: Claude Code reads it as the repo's project memory; the plugin never needs it"],
];

const run = (cmd, args) => spawnSync(cmd, args, { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' });

const validate = run('claude', ['plugin', 'validate', '--json', '.']);
if (validate.error || !validate.stdout) {
  console.error('check-plugin: could not run `claude plugin validate`:', validate.error ? validate.error.message : validate.stderr);
  process.exit(1);
}

const report = JSON.parse(validate.stdout);
const ignored = file => run('git', ['check-ignore', '-q', file]).status === 0;
const accepted = (where, message) => ACCEPTED.some(([file, start]) => where === file && message.startsWith(start));
const problems = [];
for (const entry of [report.manifest, ...report.contents]) {
  if (ignored(entry.file)) continue;
  const where = path.relative(root, entry.file);
  for (const e of entry.errors) problems.push(`${where}: error: ${e.message}`);
  for (const w of entry.warnings) {
    if (!accepted(where, w.message)) problems.push(`${where}: warning: ${w.message}`);
  }
}

if (problems.length > 0 || !report.success) {
  console.error(`check-plugin: ${problems.length} problem(s) from claude plugin validate`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log('check-plugin: claude plugin validate is clean');
