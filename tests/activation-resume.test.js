const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Claude Code gets SessionStart context as hookSpecificOutput JSON (dietrichgebert/ponytail#1420); '' when the hook wrote nothing.
const context = (stdout) => (stdout ? JSON.parse(stdout).hookSpecificOutput.additionalContext : '');

test('resume preserves the live mode and emits only a reminder', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ponytail-resume-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  function run(script, env, input) {
    return spawnSync(process.execPath, [path.join(__dirname, '..', 'hooks', script)], {
      env: { ...process.env, CLAUDE_CONFIG_DIR: '', CLAUDE_PROJECT_DIR: '',
        PLUGIN_DATA: '', COPILOT_PLUGIN_DATA: '', CURSOR_VERSION: '', CURSOR_PROJECT_DIR: '',
        CODEBUDDY_PLUGIN_ROOT: '', CODEBUDDY_CONFIG_DIR: '', PONYTAIL_MAP: '0', ...env },
      input, encoding: 'utf8',
    });
  }

  const resumeHome = path.join(temp, 'resume-home');
  const resumeFlag = path.join(resumeHome, '.claude', '.ponytail-active');
  const resumeEnv = { HOME: resumeHome, USERPROFILE: resumeHome, PONYTAIL_DEFAULT_MODE: 'full' };
  const resume = () => run('ponytail-activate.js', resumeEnv, JSON.stringify({ source: 'resume' }));

  assert.equal(resume().stdout, '', 'resume without a live mode must stay off');
  assert.equal(fs.existsSync(resumeFlag), false);
  run('ponytail-activate.js', resumeEnv, JSON.stringify({ source: 'startup' }));
  for (const mode of ['ultra', 'lite', 'full']) {
    run('ponytail-mode-tracker.js', resumeEnv, JSON.stringify({ prompt: '/ponytail ' + mode }));
    const result = resume();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(context(result.stdout), 'PONYTAIL MODE ACTIVE — level: ' + mode);
    assert.equal(fs.readFileSync(resumeFlag, 'utf8'), mode);
  }
  run('ponytail-mode-tracker.js', resumeEnv, JSON.stringify({ prompt: 'stop ponytail' }));
  assert.equal(resume().stdout, '', 'resume must not switch a stopped session back on');
  assert.equal(fs.existsSync(resumeFlag), false);
});

test('resume keeps its own session level when another session in the repo started off', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ponytail-resume-session-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const env = { ...process.env, CLAUDE_CONFIG_DIR: '', PLUGIN_DATA: '', COPILOT_PLUGIN_DATA: '', CURSOR_VERSION: '', CURSOR_PROJECT_DIR: '',
    CODEBUDDY_PLUGIN_ROOT: '', CODEBUDDY_CONFIG_DIR: '', PONYTAIL_MAP: '0', HOME: temp, USERPROFILE: temp, CLAUDE_PROJECT_DIR: '/work/shared-repo' };
  const hook = (script, session, payload, mode = 'full') => spawnSync(process.execPath, [path.join(__dirname, '..', 'hooks', script)], {
    env: { ...env, PONYTAIL_DEFAULT_MODE: mode }, input: JSON.stringify({ session_id: session, ...payload }), encoding: 'utf8',
  }).stdout;

  hook('ponytail-activate.js', 'A', { source: 'startup' });
  hook('ponytail-mode-tracker.js', 'A', { prompt: '/ponytail ultra' });
  hook('ponytail-activate.js', 'B', { source: 'startup' }, 'off');
  assert.equal(context(hook('ponytail-activate.js', 'A', { source: 'resume' })), 'PONYTAIL MODE ACTIVE — level: ultra');
  assert.equal(hook('ponytail-activate.js', 'B', { source: 'resume' }), '', 'the session that started off resumes off');
});

