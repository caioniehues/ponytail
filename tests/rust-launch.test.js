// Claude Code runs the ponytail binary when it is built, and the JS hook otherwise; every other host that reads
// claude-codex-hooks.json keeps the JS (fork #8, ADR 0002). A stub binary stands in for rust/app's build.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const BINARY = path.join('rust', 'app', 'target', 'release', 'ponytail');
const EVENTS = { SessionStart: 'session-start', SubagentStart: 'subagent-start', UserPromptSubmit: 'prompt-submit' };

// A copy of the plugin, with the stub binary when built is set: it prints its arguments and its stdin.
function plugin(t, dir, built) {
  const copy = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ponytail-launch-')), dir);
  t.after(() => fs.rmSync(path.dirname(copy), { recursive: true, force: true }));
  for (const folder of ['hooks', 'skills']) fs.cpSync(path.join(root, folder), path.join(copy, folder), { recursive: true });
  if (built) {
    fs.mkdirSync(path.dirname(path.join(copy, BINARY)), { recursive: true });
    fs.writeFileSync(path.join(copy, BINARY), '#!/bin/sh\nprintf "binary %s %s: " "$1" "$2"\ncat\n', { mode: 0o755 });
  }
  return copy;
}

function run(pluginRoot, event, env = {}) {
  const config = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'hooks', 'claude-codex-hooks.json'), 'utf8'));
  const [{ hooks: [{ command }] }] = config.hooks[event];
  const home = path.join(path.dirname(pluginRoot), 'home');
  return spawnSync('/bin/sh', ['-c', command], {
    input: JSON.stringify({ session_id: 'A', source: 'startup', prompt: '/ponytail ultra' }),
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: '', CLAUDE_PROJECT_DIR: '', XDG_CONFIG_HOME: '',
      PLUGIN_DATA: '', COPILOT_PLUGIN_DATA: '', QODER_SESSION_ID: '', QODER_PROJECT_DIR: '', CODEBUDDY_PLUGIN_ROOT: '',
      CURSOR_VERSION: '', PONYTAIL_MAP: '0', PONYTAIL_DEFAULT_MODE: 'full', CLAUDE_PLUGIN_ROOT: pluginRoot, ...env },
  });
}

const skip = { skip: !fs.existsSync('/bin/sh') };
const fromBinary = (result) => /^binary hook /.test(result.stdout);

test('Claude Code runs every hook through the binary when it is built, with the same stdin', skip, (t) => {
  const copy = plugin(t, 'ponytail', true);
  for (const [event, hook] of Object.entries(EVENTS)) {
    const result = run(copy, event);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'binary hook ' + hook + ': {"session_id":"A","source":"startup","prompt":"/ponytail ultra"}');
  }
});

test('without the binary, Claude Code runs the JS hooks', skip, (t) => {
  const copy = plugin(t, 'ponytail', false);
  const start = run(copy, 'SessionStart');
  assert.equal(start.status, 0, start.stderr);
  assert.match(JSON.parse(start.stdout).hookSpecificOutput.additionalContext, /^PONYTAIL MODE ACTIVE — level: full/);
  assert.equal(run(copy, 'UserPromptSubmit').stdout, 'PONYTAIL MODE CHANGED — level: ultra');
});

test('another host that reads the hooks file keeps the JS when the binary is built', skip, (t) => {
  const copy = plugin(t, 'ponytail', true);
  const data = path.join(path.dirname(copy), 'data');
  for (const env of [{ PLUGIN_DATA: data }, { COPILOT_PLUGIN_DATA: data }, { QODER_PROJECT_DIR: data },
    { CODEBUDDY_PLUGIN_ROOT: copy, CODEBUDDY_CONFIG_DIR: data }, { CURSOR_VERSION: '3.20.17', CURSOR_PROJECT_DIR: data }]) {
    for (const event of Object.keys(EVENTS)) {
      const result = run(copy, event, env);
      assert.equal(result.status, 0, result.stderr);
      assert.ok(!fromBinary(result), Object.keys(env)[0] + ' ' + event + ' ran the binary: ' + result.stdout);
    }
  }
  // VS Code Copilot sets no marker of its own, only a plugin root under .vscode/agent-plugins.
  const vscode = plugin(t, path.join('.vscode', 'agent-plugins', 'ponytail'), true);
  const result = run(vscode, 'SessionStart');
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!fromBinary(result), 'VS Code Copilot ran the binary: ' + result.stdout);
});
