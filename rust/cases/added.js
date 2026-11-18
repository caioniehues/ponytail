// The cases fork #7 adds to the ones harvested from the hook tests (rust/cases/preload.js): each is one run of the reference,
// with the state files a sequence of hooks would have left (a resume, two sessions, a band pick) as starting files.
const crypto = require('crypto');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const SESSION = (id) => 'home/.claude/ponytail-sessions/' + sha(id);
const PROJECT = (dir) => 'home/.claude/ponytail-modes/' + sha(dir);
const FLAG = 'home/.claude/.ponytail-active';
const REPO = '/work/repo';

const hook = (sub) => (name, payload, env = {}, files = {}) => ({
  name, args: ['hook', sub], stdin: typeof payload === 'string' ? payload : JSON.stringify(payload), env, files,
});
const start = hook('session-start');
const sub = hook('subagent-start');
const prompt = hook('prompt-submit');
const map = (name, args, env = {}, files = {}) => ({ name, args: ['map', ...args], env, files });

const repo = { CLAUDE_PROJECT_DIR: REPO, PONYTAIL_MAP: '0' };
const two = { [SESSION('A')]: 'ultra', [SESSION('B')]: 'full', [PROJECT(REPO)]: 'full', [FLAG]: 'full' };
const pending = (id, level) => ({ ['home/.claude/ponytail-pending/' + id]: level, [SESSION(id)]: 'full', [FLAG]: 'full' });
const settings = (value) => ({ 'home/.claude/settings.json': value });
const project = { 'lib/helper.js': 'export function usefulHelper() {}\n', 'src/app.ts': 'export class App {}\n' };

// Names a JS regex without the u flag stops at (\w is ASCII there), near a budget that cuts the list.
const nonAscii = {};
for (let i = 0; i < 8; i++) {
  nonAscii['proj/pkg' + i + '/index.js'] = 'export function café' + i + '() {}\nexport const größe' + i + ' = 1;\nexport function plain' + i + '() {}\n';
}
nonAscii['proj/py/mod.py'] = 'def ñame():\n    pass\nclass Ünicode:\n    pass\ndef ascii_name():\n    pass\n';
nonAscii['proj/emoji/e.js'] = 'export const smile😀 = 1;\nexport function 𝒻() {}\nexport function after() {}\n';

