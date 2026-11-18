//! `ponytail hook session-start` (hooks/ponytail-activate.js): a Claude Code session starts at its level, with the
//! ruleset, the codebase map and the statusline nudge as hidden context.

use std::fs::{self, File};
use std::io;
use std::path::Path;
use std::process::{self, ExitCode};
use std::sync::LazyLock;
use std::time::Instant;

use regex::Regex;
use serde_json::Value;

use crate::state::{self, LevelFiles};
use crate::units::map;
use crate::{config, hook, instructions, js};

/// The statusline script a statusLine command runs, quoted or bare.
static SCRIPT_REF: LazyLock<Regex> = LazyLock::new(|| {
    js::regex(
        r#""([^"]*ponytail-statusline\.(?:sh|ps1))"|(\S*ponytail-statusline\.(?:sh|ps1))"#,
        "",
    )
});

/// Starts the session at the default level on a fresh start (startup, /clear, no payload), and at the level its files
/// hold for any other source, Claude Code's later ones included; a session with none stays off.
pub fn run() -> ExitCode {
    // data.source on a payload of null throws before bindSession: a fresh start without a session.
    let payload = hook::read_payload();
    let source = payload.get("source");
    let files = LevelFiles::new(payload.get("session_id").and_then(Value::as_str));
    let fresh = source.is_none_or(|source| {
        !js::truthy(source) || matches!(source.as_str(), Some("startup" | "clear"))
    });
    // Only a fresh start prunes: a resume reads its own file, however old.
    if fresh {
        state::prune_sessions();
    }
    let mode = if fresh {
        config::default_level().to_string()
    } else {
        files.read_mode().unwrap_or_else(|| "off".to_owned())
    };
    if mode == "off" {
        // shortcut: a session file that cannot be written is ignored, where the JS dies with a stack trace and exit 1;
        // match it if a host ever reads that exit.
        let _ = files.clear_mode();
        return ExitCode::SUCCESS;
    }
    // The flag is best-effort: a session still gets its rules.
    let _ = files.set_mode(&mode);
    // Resume and fork already have the ruleset in their transcript; only remind them of the live level.
    if matches!(source.and_then(Value::as_str), Some("resume" | "fork")) {
        hook::write_context(
            "SessionStart",
            &format!("PONYTAIL MODE ACTIVE — level: {mode}"),
        );
        return ExitCode::SUCCESS;
    }
    let mut context = instructions::for_mode(&mode);
    if mode != "review" && js::env("PONYTAIL_MAP") != "0" {
        // shortcut: the map runs in-process with the 2 s the JS map gives itself, but without activate's 3 s kill, so a
        // git ls-files that takes its own 3 s can hold the start past 3 s where the JS drops the map; add a kill if it shows up.
        let until = Instant::now() + map::DEADLINE;
        if let Some(text) = map::build(Path::new("."), until) {
            let text = text.trim_end_matches(js::is_space);
            if !text.is_empty() {
                context.push_str("\n\n");
                context.push_str(text);
            }
        }
    }
    if let Some(nudge) = statusline(&state::claude_dir_name()) {
        context.push_str(&nudge);
    }
    hook::write_context("SessionStart", &context);
    ExitCode::SUCCESS
}

