// Drops the files in a directory that nothing has written for a while, so per-session
// state does not pile up. A missing directory is nothing to do.
const fs = require('fs');
const path = require('path');

const SESSION_MAX_AGE_MS = 30 * 24 * 3600 * 1000;

function pruneStale(dir, maxAgeMs = SESSION_MAX_AGE_MS) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch (e) { return; }
  const cutoff = Date.now() - maxAgeMs;
  for (const name of names) {
    const file = path.join(dir, name);
    try { if (fs.statSync(file).mtimeMs < cutoff) fs.unlinkSync(file); } catch (e) {}
  }
}

module.exports = { pruneStale };
