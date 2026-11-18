#!/usr/bin/env node
// Records the hook cases from the JS reference (fork #8, ADR 0002): harvests the runs of the hook tests
// (rust/cases/preload.js), adds rust/cases/added.js, and has rust-anything run each case twice into rust/app-cases,
// with its trap cases. Run it again after a pick changes hook behaviour; the Rust then has to catch up.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repo = path.join(__dirname, '..', '..');
// Every case sets what the hooks read, so the shell that replays it (a Claude Code session, Codex) leaks nothing in.
const BASE = {
  HOME: 'home', USERPROFILE: 'home', XDG_CONFIG_HOME: '', CLAUDE_CONFIG_DIR: '', CLAUDE_PROJECT_DIR: '',
  CLAUDE_PLUGIN_ROOT: '', PLUGIN_DATA: '', COPILOT_PLUGIN_DATA: '', QODER_SESSION_ID: '', QODER_PROJECT_DIR: '',
  QODER_CONFIG_DIR: '', CODEBUDDY_PLUGIN_ROOT: '', CODEBUDDY_CONFIG_DIR: '', CURSOR_VERSION: '', CURSOR_PROJECT_DIR: '',
  PONYTAIL_DEFAULT_MODE: '', PONYTAIL_MAP: '', PONYTAIL_MAP_CHARS: '', PONYTAIL_SUBAGENT_MATCHER: '',
};
const SUITES = [
  [repo, ['tests/hooks.test.js', 'tests/activation-resume.test.js', 'tests/hooks-windows.test.js', 'tests/map.test.js']],
  [path.join(repo, 'pi-extension'), ['test/extension.test.js']],
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ponytail-record-'));
try {
  const harvest = path.join(tmp, 'harvest.jsonl');
  fs.writeFileSync(harvest, '');
  let harvested = 0;
  for (const [cwd, files] of SUITES) {
    const run = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], {
      cwd, stdio: ['ignore', 'ignore', 'inherit'],
      env: { ...process.env, NODE_OPTIONS: '--require ' + path.join(__dirname, 'preload.js'), PONYTAIL_HARVEST_OUT: harvest },
    });
    if (run.status !== 0) throw new Error(files.join(' ') + ' failed: record from a green suite');
    const before = harvested;
    harvested = fs.readFileSync(harvest, 'utf8').split('\n').filter(Boolean).length;
    if (harvested === before) throw new Error(files.join(' ') + ' gave no case: the preload saw no hook run');
  }
  let projects = [];
  try { projects = fs.readFileSync(harvest + '.projects', 'utf8').split('\n').filter(Boolean).map((l) => l.split(' ')); } catch (e) {}
  const unique = new Map();
  for (const line of fs.readFileSync(harvest, 'utf8').split('\n').filter(Boolean)) {
    const c = JSON.parse(line);
    for (const [from, to] of projects) {
      for (const name of Object.keys(c.files)) {
        if (!name.endsWith('ponytail-modes/' + from)) continue;
        c.files[name.slice(0, -from.length) + to] = c.files[name];
        delete c.files[name];
      }
    }
    // Named by its content once the renames are done, so a case keeps its name from one recording to the next.
    const id = crypto.createHash('sha256').update(JSON.stringify({ ...c, name: '' })).digest('hex').slice(0, 6);
    c.name = c.name.replace(/[0-9a-f]{6}$/, id);
    unique.set(c.name, c);
  }
  const cases = [...[...unique.values()].sort((a, b) => a.name.localeCompare(b.name)), ...require('./added')]
    .map((c) => ({ ...c, env: { ...BASE, ...c.env } }));
  const names = cases.map((c) => c.name);
  const twice = names.filter((n, i) => names.indexOf(n) !== i);
  if (twice.length) throw new Error('case names used twice: ' + twice.join(', '));
  const long = names.filter((n) => n.length > 24);
  if (long.length) throw new Error('rust-anything cuts names past 24 characters: ' + long.join(', '));
  const inputs = path.join(tmp, 'inputs.jsonl');
  fs.writeFileSync(inputs, cases.map((c) => JSON.stringify(c)).join('\n') + '\n');
  console.log(unique.size + ' harvested cases, ' + (cases.length - unique.size) + ' added');

  fs.rmSync(path.join(repo, 'rust', 'app-cases'), { recursive: true, force: true });
  const record = spawnSync('rust-anything', ['app', 'record', repo, '--inputs', inputs, '--normalize', 'key-order', '--name', 'ponytail',
    '--', 'sh', 'rust/run-case.sh', 'node', 'rust/reference.js'], { stdio: 'inherit' });
  process.exitCode = record.status ?? 1;
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
