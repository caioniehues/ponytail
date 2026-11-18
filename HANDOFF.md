# Handoff: ponytail fork, after the second session

Repo: /home/milena/Projects/ponytail. A fork (`origin` = caioniehues/ponytail) of `upstream` = DietrichGebert/ponytail.
You have READ access upstream; issues and labels are tracked on the fork (see `docs/agents/issue-tracker.md`). `CLAUDE.local.md`, `docs/agents/` and this file are no longer in `.git/info/exclude`: untracked until you commit them. What stays true between sessions (checks, the PR flow, gotchas) is in `docs/agents/fork-workflow.md`; this file is state and open work.

## Where things stand

- `main` = `14cac50`, pushed, CI green (band suite 54/54 on Claude Code 2.1.327 and `@latest`). It is upstream `96608e0` (v5.3.3) plus cherry-picked upstream PRs and local fixes: `git log --oneline 96608e0..main`. Original authors are kept on cherry-picks; ported PRs carry a `Co-authored-by` trailer.
- Only `main` exists, locally and on origin; the merged batch branches are deleted. Local refs `pr-<n>` are fetched upstream PR heads (`git fetch upstream pull/<n>/head:pr-<n>`).
- What landed, by theme (upstream PR numbers):
  - First session: Code Mode #1449 (band reads tests and reuse from the transcript; no `tool.call` hook). Band fixes #1438 #1417 #1446; CI band suite #1354. Privacy/security #1407 #1408 #1320 #1249 #1409. Windows #1346 #1363 #1222 (its `isSource` part) #1442 #1377 #1386. Per-session level #1450 + #1321, with local commits 56ca145 f7946f4 2cf2db2 51f7582.
  - Second session, local fixes:
    - `301e179` band layout tests: from Claude Code 2.1.321 the harness's `next(e)` resolves to the engine's own AbovePrompt (`{type:'engine'}`) instead of rejecting, so the band stacks itself in a column Box and `find({type:'Box'})` hit that wrapper. Root Boxes now carry `key="band"`. `03acfa3` moves CI to 2.1.327.
    - `9f39d11` removed-definition callers: one `git grep` with an `-e` per name instead of one per name.
    - `e2d65f7` `ponytail-sessions/` pruned: files idle 30 days go at a fresh SessionStart (never compact/resume) and when the OpenCode plugin loads (V2 `setup`, V1 `server`). Helper `hooks/ponytail-prune.js`.
    - `fadc8e7` comment: the `writeBoard` upper-case probe can't misfire (`dir` is always `ledgerDir()`, ending in lower-case `/ponytail/band`).
  - Second session, test-run batch `e0955ca..1dcb607`: #1397 (runner must be the command; by design `sudo npm test` and `npx --yes vitest` no longer count), #1336 (squashed; jest/vitest count tests, not suites), #1441 (Vue), #1351 (PHP/JVM; its package-lock dropped), `4b44d88` (new languages added to `DEF_PATHS`, test checks both directions), #1414 (PowerShell) and #1227 (Swift/Xcode MCP; plus `test-without-building`) ported from the `tool.call` hook to `toolsSummary`.
- Left out on purpose: #1163 (breaks `clawhub` on Windows), #1322 (dup of #1407), duplicate `base()` PRs #1355 #1204 #1203 #1192 #1179, other per-session/Codex mode PRs #1366 #1175 #1174 #1331 #1325.
- Measured and left: the three transcript greps per turn (#1401) cost about 45 ms on a 12 MB transcript (4.6 + 16.1 + 7.4 ms grep, 19 ms parse). A saved byte offset isn't worth its state handling yet; the `shortcut:` notes in `register.tsx` record it.

## Test baseline on main

- `npm run check` is fully green: rule copies, versions, `check:plugin`, `npm test` 159/159 (pandas is now installed locally), band suite 54/54 on 2.1.327. Details in `docs/agents/fork-workflow.md`.

## Third session: the retro's environment fixes (`f9f7d99..14cac50`, pushed)

- `scripts/check-plugin.js` + `npm run check:plugin` / `npm run check`; a `check:plugin` step in `test.yml`. `claude plugin validate` type-checks the band against the engine's types but exits 0 on its warnings; this fails on them. A planted duplicate import fails it.
- The 24 type errors it found are fixed: `mainModel` under `noUncheckedIndexedAccess`; in `tests/band.test.tsx`, the `isCollapsed` prop 2.1.327 added to AbovePrompt, `isStdoutTruncated`/`isStderrTruncated` on mocked `process.run` results, a `typed()` helper for full `command.run` input, `removeTwo` typed as `(Engine, On)`.
- `.github/workflows/engine-latest.yml`: band checks on `@latest` every Monday and on demand; its first run (dispatched) passed, and the workflow is active.
- Editor types laid locally (`.claude-plugin/types/`, root `tsconfig.json`, both gitignored): the "Cannot find module 'claude-code'" diagnostics are gone.
- CI green on `14cac50`: `check:plugin` clean, band 54/54, on 2.1.327 and on `@latest`.

## Open work, in priority order

1. **Next upstream batch: uninstall and config** — #1395 #1282 #1264 #1258 #1269 #1276. Smaller than the codebase map and doesn't touch files changed this session. Same flow as the test-run batch: fetch heads, read diffs against `96608e0`, integrate on `batch/<name>`, suite after each pick, ff `main`.
2. **Remaining upstream batches, not yet reviewed:**
   - Codebase map: #1435 #1391 #1370 #1368 #1284 #1273 #1271 #1260 #1245 #1243 #1323.
   - Hosts: #1420 #1410 #1232 #1262 #1168 #1281 #1234 #1201 #1202.
   - Ledger correctness: #1399 or #1328, one of #1235/#1217/#1210, #1214, #1347 or #1402.
   - Rules and skills (need benchmarks): #1423 #1388 #1193 #1383 #1360 #1335.
   - Spam to ignore: #1405 (crypto token), #1436, #1415, #1429, #1406, #1430, #1411.
3. **Unverified, needs live hosts:** do OpenCode V1 hooks (`experimental.chat.system.transform`) get a `sessionID`? If not, V1 falls back to the shared file. No live test of session keying on Claude Code, Codex or OpenCode; that Claude Code keeps the session id on resume (unless `--fork-session`) is assumed.
4. **Smells (judgement calls):** folder-name logic duplicated (`base` in register.tsx, `tasksFrom` in board.ts), and the grep-or-read fallback (`readTitle`/`readModel`/`readTools`); `package-lock.json` locks no dependencies; `band-webhook-names.test.js` and `band-import.test.js` assert on source text.
5. **Design: split the band into its own plugin.** The real fix behind upstream #1433, #1310 and #1356; #1449 traded accuracy for Code Mode (`Write` overwrites count every definition as new; no transcript means no Tests/reuse; subagent tool calls aren't counted).

## Suggested skills

- `mattpocock-skills:code-review` with fixed point `51f7582` over this session's work, or after the next batch. Its spec lives upstream, so point the Spec reviewer at DietrichGebert/ponytail PRs.
- `mattpocock-skills:tdd` for porting PRs and anything in item 4.
- `mattpocock-skills:grill-with-docs` for item 5, then `to-spec` / `to-tickets` if it's multi-session.
- `mattpocock-skills:triage` if you mirror upstream issues into the fork's tracker.
