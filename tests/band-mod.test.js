// Guard for docs/adr/0001-band-reads-tool-calls-from-the-transcript.md: the band reads tool calls out of
// the session's transcripts at turn.complete, not through a `tool.call` hook. A hook that may match a
// tool, even one that only passes `next(e)` on, turns off that tool's move to the background and its
// live output, so a hook on Bash would hold every long command in the foreground. (dietrichgebert/ponytail#1449 removed the hook
// because it stopped Code Mode; from Claude Code 2.1.327 it no longer does.) This file runs with
// `npm test`, so re-adding the hook fails there.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const register = fs.readFileSync(path.join(__dirname, '..', 'hooks', 'band', 'register.tsx'), 'utf8');

test('the band never subscribes to tool.call, so long commands can still move to the background (ADR 0001)', () => {
  assert.doesNotMatch(
    register,
    /\bon\(\s*['"`]tool\.call['"`]/,
    'a tool.call hook turns off the background and live output of every tool it may match; derive the numbers from the transcript at turn.complete instead (see docs/adr/0001)',
  );
});