module.exports = [
  // Two sessions in one repo keep their own levels.
  prompt('two-sessions-switch', { session_id: 'B', prompt: '/ponytail lite' }, repo, two),
  prompt('two-sessions-stop', { session_id: 'B', prompt: 'stop ponytail' }, repo, two),
  sub('two-sessions-subagent', { session_id: 'A', agent_type: 'Explore' }, repo, { ...two, [SESSION('B')]: 'lite' }),
  start('two-sessions-start-b', { session_id: 'B', source: 'startup' }, { ...repo, PONYTAIL_DEFAULT_MODE: 'off' }, two),
  // A resumed session id keeps its level; the other sources.
  start('resume-own-level', { session_id: 'A', source: 'resume' }, repo, { [SESSION('A')]: 'lite', [PROJECT(REPO)]: 'ultra' }),
  start('resume-stopped', { session_id: 'A', source: 'resume' }, repo, { [SESSION('A')]: 'off', [PROJECT(REPO)]: 'ultra' }),
  start('resume-no-session-file', { session_id: 'C', source: 'resume' }, repo, { [PROJECT(REPO)]: 'ultra' }),
  start('resume-nothing', { session_id: 'C', source: 'resume' }, repo),
  start('fork', { session_id: 'F', source: 'fork' }, repo, { [SESSION('A')]: 'ultra', [PROJECT(REPO)]: 'ultra', [FLAG]: 'ultra' }),
  start('unknown-source', { session_id: 'G', source: 'teleport' }, repo, { [PROJECT(REPO)]: 'lite' }),
  start('compact', { session_id: 'A', source: 'compact' }, repo, { [SESSION('A')]: 'ultra' }),
  start('clear', { session_id: 'A', source: 'clear' }, repo, { [SESSION('A')]: 'ultra' }),
  start('startup-keeps-recent', { session_id: 'N', source: 'startup' }, repo, { [SESSION('old')]: 'ultra' }),
  start('startup-off-clears', { session_id: 'A', source: 'startup' }, { ...repo, PONYTAIL_DEFAULT_MODE: 'off' },
    { [SESSION('A')]: 'full', [PROJECT(REPO)]: 'full', [FLAG]: 'full' }),
  start('start-bad-json', 'not json', repo),
  start('start-empty', '', repo),
  start('start-bom', '\uFEFF' + JSON.stringify({ session_id: 'A', source: 'resume' }), repo, { [SESSION('A')]: 'lite' }),
  start('start-session-id-number', { session_id: 42, source: 'startup' }, repo),
  // Each PONYTAIL_* variable.
  start('env-map-on', { session_id: 'A', source: 'startup' }, { PONYTAIL_MAP: '1' }, project),
  start('env-map-unset', { session_id: 'A', source: 'startup' }, {}, project),
  start('env-map-off', { session_id: 'A', source: 'startup' }, { PONYTAIL_MAP: '0' }, project),
  start('env-map-chars', { session_id: 'A', source: 'startup' }, { PONYTAIL_MAP_CHARS: '30' }, project),
  start('env-map-review-default', { session_id: 'A', source: 'startup' }, { PONYTAIL_DEFAULT_MODE: 'review' }, project),
  start('env-default-ultra', { source: 'startup' }, { PONYTAIL_DEFAULT_MODE: ' ULTRA ', PONYTAIL_MAP: '0' }),
  start('env-default-lite', { source: 'startup' }, { PONYTAIL_DEFAULT_MODE: 'lite', PONYTAIL_MAP: '0' }),
  start('env-default-bogus', { source: 'startup' }, { PONYTAIL_DEFAULT_MODE: 'bogus', PONYTAIL_MAP: '0' }),
  start('env-quiet-startup', { source: 'startup' }, { PONYTAIL_QUIET_STARTUP: '1', PONYTAIL_MAP: '0' }),
  start('env-hide-status', { source: 'startup' }, { PONYTAIL_HIDE_STATUS: '1', PONYTAIL_MAP: '0' }),
  start('env-config-dir', { session_id: 'A', source: 'startup' }, { CLAUDE_CONFIG_DIR: 'cc', PONYTAIL_MAP: '0' }),
  start('env-config-dir-unsafe', { source: 'startup' }, { CLAUDE_CONFIG_DIR: 'c$x', PONYTAIL_MAP: '0' }),
  // Config file lookup.
  start('config-xdg', { source: 'startup' }, { XDG_CONFIG_HOME: 'cfg', PONYTAIL_MAP: '0' }, { 'cfg/ponytail/config.json': '{"defaultMode":"lite"}' }),
  start('config-home', { source: 'startup' }, { PONYTAIL_MAP: '0' }, { 'home/.config/ponytail/config.json': '\uFEFF{"defaultMode":"ultra"}' }),
  start('config-xdg-wins', { source: 'startup' }, { XDG_CONFIG_HOME: 'cfg', PONYTAIL_MAP: '0' },
    { 'cfg/ponytail/config.json': '{"defaultMode":"off"}', 'home/.config/ponytail/config.json': '{"defaultMode":"ultra"}' }),
  start('config-env-wins', { source: 'startup' }, { PONYTAIL_DEFAULT_MODE: 'lite', PONYTAIL_MAP: '0' }, { 'home/.config/ponytail/config.json': '{"defaultMode":"ultra"}' }),
  start('config-review', { source: 'startup' }, { PONYTAIL_MAP: '0' }, { 'home/.config/ponytail/config.json': '{"defaultMode":"review"}' }),
  start('config-broken', { source: 'startup' }, { PONYTAIL_MAP: '0' }, { 'home/.config/ponytail/config.json': '{"defaultMode":' }),
  prompt('default-writes-config', { session_id: 'A', prompt: '/ponytail default ultra' }, {}, { 'home/.config/ponytail/config.json': '{"quietStartup":true}' }),
  prompt('default-xdg', { session_id: 'A', prompt: '/ponytail default off' }, { XDG_CONFIG_HOME: 'cfg' }),
  prompt('default-array', { session_id: 'A', prompt: '/ponytail default lite' }, {}, { 'home/.config/ponytail/config.json': '[1]' }),
  prompt('default-review', { session_id: 'A', prompt: '/ponytail default review' }),
  // The statusline nudge.
  start('statusline-none', { source: 'startup' }, { PONYTAIL_MAP: '0' }, settings('{}')),
  start('statusline-stale', { source: 'startup' }, { PONYTAIL_MAP: '0' },
    settings('{"statusLine":{"type":"command","command":"bash \\"/nonexistent/ponytail/4.12.0/hooks/ponytail-statusline.sh\\""}}')),
  start('statusline-stale-nudged', { source: 'startup' }, { PONYTAIL_MAP: '0' }, {
    ...settings('{"statusLine":{"command":"bash /nonexistent/ponytail/4.12.0/hooks/ponytail-statusline.sh"}}'),
    'home/.claude/.ponytail-statusline-nudged': '/nonexistent/ponytail/4.12.0/hooks/ponytail-statusline.sh' }),
  start('statusline-other', { source: 'startup' }, { PONYTAIL_MAP: '0' }, settings('\uFEFF{"statusLine":{"command":"starship prompt"}}')),
  start('statusline-copy-refresh', { source: 'startup' }, { PONYTAIL_MAP: '0' },
    { ...settings('{"statusLine":{"command":"bash home/.claude/ponytail-statusline.sh"}}'), 'home/.claude/ponytail-statusline.sh': 'old' }),
  start('statusline-nudged-once', { source: 'startup' }, { PONYTAIL_MAP: '0' }, { 'home/.claude/.ponytail-statusline-nudged': '' }),
  start('statusline-bad-settings', { source: 'startup' }, { PONYTAIL_MAP: '0' }, settings('{nope')),
  // The subagent matcher.
  sub('matcher-bad', { session_id: 'A', agent_type: 'Explore' }, { PONYTAIL_SUBAGENT_MATCHER: '(' }, { [SESSION('A')]: 'full' }),
  sub('matcher-match', { session_id: 'A', agent_type: 'Explore' }, { PONYTAIL_SUBAGENT_MATCHER: 'explore|general' }, { [SESSION('A')]: 'full' }),
  sub('matcher-miss', { session_id: 'A', agent_type: 'Explore' }, { PONYTAIL_SUBAGENT_MATCHER: '^general$' }, { [SESSION('A')]: 'full' }),
  sub('matcher-no-agent-type', { session_id: 'A' }, { PONYTAIL_SUBAGENT_MATCHER: 'explore' }, { [SESSION('A')]: 'lite' }),
  sub('matcher-kelvin', { session_id: 'A', agent_type: '\u212Aelvin' }, { PONYTAIL_SUBAGENT_MATCHER: 'kelvin' }, { [SESSION('A')]: 'full' }),
  sub('matcher-dotted-i', { session_id: 'A', agent_type: '\u0130nspector' }, { PONYTAIL_SUBAGENT_MATCHER: '^inspector$' }, { [SESSION('A')]: 'full' }),
  sub('matcher-word', { session_id: 'A', agent_type: 'agent-é' }, { PONYTAIL_SUBAGENT_MATCHER: '^agent-\\w$' }, { [SESSION('A')]: 'full' }),
  sub('matcher-level-off', { session_id: 'A', agent_type: 'Explore' }, { PONYTAIL_SUBAGENT_MATCHER: 'explore' }, { [SESSION('A')]: 'off' }),
  sub('subagent-no-level', { session_id: 'A', agent_type: 'Explore' }),
  sub('subagent-bad-json', '{', {}, { [FLAG]: 'ultra' }),
  // Deactivation counts only as the whole message.
  prompt('stop-inside-message', { session_id: 'A', prompt: 'please stop ponytail now' }, repo, { [SESSION('A')]: 'ultra' }),
  prompt('normal-mode-inside', { session_id: 'A', prompt: 'add a normal mode toggle' }, repo, { [SESSION('A')]: 'ultra' }),
  prompt('stop-punctuation', { session_id: 'A', prompt: '  Stop Ponytail!! ' }, repo, { [SESSION('A')]: 'ultra', [FLAG]: 'ultra' }),
  prompt('normal-mode', { session_id: 'A', prompt: 'normal mode.' }, repo, { [SESSION('A')]: 'ultra', [PROJECT(REPO)]: 'ultra' }),
  // /ponytail commands.
  prompt('bare-when-off', { session_id: 'A', prompt: '/ponytail' }, repo),
  prompt('bare-when-on', { session_id: 'A', prompt: '/ponytail' }, repo, { [SESSION('A')]: 'lite' }),
  prompt('bare-default-off', { session_id: 'A', prompt: '/ponytail' }, { ...repo, PONYTAIL_DEFAULT_MODE: 'off' }),
  prompt('at-prefix', { session_id: 'A', prompt: '@ponytail ultra' }, repo),
  prompt('dollar-prefix', { session_id: 'A', prompt: '$ponytail lite' }, repo),
  prompt('namespaced', { session_id: 'A', prompt: '/ponytail:ponytail full' }, repo),
  prompt('uppercase', { session_id: 'A', prompt: '/PONYTAIL ULTRA' }, repo),
  prompt('review-skill', { session_id: 'A', prompt: '/ponytail-review' }, repo, { [SESSION('A')]: 'lite' }),
  prompt('unknown-arg', { session_id: 'A', prompt: '/ponytail sideways' }, repo, { [SESSION('A')]: 'lite' }),
  prompt('off', { session_id: 'A', prompt: '/ponytail off' }, repo, { [SESSION('A')]: 'lite', [FLAG]: 'lite' }),
  prompt('ordinary-prompt', { session_id: 'A', prompt: 'fix the bug in utils.js' }, repo, { [SESSION('A')]: 'lite' }),
  prompt('prompt-bad-json', 'nope', repo),
  prompt('prompt-no-session', { prompt: '/ponytail ultra' }, repo),
  // A level picked in the band applies with the next prompt.
  prompt('band-pick', { session_id: 'A', prompt: 'hello' }, repo, pending('A', 'ultra')),
  prompt('band-pick-off', { session_id: 'A', prompt: 'hello' }, repo, pending('A', 'off')),
  prompt('band-pick-typed-wins', { session_id: 'A', prompt: '/ponytail lite' }, repo, pending('A', 'ultra')),
  prompt('band-pick-stop-wins', { session_id: 'A', prompt: 'stop ponytail' }, repo, pending('A', 'ultra')),
  prompt('band-pick-taken-back', { session_id: 'A', prompt: 'hello' }, repo, pending('A', '')),
  prompt('band-pick-other-session', { session_id: 'B', prompt: 'hello' }, repo, pending('A', 'ultra')),
  prompt('band-pick-bad-id', { session_id: 'a.b', prompt: 'hello' }, repo, pending('a.b', 'ultra')),
  // The band flag and the band import (stdout and exit code; the import itself stays JS).
  prompt('band-off', { session_id: 'A', prompt: '/ponytail band off' }, repo, { [SESSION('A')]: 'full' }),
  prompt('band-toggle-on', { session_id: 'A', prompt: '/ponytail band' }, repo, { 'home/.claude/.ponytail-band': 'off\n' }),
  prompt('band-import', { session_id: 'A', prompt: '/ponytail band import' }, repo, { [SESSION('A')]: 'ultra' }),
  // The map: non-ASCII names near the budget, a deadline never reached, the budget variable.
  map('map-non-ascii-budget', ['proj'], { PONYTAIL_MAP_CHARS: '160' }, nonAscii),
  map('map-non-ascii', ['proj'], {}, nonAscii),
  map('map-small-tree', ['.'], {}, project),
  map('map-default-root', [], {}, project),
  map('map-missing-root', ['nowhere'], {}, project),
  map('map-chars-nan', ['proj'], { PONYTAIL_MAP_CHARS: 'abc' }, nonAscii),
  map('map-chars-zero', ['proj'], { PONYTAIL_MAP_CHARS: '0' }, nonAscii),
  map('map-chars-huge', ['proj'], { PONYTAIL_MAP_CHARS: '100000' }, nonAscii),
  map('map-chars-tiny', ['proj'], { PONYTAIL_MAP_CHARS: '20' }, nonAscii),
];
