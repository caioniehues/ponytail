// Loaded with NODE_OPTIONS=--require by rust/cases/record.js while the hook tests run (fork #8). Every Claude Code
// hook process the tests start, and every map they build, becomes an input case for `rust-anything app record`: its
// subcommand, stdin, environment and the files of the test's temp folder, which becomes the case's folder.
// shortcut: symlinks, .git folders, binary files and file times are not carried over, so a case built from a test
// that needs them runs on a plain copy; write it into added.js by hand if the copy loses what the test checks.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const OUT = process.env.PONYTAIL_HARVEST_OUT;
const repo = path.join(__dirname, '..', '..');
const HOOKS = {
  'ponytail-activate.js': 'session-start',
  'ponytail-subagent.js': 'subagent-start',
  'ponytail-mode-tracker.js': 'prompt-submit',
};
// What the hooks read from the environment; a path outside the test's temp folder is left to the case's default.
const PATHS = ['HOME', 'USERPROFILE', 'CLAUDE_CONFIG_DIR', 'XDG_CONFIG_HOME'];
const VALUES = ['CLAUDE_PROJECT_DIR', 'PONYTAIL_DEFAULT_MODE', 'PONYTAIL_MAP', 'PONYTAIL_MAP_CHARS',
  'PONYTAIL_SUBAGENT_MATCHER', 'PONYTAIL_QUIET_STARTUP', 'PONYTAIL_HIDE_STATUS'];
const OTHER_HOSTS = ['PLUGIN_DATA', 'COPILOT_PLUGIN_DATA', 'QODER_SESSION_ID', 'QODER_PROJECT_DIR',
  'CODEBUDDY_PLUGIN_ROOT', 'CURSOR_VERSION'];
const MAX_FILES = 300;
const MAX_BYTES = 1 << 20;
const tmp = os.tmpdir();

// The test's temp folder that holds p: the first folder under the temp dir.
function sandboxOf(p) {
  if (typeof p !== 'string' || !p.startsWith(tmp + path.sep)) return null;
  return path.join(tmp, p.slice(tmp.length + 1).split(path.sep)[0]);
}

const relTo = (root) => (text) => text.split(root + path.sep).join('').split(root).join('.');

// The regular UTF-8 files under dirs (all of root by default), keyed by their path from root; null when too big for a case.
function snapshot(root, rel, dirs = [root]) {
  const files = {};
  let count = 0;
  let bytes = 0;
  const walk = (dir) => {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const ent of ents) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) { if (ent.name !== '.git') walk(p); continue; }
      if (!ent.isFile()) continue;
      let buf;
      try { buf = fs.readFileSync(p); } catch (e) { continue; }
      const text = buf.toString('utf8');
      if (!Buffer.from(text, 'utf8').equals(buf)) continue;
      count++;
      bytes += buf.length;
      files[path.relative(root, p).split(path.sep).join('/')] = rel(text);
    }
  };
  for (const dir of dirs) if (dir === root || dir.startsWith(root + path.sep)) walk(dir);
  return count > MAX_FILES || bytes > MAX_BYTES ? null : files;
}

function environment(root, rel, env) {
  const out = {};
  for (const k of PATHS) {
    const v = env[k];
    if (v === undefined) continue;
    out[k] = sandboxOf(v) === root ? rel(v) : '';
  }
  if (!out.HOME) out.HOME = 'home';
  for (const k of VALUES) if (env[k] !== undefined) out[k] = rel(env[k]);
  return out;
}

function emit(sub, c) {
  const body = JSON.stringify(c);
  const id = crypto.createHash('sha256').update(body).digest('hex').slice(0, 6);
  const source = process.env.PONYTAIL_HARVEST_SOURCE || 'test';
  // rust-anything keeps 24 characters of a name: <test>-<hook>-<hash of the case>.
  fs.appendFileSync(OUT, JSON.stringify({ name: `${source}-${sub.split('-')[0]}-${id}`, ...c }) + '\n');
}

