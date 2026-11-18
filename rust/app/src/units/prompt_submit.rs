//! `ponytail hook prompt-submit` (hooks/ponytail-mode-tracker.js): a level command typed in the prompt, or a level
//! picked in the band, switches the session's level; what it prints, Claude Code adds to the prompt as context.

use std::fs;
use std::path::Path;
use std::process::{Command, ExitCode, Stdio};

use serde_json::Value;

use crate::level::Level;
use crate::state::{self, LevelFiles};
use crate::{config, hook, instructions, js};

/// The level came from the band, not from the prompt: the model answers the prompt, not the switch.
const BAND_NOTE: &str = " (picked in the band; answer the user's message as usual)";

/// Reads the payload and answers it. Whatever makes the JS throw prints nothing, and the hook still exits 0.
pub fn run() -> ExitCode {
    if let Some(context) = respond(&hook::read_payload()) {
        hook::write(&context);
    }
    ExitCode::SUCCESS
}

/// The context for one prompt, after the level files it switches are written; None where the JS prints nothing.
fn respond(payload: &Value) -> Option<String> {
    // data.session_id throws on a payload of null, or one that did not parse.
    if payload.is_null() {
        return None;
    }
    let session_id = payload.get("session_id");
    let files = LevelFiles::new(session_id.and_then(Value::as_str));
    // (data.prompt || '').trim() throws on a prompt that is truthy and not a string.
    let mut prompt = match payload.get("prompt") {
        Some(Value::String(text)) => js::trim(text).to_lowercase(),
        Some(value) if js::truthy(value) => return None,
        _ => String::new(),
    };

    // A pick applies with this prompt as if the user had typed it, unless the prompt switches the level itself.
    let pending = take_pending(session_id).ok()?;
    let mut from_band = false;
    if let Some(level) = pending.filter(|_| !names_ponytail(&prompt) && !is_deactivation(&prompt)) {
        prompt = format!("/ponytail {level}");
        from_band = true;
    }
    let note = if from_band { BAND_NOTE } else { "" };

    if after_ponytail(&prompt).is_none() {
        if !is_deactivation(&prompt) {
            return None;
        }
        files.clear_mode().ok()?;
        return Some("PONYTAIL MODE OFF".to_owned());
    }
    let parts: Vec<&str> = prompt
        .split(js::is_space)
        .filter(|part| !part.is_empty())
        .collect();
    // /ponytail-review and the like are skills, not a session level (#736). The prefix is one ASCII byte.
    if !matches!(&parts[0][1..], "ponytail" | "ponytail:ponytail") {
        return None;
    }
    let level = match parts.get(1).copied().unwrap_or("") {
        "default" => return set_default(parts.get(2).copied()),
        "band" => return band(parts.get(2).copied()),
        "" => match files.read_mode().filter(|live| live != "off") {
            // Already on: keep the level, report it (#639).
            Some(live) => return Some(format!("PONYTAIL MODE ACTIVE — level: {live}")),
            None => match config::default_level() {
                Level::Off => Level::Full,
                level => level,
            },
        },
        arg => Level::from_name(arg)?,
    };
    if level == Level::Off {
        files.clear_mode().ok()?;
        return Some(format!("PONYTAIL MODE OFF{note}"));
    }
    files.set_mode(level).ok()?;
    let header = format!("PONYTAIL MODE CHANGED — level: {level}{note}");
    // A pick in the band loads no skill body, so the new level's ruleset comes with it.
    Some(if from_band {
        format!("{header}\n\n{}", instructions::for_mode(&level.to_string()))
    } else {
        header
    })
}

