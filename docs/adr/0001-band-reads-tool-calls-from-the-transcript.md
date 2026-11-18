# The band reads tool calls from the transcript, not from a tool.call hook

The band works out tests, created, removed and reused definitions by replaying the session's transcript at the end of every turn. That covers the main transcript and each subagent's file under `<session>/subagents/`, merged by timestamp, with a `Write`'s `toolUseResult.originalFile` as the text before it. It does not hook `tool.call`. The replay keeps no state between turns, so `/clear`, a reload or a resume cannot make the numbers drift, and there is one source for each number.

The hook was first removed (dietrichgebert/ponytail#1449) because it turned Code Mode off. That is no longer the reason. On Claude Code 2.1.327, a mod hooking `tool.call`, including the v5.3.3 band, starts with Code Mode on, and the hook fires for every call made inside a Code Mode script (probe of 2026-11-18). The cost that remains is the engine's: a hook that may match a tool turns off its move to the background, its live output and Code Mode's wait for a stopped result.

## Considered Options

- **`tool.call` on every tool** (the v5.3.3 hook): long `Bash` commands could no longer move to the background.
- **`tool.call` on `Edit`/`Write` only, tests from the transcript**: counts as calls happen and skips denied calls, but brings back state kept across turns and a second source for the same numbers. The transcript already holds what it would add.

## Consequences

- On the 2026-11-18 sample (46 sessions with edits or tests), the replay without the two fixes differed from the hook in 5 sessions. Overwrites added 10–18% too many created names. One session's subagent edits (68 of its 82) were missing. Tests matched in all 46. Those sessions are the test cases for the fixes.
- `tests/band-mod.test.js` keeps the guard against `tool.call`. Its reason is the background-run cost and this ADR, not Code Mode.
