# Handoff: ponytail fork

Repo: /home/milena/Projects/ponytail, a fork (`origin` = caioniehues/ponytail) of `upstream` = DietrichGebert/ponytail (read access only). Issues live on the fork (`docs/agents/issue-tracker.md`). What stays true between sessions (checks, picking PRs, per-session ports, benchmarks, gotchas) is in `docs/agents/fork-workflow.md`; this file is state, decisions and open work.

## Where things stand

- `main` is pushed and CI green. It is upstream `96608e0` (v5.3.3) plus picked upstream PRs and fork fixes: `git log --oneline 96608e0..main` is the history, each pick citing `dietrichgebert/ponytail#<n>`.
- All upstream batches in the plan are integrated: band fixes, privacy, Windows, per-session levels, test-run counting, uninstall and config, codebase map, hosts, ledger, rules and skills, and (2026-11-18) band features and Pi: #1378 #1385 #1364 #1372 #1382 #1349 #1357 #1426 #1427 #1425, and the hand ports of #1404 (fork #4: the start-up definitions grep no longer holds `session.start`) and #1338 (fork #5: a level pick in the band applies with the next prompt).
- Per-session levels checked live on 2026-11-18 (fork #6): on Claude Code 2.1.327, concurrent sessions, `/compact` and `--resume` keep each session's level, and `--fork-session` leaks (#15). On pi, sessions keep their own level across resume.
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

- #1364 runs `node --version` on each turn while the level flag file is missing, to tell "off" from "no node"; accepted, the flag is missing only before ponytail's first write.
- #1404's port: a shown turn awaits the start-up definitions search even when it has no tool calls to count; accepted, a turn does not hold the engine's `initialize` reply.
- #1338's port: the band still reads the shared level flag, so after another session's switch a pick of that level counts as taking the pick back (the `readLevel` shortcut). A pick is also dropped by any typed `/ponytail …` prompt, `/ponytail band` included, as upstream does.
- `package-lock.json` stays though it locks nothing: no dependencies, CI never runs `npm ci`, and it is an upstream file.

- The band split is dropped (2026-11-18). On Claude Code 2.1.327, a mod that hooks `tool.call`, the v5.3.3 band included, starts with Code Mode on, and the hook fires for every call made inside a Code Mode script (probe: a logging mod plus one Haiku prompt). So Code Mode no longer argues for the split, and you're the only user. Upstream #1433's premise is out of date from 2.1.327 on.

## Open work, in priority order

1. **Level leak on `--fork-session`** (fork issue #15, `needs-triage`): a forked Claude Code session gets no level file of its own and follows the repo's last switch. Found in the live check below; reproduction in the issue.
2. **Unverified hosts** (fork issue #16): OpenCode V1 (does `experimental.chat.system.transform` get a `sessionID`? If not, V1 falls back to the shared file) and Codex. The owner can't test these, so they stay unverified.
3. **Benchmark task** for owner-anchored fixes: fork issue #1. Validating it needs paid `claude -p` runs: ask first.

## Suggested skills

- `mattpocock-skills:triage` if you mirror upstream issues into the fork's tracker.
