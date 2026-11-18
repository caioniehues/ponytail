# Ponytail

Ponytail is a ruleset and plugin that makes coding agents take the simplest solution that works. On Claude Code it also shows what each task cost and changed.

## Language

**Band**:
Ponytail's row in the area above the prompt: the level switch, the buttons, and the task's cost, tokens and agent time.
_Avoid_: status bar, the mod, the whole band plugin

**Area above the prompt**:
The space above Claude Code's prompt that every plugin draws its row into. The band is one row in it.
_Avoid_: the band (when meaning the shared area)

**Level**:
How hard ponytail pushes for the simplest solution: off, lite, full or ultra. One per session.
_Avoid_: mode, intensity

**Task**:
One Claude Code session, as the ledger records it.
_Avoid_: session (when meaning the ledger's row), job

**Ledger**:
The record of tasks for one project, one row per task.
_Avoid_: log, history, CSV

**Board**:
The page that compares a project's tasks, built from its ledger.
_Avoid_: dashboard, report

**Reference**:
The JS hooks and map, as the Rust port must behave: `rust/reference.js` runs them by subcommand, and the recorded cases come from it.
_Avoid_: original (rust-anything's word), legacy

**Front door**:
The `ponytail` binary in `rust/app`: it takes every subcommand and runs the Rust for the ported ones and the reference for the rest.
_Avoid_: wrapper, shim