test('a session id with no state file of its own falls back to the project level, and a lost payload still finds it', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ponytail-resume-fallback-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const env = { ...process.env, CLAUDE_CONFIG_DIR: '', PLUGIN_DATA: '', COPILOT_PLUGIN_DATA: '', CURSOR_VERSION: '', CURSOR_PROJECT_DIR: '',
    CODEBUDDY_PLUGIN_ROOT: '', CODEBUDDY_CONFIG_DIR: '', PONYTAIL_MAP: '0', HOME: temp, USERPROFILE: temp,
    CLAUDE_PROJECT_DIR: '/work/shared-repo', PONYTAIL_DEFAULT_MODE: 'full' };
  const hook = (script, input) => spawnSync(process.execPath, [path.join(__dirname, '..', 'hooks', script)], { env, input, encoding: 'utf8' }).stdout;

  // A session from before session keying: its level lives only in the project file.
  hook('ponytail-activate.js', JSON.stringify({ source: 'startup' }));
  hook('ponytail-mode-tracker.js', JSON.stringify({ prompt: '/ponytail ultra' }));
  assert.equal(context(hook('ponytail-activate.js', JSON.stringify({ session_id: 'old', source: 'resume' }))), 'PONYTAIL MODE ACTIVE — level: ultra');

  // A keyed session's switch also reaches the project file, which a subagent hook with no payload reads.
  hook('ponytail-mode-tracker.js', JSON.stringify({ session_id: 'A', prompt: '/ponytail lite' }));
  assert.match(hook('ponytail-subagent.js', ''), /level: lite/);

  // A keyed session that was stopped resumes off, even with a level in the project file.
  hook('ponytail-mode-tracker.js', JSON.stringify({ session_id: 'B', prompt: 'stop ponytail' }));
  hook('ponytail-mode-tracker.js', JSON.stringify({ session_id: 'A', prompt: '/ponytail ultra' }));
  assert.equal(hook('ponytail-activate.js', JSON.stringify({ session_id: 'B', source: 'resume' })), '');
});

test('a forked session, or one from a source ponytail does not know, keeps a level instead of following the repo (#15)', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ponytail-fork-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const env = { ...process.env, CLAUDE_CONFIG_DIR: '', PLUGIN_DATA: '', COPILOT_PLUGIN_DATA: '', CURSOR_VERSION: '', CURSOR_PROJECT_DIR: '',
    CODEBUDDY_PLUGIN_ROOT: '', CODEBUDDY_CONFIG_DIR: '', PONYTAIL_MAP: '0', HOME: temp, USERPROFILE: temp,
    CLAUDE_PROJECT_DIR: '/work/shared-repo', PONYTAIL_DEFAULT_MODE: 'full' };
  const hook = (script, session, payload) => spawnSync(process.execPath, [path.join(__dirname, '..', 'hooks', script)], {
    env, input: JSON.stringify({ session_id: session, ...payload }), encoding: 'utf8',
  }).stdout;

  // Claude Code starts --fork-session, /fork and /branch with source "fork", and adds sources over time. With no
  // matcher every source reaches the hook, which keeps the session's level for anything but a fresh start.
  const entries = (manifest) => [].concat(JSON.parse(fs.readFileSync(path.join(__dirname, '..', manifest), 'utf8')).hooks)
    .flatMap(file => JSON.parse(fs.readFileSync(path.join(__dirname, '..', file), 'utf8')).hooks.SessionStart ?? []);
  for (const manifest of ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json']) {
    assert.deepEqual(entries(manifest).map(entry => entry.matcher), [undefined], `${manifest}: one SessionStart entry, with no matcher`);
  }

  hook('ponytail-activate.js', 'A', { source: 'startup' });
  hook('ponytail-mode-tracker.js', 'A', { prompt: '/ponytail ultra' });
  // A fork of A: a new id with no file of its own, and no parent id in the payload.
  assert.equal(context(hook('ponytail-activate.js', 'F', { source: 'fork' })), 'PONYTAIL MODE ACTIVE — level: ultra');
  // Another session in the repo switches afterwards; the fork's compaction keeps the fork's own level.
  hook('ponytail-activate.js', 'B', { source: 'startup' });
  hook('ponytail-mode-tracker.js', 'B', { prompt: '/ponytail lite' });
  // A source ponytail does not know yet goes on at the level readMode finds (B's lite here), not the default (full).
  assert.match(context(hook('ponytail-activate.js', 'G', { source: 'teleport' })), /^PONYTAIL MODE ACTIVE — level: lite\n/);
  assert.match(context(hook('ponytail-activate.js', 'F', { source: 'compact' })), /^PONYTAIL MODE ACTIVE — level: ultra\n/);
});

