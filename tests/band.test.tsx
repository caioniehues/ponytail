import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { BAND_SESSION } from './fixtures/band-session'

import { boardHtml, parseCsv, tasksFrom } from '../hooks/band/board'
import type { Band } from '../hooks/band/types'
import {
  NO_TOKENS,
  addTokens,
  addedLines,
  callsIn,
  defsIn,
  duration,
  elapsed,
  fmtTokens,
  GREP_DEFS,
  inProject,
  isSource,
  isBuildFailure,
  isTestCommand,
  isTestTool,
  ledgerFile,
  mainModel,
  markdown,
  metricsSvg,
  parseDefs,
  percent,
  resume,
  sessionTitle,
  snapshot,
  testCounts,
  toolTestCounts,
  toolCalls,
  toolsSummary,
  TOOL_RESULT_RECORD,
  TOOL_USE_RECORD,
  totalTokens,
  upsertCsv,
  CSV_HEADER,
  DEF_PATHS,
  isCode,
  webhookRequest,
} from '../hooks/band/metrics'

// A mocked process.run answer.
const ran = (exitCode: number, stdout = '') => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

test('definition and caller searches skip binary files', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const transcript = '/home/u/.claude/projects/-repo/s1.jsonl'
  // The fixture's Edit removes `legacy`, so the turn searches for its callers.
  const toolLines = BAND_SESSION.split('\n').filter(line => line.includes(TOOL_USE_RECORD) || line.includes(TOOL_RESULT_RECORD)).join('\n')
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
  on('session.repo', () => ({ value: { root: '/repo' } }) as never)
  on('session.root', () => ({ value: '-repo' }))
  on('session.id', () => ({ value: 's1' }))
  on('session.turns', () => ({ value: 1 }))
  on('session.usage', () => ({ value: { startedAt: 0, cost: { usd: 0 } } }) as never)
  on('fs.exists', ($, e) => ({ value: e.path === transcript }))
  const searches: string[][] = []
  on('process.run', ($, e) => {
    if (e.argv.includes(TOOL_USE_RECORD)) return ran(0, toolLines)
    if (e.argv[0] === 'git' && e.argv[1] === 'grep') searches.push([...e.argv])
    return ran(1) as never
  })
  on('fs.read', () => ({ deny: 'missing' }) as never)
  on('fs.list', () => ({ value: [] }))
  on('fs.write', () => ({ value: undefined }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/repo', surface: null } as never)
  await $.turn.complete({ answer: '', durationMs: 1000 } as never)
  expect(searches.map(argv => argv.includes('-I'))).toEqual([true, true])
})

describe('board', () => {
  const CSV = 'key,started,project,name,cost_usd,turns,agent_minutes,tokens_total,tokens_output,reuse_pct,reused,new,callers_open,tests,level\n' +
    'a-1,2026-10-15 12:00,shop,"Fix ""cart"", totals\nand tax",3.10,6,26.0,1200000,85000,83,5,1,0,14 passed,full\n' +
    'b-2,2026-10-14 09:30,shop,<script>alert(1)</script>,0.50,2,1.5,40000,900,,0,0,0,not run,lite\n'

  test('reads quoted CSV fields with commas, quotes and line breaks', () => {
    const rows = parseCsv(CSV)
    expect(rows.length).toBe(3)
    expect(rows[1]?.[3]).toBe('Fix "cart", totals\nand tax')
    const tasks = tasksFrom(CSV)
    expect(tasks[0]).toEqual({ started: '2026-10-15 12:00', project: 'shop', name: 'Fix "cart", totals\nand tax', cost: 3.1, turns: 6, agentMinutes: 26, tokens: 1_200_000, reuse: 83, tests: '14 passed', level: 'full', model: '' })
    expect(tasks[1]?.reuse).toBeNull()
    expect(tasksFrom('not,a,ledger\n1,2,3')).toEqual([])
  })

  test('a project written as a whole Windows path, drive letter in either case, is one project', () => {
    const csv = 'key,started,project,cost_usd,turns,agent_minutes,tokens_total\n' + ['c:\\Repos\\shop', 'C:\\Repos\\shop\\', 'shop', '/repo/shop/'].map((p, i) => `k-${i},2026-10-15 12:00,"${p}",0,0,0,0`).join('\n')
    expect(tasksFrom(csv).map(t => t.project)).toEqual(['shop', 'shop', 'shop', 'shop'])
  })

  test('where case is ignored, a folder spelled in another case is the same project, named as its newest row spells it', () => {
    const csv = 'key,started,project,cost_usd,turns,agent_minutes,tokens_total\n' + ['C:\\Repos\\Shop', 'c:\\repos\\shop', 'SHOP', 'other'].map((p, i) => `k-${i},2026-10-1${i} 12:00,"${p}",0,0,0,0`).join('\n')
    const projects = (ignoreCase: boolean) => dataOf(boardHtml(tasksFrom(csv), Date.UTC(2026, 9, 15, 12, 0), ignoreCase)).tasks.map((t: { project: string }) => t.project)
    expect(projects(true)).toEqual(['SHOP', 'SHOP', 'SHOP', 'other'])
    expect(projects(false)).toEqual(['Shop', 'shop', 'SHOP', 'other'])
  })

  test('a malformed or truncated ledger row is dropped, a zero-cost row is kept', () => {
    const head = CSV.split('\n')[0]
    const csv = `${head}\nz-1,2026-10-15 12:00,shop,Free,0.00,0,0.0,0,0,,0,0,0,not run,full\n` +
      'x-1,2026-10-15 12:00,shop,Bad,oops,2,1.0,500,50,,0,0,0,not run,full\nt-1,2026-10-15 12:00,shop\n'
    expect(tasksFrom(csv).map(t => [t.name, t.cost])).toEqual([['Free', 0]])
  })

  const dataOf = (html: string) => JSON.parse(/<script type="application\/json" id="board-data">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? 'null')

  test('the board carries every task as data no name can break out of', () => {
    const html = boardHtml(tasksFrom(CSV), Date.UTC(2026, 9, 15, 12, 0))
    const data = dataOf(html)
    expect(data.tasks.length).toBe(2)
    expect(data.tasks[1].name).toBe('<script>alert(1)</script>')
    expect(html).not.toContain('<script>alert(1)')
    expect(html).toContain('\\u003cscript>alert(1)\\u003c/script>')
    expect(html).toContain('not a bill')
    expect(html).toContain('id="card"')
    expect(html.split('id="pt-logo"').length).toBe(2)
    expect(html).toContain('href="#pt-logo"')
    expect(html).toContain('<link rel="icon" href="data:image/svg+xml,')
    expect(html).toContain('id="c-time"')
    expect(html).not.toContain('innerHTML')
    expect(html).toContain('id="theme"')
    expect(html).toContain('<html lang="en" data-theme="dark">')
    expect(html).toContain(':root[data-theme=light]{')
    expect(html).toContain(':root[data-theme=system]{')
  })

  test('an empty board still loads and says there are no sessions yet', () => {
    const html = boardHtml([], Date.UTC(2026, 9, 15, 12, 0))
    expect(dataOf(html).tasks).toEqual([])
    expect(html).toContain('No sessions yet')
  })
})

describe('metrics', () => {
  test('adds up tokens and prints them short', () => {
    const t = addTokens(addTokens(NO_TOKENS, { input_tokens: 10, output_tokens: 90, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 }), { input_tokens: 0, output_tokens: 10, cache_read_input_tokens: 140, cache_creation_input_tokens: 0 })
    expect(totalTokens(t)).toBe(1250)
    expect(t.output).toBe(100)
    expect([fmtTokens(950), fmtTokens(1234), fmtTokens(1_240_000), fmtTokens(2000)]).toEqual(['950', '1.2k', '1.2M', '2k'])
  })

  const BASE: Band = {
    level: 'full', model: 'claude-opus-5-5', cost: 31.9, spent: 3.1, turns: 6, turnCosts: [0.42], tokens: { input: 5000, output: 85_000, cacheRead: 1_100_000, cacheWrite: 10_000 },
    busyMs: 1_560_000, name: 'Fix the cart | totals, again', project: 'shop', session: '4c69e3db-57a0', transcript: '', reused: ['to_cents'], created: [],
    removed: [], openCallers: [], tests: { state: 'pass', passed: 14 }, details: false,
  }

  test('a band that starts again mid-session goes on from its row instead of from zero', () => {
    const csv = `${CSV_HEADER}\nother-1,2026-10-14 09:00,shop,Other,1.00,2,3.0,500,50,,0,0,0,not run,full\n4c69e3db-7,2026-10-15 01:10,shop,"Fix the cart, again",46.09,32,55.5,107900000,250000,,0,0,0,stale,full\n`
    const fresh: Band = { ...BASE, name: '', busyMs: 0, tokens: NO_TOKENS }
    const b = resume(fresh, csv, '4c69e3db-7')
    expect(b.name).toBe('Fix the cart, again')
    expect(b.busyMs).toBe(55.5 * 60000)
    expect(totalTokens(b.tokens)).toBe(107_900_000)
    expect(b.tokens.output).toBe(250_000)
    // A band that already counted more keeps its own numbers and name.
    const ahead: Band = { ...BASE, busyMs: 4_000_000, tokens: { input: 0, output: 1, cacheRead: 200_000_000, cacheWrite: 0 } }
    expect(resume(ahead, csv, '4c69e3db-7')).toEqual(ahead)
    expect(resume(fresh, csv, 'missing-1')).toEqual(fresh)
    expect(resume(fresh, '', '4c69e3db-7')).toEqual(fresh)
  })

  test('the row names the model that wrote most replies, and an older ledger keeps its rows', () => {
    expect(mainModel('"model":"claude-opus-5-5"\n"model":"claude-haiku-5-5"\n"model":"claude-opus-5-5"\n')).toBe('claude-opus-5-5')
    expect(mainModel('')).toBe('')
    const old = 'key,started,project,name,cost_usd,turns,agent_minutes,tokens_total,tokens_output,reuse_pct,reused,new,callers_open,tests,level\n' +
      'other-1,2026-10-14 09:00,shop,Other,1.00,2,3.0,500,50,,0,0,0,not run,full\n'
    const csv = upsertCsv(old, snapshot(BASE, Date.UTC(2026, 9, 15, 12, 0)))
    expect(csv.split('\n')[0]).toBe(CSV_HEADER)
    expect(csv.split('\n').filter(line => line.startsWith('key,')).length).toBe(1)
    expect(tasksFrom(csv).map(t => t.model)).toEqual(['', 'claude-opus-5-5'])
    expect(markdown(snapshot(BASE, Date.UTC(2026, 9, 15, 12, 0)))).toContain('| Model | claude-opus-5-5 |')
  })

  test('a name with a carriage return stays in one ledger row', () => {
    const csv = upsertCsv('', snapshot({ ...BASE, name: 'Fix it\r' }, Date.UTC(2026, 9, 15, 12, 0)))
    expect(tasksFrom(csv).map(t => t.name)).toEqual(['Fix it\r'])
  })

  test('the webhook sends the token only over https, or to this machine', () => {
    const row = snapshot(BASE, Date.UTC(2026, 9, 15, 12, 0))
    const sent = webhookRequest('https://board.example.com/tasks', 'ptb_x', true, row)
    expect('refused' in sent).toBe(false)
    if (!('refused' in sent)) {
      expect(sent.init.headers.authorization).toBe('Bearer ptb_x')
      expect(JSON.parse(sent.init.body).name).toBe('Fix the cart | totals, again')
    }
    expect(webhookRequest('http://board.example.com/tasks', 'ptb_x', true, row)).toEqual({ refused: 'webhook needs https' })
    expect(webhookRequest('not a url', 'ptb_x', true, row)).toEqual({ refused: 'webhook URL is not a URL' })
    expect('refused' in webhookRequest('http://127.0.0.1:4711/tasks', 'ptb_x', true, row)).toBe(false)
    const quiet = webhookRequest('https://board.example.com/tasks', '', false, row)
    if (!('refused' in quiet)) {
      expect(quiet.init.headers.authorization).toBeUndefined()
      expect(JSON.parse(quiet.init.body).name).toBe('')
    }
  })

  test('agent time reads in seconds, minutes, hours', () => {
    expect([elapsed(45_000), elapsed(130_000), elapsed(4_320_000)]).toEqual(['45s', '2m 10s', '1h 12m'])
  })

  test('the sidebar name is the last custom-title record of the transcript', () => {
    const lines = [
      JSON.stringify({ type: 'custom-title', customTitle: 'First name', sessionId: 's' }),
      JSON.stringify({ type: 'assistant', meta: { type: 'custom-title', customTitle: 'not a record' } }),
      JSON.stringify({ type: 'custom-title', customTitle: '  GitHub issues triage  ' }),
      '{"type":"custom-title", broken',
    ]
    expect(sessionTitle(lines.join('\n'))).toBe('GitHub issues triage')
    expect(sessionTitle(lines.slice(0, 2).join('\n'))).toBe('First name')
    expect(sessionTitle(JSON.stringify({ type: 'custom-title', customTitle: ' ' }))).toBeUndefined()
    expect(sessionTitle(JSON.stringify({ type: 'user', message: { content: 'no title yet' } }))).toBeUndefined()
    expect(sessionTitle(JSON.stringify({ type: 'custom-title', customTitle: 'x'.repeat(80) }))?.length).toBe(60)
  })

  test('the Markdown export holds every value and the task name', () => {
    const md = markdown(snapshot(BASE, Date.UTC(2026, 9, 15, 12, 0)))
    expect(md.split('\n')[0]).toBe('## Fix the cart \\| totals, again')
    expect(md).toContain('| Cost | $3.10 · last turn $0.42 · ⌀ $0.52 / turn |')
    expect(md).toContain('| Agent time | 26m 0s · ⌀ 4m 20s / turn |')
    expect(md).toContain('| Tokens | 1.2M (input 5k, output 85k, cache read 1.1M, cache write 10k) |')
    expect(md).toContain('| Tests | 14 passed |')
  })

  test('two project names that sanitize to the same filename keep separate ledgers', () => {
    expect(ledgerFile('/band', 'myapp', '/work/myapp')).toBe('/band/myapp.csv')
    expect(ledgerFile('/band', 'api_shop', '/work/api_shop')).toBe('/band/api_shop.csv')
    expect(ledgerFile('/band', 'api@shop', '/work/api@shop')).toBe('/band/api_shop_ad0ec4e8.csv')
    expect(ledgerFile('/band', 'api@shop', '/work/api@shop/')).toBe('/band/api_shop_ad0ec4e8.csv')
    expect(ledgerFile('/band', 'api@shop', '/a/api@shop')).not.toBe(ledgerFile('/band', 'api@shop', '/b/api@shop'))
    expect(ledgerFile('/band', 'api@shop', '/work/api@shop')).not.toBe(ledgerFile('/band', 'api_shop', '/work/api_shop'))
  })

  test('the CSV keeps one row per task and replaces it on every turn', () => {
    const at = Date.UTC(2026, 9, 15, 12, 0)
    const first = upsertCsv('', snapshot(BASE, at))
    const lines = first.trim().split('\n')
    expect(lines.length).toBe(2)
    expect(lines[1]).toContain('"Fix the cart | totals, again"')
    const again = upsertCsv(first, snapshot({ ...BASE, spent: 4.2, turns: 7 }, at))
    expect(again.trim().split('\n').length).toBe(2)
    expect(again).toContain(',4.20,7,')
    const other = upsertCsv(again, snapshot({ ...BASE, session: 'ffff0000' }, at + 1))
    expect(other.trim().split('\n').length).toBe(3)
  })

  test('the CSV writes a formula-shaped name as text', () => {
    const at = Date.UTC(2026, 9, 15, 12, 0)
    const csv = upsertCsv('', snapshot({ ...BASE, name: '=2+2' }, at))
    expect(csv).toContain("'=2+2")
    // Replacing the row re-writes kept rows through the same escaping: once, not twice.
    const again = upsertCsv(csv, snapshot({ ...BASE, session: 'another-session', name: 'x' }, at))
    expect(again).toContain("'=2+2")
    expect(again).not.toContain("''=2+2")
  })

  test('a task name with a line break is replaced whole, not left as a stray line', () => {
    const at = Date.UTC(2026, 9, 15, 12, 0)
    const first = upsertCsv('', snapshot({ ...BASE, name: 'first\nsecond' }, at))
    const again = upsertCsv(first, snapshot({ ...BASE, name: 'first\nsecond', turns: 7 }, at))
    const rows = parseCsv(again)
    expect(rows.length).toBe(2)
    expect(rows[1]?.[3]).toBe('first\nsecond')
  })

  test('the desktop row is one SVG with real dividers, escaped and cut to fit', () => {
    const svg = metricsSvg(
      [
        { key: 'cost', label: 'cost', value: '$1.20', sub: '' },
        { key: 'callers', label: 'callers', value: '2 open', sub: 'a&b.py:1, a very long path/that/does/not/fit.py:9', tone: 'warning' },
      ],
      [0.1, 0.4],
      300,
    )
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg.match(/<line /g)?.length).toBe(2)
    expect(svg).toContain('a&amp;b.py')
    expect(svg).toContain('…')
    expect(svg).toContain('class="v warning"')
    expect(svg.match(/<rect /g)?.length).toBe(2)
  })

  test('finds top-level definitions per language', () => {
    expect(defsIn('a.py', 'def to_cents(x):\n    pass\nclass Cart:\n    def total(self): pass')).toEqual(['to_cents', 'Cart'])
    expect(defsIn('a.ts', 'export function formatMoney() {}\nfunction local() {}\nconst x = 1')).toEqual(['formatMoney', 'local'])
    expect(defsIn('README.md', 'def nope():')).toEqual([])
    expect(defsIn('A.swift', 'public struct Cart {\n  func total() {}\n}\nfinal class Store {}\nfunc formatMoney() {}\nextension Cart {}')).toEqual(['Cart', 'Store', 'formatMoney'])
  })

  test('Swift test targets are not source', () => {
    expect(isSource('/repo/Sources/Cart/Cart.swift')).toBe(true)
    expect(isSource('/repo/Tests/CartTests/Helpers.swift')).toBe(false)
    expect(isSource('/repo/App/CartTests.swift')).toBe(false)
    // Xcode's project template puts test targets in <App>Tests/ and <App>UITests/.
    expect(isSource('/repo/MyAppTests/Mocks.swift')).toBe(false)
    expect(isSource('/repo/MyAppUITests/Screens.swift')).toBe(false)
    expect(isSource('/repo/Sources/Experiments/ABTest.swift')).toBe(true)
    expect(isSource('/repo/tests/cart.js')).toBe(false)
  })

  test('a Vue single-file component counts like JS: its script defines, script and template call', () => {
    const sfc = [
      '<script setup lang="ts">',
      "import { formatMoney } from '../lib/money'",
      'function onSave() {',
      '  return formatMoney(total.value)',
      '}',
      '</script>',
      '<template>',
      '  <button @click="onSave()">{{ formatMoney(total) }}</button>',
      '</template>',
    ].join('\n')
    expect(defsIn('src/Cart.vue', sfc)).toEqual(['onSave'])
    const known = parseDefs('src/lib/money.ts:1:export function formatMoney(v) {\nsrc/Old.vue:3:function legacyTotal() {')
    expect([...known.keys()]).toEqual(['formatMoney', 'legacyTotal'])
    expect(callsIn(addedLines('', sfc), known, ['onSave'])).toEqual(['formatMoney'])
  })

  test('finds PHP functions and methods behind any modifiers', () => {
    const php = [
      '<?php',
      'function to_cents($v) {}',
      'class Cart {',
      '    public function total() {}',
      '    protected static function fromArray(array $a) {}',
      '    private function &items() {}',
      '    abstract public function tax();',
      '    final public static function make() {}',
      '}',
    ].join('\n')
    expect(defsIn('src/Cart.php', php)).toEqual(['to_cents', 'total', 'fromArray', 'items', 'tax', 'make', 'Cart'])
  })

  test('finds PHP classes, interfaces, traits and enums, not closures or calls', () => {
    const php = [
      'abstract class Shape {}',
      'final class Square extends Shape {}',
      'readonly class Point {}',
      'interface Priced {}',
      'trait Loggable {}',
      'enum Suit: string {}',
      '$f = function ($x) { return $x; };',
      '$y = fn($x) => $x;',
      'echo total();',
    ].join('\n')
    expect(defsIn('src/shapes.php', php)).toEqual(['Shape', 'Square', 'Point', 'Priced', 'Loggable', 'Suit'])
  })

  test('finds Java, Kotlin, Swift and C# type definitions', () => {
    expect(defsIn('src/Money.java', 'package shop;\npublic final class Money {\n  public static final class Cents {}\n}\ninterface Priced {}\nenum Currency { EUR }\npublic record Price(int cents) {}')).toEqual(['Money', 'Cents', 'Priced', 'Currency', 'Price'])
    expect(defsIn('src/Cart.kt', 'class Cart(val items: List<Item>)\ninterface Store')).toEqual(['Cart', 'Store'])
    expect(defsIn('Sources/Cart.swift', 'public class Cart {}\nenum Coin {}')).toEqual(['Cart', 'Coin'])
    expect(defsIn('src/Ext.cs', 'public static class MoneyExt {}\npublic interface IPriced {}')).toEqual(['MoneyExt', 'IPriced'])
    expect(defsIn('src/Main.java', 'Money m = new Money();\nreturn classes;')).toEqual([])
  })

  test('PHP, Java, Kotlin, Swift and C# files count as source, their tests do not', () => {
    for (const f of ['src/Cart.php', 'src/Money.java', 'app/Cart.kt', 'Sources/Cart.swift', 'src/Ext.cs']) expect(isSource(f)).toBe(true)
    expect(isSource('tests/CartTest.php')).toBe(false)
    expect(isSource('vendor/lib/Thing.php')).toBe(false)
    expect(isSource('src/main.c')).toBe(false)
  })

  test('the grep pattern keeps lines that start with PHP and Java modifiers', () => {
    const grep = new RegExp(GREP_DEFS.replace(/\[\[:space:\]\]/g, '\\s'))
    for (const line of ['    public function total() {', '  private static function x()', 'protected function y()', 'abstract class Shape', 'final class Square', 'readonly class Point', 'interface Priced', 'trait Loggable', 'enum Suit', 'record Price(int c)', 'static class Ext']) {
      expect(grep.test(line)).toBe(true)
    }
    for (const line of ['$x = total();', 'echo "public";', 'return enum;']) expect(grep.test(line)).toBe(false)
  })

  test('the grep keeps every line a definition rule reads, so start-up finds what a turn would', () => {
    const grep = new RegExp(GREP_DEFS.replace(/\[\[:space:\]\]/g, '\\s'))
    const samples: [string, string][] = [
      ['Sources/Cart.swift', 'struct Cart {'],
      ['Sources/Cart.swift', 'protocol Priced {'],
      ['Sources/Cart.swift', 'actor Store {'],
      ['Sources/Cart.swift', 'open class Base {'],
      ['Sources/Cart.swift', 'internal func total() -> Int {'],
      ['Sources/Cart.swift', 'fileprivate func round() {'],
      ['Sources/Cart.swift', 'nonisolated func id() -> String {'],
      ['Sources/Cart.swift', 'package func share() {'],
      ['src/money.py', 'async def fetch_rate():'],
      ['src/money.ts', 'export default async function convert() {'],
      ['src/money.go', 'func (m Money) Cents() int {'],
      ['src/money.rs', 'pub async fn cents() -> i64 {'],
      ['lib/money.rb', '  def self.cents'],
      ['src/Money.php', 'final class Money {'],
      ['src/Money.java', 'public final class Money {'],
    ]
    for (const [file, line] of samples) {
      expect([file, defsIn(file, line).length > 0]).toEqual([file, true])
      expect([line, grep.test(line)]).toEqual([line, true])
    }
  })

  test('PHP methods from git grep become known helpers, so calling them counts as reuse', () => {
    const known = parseDefs('src/Money.php:7:    public static function toCents($v) {\nsrc/Money.php:2:final class Money {\ntests/MoneyTest.php:5:    public function testIt() {')
    expect(known.get('toCents')).toBe('src/Money.php:7')
    expect(known.get('Money')).toBe('src/Money.php:2')
    expect(known.has('testIt')).toBe(false)
    expect(callsIn('$c = Money::toCents($p);', known, [])).toEqual(['toCents'])
  })

  test('counts calls of existing helpers, never new ones, test files or generic names', () => {
    const known = parseDefs('utils/money.py:4:def to_cents(v):\nutils/io.py:1:def load(p):\ntests/test_x.py:1:def helper():')
    expect([...known.keys()]).toEqual(['to_cents', 'load'])
    const added = addedLines('x = 1', 'x = 1\ny = to_cents(p)\nz = load(f)\nw = parse_price(s)')
    expect(added).not.toContain('x = 1')
    expect(callsIn(added, known, ['parse_price'])).toEqual(['to_cents'])
  })

  test('Windows paths keep tests and generated files out of source metrics', () => {
    expect(isSource('C:\\repo\\tests\\cart.js')).toBe(false)
    expect(isSource('C:\\repo\\node_modules\\lib\\cart.js')).toBe(false)
    expect(isSource('C:\\repo\\src\\test_cart.py')).toBe(false)
    expect(isSource('C:\\repo\\src\\cart.py')).toBe(true)
    expect([...parseDefs('C:\\repo\\tests\\test_cart.py:1:def helper():')]).toEqual([])
  })

  test('only files under the project root count, with either slash', () => {
    expect(inProject('/repo/shop/cart.py', '/repo/shop')).toBe(true)
    expect(inProject('/repo/shop/cart.py', '/repo/shop/')).toBe(true)
    expect(inProject('/tmp/scratch/drive.py', '/repo/shop')).toBe(false)
    expect(inProject('/repo/shop-old/cart.py', '/repo/shop')).toBe(false)
    expect(inProject('/repo/Shop/cart.py', '/repo/shop')).toBe(false)
    expect(inProject('C:\\Users\\a\\shop\\cart.py', 'C:/Users/a/shop')).toBe(true)
    expect(inProject('C:\\Users\\A\\shop\\cart.py', 'c:/users/a/shop')).toBe(true)
    expect(inProject('\\\\Server\\Share\\Shop\\cart.py', '//server/share/shop')).toBe(true)
  })

  test('recognises test runs and their counts', () => {
    expect(isTestCommand('npm test')).toBe(true)
    expect(isTestCommand('cd api && python -m pytest -q')).toBe(true)
    expect(isTestCommand('npm install')).toBe(false)
    expect(isTestCommand('uv run pytest')).toBe(true)
    expect(isTestCommand('CI=1 npx vitest run')).toBe(true)
    expect(isTestCommand('./node_modules/.bin/jest')).toBe(true)
    expect(isTestCommand('cat jest.config.js')).toBe(false)
    expect(isTestCommand('pip install pytest')).toBe(false)
    expect(isTestCommand('grep -r vitest src')).toBe(false)
    expect(testCounts('===== 14 passed, 1 failed in 0.31s =====')).toEqual({ passed: 14, failed: 1 })
    expect(testCounts('ℹ pass 141\nℹ fail 1')).toEqual({ passed: 141, failed: 1 })
    expect(testCounts('ok')).toEqual({ passed: undefined, failed: undefined })
    expect(isTestCommand('swift test --filter CartTests')).toBe(true)
    // Listing runs nothing.
    expect(isTestCommand('swift test list')).toBe(false)
    expect(isTestCommand('swift test --list-tests')).toBe(false)
    expect(isTestCommand('swift test --package-path Pkg list')).toBe(false)
    expect(isTestCommand('swift test --skip-build --list-tests')).toBe(false)
    expect(isTestCommand('xcodebuild -scheme App -destination "platform=iOS Simulator" test')).toBe(true)
    expect(isTestCommand('xcodebuild -scheme App -testPlan Unit build')).toBe(false)
    expect(isTestCommand('xcodebuild -scheme App test-without-building')).toBe(true)
    expect(testCounts('✔ Test run with 12 tests in 3 suites passed after 0.004 seconds.')).toEqual({ passed: 12, failed: undefined })
    const xctest = [
      "Test Suite 'CartTests' failed at 2026-10-22 11:00:00.100.",
      '\t Executed 4 tests, with 1 failure (0 unexpected) in 0.010 (0.011) seconds',
      "Test Suite 'All tests' failed at 2026-10-22 11:00:00.200.",
      '\t Executed 12 tests, with 1 failure (0 unexpected) in 0.031 (0.035) seconds',
    ].join('\n')
    expect(testCounts(xctest)).toEqual({ passed: 11, failed: 1 })
    // swift test reports an empty XCTest run beside Swift Testing's own result.
    const mixed = 'Executed 0 tests, with 0 failures (0 unexpected) in 0.000 (0.001) seconds\n✘ Test run with 12 tests in 3 suites failed after 0.02 seconds with 2 issues.'
    expect(testCounts(mixed)).toEqual({ passed: undefined, failed: undefined })
    const xcLine = 'Executed 5 tests, with 0 failures (0 unexpected) in 0.01 (0.01) seconds'
    expect(testCounts(`${xcLine}\n✔ Test run with 12 tests in 3 suites passed after 0.02 seconds.`)).toEqual({ passed: 17, failed: 0 })
    // Swift Testing failed but names no test count: no "0 failed" from the passing XCTest half.
    expect(testCounts(`${xcLine}\n✘ Test run with 12 tests in 3 suites failed after 0.02 seconds with 2 issues.`).failed).toBeUndefined()
    // jest/vitest print a suite/file summary above the Tests line; count tests, not suites.
    expect(testCounts('Test Suites: 2 passed, 2 total\nTests:       10 passed, 10 total\n')).toEqual({ passed: 10, failed: undefined })
    expect(testCounts('Test Suites: 1 failed, 1 passed, 2 total\nTests:       1 failed, 9 passed, 10 total\n')).toEqual({ passed: 9, failed: 1 })
    expect(testCounts(' Test Files  2 passed (2)\n      Tests  10 passed (10)\n')).toEqual({ passed: 10, failed: undefined })
    expect(testCounts(' Test Files  1 failed | 1 passed (2)\n      Tests  3 failed | 7 passed (10)\n')).toEqual({ passed: 7, failed: 3 })
    // a generic "Tests ..." line (no counts) must not preempt the real summary or block the fallback.
    expect(testCounts('  Tests for parser\nTest Suites: 2 passed, 2 total\nTests:       10 passed, 10 total\n')).toEqual({ passed: 10, failed: undefined })
    expect(testCounts('Tests: 5\n===== 14 passed in 0.31s =====')).toEqual({ passed: 14, failed: undefined })
    expect(testCounts('Test Suites: 1 failed, 1 total\nTests:       3 failed, 3 total\n')).toEqual({ passed: undefined, failed: 3 })
    // describe titles that start with digits and status words are not summary lines.
    expect(testCounts('  Tests 2 failed inputs\nTest Suites: 1 passed, 1 total\nTests:       3 passed, 3 total\n')).toEqual({ passed: 3, failed: undefined })
    expect(testCounts('  Tests 2 passed conditions\nTest Suites: 1 failed, 1 passed, 2 total\nTests:       3 failed, 7 passed, 10 total\n')).toEqual({ passed: 7, failed: 3 })
    // CRLF and SGR color codes (vitest colors its summary even when piped).
    expect(testCounts('Test Suites: 2 passed, 2 total\r\nTests:       10 passed, 10 total\r\n')).toEqual({ passed: 10, failed: undefined })
    expect(testCounts('\x1b[2m Test Files \x1b[22m \x1b[1m\x1b[32m2 passed\x1b[39m\x1b[22m\x1b[90m (2)\x1b[39m\n\x1b[2m      Tests \x1b[22m \x1b[1m\x1b[32m10 passed\x1b[39m\x1b[22m\x1b[90m (10)\x1b[39m\n')).toEqual({ passed: 10, failed: undefined })
    // skipped tests can lead the vitest segment list.
    expect(testCounts(' Test Files  2 passed (2)\n      Tests  2 skipped | 10 passed (12)\n')).toEqual({ passed: 10, failed: undefined })
    // log captures can leave trailing whitespace on the summary line.
    expect(testCounts('Test Suites: 2 passed, 2 total\nTests:       10 passed, 10 total \n')).toEqual({ passed: 10, failed: undefined })
    expect(testCounts(' Test Files  2 passed (2)\n      Tests  10 passed (10)\t\n')).toEqual({ passed: 10, failed: undefined })
  })

  test('reads Xcode MCP test runs from their JSON, where a failing test is no tool error', () => {
    expect(isTestTool('mcp__xcode__RunAllTests')).toBe(true)
    expect(isTestTool('mcp__xcode__RunSomeTests')).toBe(true)
    expect(isTestTool('mcp__xcode__BuildProject')).toBe(false)
    // The server name is the user's choice.
    expect(isTestTool('mcp__apple-xcode__RunAllTests')).toBe(true)
    expect(toolTestCounts('{"counts":{"failed":13,"passed":174,"total":187},"results":[]}')).toEqual({ passed: 174, failed: 13 })
    expect(toolTestCounts('{"type":"error","data":"Build action failed."}')).toBeUndefined()
    expect(toolTestCounts('not json')).toBeUndefined()
    expect(isBuildFailure('{"type":"error","data":"Build action failed. Inspect build logs."}')).toBe(true)
    expect(isBuildFailure('{"data":"Test \'CartTests\' not found in target \'AppTests\'.","type":"error"}')).toBe(false)
  })

  test('shows the reuse share only once there is something to share, and a readable time', () => {
    expect(percent(5, 1)).toBe(83)
    expect(percent(0, 1)).toBeUndefined()
    expect(percent(0, 0)).toBeUndefined()
    expect(duration(45)).toBe('45m')
    expect(duration(210)).toBe('3h 30m')
  })
})