/// The statusline nudge, once: for a statusLine that is not set up, or once per path for one whose script is gone (the
/// plugin's versioned folder was deleted on update, #1032). Refreshes the copy in the config dir, which outlives
/// updates, whenever there is one. Empty for no nudge; None where the JS throws (a settings.json JSON.parse refuses, a
/// copy that fails), which drops the nudge.
// shortcut: serde_json refuses a settings.json with a lone-surrogate escape, which JSON.parse takes, so such a file gets no
// nudge and no refreshed copy; parse leniently if a user's settings.json has one.
fn statusline(claude_dir: &str) -> Option<String> {
    // The JS's win32 branches are left out: the launcher never finds a binary on Windows (it has no .exe there).
    let settings_path = js::join(&[claude_dir, "settings.json"]);
    let mut command = None;
    if Path::new(&settings_path).exists() {
        let bytes = fs::read(&settings_path).ok()?;
        let text = String::from_utf8_lossy(&bytes);
        let settings: Value =
            serde_json::from_str(text.strip_prefix('\u{FEFF}').unwrap_or(&text)).ok()?;
        // settings.statusLine throws on null.
        if settings.is_null() {
            return None;
        }
        if let Some(line) = settings.get("statusLine").filter(|line| js::truthy(line)) {
            let value = line.get("command").filter(|value| js::truthy(value));
            command = Some(value.map(js::string).unwrap_or_default());
        }
    }

    // Only an absolute path is checked, so ~ or $HOME forms are never taken for missing files. isShellSafe keeps quotes,
    // newlines and shell metacharacters from settings.json out of the model's context.
    let script_ref = command
        .as_deref()
        .and_then(|command| SCRIPT_REF.captures(command))
        .and_then(|found| found.get(1).or_else(|| found.get(2)))
        .map(|found| found.as_str());
    let stale = script_ref
        .filter(|path| is_shell_safe(path) && path.starts_with('/') && !Path::new(path).exists());
    // A statusLine that already runs ponytail keeps its script type, so its copy stays fresh.
    let script_name = if script_ref.is_some_and(|path| path.ends_with(".ps1")) {
        "ponytail-statusline.ps1"
    } else {
        "ponytail-statusline.sh"
    };
    let script_path = js::join(&[claude_dir, script_name]);

    // The flag marks the offer as seen, and for a broken path which one.
    let flag = js::join(&[claude_dir, ".ponytail-statusline-nudged"]);
    let nudged = fs::read(&flag)
        .ok()
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned());
    let nudge = match stale {
        Some(stale) => nudged.as_deref() != Some(stale),
        None => command.is_none() && nudged.is_none(),
    };
    // Refreshed every session, so script fixes ship with plugin updates.
    if nudge || Path::new(&script_path).exists() {
        refresh(script_name, &script_path).ok()?;
    }
    if !nudge {
        return Some(String::new());
    }
    let _ = fs::write(&flag, stale.unwrap_or(""));
    let ask = "Mention this to the user once; change settings.json only if they ask for it.";
    Some(if let Some(stale) = stale {
        format!(
            "\n\nSTATUSLINE BROKEN: The statusLine in {settings_path} runs {stale}, which no longer exists (the ponytail plugin was updated and its old version removed), so the ponytail badge is blank. The fix is to point that command at {script_path}, which survives updates, quoted for the shell, keeping the rest of the command as it is. {ask}"
        )
    } else if is_shell_safe(&script_path) {
        let snippet = format!(
            r#""statusLine": {{ "type": "command", "command": {} }}"#,
            Value::from(format!(r#"bash "{script_path}""#))
        );
        format!(
            "\n\nSTATUSLINE SETUP NEEDED: The ponytail plugin includes a statusline badge showing active mode (e.g. [PONYTAIL], [PONYTAIL:ULTRA]). It is not configured yet. To enable it, the user can add this to {settings_path}: {snippet} {ask}"
        )
    } else {
        // A config dir with shell metacharacters is not put in a command: the setup is described instead.
        format!(
            "\n\nSTATUSLINE SETUP NEEDED: The ponytail plugin includes a statusline badge showing active mode. Its path contains characters unsafe to embed in a shell command, so it has to be configured manually: the user can add a statusLine command of type \"command\" that runs {script_name} from {claude_dir} to {settings_path}, with the path quoted/escaped for their shell. {ask}"
        )
    })
}

/// Copies the plugin's script to `script` through a new temp file, then renames it: the rename replaces a symlink there
/// instead of writing through it, and a concurrent session never runs half a script. The temp file never stays.
fn refresh(name: &str, script: &str) -> io::Result<()> {
    let temp = format!("{script}.{}.tmp", process::id());
    let copied = copy_new(
        &Path::new(crate::PLUGIN_ROOT).join("hooks").join(name),
        &temp,
    )
    .and_then(|()| fs::rename(&temp, script));
    let _ = fs::remove_file(&temp);
    copied
}

/// `copyFileSync(from, to, COPYFILE_EXCL)`, then `chmodSync(to, 0o644)`.
fn copy_new(from: &Path, to: &str) -> io::Result<()> {
    let mut source = File::open(from)?;
    let mut target = File::create_new(to)?;
    io::copy(&mut source, &mut target)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(to, fs::Permissions::from_mode(0o644))?;
    }
    Ok(())
}

/// `isShellSafe`: only ordinary path characters, so a path can sit in a shell command without escaping.
fn is_shell_safe(path: &str) -> bool {
    !path.is_empty()
        && path
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || " _.-:/\\~".contains(c))
}