// The map's case folder is the project root itself: a test's files beside it (outside a symlink) stay out.
function captureMap(root, env) {
  const box = path.resolve(root);
  if (!sandboxOf(box)) return;
  const rel = relTo(box);
  const files = snapshot(box, rel);
  if (files) emit('map', { args: ['map', '.'], env: environment(box, rel, env), files });
}

function captureHook(sub) {
  const env = process.env;
  if (OTHER_HOSTS.some((k) => env[k])) return;
  const root = env.CLAUDE_PLUGIN_ROOT || '';
  if (root.split(/[\\/]+/).includes('agent-plugins') && root.toLowerCase().includes('.vscode')) return;
  const box = sandboxOf(env.HOME) ||
    (sandboxOf(env.CLAUDE_CONFIG_DIR) && sandboxOf(env.CLAUDE_CONFIG_DIR) === sandboxOf(env.XDG_CONFIG_HOME)
      ? sandboxOf(env.CLAUDE_CONFIG_DIR) : null);
  if (!box) return;
  const rel = relTo(box);
  // Only the folders a hook reads: the Claude config dir and ponytail's config dir; other hosts' state stays out.
  const home = env.HOME || '';
  const files = snapshot(box, rel, [env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'),
    path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'ponytail')]);
  if (!files) return;
  const environ = environment(box, rel, env);
  // A project dir in the temp folder names its state file by the hash of its path, which differs every run:
  // record.js renames that file in every case to the hash of the case's path.
  const project = (env.CLAUDE_PROJECT_DIR || '').trim();
  if (project && sandboxOf(project) === box) {
    const hash = (dir) => crypto.createHash('sha256').update(path.normalize(dir)).digest('hex');
    fs.appendFileSync(OUT + '.projects', hash(project) + ' ' + hash(environ.CLAUDE_PROJECT_DIR.trim()) + '\n');
  }
  let stdin = '';
  let ended = false;
  process.stdin.on('data', (chunk) => { stdin += chunk; });
  process.stdin.on('end', () => { ended = true; });
  // A stdin that never ended took the hook's 1 s fallback: timing, not a case.
  process.on('exit', () => { if (ended) emit(sub, { args: ['hook', sub], stdin: rel(stdin), env: environ, files }); });
}

const script = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (OUT && !process.env.PONYTAIL_HARVEST_CHILD) {
  if (/\.test\.js$/.test(script)) {
    process.env.PONYTAIL_HARVEST_SOURCE = path.basename(script, '.test.js').replace(/^activation-/, '').replace(/^hooks-/, '');
    // Tests that build the map in-process: buildMap(root) with no deadline is `map root` in a small tree.
    const map = require(path.join(repo, 'hooks', 'ponytail-map.js'));
    const buildMap = map.buildMap;
    map.buildMap = function (root = process.cwd(), until) {
      if (until === undefined) captureMap(root, process.env);
      return buildMap.apply(this, arguments);
    };
    // Cases come from the JS even when the binary is built: Pi's loader starts the reference in its place.
    const cp = require('child_process');
    const execFile = cp.execFile;
    const binary = path.join(repo, 'rust', 'app', 'target', 'release', 'ponytail');
    cp.execFile = function (file, args, ...rest) {
      if (file !== binary) return execFile.apply(this, arguments);
      return execFile.call(this, process.execPath, [path.join(repo, 'rust', 'reference.js'), ...args], ...rest);
    };
    // Pi's extension imports execFile as an ES module binding.
    require('module').syncBuiltinESMExports();
  } else if (path.dirname(script) === path.join(repo, 'hooks') || script === path.join(repo, 'rust', 'reference.js')) {
    // The map and the band import a hook starts are part of that hook's case.
    process.env.PONYTAIL_HARVEST_CHILD = '1';
    const [a, b] = process.argv.slice(2);
    const name = path.basename(script);
    if (HOOKS[name]) captureHook(HOOKS[name]);
    else if (name === 'ponytail-map.js') captureMap(a || process.cwd(), process.env);
    // Pi's map, when the binary is built (above): the same case as the JS map it would run otherwise.
    else if (name === 'reference.js' && a === 'map') captureMap(b || process.cwd(), process.env);
  }
}
