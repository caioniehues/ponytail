//! The subcommands the Rust answers; every other one runs the reference (crate::original).

mod subagent_start;

use std::ffi::OsString;
use std::process::ExitCode;

use clap::ArgMatches;

/// Runs the subcommand argv names when it is ported and returns its exit code; None runs the reference. Arguments
/// after the first are ignored, as the reference ignores them.
pub fn dispatch(command: &str, matches: &ArgMatches) -> Option<ExitCode> {
    let first = matches
        .get_many::<OsString>("args")
        .and_then(|mut args| args.next());
    match (command, first.and_then(|arg| arg.to_str())) {
        ("hook", Some("subagent-start")) => Some(subagent_start::run()),
        _ => None,
    }
}