// A slash command as the person types it at the prompt.
const typed = (command: string) => ({ command, args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 80 } })

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const

test('the band switches between compact and details on terminal and desktop', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'ponytail', surface, ...BAND })
    expect(await ui.find({ key: 'level' })).toBeDefined()
    expect(await ui.find({ key: 'board' })).toBeDefined()
    expect(await ui.find({ key: 'level-ultra' })).toBeUndefined()

    await ui.press({ key: 'details' })
    expect(await ui.find({ key: 'level-ultra' })).toBeDefined()
    expect(await ui.find({ key: 'board' })).toBeDefined()
    if (surface === 'desktop') expect(await ui.find({ type: 'Svg' })).toBeDefined()
    else expect(await ui.find({ type: 'Text', text: /cost/ })).toBeDefined()

    await ui.press({ key: 'details' })
    expect(await ui.find({ key: 'level' })).toBeDefined()
    await ui.unmount()
  }
})

test('the row takes bodyColumns only in the terminal, where a Button is as wide as its cells', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  for (const [surface, width] of [['terminal', 100], ['vscode', undefined]] as const) {
    const ui = await $.ui.mount({ plugin: 'ponytail', surface, ...BAND })
    expect((await ui.find({ key: 'band' }))?.props.width).toBe(width)
    await ui.press({ key: 'details' })
    expect((await ui.find({ key: 'band' }))?.props.width).toBe(width)
    await ui.unmount()
  }
})

