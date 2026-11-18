const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

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
    assert.equal(result.stdout, 'PONYTAIL MODE ACTIVE — level: ' + mode);
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
  assert.equal(hook('ponytail-activate.js', 'A', { source: 'resume' }), 'PONYTAIL MODE ACTIVE — level: ultra');
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
  assert.equal(hook('ponytail-activate.js', JSON.stringify({ session_id: 'old', source: 'resume' })), 'PONYTAIL MODE ACTIVE — level: ultra');

  // A keyed session's switch also reaches the project file, which a subagent hook with no payload reads.
  hook('ponytail-mode-tracker.js', JSON.stringify({ session_id: 'A', prompt: '/ponytail lite' }));
  assert.match(hook('ponytail-subagent.js', ''), /level: lite/);

  // A keyed session that was stopped resumes off, even with a level in the project file.
  hook('ponytail-mode-tracker.js', JSON.stringify({ session_id: 'B', prompt: 'stop ponytail' }));
  hook('ponytail-mode-tracker.js', JSON.stringify({ session_id: 'A', prompt: '/ponytail ultra' }));
  assert.equal(hook('ponytail-activate.js', JSON.stringify({ session_id: 'B', source: 'resume' })), '');
});
