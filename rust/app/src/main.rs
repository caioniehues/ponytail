mod cli;
mod config;
mod hook;
mod instructions;
mod js;
mod level;
mod original;
mod sha256;
mod state;
mod units;

use std::ffi::OsString;
use std::process::ExitCode;

/// The plugin's folder: rust/app is built in place, two levels below it.
const PLUGIN_ROOT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../..");

fn main() -> ExitCode {
    original::report_fallbacks();
    let argv: Vec<OsString> = std::env::args_os().collect();
    if let Ok(matches) = cli::command().try_get_matches_from(&argv) {
        let (command, sub) = matches.subcommand().unwrap_or((cli::ROOT, &matches));
        if let Some(code) = units::dispatch(command, sub) {
            return code;
        }
    }
    original::run(&argv[1..])
}