test('the details view has its line without empty rows, and off the terminal its columns share the row', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  for (const surface of ['terminal', 'vscode'] as const) {
    const ui = await $.ui.mount({ plugin: 'ponytail', surface, ...BAND })
    await ui.press({ key: 'details' })
    expect(await ui.find({ type: 'Text', text: /─/ })).toBeDefined()
    expect((await ui.find({ key: 'band' }))?.props.gap).toBe(0)
    const cost = (await ui.find({ key: 'cost' }))?.props
    expect(surface === 'terminal' ? cost?.width : cost?.flexGrow).toBe(surface === 'terminal' ? 31 : 1)
    // The view is stored, so the next surface would start in details: switch back.
    await ui.press({ key: 'details' })
    await ui.unmount()
  }
  // The desktop keeps a gap above its SVG, whose top line would otherwise touch the buttons.
  const ui = await $.ui.mount({ plugin: 'ponytail', surface: 'desktop', ...BAND })
  await ui.press({ key: 'details' })
  expect((await ui.find({ key: 'band' }))?.props.gap).toBe(1)
  await ui.unmount()
})

test('after /ponytail band the band draws nothing', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
  // The engine may hand the path on with either separator, and on Windows with a drive in front: compare the end.
  on('fs.read', ($, e, next) => (e.path.replaceAll('\\', '/').endsWith('/home/u/.claude/.ponytail-band') ? { value: 'off' } : next(e)))
  // What Claude Code draws without the band.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>prompt only</Text>
  })
  const ui = await $.ui.mount({ plugin: 'ponytail', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /prompt only/ })).toBeDefined()
  expect(await ui.find({ key: 'level' })).toBeUndefined()
  expect(await ui.find({ key: 'board' })).toBeUndefined()
  await ui.unmount()
})

