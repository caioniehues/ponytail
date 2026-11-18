#!/usr/bin/env node
// The webhook gets no task names unless the user turns them on.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

const plugin = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8'));
assert.strictEqual(plugin.userConfig.sendNames.default, false, 'sendNames is off by default');
// What the webhook sends with it unset or on: tests/band.test.tsx.

console.log('ok');
