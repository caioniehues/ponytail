#!/usr/bin/env node
// The task ledger's text (hooks/band/ledger.ts), which the band, the import and pi all write.

const assert = require('assert');
const { test } = require('node:test');
const { loadBand, sessionStats, taskRow } = require('../hooks/ponytail-band-import');

const at = Date.UTC(2026, 9, 15, 12, 0);
const row = (ledger, over = {}) => ({
  key: ledger.taskKey('4c69e3db-57a0', at), started: ledger.stamp(at), project: 'shop', name: 'Fix the cart | totals, again', cost: 3.1, turns: 6,
  agentMs: 1_560_000, tokens: { input: 5000, output: 85_000, cacheRead: 1_100_000, cacheWrite: 10_000 },
  reuse: null, reused: 1, created: 0, callersOpen: 0, tests: '14 passed', level: 'full', model: 'claude-opus-5-5', ...over,
});

test('two project names that sanitize to the same filename keep separate ledgers', async () => {
  const { ledgerFile } = await loadBand('ledger');
  assert.equal(ledgerFile('/band', 'myapp', '/work/myapp'), '/band/myapp.csv');
  assert.equal(ledgerFile('/band', 'api_shop', '/work/api_shop'), '/band/api_shop.csv');
  assert.equal(ledgerFile('/band', 'api@shop', '/work/api@shop'), '/band/api_shop_ad0ec4e8.csv');
  assert.equal(ledgerFile('/band', 'api@shop', '/work/api@shop/'), '/band/api_shop_ad0ec4e8.csv');
  assert.notEqual(ledgerFile('/band', 'api@shop', '/a/api@shop'), ledgerFile('/band', 'api@shop', '/b/api@shop'));
  assert.notEqual(ledgerFile('/band', 'api@shop', '/work/api@shop'), ledgerFile('/band', 'api_shop', '/work/api_shop'));
});

test('the ledger folder follows XDG_CONFIG_HOME, empty meaning unset', async () => {
  const { ledgerDir } = await loadBand('ledger');
  assert.equal(ledgerDir('/x', '/home/u'), '/x/ponytail/band');
  assert.equal(ledgerDir(undefined, '/home/u'), '/home/u/.config/ponytail/band');
  assert.equal(ledgerDir('', '/home/u'), '/home/u/.config/ponytail/band');
});

test('the CSV keeps one row per task and replaces it on every turn', async () => {
  const ledger = await loadBand('ledger');
  const first = ledger.upsertCsv('', row(ledger));
  const lines = first.trim().split('\n');
  assert.equal(lines.length, 2);
  assert.ok(lines[1].includes('"Fix the cart | totals, again"'));
  const again = ledger.upsertCsv(first, row(ledger, { cost: 4.2, turns: 7 }));
  assert.equal(again.trim().split('\n').length, 2);
  assert.ok(again.includes(',4.20,7,'));
  assert.equal(ledger.upsertCsv(again, row(ledger, { key: ledger.taskKey('ffff0000', at + 1) })).trim().split('\n').length, 3);
});

test('the CSV writes a formula-shaped name as text, once', async () => {
  const ledger = await loadBand('ledger');
  const csv = ledger.upsertCsv('', row(ledger, { name: '=2+2' }));
  assert.ok(csv.includes("'=2+2"));
  // Replacing the row re-writes kept rows through the same escaping: once, not twice.
  const again = ledger.upsertCsv(csv, row(ledger, { key: 'another-1', name: 'x' }));
  assert.ok(again.includes("'=2+2") && !again.includes("''=2+2"));
});

test('a task name with a line break is replaced whole, not left as a stray line', async () => {
  const ledger = await loadBand('ledger');
  const again = ledger.upsertCsv(ledger.upsertCsv('', row(ledger, { name: 'first\nsecond' })), row(ledger, { name: 'first\nsecond', turns: 7 }));
  const rows = ledger.parseCsv(again);
  assert.equal(rows.length, 2);
  assert.equal(rows[1][3], 'first\nsecond');
});