for (const command of ['clear', 'resume', 'branch']) {
  test(`after /${command} the band shows the level again, with no session.start`, async ($, on) => {
    mock.clock(on)
    mock.store(on)
    let session = 's1'
    on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
    on('fs.read', ($, e, next) => (e.path.replaceAll('\\', '/').endsWith('/home/u/.claude/.ponytail-active') ? { value: 'full' } : next(e)))
    on('session.repo', () => ({ value: { root: '/repo/shop' } }) as never)
    on('session.id', () => ({ value: session }))
    // /clear, /resume and /branch go on under another session id; /help stays in this one.
    on('command.run', ($, e) => {
      if (e.command !== 'help') session = 's2'
      return { text: '' }
    })
    const ui = await $.ui.mount({ plugin: 'ponytail', surface: 'terminal', ...BAND })
    await $.command.run(typed('help'))
    expect(await ui.find({ key: 'level', text: /full/ })).toBeUndefined()
    await $.command.run(typed(command))
    expect(await ui.find({ key: 'level', text: /full/ })).toBeDefined()
    await ui.unmount()
  })
}

test('two project names that sanitize to the same filename write separate ledgers', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  let root = '/work/api@shop'
  const files: Record<string, string> = {}
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/home/u' : e.name === 'XDG_CONFIG_HOME' ? '/home/u/.config' : undefined }))
  on('session.repo', () => ({ value: { root } }) as never)
  on('session.cwd', () => ({ value: root }))
  on('session.id', () => ({ value: 's1' }))
  on('session.turns', () => ({ value: 1 }))
  on('session.usage', () => ({ value: { startedAt: 0, cost: { usd: 0.5 } } }) as never)
  on('process.run', () => ran(1) as never)
  on('fs.read', ($, e) => {
    const path = e.path.replace(/\\/g, '/')
    const text = files[path]
    return text === undefined ? ({ deny: 'missing' } as never) : { value: text }
  })
  on('fs.list', ($, e) => {
    const dir = e.path.replace(/\\/g, '/')
    return {
      value: Object.keys(files)
        .filter(p => p.startsWith(`${dir}/`) && p.endsWith('.csv'))
        .map(p => ({ kind: 'file' as const, name: p.slice(dir.length + 1), size: 0, mtimeMs: 0, isLink: false })),
    }
  })
  on('fs.write', ($, e) => {
    files[e.path.replace(/\\/g, '/')] = e.text
    return { value: undefined }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))

  await $.session.start({ cwd: root, surface: null } as never)
  await $.turn.complete({ answer: '', durationMs: 1000 } as never)
  root = '/work/api_shop'
  await $.session.start({ cwd: root, surface: null } as never)
  await $.turn.complete({ answer: '', durationMs: 1000 } as never)

  const csvs = Object.keys(files).filter(p => p.endsWith('.csv')).sort()
  expect(csvs.some(p => p.endsWith('/api_shop.csv'))).toBe(true)
  expect(csvs.some(p => p.endsWith('/api_shop_ad0ec4e8.csv'))).toBe(true)
  expect(csvs.length).toBe(2)
  const board = Object.values(files).find(t => t.includes('id="board-data"')) ?? ''
  expect(board).toContain('api@shop')
  expect(board).toContain('api_shop')
})

