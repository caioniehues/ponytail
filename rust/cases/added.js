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

const collation = {};
for (const dir of ['B', 'b', 'a', 'A', 'Ab', 'ab', 'a_b', 'a-b', 'a.b', 'a(1)', 'a[1]', 'a@1', 'a+1', 'a$1', 'a1', 'a10', 'a9', 'z/lib', 'Util', 'a/b']) {
  collation[dir + '/x.js'] = 'export function f' + dir.replace(/[^A-Za-z0-9]/g, '_') + '() {}\n';
}
const lineEnds = {
  'crlf.js': 'const a = 1;\r\nexport function crlf() {}\rexport function cr() {}\r\n',
  'ls.js': '// x\u2028export function lineSep() {}\u2029export const paraSep = 1\n',
  'nbsp.js': 'export\u00A0function nbsp() {}\nexport {\u3000ideo,\u2028 other as renamed\u00A0}\n',
  'bom.js': '\uFEFFexport function hidden() {}\nexport function shown() {}\n',
  'r.rb': 'x = 1\r\n  def ruby_cr\r\nend\r\nmodule Mod::Inner\nend\n',
};
const manyFiles = {};
for (let i = 0; i < 32; i++) manyFiles['kit/c' + i + '.js'] = 'export const k' + i + ' = 1\nexport const second' + i + ' = 2\n';
for (let i = 0; i < 2; i++) manyFiles['few/f' + i + '.ts'] = 'export type T' + i + ' = 1\nexport enum E' + i + ' {}\nexport interface I' + i + ' {}\nexport let fourth' + i + ' = 1\n';
Object.assign(manyFiles, {
  'node_modules/m/i.js': 'export const nm = 1\n', '.hidden/h.js': 'export const hid = 1\n', 'src/a.test.js': 'export const t = 1\n',
  'src/test_a.py': 'def t(): pass\n', 'src/x.d.ts': 'export type D = 1\n', 'src/x.min.js': 'export const m = 1\n', 'src/ok.js': 'export const ok = 1\n',
  'src/_private.js': 'export const _p = 1\nexport default function () {}\n', 'src/README.md': 'export const md = 1\n',
  'deep/1/2/3/4/5/6/x.js': 'export const six = 1\n', 'deep/1/2/3/4/5/6/7/x.js': 'export const seven = 1\n',
});
const languages = {
  'go/a.go': 'func Exported() {}\nfunc private() {}\nfunc (r *Recv) Method() {}\ntype Thing struct{}\n',
  'rs/a.rs': 'pub fn run() {}\npub async fn go() {}\npub(crate) fn hidden() {}\npub struct S;\npub trait T {}\n',
  'py/a.py': 'async def fetch():\n    pass\ndef _private():\n    pass\nclass Model:\n    pass\n',
  'rb/a.rb': 'class Foo::Bar\n  def baz; end\nend\n',
  'jvm/A.java': 'public final class Main {}\nrecord Point(int x) {}\n',
  'jvm/B.swift': 'open class View {}\ninterface Nope {}\n',
  'jvm/C.cs': 'internal static partial class Helpers {}\n',
  'php/a.php': '<?php\nfunction &refFn() {}\nfinal readonly class Value {}\nenum Suit {}\n',
  'js/a.mjs': 'export default async function* gen() {}\nexport { a as b, type C, x.y, $dollar }\nexports = class Klass {}\nmodule.exports.nope = 1\n',
  'js/b.cjs': 'module.exports = {\n  one,\n  two: three,\n}\n',
};

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
  // Edge cases the subagent-start port reasons about (fork #9): JS trim, String() of agent_type, path.normalize of the
  // project dir, which file answers, and flag contents that are not a level.
  sub('sub-trimmed-session', { session_id: '  A\t', agent_type: 'x' }, {}, { [SESSION('A')]: 'lite' }),
  sub('sub-js-whitespace', { session_id: 'A' }, {}, { [SESSION('A')]: '\uFEFF ultra\u00A0\u3000\n' }),
  sub('sub-nel-not-space', { session_id: 'A' }, {}, { [SESSION('A')]: '\u0085lite' }),
  sub('sub-blank-session-file', { session_id: 'A' }, repo, { [SESSION('A')]: '  \n', [PROJECT(REPO)]: 'ultra' }),
  sub('sub-uppercase-off', { session_id: 'A' }, {}, { [SESSION('A')]: 'OFF' }),
  sub('sub-review', { session_id: 'A' }, {}, { [SESSION('A')]: 'review' }),
  sub('sub-unknown-mode', { session_id: 'A' }, {}, { [SESSION('A')]: 'banana' }),
  sub('sub-mixed-case-mode', { session_id: 'A' }, {}, { [SESSION('A')]: ' Ultra ' }),
  sub('sub-shared-flag', {}, {}, { [FLAG]: 'lite' }),
  sub('sub-project-over-flag', {}, repo, { [PROJECT(REPO)]: 'ultra', [FLAG]: 'lite' }),
  sub('sub-project-missing', {}, repo, { [FLAG]: 'lite' }),
  sub('sub-session-missing', { session_id: 'Z' }, repo, { [PROJECT(REPO)]: 'ultra', [FLAG]: 'lite' }),
  sub('sub-project-trailing', {}, { CLAUDE_PROJECT_DIR: ' /work/repo/ ' }, { [PROJECT('/work/repo/')]: 'ultra', [PROJECT(REPO)]: 'lite' }),
  sub('sub-project-dots', {}, { CLAUDE_PROJECT_DIR: '/work//./a/../repo' }, { [PROJECT(REPO)]: 'ultra' }),
  sub('sub-project-relative', {}, { CLAUDE_PROJECT_DIR: 'a/../../x/./' }, { [PROJECT('../x/')]: 'ultra' }),
  sub('sub-project-root', {}, { CLAUDE_PROJECT_DIR: '//' }, { [PROJECT('/')]: 'ultra' }),
  sub('sub-session-not-string', { session_id: 7 }, {}, { [FLAG]: 'lite', [SESSION('7')]: 'ultra' }),
  sub('sub-payload-array', '[{"session_id":"A"}]', {}, { [SESSION('A')]: 'ultra', [FLAG]: 'lite' }),
  sub('sub-payload-null', 'null', {}, { [FLAG]: 'lite' }),
  sub('sub-config-dir', { session_id: 'A' }, { CLAUDE_CONFIG_DIR: 'cc' }, { ['cc/ponytail-sessions/' + sha('A')]: 'ultra', [SESSION('A')]: 'lite' }),
  sub('sub-agent-exponent', { session_id: 'A', agent_type: 1e21 }, { PONYTAIL_SUBAGENT_MATCHER: '^1e\\+21$' }, { [SESSION('A')]: 'lite' }),
  sub('sub-agent-small', { session_id: 'A', agent_type: 1e-7 }, { PONYTAIL_SUBAGENT_MATCHER: '^1e-7$' }, { [SESSION('A')]: 'lite' }),
  sub('sub-agent-decimal', { session_id: 'A', agent_type: 0.000001 }, { PONYTAIL_SUBAGENT_MATCHER: '^0\\.000001$' }, { [SESSION('A')]: 'lite' }),
  sub('sub-agent-big-int', '{"session_id":"A","agent_type":9007199254740993}', { PONYTAIL_SUBAGENT_MATCHER: '^9007199254740992$' }, { [SESSION('A')]: 'lite' }),
  sub('sub-agent-true', { session_id: 'A', agent_type: true }, { PONYTAIL_SUBAGENT_MATCHER: '^true$' }, { [SESSION('A')]: 'lite' }),
  sub('sub-agent-false', { session_id: 'A', agent_type: false }, { PONYTAIL_SUBAGENT_MATCHER: 'nothing' }, { [SESSION('A')]: 'lite' }),
  sub('sub-agent-zero', { session_id: 'A', agent_type: 0 }, { PONYTAIL_SUBAGENT_MATCHER: 'nothing' }, { [SESSION('A')]: 'lite' }),
  sub('sub-agent-array', { session_id: 'A', agent_type: [1, [2, null], 'a'] }, { PONYTAIL_SUBAGENT_MATCHER: '^1,2,,a$' }, { [SESSION('A')]: 'lite' }),
  sub('sub-agent-object', { session_id: 'A', agent_type: {} }, { PONYTAIL_SUBAGENT_MATCHER: '^\\[object object\\]$' }, { [SESSION('A')]: 'lite' }),
  sub('sub-agent-padded', { session_id: 'A', agent_type: ' \u00A0Explore\n' }, { PONYTAIL_SUBAGENT_MATCHER: '^explore$' }, { [SESSION('A')]: 'lite' }),
  sub('matcher-dot-cr', { session_id: 'A', agent_type: 'a\rb' }, { PONYTAIL_SUBAGENT_MATCHER: '^a.b$' }, { [SESSION('A')]: 'lite' }),
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
  // JS Number(): hex, padded exponents (JS whitespace), Infinity and a signed hex (NaN) as the budget.
  map('map-chars-hex', ['proj'], { PONYTAIL_MAP_CHARS: '0x40' }, nonAscii),
  map('map-chars-exp', ['proj'], { PONYTAIL_MAP_CHARS: ' +.6e2\u00A0' }, nonAscii),
  map('map-chars-inf', ['proj'], { PONYTAIL_MAP_CHARS: 'Infinity' }, nonAscii),
  map('map-chars-neg-hex', ['proj'], { PONYTAIL_MAP_CHARS: '-0x10' }, nonAscii),
  map('map-chars-bin', ['proj'], { PONYTAIL_MAP_CHARS: '0b1000000' }, nonAscii),
  map('map-chars-oct', ['proj'], { PONYTAIL_MAP_CHARS: '0O777' }, nonAscii),
  // localeCompare's order (ICU): punctuation, then digits, then letters with case second; shared folders first.
  map('map-collation', ['.'], {}, collation),
  // JS line terminators (\r, U+2028, U+2029) start a line for ^, JS \s takes U+00A0 and U+3000, a BOM hides the first line.
  map('map-line-ends', ['.'], {}, lineEnds),
  // Folders of many files list one name per file, past 30 names a ", ..."; skipped folders and files.
  map('map-many-files', ['.'], {}, manyFiles),
  // Every language's patterns.
  map('map-languages', ['.'], {}, languages),
];
