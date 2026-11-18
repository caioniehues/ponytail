#!/usr/bin/env node
// The task ledger's text (hooks/band/ledger.ts), which the band, the import and pi all write.

const assert = require('assert');
const { test } = require('node:test');
const { loadBand, loadBoard } = require('../hooks/ponytail-band-import');

const at = Date.UTC(2026, 9, 15, 12, 0);
const row = (L, over = {}) => ({
  key: L.taskKey('4c69e3db-57a0', at), started: L.stamp(at), project: 'shop', name: 'Fix the cart | totals, again', cost: 3.1, turns: 6,
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
  const L = await loadBand('ledger');
  const first = L.upsertCsv('', row(L));
  const lines = first.trim().split('\n');
  assert.equal(lines.length, 2);
  assert.ok(lines[1].includes('"Fix the cart | totals, again"'));
  const again = L.upsertCsv(first, row(L, { cost: 4.2, turns: 7 }));
  assert.equal(again.trim().split('\n').length, 2);
  assert.ok(again.includes(',4.20,7,'));
  assert.equal(L.upsertCsv(again, row(L, { key: L.taskKey('ffff0000', at + 1) })).trim().split('\n').length, 3);
});

test('the CSV writes a formula-shaped name as text, once', async () => {
  const L = await loadBand('ledger');
  const csv = L.upsertCsv('', row(L, { name: '=2+2' }));
  assert.ok(csv.includes("'=2+2"));
  // Replacing the row re-writes kept rows through the same escaping: once, not twice.
  const again = L.upsertCsv(csv, row(L, { key: 'another-1', name: 'x' }));
  assert.ok(again.includes("'=2+2") && !again.includes("''=2+2"));
});

test('a task name with a line break is replaced whole, not left as a stray line', async () => {
  const L = await loadBand('ledger');
  const again = L.upsertCsv(L.upsertCsv('', row(L, { name: 'first\nsecond' })), row(L, { name: 'first\nsecond', turns: 7 }));
  const rows = L.parseCsv(again);
  assert.equal(rows.length, 2);
  assert.equal(rows[1][3], 'first\nsecond');
});

test('a row by its key, as column to value', async () => {
  const L = await loadBand('ledger');
  assert.equal(L.rowFor('key,agent_minutes\nother-1,2.0\n', 'other-1').agent_minutes, '2.0', 'an older header names its own columns');
  const csv = L.upsertCsv('', row(L));
  assert.equal(L.rowFor(csv, row(L).key).name, 'Fix the cart | totals, again');
  assert.equal(L.rowFor(csv, 'missing-1'), undefined);
  assert.equal(L.rowFor('', 'other-1'), undefined);
});

// The three writers on one ledger: the band's row, the import's merge, pi's row. The board reads every task whole.
test('rows from the band, the import and pi all reach the board', async () => {
  const L = await loadBand('ledger');
  const { tasksFrom } = await loadBoard();
  const band = row(L, { name: 'Fix the cart, "again"' });
  const imported = row(L, { key: L.taskKey('abcd1234-0000', at), name: 'Fix cart\r', cost: null, reused: 0, tests: '', level: 'import' });
  const pi = row(L, { key: L.taskKey('beef0000-1111', at), name: 'first\nsecond', level: 'lite' });
  let csv = L.upsertCsv('', band);
  const merged = L.mergeRows(csv, [imported], L.recorded([csv]));
  assert.equal(merged.added, 1);
  csv = L.upsertCsv(merged.text, pi);
  assert.deepEqual(L.parseCsv(csv).slice(1).map(r => r[3]), ['Fix the cart, "again"', 'Fix cart\r', 'first\nsecond'], 'every name stays one row');
  // The board drops a row without a cost (tasksFrom's NaN check), so an unpriced import is in the ledger but not on the board.
  assert.deepEqual(tasksFrom(csv).map(t => t.name), ['Fix the cart, "again"', 'first\nsecond']);

  // An imported session the band resumes with the same start replaces the import's row; the import never adds a recorded one back.
  const resumed = L.upsertCsv(csv, { ...imported, cost: 1.5, tests: '3 passed', level: 'full' });
  assert.equal(L.rowFor(resumed, imported.key).tests, '3 passed');
  assert.equal(L.parseCsv(resumed).length, 4);
  assert.equal(L.mergeRows(resumed, [imported], L.recorded([resumed])).added, 0);
});