test("another plugin's command runs without the band's hook, so its output is not labelled ponytail", async ($, on) => {
  let reads = 0
  on('session.id', () => (reads++, { value: 's1' }))
  on('command.run', () => ({ text: '' }))
  await $.command.run(typed('anymodel'))
  expect(reads).toBe(0)
})

test('the ledger is written on Windows, where there is no mkdir', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const env: Record<string, string> = { OS: 'Windows_NT', XDG_CONFIG_HOME: 'C:/Users/u/.config' }
  on('env.get', ($, e) => ({ value: env[e.name] }))
  on('session.repo', () => ({ value: { root: 'C:\\repo\\shop' } }) as never)
  on('session.id', () => ({ value: 's1' }))
  on('session.turns', () => ({ value: 1 }))
  on('session.usage', () => ({ value: { startedAt: 0, cost: { usd: 0.5 } } }) as never)
  on('process.run', ($, e) => (e.argv[0] === 'mkdir' ? { deny: 'mkdir: not found' } : (ran(1) as never)))
  on('fs.read', () => ({ deny: 'missing' }) as never)
  on('fs.list', () => ({ value: [] }))
  const written: string[] = []
  on('fs.write', ($, e) => {
    // The engine writes the path with this OS's separator.
    written.push(e.path.replace(/\\/g, '/'))
    return { value: undefined }
  })
  const status: unknown[] = []
  on('ui.status', ($, e) => {
    status.push(e)
    return { value: undefined }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: 'C:\\repo\\shop', surface: null } as never)
  await $.turn.complete({ answer: '', durationMs: 1000 } as never)
  expect(JSON.stringify(status)).not.toContain('could not write the task ledger')
  // Off Windows a C: path is relative, so the working dir comes in front of it: compare the end.
  expect(written.length).toBe(2)
  expect(written[0]?.endsWith('C:/Users/u/.config/ponytail/band/shop.csv')).toBe(true)
  expect(written[1]?.endsWith('C:/Users/u/.config/ponytail/band/board.html')).toBe(true)
})

