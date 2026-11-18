# The JS hooks stay the reference for the Rust port

The three hooks Claude Code runs (`session-start`, `subagent-start`, `prompt-submit`) and the codebase map Pi runs get a Rust port as one `ponytail` binary under `rust/`, but the JS hooks stay in the repo as the reference: upstream picks keep landing in them, and the binary is replayed against them (same stdin, environment and files in; the same stdout as parsed JSON, exit code and files out, byte for byte). The port is for the fork's own use, for its own sake and as a base for features the band could call later, not for speed: node costs about 20 ms per prompt and 60 ms per session start (hyperfine, 2026-11-18), which no one notices next to a model reply.

## Considered Options

- **Hand-port every upstream change to the hooks into Rust**: the fork's picks land mostly in `ponytail-runtime.js` and `ponytail-mode-tracker.js`, so every pick there would turn into a port.
- **Freeze upstream for the hooks**: cuts the fork off from the fixes it exists to collect.

## Consequences

- `hooks/claude-codex-hooks.json` runs the binary when it is built and no other host's marker is set, and node otherwise: Codex and VS Code Copilot read the same file and keep the JS, so the binary only needs Claude Code's output. Pi's map loader makes the same choice. `cargo clean` goes back to JS.
- Drift is reported, not blocking: `npm run check:rust` replays the cases outside `npm run check`, and `scripts/pick-upstream.sh` warns when a pick touches a ported hook. CI does not build the Rust: the check runs locally. Until the Rust catches up, the binary runs the older behaviour.
- A change to hook behaviour goes into JS first, then Rust.
