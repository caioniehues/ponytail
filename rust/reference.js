#!/usr/bin/env node
// ponytail — the reference dispatcher for the Rust port (fork #7, #8; ADR 0002): one subcommand per JS hook,
// so the binary and the JS can be replayed against the same recorded cases. It runs the JS hooks unchanged.
//   hook session-start | hook subagent-start | hook prompt-submit   (stdin: the host's hook JSON)
//   map [root]                                                      (Pi's codebase map)

const path = require('path');

const HOOKS = {
  'session-start': 'ponytail-activate.js',
  'subagent-start': 'ponytail-subagent.js',
  'prompt-submit': 'ponytail-mode-tracker.js',
};
const hooks = path.join(__dirname, '..', 'hooks');
const [command, arg] = process.argv.slice(2);

if (command === 'hook' && HOOKS[arg]) {
  require(path.join(hooks, HOOKS[arg]));
} else if (command === 'map') {
  // As `node hooks/ponytail-map.js [root]` prints it: 2 s from process start. A map that fails (a root that is not
  // there) exits 1 with nothing printed, which both callers read as no map; node's stack trace is not part of it.
  let map;
  try { map = require(path.join(hooks, 'ponytail-map.js')).buildMap(arg || process.cwd(), 2000); } catch (e) { process.exit(1); }
  process.stdout.write(map + '\n');
} else {
  process.stderr.write('usage: ponytail hook session-start|subagent-start|prompt-submit | ponytail map [root]\n');
  process.exit(2);
}
