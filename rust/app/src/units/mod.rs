//! The subcommands: the three Claude Code hooks and the map; any other argv gets the usage line.

mod map;
mod prompt_submit;
mod session_start;
mod subagent_start;

use std::ffi::OsStr;
use std::io::{self, Write};
use std::process::ExitCode;

/// Runs the subcommand argv names and returns its exit code. A `--` is an argument like any other, as in the reference.
pub fn dispatch(command: Option<&OsStr>, arg: Option<&OsStr>) -> ExitCode {
    match (command.and_then(OsStr::to_str), arg.and_then(OsStr::to_str)) {
        (Some("hook"), Some("subagent-start")) => subagent_start::run(),
        (Some("hook"), Some("prompt-submit")) => prompt_submit::run(),
        (Some("hook"), Some("session-start")) => session_start::run(),
        (Some("map"), _) => map::run(arg),
        _ => usage(),
    }
}

/// What rust/reference.js answers argv it does not take: the usage line on stderr, exit 2.
pub fn usage() -> ExitCode {
    let _ = writeln!(
        io::stderr(),
        "usage: ponytail hook session-start|subagent-start|prompt-submit | ponytail map [root]"
    );
    ExitCode::from(2)
}
