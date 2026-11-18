//! `ponytail hook subagent-start` (hooks/ponytail-subagent.js): each subagent gets the ruleset while ponytail is on,
//! since SessionStart context never reaches subagents (#252).

use std::process::ExitCode;

use regex::bytes::{Regex, RegexBuilder};
use serde_json::Value;

use crate::state::LevelFiles;
use crate::{hook, instructions, js};

/// Reads the payload, then writes the ruleset for the session's level unless ponytail is off or the matcher scopes it out.
pub fn run() -> ExitCode {
    let payload = hook::read_payload();
    let files = LevelFiles::new(payload.get("session_id").and_then(Value::as_str));
    let Some(mode) = files.read_mode() else {
        return ExitCode::SUCCESS;
    };
    // The raw text, as the JS compares it: "OFF" is not off here, and gets the off ruleset.
    if mode == "off" {
        return ExitCode::SUCCESS;
    }
    if let Some(matcher) = matcher() {
        // String(data.agent_type || ''): a missing agent type injects, so scoping never drops the ruleset silently.
        let agent = payload
            .get("agent_type")
            .filter(|value| js::truthy(value))
            .map(js::string)
            .unwrap_or_default();
        let agent = js::trim(&agent);
        if !agent.is_empty() && !matcher.is_match(agent.as_bytes()) {
            return ExitCode::SUCCESS;
        }
    }
    hook::write_context("SubagentStart", &instructions::for_mode(&mode));
    ExitCode::SUCCESS
}

/// PONYTAIL_SUBAGENT_MATCHER as `new RegExp(pattern, 'i')`: unanchored and case-insensitive, with ASCII `\w`, `\d` and
/// `\b` and no case folding across ASCII (no Kelvin sign for k), as a JS regex without the u flag. None, so every
/// subagent gets the ruleset, when it is unset or the regex crate rejects it.
// shortcut: the regex crate is not JS: lookaround, backreferences and non-ASCII literals are rejected (inject everywhere),
// syntax only it knows such as (?x) is accepted, \s is ASCII and . is one byte (fork-workflow.md lists them); emulate JS
// syntax if a real matcher hits one.
fn matcher() -> Option<Regex> {
    let pattern = js::env("PONYTAIL_SUBAGENT_MATCHER");
    if pattern.is_empty() {
        return None;
    }
    RegexBuilder::new(&pattern)
        .case_insensitive(true)
        .unicode(false)
        .crlf(true)
        .build()
        .ok()
}