test('a row by its key, as column to value', async () => {
  const ledger = await loadBand('ledger');
  assert.equal(ledger.rowFor('key,agent_minutes\nother-1,2.0\n', 'other-1').agent_minutes, '2.0', 'an older header names its own columns');
  const csv = ledger.upsertCsv('', row(ledger));
  assert.equal(ledger.rowFor(csv, row(ledger).key).name, 'Fix the cart | totals, again');
  assert.equal(ledger.rowFor(csv, 'missing-1'), undefined);
  assert.equal(ledger.rowFor('', 'other-1'), undefined);
});

// The three writers on one ledger, each building its row as it does for real: the band's snapshot, the import's
// taskRow from a transcript, pi's snapshotFrom. Each writer's own tests check it finds the repository root for a worktree.
test('rows from the band, the import and pi all reach the board', async () => {
  const ledger = await loadBand('ledger');
  const { snapshot, isTestCommand, testCounts, testsLabel } = await loadBand('metrics');
  const { tasksFrom } = await loadBand('board');
  const pi = await import('../pi-extension/ledger.js');
  const file = ledger.ledgerFile('/band', 'api@shop', '/work/api@shop');
  assert.equal(file, '/band/api_shop_ad0ec4e8.csv', 'every writer names the file this way, from the repository root');

  const tokens = { input: 5000, output: 85_000, cacheRead: 1_100_000, cacheWrite: 10_000 };
  const band = snapshot({
    level: 'full', pending: '', model: 'claude-opus-5-5', cost: 3.1, spent: 3.1, turns: 6, turnCosts: [0.42], tokens, busyMs: 1_560_000,
    name: 'first\nsecond', project: 'api@shop', session: '4c69e3db-57a0', transcript: '', reused: ['to_cents'], created: [],
    removed: [], openCallers: [], tests: { state: 'pass', passed: 14 }, details: false,
  }, at);
  const t = s => `2026-10-01T10:${s}Z`;
  const stats = sessionStats([
    { type: 'user', timestamp: t('00:00'), origin: { kind: 'human' }, message: { content: 'Fix cart\r\nplease' } },
    { type: 'assistant', timestamp: t('00:10'), message: { id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 5 } } },
  ]);
  const imported = taskRow(ledger, 'abcd1234-0000', 'api@shop', stats);
  const fromPi = pi.snapshotFrom({
    entries: [{ type: 'message', message: { role: 'user', content: 'hi' } }, { type: 'message', message: { role: 'assistant', model: 'gpt-6', usage: { input: 1, output: 1, cost: { total: 0.5 } }, content: [] } }],
    header: { timestamp: '2026-11-14T13:39:28.526Z' }, sessionId: 'beef0000-1111', project: 'api@shop', named: 'Pi, "quoted"', agentMs: 0, level: 'lite',
  }, { ...ledger, isTestCommand, testCounts, testsLabel });

  let csv = ledger.upsertCsv('', band);
  const merged = ledger.mergeRows(csv, [imported], ledger.recordedSessions([csv]));
  assert.equal(merged.added, 1);
  csv = ledger.upsertCsv(merged.text, fromPi);
  assert.deepEqual(ledger.parseCsv(csv).slice(1).map(r => r[3]), ['first\nsecond', 'Fix cart\r', 'Pi, "quoted"'], 'every name stays one row');
  assert.deepEqual(tasksFrom(csv).map(t => t.name), ['first\nsecond', 'Fix cart\r', 'Pi, "quoted"']);
  // The board drops a row without a cost (tasksFrom's NaN check), so an unpriced import is in the ledger but not on the board.
  assert.deepEqual(tasksFrom(ledger.mergeRows('', [{ ...imported, cost: null }]).text), []);

  // The band resuming an imported session it dates the same replaces the import's row; the import never adds a recorded one back.
  const resumed = ledger.upsertCsv(csv, { ...imported, cost: 1.5, tests: '3 passed', level: 'full' });
  assert.equal(ledger.rowFor(resumed, imported.key).tests, '3 passed');
  assert.equal(ledger.parseCsv(resumed).length, 4);
  assert.equal(ledger.mergeRows(resumed, [imported], ledger.recordedSessions([resumed])).added, 0);
  // Dated differently, it gets a second row: the shortcut on upsertCsv.
  assert.equal(ledger.parseCsv(ledger.upsertCsv(csv, { ...imported, key: ledger.taskKey('abcd1234-0000', at + 1) })).length, 5);
});