test('the transcript is found with no classic hook, in its named folder or any other', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  let session = 's1'
  const projects = '/home/u/.claude/projects'
  let titles: Record<string, string> = { [`${projects}/-repo-shop-v2/s1.jsonl`]: 'Cart totals' }
  // Windows fs events add a drive and backslashes to the fixture's POSIX paths.
  const titleAt = (file: string) => Object.entries(titles).find(([name]) => file.replaceAll('\\', '/').endsWith(name))?.[1]
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
  on('session.repo', () => ({ value: { root: '/repo/shop' } }) as never)
  on('session.root', () => ({ value: '/repo/shop.v2' }))
  on('session.id', () => ({ value: session }))
  on('session.turns', () => ({ value: 1 }))
  on('session.usage', () => ({ value: { startedAt: 0, cost: { usd: 0.5 } } }) as never)
  const listed: string[] = []
  on('fs.list', ($, e) => {
    listed.push(e.path.replaceAll('\\', '/'))
    return { value: listed.at(-1)?.endsWith(projects) ? [{ name: '-repo-shop-v2', kind: 'dir' }, { name: 'notes.txt', kind: 'file' }, { name: '-wt', kind: 'dir' }] : [] } as never
  })
  on('fs.exists', ($, e) => ({ value: titleAt(e.path) !== undefined }))
  on('process.run', ($, e) => {
    const title = e.argv[0] === 'grep' && e.argv[1] === '-F' ? titleAt(e.argv.at(-1) ?? '') : undefined
    return { value: { exitCode: title ? 0 : 1, stdout: title ? `${JSON.stringify({ type: 'custom-title', customTitle: title })}\n` : '', stderr: '' } } as never
  })
  on('fs.read', () => ({ deny: 'missing' }) as never)
  const rows: string[] = []
  on('fs.write', ($, e) => {
    if (e.path.endsWith('shop.csv')) rows.push(e.text)
    return { value: undefined }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  // Only non-classic events fire, as when cc-plugin-sec-default skips every classic.* hook.
  await $.session.start({ cwd: '/repo/shop.v2', surface: null } as never)
  await $.turn.complete({ answer: '', durationMs: 1000 } as never)
  expect(rows.at(-1)).toContain('Cart totals')
  // The folder its rule names held the file, so no folder was listed.
  expect(listed.some(file => file.endsWith(projects))).toBe(false)
  // A worktree moves the file under the same id, and the session is renamed there.
  titles = { [`${projects}/-wt/s1.jsonl`]: 'Cart totals, split' }
  await $.turn.complete({ answer: '', durationMs: 1000 } as never)
  expect(rows.at(-1)).toContain('Cart totals, split')
  // /clear goes on under another id, in a folder the rule does not name (a hashed long name, say).
  session = 's2'
  titles = { ...titles, [`${projects}/-wt/s2.jsonl`]: 'Refunds' }
  await $.turn.complete({ answer: '', durationMs: 1000 } as never)
  expect(rows.at(-1)).toContain('Refunds')
})

test('without HOME (Windows) the band reads its flags under USERPROFILE', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('env.get', ($, e) => ({ value: e.name === 'USERPROFILE' ? 'C:\\Users\\u' : undefined }))
  // The engine may hand the path on with either separator, and off Windows a C: path is relative,
  // so the working dir comes in front of it: compare the end.
  const reads: string[] = []
  on('fs.read', ($, e, next) => {
    reads.push(e.path.replaceAll('\\', '/'))
    return reads.at(-1)?.endsWith('C:/Users/u/.claude/.ponytail-band') ? { value: 'off' } : next(e)
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>prompt only</Text>
  })
  const ui = await $.ui.mount({ plugin: 'ponytail', surface: 'terminal', ...BAND })
  expect(reads.some(path => path.endsWith('C:/Users/u/.claude/.ponytail-band'))).toBe(true)
  expect(await ui.find({ key: 'level' })).toBeUndefined()
  await ui.unmount()
})