test('a fresh start removes session files untouched for 30 days', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ponytail-prune-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const env = { ...process.env, CLAUDE_CONFIG_DIR: '', PLUGIN_DATA: '', COPILOT_PLUGIN_DATA: '', CURSOR_VERSION: '', CURSOR_PROJECT_DIR: '',
    CODEBUDDY_PLUGIN_ROOT: '', CODEBUDDY_CONFIG_DIR: '', PONYTAIL_MAP: '0', HOME: temp, USERPROFILE: temp,
    CLAUDE_PROJECT_DIR: '/work/repo', PONYTAIL_DEFAULT_MODE: 'full' };
  const sessions = path.join(temp, '.claude', 'ponytail-sessions');
  fs.mkdirSync(sessions, { recursive: true });
  const day = 24 * 3600;
  const now = Date.now() / 1000;
  for (const [name, age] of [['stale', 31 * day], ['recent', 1 * day]]) {
    fs.writeFileSync(path.join(sessions, name), 'ultra');
    fs.utimesSync(path.join(sessions, name), now - age, now - age);
  }

  spawnSync(process.execPath, [path.join(__dirname, '..', 'hooks', 'ponytail-activate.js')], {
    env, input: JSON.stringify({ session_id: 'new', source: 'startup' }), encoding: 'utf8',
  });

  assert.equal(fs.existsSync(path.join(sessions, 'stale')), false, 'a session file idle past 30 days is removed');
  assert.equal(fs.existsSync(path.join(sessions, 'recent')), true, 'a recent session keeps its file');
});

test('a session resumed after 30 idle days keeps its own level', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ponytail-prune-resume-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const env = { ...process.env, CLAUDE_CONFIG_DIR: '', PLUGIN_DATA: '', COPILOT_PLUGIN_DATA: '', CURSOR_VERSION: '', CURSOR_PROJECT_DIR: '',
    CODEBUDDY_PLUGIN_ROOT: '', CODEBUDDY_CONFIG_DIR: '', PONYTAIL_MAP: '0', HOME: temp, USERPROFILE: temp,
    CLAUDE_PROJECT_DIR: '/work/repo', PONYTAIL_DEFAULT_MODE: 'full' };
  const hook = (script, session, payload) => spawnSync(process.execPath, [path.join(__dirname, '..', 'hooks', script)], {
    env, input: JSON.stringify({ session_id: session, ...payload }), encoding: 'utf8',
  }).stdout;

  hook('ponytail-activate.js', 'A', { source: 'startup' });
  hook('ponytail-mode-tracker.js', 'A', { prompt: '/ponytail ultra' });
  // Another session leaves lite in the project file, so a pruned A would resume at lite.
  hook('ponytail-activate.js', 'B', { source: 'startup' });
  hook('ponytail-mode-tracker.js', 'B', { prompt: '/ponytail lite' });
  const sessions = path.join(temp, '.claude', 'ponytail-sessions');
  const old = Date.now() / 1000 - 31 * 24 * 3600;
  for (const name of fs.readdirSync(sessions)) fs.utimesSync(path.join(sessions, name), old, old);

  assert.equal(context(hook('ponytail-activate.js', 'A', { source: 'resume' })), 'PONYTAIL MODE ACTIVE — level: ultra');
});
