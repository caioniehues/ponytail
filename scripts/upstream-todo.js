#!/usr/bin/env node
// The open upstream PRs this fork has not taken, for /triage and the next batch. A PR counts as taken when a commit
// since v5.3.3 cites it or carries its title as the subject (picks before the citation convention cite nothing).
// PRs HANDOFF.md names (left out on purpose, or open work) are listed apart, and so are PRs whose title names an
// upstream issue a fork commit already cites: the fork may have fixed it its own way.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const BASE = '96608e0';
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const open = JSON.parse(run('gh', ['pr', 'list', '-R', 'DietrichGebert/ponytail', '--state', 'open', '--limit', '500', '--json', 'number,title']));
const log = run('git', ['log', '--format=%s%n%b', `${BASE}..main`]);
const cited = new Set([...log.matchAll(/ponytail#(\d+)/g)].map(m => Number(m[1])));
const norm = s => s.toLowerCase().replace(/\s*\((?:dietrichgebert\/ponytail)?#\d+\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const subjects = run('git', ['log', '--format=%s', `${BASE}..main`]).split('\n').map(norm).filter(Boolean);
const taken = pr => cited.has(pr.number) || subjects.includes(norm(pr.title));
const handoff = fs.readFileSync(path.join(root, 'HANDOFF.md'), 'utf8');
const named = new Set([...handoff.matchAll(/#(\d{3,5})\b/g)].map(m => Number(m[1])));

const todo = open.filter(pr => !taken(pr)).sort((a, b) => b.number - a.number);
const line = pr => `#${pr.number} ${pr.title}`;
const covers = pr => [...pr.title.matchAll(/#(\d+)/g)].map(m => Number(m[1])).filter(n => cited.has(n))
const known = todo.filter(pr => named.has(pr.number));
const covered = todo.filter(pr => !named.has(pr.number) && covers(pr).length > 0);
const fresh = todo.filter(pr => !named.has(pr.number) && covers(pr).length === 0);
const list = (heading, prs, extra = () => '') => {
  console.log(`${heading} (${prs.length}):`);
  for (const pr of prs) console.log(`  ${line(pr)}${extra(pr)}`);
  console.log('');
};
list('Not in the fork', fresh);
list('May be covered: the fork already cites the issue the title names', covered, pr => `  [fork cites #${covers(pr).join(', #')}]`);
list('Named in HANDOFF.md, left out or open work', known);