test('another mod drawing above the prompt shows below the band, in compact and in details', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  // Another mod in the same slot, beneath ponytail in the chain.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>other band</Text>
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'ponytail', surface, ...BAND })
    expect(await ui.find({ key: 'level' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /other band/ })).toBeDefined()

    await ui.press({ key: 'details' })
    expect(await ui.find({ key: 'level-ultra' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /other band/ })).toBeDefined()
    // back to compact for the next surface
    await ui.press({ key: 'details' })
    await ui.unmount()
  }
})

test('review and audit run the same commands a person types', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const sent: string[] = []
  on('command.run', ($, e) => {
    sent.push(`/${e.command} ${e.args}`.trim())
    return { text: '' }
  })
  const ui = await $.ui.mount({ plugin: 'ponytail', surface: 'terminal', ...BAND })
  // The level pill opens the four levels instead of switching: no command, no turn.
  await ui.press({ key: 'level' })
  expect(await ui.find({ key: 'level-ultra' })).toBeDefined()
  expect(sent).toEqual([])
  await ui.press({ key: 'level-lite' })
  expect(sent).toEqual(['/ponytail:ponytail lite'])
  sent.length = 0
  await ui.press({ key: 'review' })
  await ui.press({ key: 'audit' })
  expect(sent).toEqual(['/ponytail:ponytail-review', '/ponytail:ponytail-audit'])
  await ui.unmount()
})

test('copy hands the task to the clipboard as Markdown', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const copied: string[] = []
  on('ui.copy', ($, e) => {
    copied.push(e.text)
    return { value: { isCopied: true as const } }
  })
  on('ui.toast', () => ({ value: undefined }))
  const ui = await $.ui.mount({ plugin: 'ponytail', surface: 'terminal', ...BAND })
  await ui.press({ key: 'details' })
  expect(await ui.find({ key: 'task' })).toBeUndefined()
  await ui.press({ key: 'copy' })
  expect(copied.length).toBe(1)
  expect(copied[0]).toContain('## Untitled session')
  expect(copied[0]).toContain('| Turns | 0 |')
  await ui.unmount()
})

test('the transcript alone says which tests ran, what an edit made and what it reused', () => {
  const calls = toolCalls(BAND_SESSION)
  // A Read and the prompt are not tool calls that change the board.
  expect(calls.map(c => c.name)).toEqual(['Bash', 'Edit', 'Read', 'Write', 'Bash'])
  const known = new Map([['lineTotal', 'src/money.ts:1'], ['formatPrice', 'src/money.ts:9']])

  // The first run says how it went, before any edit.
  expect(toolsSummary(calls.slice(0, 1), '/repo', known).tests).toEqual({ state: 'pass', passed: 14, failed: 0 })

  // An edit swapping a definition for one that calls an existing helper: new, gone, reused, and the tests stale.
  expect(toolsSummary(calls.slice(0, 2), '/repo', known)).toEqual({
    created: ['send'],
    removed: ['legacy'],
    reused: ['lineTotal'],
    tests: { state: 'stale', passed: 14, failed: 0 },
  })

  // A new source file counts every definition it holds as new.
  const written = toolsSummary(calls.slice(0, 4), '/repo', known)
  expect(written.created).toEqual(['send', 'lineTotal'])
  expect(written.reused).toEqual(['lineTotal'])
  expect(written.tests.state).toBe('stale')

  // The second run is what the session ends on.
  expect(toolsSummary(calls, '/repo', known).tests).toEqual({ state: 'pass', passed: 15, failed: 0 })

  // A scratch script outside the project is never the project's code (#1300).
  const scratch = [{ name: 'Edit', input: { file_path: '/tmp/scratch/drive.py', old_string: 'a = 1', new_string: 'def send():\n  pass' }, failed: false, text: 'ok' }]
  expect(toolsSummary(scratch, '/repo', known)).toEqual({ created: [], removed: [], reused: [], tests: { state: 'none' } })
})

test('a test run through the PowerShell tool counts like one through Bash (dietrichgebert/ponytail#1414)', () => {
  const ran = [{ name: 'PowerShell', input: { command: 'npm test' }, failed: false, text: 'ℹ pass 7' }]
  expect(toolsSummary(ran, '/repo', new Map()).tests).toEqual({ state: 'pass', passed: 7, failed: undefined })
})

test('a piped test run that exits 0 still shows its failures (dietrichgebert/ponytail#1227)', () => {
  const out = '\t Executed 12 tests, with 1 failure (0 unexpected) in 0.031 (0.035) seconds'
  const ran = [{ name: 'Bash', input: { command: 'xcodebuild -scheme App test | xcbeautify' }, failed: false, text: out }]
  expect(toolsSummary(ran, '/repo', new Map()).tests).toEqual({ state: 'fail', passed: 11, failed: 1 })
})

test('an Xcode MCP run shows its failures though the tool did not error, and a Swift edit marks it stale', () => {
  const run = (text: string, failed = false) => ({ name: 'mcp__xcode__RunAllTests', input: {}, failed, text })
  const green = run('{"counts":{"failed":0,"passed":187,"total":187},"results":[]}')
  const typo = run('{"data":"Test \'CartTests\' not found in target \'AppTests\'.","type":"error"}', true)
  const broke = run('{"type":"error","data":"Build action failed. Inspect build logs."}', true)
  const red = run('{"counts":{"failed":13,"passed":174,"total":187},"results":[]}')
  const tests = (...calls: ReturnType<typeof run>[]) => toolsSummary(calls, '/repo', new Map()).tests
  expect(tests(green)).toEqual({ state: 'pass', passed: 187, failed: 0 })
  // A mistyped test says nothing about the code: the last result stands.
  expect(tests(green, typo)).toEqual({ state: 'pass', passed: 187, failed: 0 })
  expect(tests(green, typo, broke)).toEqual({ state: 'fail' })
  expect(tests(green, typo, broke, red)).toEqual({ state: 'fail', passed: 174, failed: 13 })
  const edit = { name: 'Edit', input: { file_path: '/repo/Sources/Cart.swift', old_string: 'let a = 1', new_string: 'let a = 2' }, failed: false, text: 'ok' }
  expect(toolsSummary([red, edit], '/repo', new Map()).tests.state).toBe('stale')
})

