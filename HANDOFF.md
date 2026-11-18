# Handoff: ponytail fork

Repo: /home/milena/Projects/ponytail, a fork (`origin` = caioniehues/ponytail) of `upstream` = DietrichGebert/ponytail (read access only). Issues live on the fork (`docs/agents/issue-tracker.md`). What stays true between sessions (checks, picking PRs, per-session ports, benchmarks, gotchas) is in `docs/agents/fork-workflow.md`; this file is state, decisions and open work.

## Where things stand

- `main` is pushed and CI green. It is upstream `96608e0` (v5.3.3) plus picked upstream PRs and fork fixes: `git log --oneline 96608e0..main` is the history, each pick citing `dietrichgebert/ponytail#<n>`.
- All upstream batches in the plan are integrated: band fixes, privacy, Windows, per-session levels, test-run counting, uninstall and config, codebase map, hosts, ledger, rules and skills.
- `npm run check` is green locally: rule copies, versions, `check:plugin`, `npm test`, band suite on Claude Code 2.1.327. `engine-latest.yml` runs the band checks on the newest Claude Code each Monday.

## Decisions git does not record

- Left out on purpose:
  - #1163 (breaks `clawhub` on Windows); #1322 (dup of #1407); duplicate `base()` PRs #1355 #1204 #1203 #1192 #1179; other per-session/Codex mode PRs #1366 #1175 #1174 #1331 #1325.
  - #1235 and #1210: the same fix as #1217 plus a ledger parser and status warnings for rows only a hand edit makes. #1347: #1402 fixes the same /clear cost and the $0 after a reload, in fewer lines.
  - #1423 (fix a wrong value where it is made): benchmarked here, no measurable effect. Opus, 6 runs per arm: trace-amount fixed at the parser 6/6 in every arm, baseline included; todo-null correct and safe 6/6 in every arm (median LOC 81.5 main, 77.5 with #1423); $3.88. It waits for the task in fork issue #1.
  - #1335 (end-of-reply note only when it matters): its own numbers are mixed, auth-token expiry named 6/6 on main, 4/6 with it. #1388 (ladder before planning): benchmarked in Codex with GPT, not this harness, and adds 8 always-loaded lines. #1383: the larger alternative to #1360.
  - Spam: #1405 (crypto token), #1436, #1415, #1429, #1406, #1430, #1411.
- #1360 landed without a 3-arm benchmark, by the user's call; #1193 brought its own.
- In `skills/ponytail-review/SKILL.md`, #1193 sends a case the reviewer could not show to `Not checked:` and #1360 marks an unchecked deletion `unverified`. Both bullets stand as upstream wrote them; unify them only with a benchmark.
- Measured and left: the three transcript greps per turn (#1401) cost about 45 ms on a 12 MB transcript. A saved byte offset isn't worth its state handling yet; the `shortcut:` notes in `register.tsx` record it.

## Open work, in priority order

1. **Design: split the band into its own plugin.** The real fix behind upstream #1433, #1310 and #1356; #1449 traded accuracy for Code Mode (`Write` overwrites count every definition as new; no transcript means no tests or reuse; subagent tool calls aren't counted).
2. **Unverified, needs live hosts:** do OpenCode V1 hooks (`experimental.chat.system.transform`) get a `sessionID`? If not, V1 falls back to the shared file. No live test of session keying on Claude Code, Codex or OpenCode; that Claude Code keeps the session id on resume (unless `--fork-session`) is assumed.
3. **Smells (judgement calls):** folder-name logic duplicated (`base` in register.tsx, `tasksFrom` in board.ts); the grep-or-read fallback (`readTitle`/`readModel`/`readTools`); `package-lock.json` locks no dependencies; `band-webhook-names.test.js` and `band-import.test.js` assert on source text. Some may go with item 1.
4. **Benchmark task** for owner-anchored fixes: fork issue #1.

## Suggested skills

- `mattpocock-skills:grill-with-docs` for item 1, then `to-spec` / `to-tickets` if it's multi-session.
- `mattpocock-skills:improve-codebase-architecture` and `mattpocock-skills:tdd` for item 3.
- `mattpocock-skills:triage` if you mirror upstream issues into the fork's tracker.
