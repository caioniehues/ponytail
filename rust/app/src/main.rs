mod config;
mod hook;
mod instructions;
mod js;
mod level;
mod sha256;
mod state;
mod units;

use std::process::ExitCode;

/// The plugin's folder: rust/app is built in place, two levels below it.
const PLUGIN_ROOT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../..");

/// Reads argv as rust/reference.js does: the command, then its one argument; the rest is ignored.
fn main() -> ExitCode {
    let mut args = std::env::args_os().skip(1);
    let (command, arg) = (args.next(), args.next());
    units::dispatch(command.as_deref(), arg.as_deref())
}