test('a turn reads the tests, reuse and stale tests out of its transcript', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const transcript = '/home/u/.claude/projects/-repo/s1.jsonl'
  // What grep -F -e TOOL_USE_RECORD -e TOOL_RESULT_RECORD leaves of the fixture.
  const toolLines = BAND_SESSION.split('\n').filter(line => line.includes(TOOL_USE_RECORD) || line.includes(TOOL_RESULT_RECORD)).join('\n')

  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
  on('session.repo', () => ({ value: { root: '/repo' } }) as never)
  on('session.root', () => ({ value: '-repo' }))
  on('session.id', () => ({ value: 's1' }))
  on('session.turns', () => ({ value: 1 }))
  on('session.usage', () => ({ value: { startedAt: 0, cost: { usd: 0.5 } } }) as never)
  on('fs.exists', ($, e) => ({ value: e.path === transcript }))
  on('fs.read', () => ({ value: '' }))
  on('fs.list', () => ({ value: [] }) as never)
  const rows: string[] = []
  on('fs.write', ($, e) => {
    if (e.path.endsWith('repo.csv')) rows.push(e.text)
    return { value: undefined }
  })
  on('process.run', ($, e) => {
    const argv = e.argv
    if (argv.includes(TOOL_USE_RECORD)) return ran(0, toolLines)
    if (argv.includes('-nE')) return ran(0, '/repo/src/money.ts:1:export function lineTotal(items: number[]) {\n')
    if (argv[0] === 'git') return ran(0, '/repo/src/app.ts:3:  legacy(cart)')
    return ran(1)
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))

  const ui = await $.ui.mount({ plugin: 'ponytail', surface: 'terminal', ...BAND })
  await $.session.start({ cwd: '/repo', surface: null } as never)
  await $.turn.complete({ answer: '', durationMs: 1000 } as never)

  // The tests, the reuse and the callers the edit left open, all without a tool.call hook.
  expect(await ui.find({ type: 'Text', text: /✓ 15 tests/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /33% reuse/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /⚠ 1 callers open/ })).toBeDefined()
  // reuse_pct, reused, new, callers_open in the ledger: 1 of 3 functions reused.
  expect(rows.at(-1)).toContain(',33,1,2,1,')
  await ui.unmount()
})

// A turn whose Edit removes two definitions: `legacy` is still called, `stale` is defined again in another file.
async function removeTwo($: Engine, on: On) {
  const transcript = '/home/u/.claude/projects/-repo/s1.jsonl'
  const OLD = 'export function legacy(cart: Cart) {\n  return 0\n}\nexport function stale() {\n  return 1\n}'
  const toolLines = [
    JSON.stringify({ type: 'assistant', message: { id: 'm1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: '/repo/src/cart.ts', old_string: OLD, new_string: '', replace_all: false } }] } }),
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ tool_use_id: 't1', type: 'tool_result', content: 'The file /repo/src/cart.ts has been updated.', is_error: false }] } }),
  ].join('\n')
  // What git grep -nw finds for each name; a line that holds both names comes back once.
  const found: Record<string, string[]> = {
    legacy: ['src/app.ts:3:  legacy(cart)', 'src/mix.ts:2:  legacy(stale)'],
    stale: ['src/mix.ts:2:  legacy(stale)', 'src/other.ts:1:export function stale() {'],
  }
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
  on('session.repo', () => ({ value: { root: '/repo' } }) as never)
  on('session.root', () => ({ value: '-repo' }))
  on('session.id', () => ({ value: 's1' }))
  on('session.turns', () => ({ value: 1 }))
  on('session.usage', () => ({ value: { startedAt: 0, cost: { usd: 0.5 } } }) as never)
  on('fs.exists', ($, e) => ({ value: e.path === transcript }))
  on('fs.read', () => ({ value: '' }))
  on('fs.list', () => ({ value: [] }) as never)
  const rows: string[] = []
  on('fs.write', ($, e) => {
    if (e.path.endsWith('repo.csv')) rows.push(e.text)
    return { value: undefined }
  })
  const callerSearches: string[][] = []
  on('process.run', ($, e) => {
    const argv = e.argv
    if (argv.includes(TOOL_USE_RECORD)) return ran(0, toolLines)
    if (argv[0] === 'git' && argv[1] === 'grep' && !argv.includes('-nE')) {
      callerSearches.push([...argv])
      const lines = [...new Set(Object.entries(found).flatMap(([name, ls]) => (argv.includes(name) ? ls : [])))].sort()
      return ran(lines.length > 0 ? 0 : 1, lines.join('\n'))
    }
    return ran(1)
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  const ui = await $.ui.mount({ plugin: 'ponytail', surface: 'terminal', ...BAND })
  await $.session.start({ cwd: '/repo', surface: null } as never)
  await $.turn.complete({ answer: '', durationMs: 1000 } as never)
  return { ui, rows, callerSearches }
}

test('a removed definition still called is open at each call, one defined again elsewhere is not', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const { ui, rows } = await removeTwo($, on)
  expect(await ui.find({ type: 'Text', text: /⚠ 2 callers open/ })).toBeDefined()
  // reuse_pct, reused, new, callers_open, tests in the ledger.
  expect(rows.at(-1)).toContain(',,0,0,2,not run,')
  await ui.press({ key: 'details' })
  expect(await ui.find({ type: 'Text', text: 'src/app.ts:3, src/mix.ts:2' })).toBeDefined()
  await ui.press({ key: 'details' })
  await ui.unmount()
})

test('a turn searches the callers of every removed definition at once', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const { ui, callerSearches } = await removeTwo($, on)
  // One search, whatever the number of names: each one more was another walk of the repo on every turn.
  expect(callerSearches).toHaveLength(1)
  await ui.unmount()
})

test('without grep (Windows) a turn still reads the tests and the model from the transcript', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const transcript = '/home/u/.claude/projects/-repo/s1.jsonl'
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
  on('session.repo', () => ({ value: { root: '/repo' } }) as never)
  on('session.root', () => ({ value: '-repo' }))
  on('session.id', () => ({ value: 's1' }))
  on('session.turns', () => ({ value: 1 }))
  on('session.usage', () => ({ value: { startedAt: 0, cost: { usd: 0.5 } } }) as never)
  on('fs.exists', ($, e) => ({ value: e.path === transcript }))
  on('fs.read', ($, e) => (e.path === transcript ? { value: BAND_SESSION } : { deny: 'missing' }) as never)
  on('fs.list', () => ({ value: [] }) as never)
  const rows: string[] = []
  on('fs.write', ($, e) => {
    if (e.path.endsWith('repo.csv')) rows.push(e.text)
    return { value: undefined }
  })
  on('process.run', ($, e) => (e.argv[0] === 'grep' ? { deny: 'grep: not found' } : ran(1)) as never)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  const ui = await $.ui.mount({ plugin: 'ponytail', surface: 'terminal', ...BAND })
  await $.session.start({ cwd: '/repo', surface: null } as never)
  await $.turn.complete({ answer: '', durationMs: 1000 } as never)
  expect(await ui.find({ type: 'Text', text: /✓ 15 tests/ })).toBeDefined()
  expect(rows.at(-1)).toContain('claude-opus-5-5')
  await ui.unmount()
})

test('the start-up definition search reads only the source files the band parses (#1443)', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
  on('session.repo', () => ({ value: { root: '/repo/shop' } }) as never)
  on('session.id', () => ({ value: 's1' }))
  on('session.turns', () => ({ value: 1 }))
  on('session.usage', () => ({ value: { startedAt: 0, cost: { usd: 0 } } }) as never)
  const searches: string[][] = []
  on('process.run', ($, e) => {
    if (e.argv[0] === 'git' && e.argv[1] === 'grep') searches.push([...e.argv])
    return ran(1) as never
  })
  on('fs.read', () => ({ deny: 'missing' }) as never)
  on('fs.list', () => ({ value: [] }))
  on('fs.write', () => ({ value: undefined }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/repo/shop', surface: null } as never)
  const argv = searches[0] ?? []
  expect(argv.slice(argv.indexOf('--') + 1)).toEqual(DEF_PATHS)
  // Every included extension is one the band reads, and HTML is not.
  const included = DEF_PATHS.filter(p => !p.startsWith(':'))
  expect(included.every(p => isCode(`src/a${p.slice(1)}`))).toBe(true)
  expect(isCode('saved/page.html')).toBe(false)
  // And every language the band reads is searched, or its existing definitions never count as reuse.
  for (const ext of ['py', 'js', 'ts', 'tsx', 'go', 'rs', 'rb', 'vue', 'php', 'java', 'kt', 'swift', 'cs']) {
    expect(isCode(`src/a.${ext}`)).toBe(true)
    expect(included).toContain(`*.${ext}`)
  }
})
