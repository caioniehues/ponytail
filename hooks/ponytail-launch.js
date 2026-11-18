// ponytail — starts a Claude Code hook as the ponytail binary when rust/app is built, and as the JS hook otherwise
// (fork #8, ADR 0002). Codex, Copilot and the other hosts that read claude-codex-hooks.json keep the JS: the binary
// writes Claude Code's output only. `cargo clean` goes back to the JS.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { isCodeBuddy, isCodex, isCopilot, isCursor, isQoder } = require('./ponytail-runtime');

const HOOKS = {
  'session-start': 'ponytail-activate.js',
  'subagent-start': 'ponytail-subagent.js',
  'prompt-submit': 'ponytail-mode-tracker.js',
};
const BINARY = path.join(__dirname, '..', 'rust', 'app', 'target', 'release', 'ponytail');

module.exports = (hook) => {
  if (!isCodex && !isCopilot && !isQoder && !isCodeBuddy && !isCursor && fs.existsSync(BINARY)) {
    const run = spawnSync(BINARY, ['hook', hook], { stdio: 'inherit' });
    // A binary that did not start has read no stdin, so the JS hook can still answer.
    // A killed binary exits 0, as every JS hook does: a hook never fails the session.
    if (!run.error) process.exit(run.status ?? 0);
  }
  require(path.join(__dirname, HOOKS[hook]));
};