/// `takePendingMode`: the level picked in the band for this session, read once (the file goes); none for a pick taken
/// back. The file is named by the raw id, so an id that could leave the folder is refused. Err where the JS throws: an
/// id that is not a string, but whose String() passes the check, reaches path.join.
fn take_pending(session_id: Option<&Value>) -> Result<Option<Level>, ()> {
    let Some(id) = session_id.filter(|id| js::truthy(id)) else {
        return Ok(None);
    };
    let name = js::string(id);
    if name.is_empty()
        || !name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Ok(None);
    }
    if !id.is_string() {
        return Err(());
    }
    let file = state::claude_dir().join("ponytail-pending").join(&name);
    let Ok(bytes) = fs::read(&file) else {
        return Ok(None);
    };
    let _ = fs::remove_file(&file);
    Ok(Level::from_name(&String::from_utf8_lossy(&bytes)))
}

/// `/^[/@$]ponytail/`: the prompt after its `/ponytail`, `@ponytail` or `$ponytail`.
fn after_ponytail(prompt: &str) -> Option<&str> {
    prompt.strip_prefix(['/', '@', '$'])?.strip_prefix("ponytail")
}

/// `/^[/@$]ponytail(:ponytail)?(\s|$)/`: the prompt is a level command, so it wins over a pick in the band.
fn names_ponytail(prompt: &str) -> bool {
    let Some(rest) = after_ponytail(prompt) else {
        return false;
    };
    let rest = rest.strip_prefix(":ponytail").unwrap_or(rest);
    rest.chars().next().is_none_or(js::is_space)
}

/// `isDeactivationCommand` for a prompt already trimmed and lowercased: "stop ponytail" or "normal mode" as the whole
/// message, before trailing punctuation. Anywhere else in a message they are ordinary words ("add a normal mode toggle").
fn is_deactivation(prompt: &str) -> bool {
    let command = prompt.trim_end_matches(|c| matches!(c, '.' | '!' | '?') || js::is_space(c));
    matches!(command, "stop ponytail" | "normal mode")
}

/// `/ponytail default <level>`: the level new sessions start in, saved to config.json. The session's level stays.
fn set_default(word: Option<&str>) -> Option<String> {
    let level = Level::from_name(word?)?;
    Some(match config::write_default(level) {
        Ok(()) => format!("PONYTAIL DEFAULT SET — new sessions start in {level}."),
        Err(why) => format!("PONYTAIL DEFAULT NOT SAVED — {why} Config left unchanged."),
    })
}

/// `/ponytail band [on|off|import]`: shows, hides or toggles the band (hooks/band reads the flag; absent = shown), or
/// starts the import of past sessions. The level is unchanged.
fn band(word: Option<&str>) -> Option<String> {
    if word == Some("import") {
        import();
        return Some("PONYTAIL BAND IMPORT: past Claude Code sessions (cost, agent time, tokens) are being added to the board in the background. Open the board in a minute. Confirm in one short line.".to_owned());
    }
    let flag = state::claude_dir().join(".ponytail-band");
    let hidden =
        fs::read(&flag).is_ok_and(|bytes| js::trim(&String::from_utf8_lossy(&bytes)) == "off");
    let show = match word {
        Some("on") => true,
        Some("off") => false,
        _ => hidden,
    };
    if show {
        let _ = fs::remove_file(&flag);
        Some("PONYTAIL BAND ON: the band shows above the prompt again. The ponytail level is unchanged. Confirm in one short line.".to_owned())
    } else {
        state::write_file(&flag, "off").ok()?;
        Some("PONYTAIL BAND OFF: the band above the prompt is hidden, `/ponytail band` brings it back. The ponytail level is unchanged. Confirm in one short line.".to_owned())
    }
}

/// Starts the JS band import in its own process group, so it outlives this hook and the prompt is answered while the
/// transcripts are read. Without node on PATH there is no import, and the prompt still gets its answer.
// shortcut: node comes from PATH where the JS uses its own, and a new process group stands in for node's setsid; take
// node's path from the launcher if the import must run where node is not on PATH.
fn import() {
    let mut command = Command::new("node");
    command
        .arg(Path::new(crate::PLUGIN_ROOT).join("hooks/ponytail-band-import.js"))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(unix)]
    std::os::unix::process::CommandExt::process_group(&mut command, 0);
    // Dropping the child neither waits for it nor kills it.
    let _ = command.spawn();
}
