//! Where Claude Code's live level is kept (ponytail-runtime.js): a file per session, one per project and the shared
//! flag the statusline and the band read, all in the Claude config dir.

use std::env;
use std::fs;
use std::path::PathBuf;

use crate::{js, sha256};

/// The files that hold one hook's level, from the session and the project Claude Code names.
#[derive(Debug)]
pub struct LevelFiles {
    session: Option<PathBuf>,
    project: Option<PathBuf>,
    shared: PathBuf,
}

impl LevelFiles {
    /// `bindSession` and the paths ponytail-runtime.js builds: an id or project dir that is blank names no file.
    pub fn new(session_id: Option<&str>) -> LevelFiles {
        let dir = claude_dir();
        let session = session_id
            .map(js::trim)
            .filter(|id| !id.is_empty())
            .map(|id| {
                dir.join("ponytail-sessions")
                    .join(sha256::hex(id.as_bytes()))
            });
        let project_dir = js::env("CLAUDE_PROJECT_DIR");
        let project_dir = js::trim(&project_dir);
        let project = (!project_dir.is_empty()).then(|| {
            dir.join("ponytail-modes")
                .join(sha256::hex(js::normalize(project_dir).as_bytes()))
        });
        LevelFiles {
            session,
            project,
            shared: dir.join(".ponytail-active"),
        }
    }

    /// `readMode`: the session's file, then the project's (or the shared flag when there is no project). The first file
    /// that reads answers, even with only whitespace in it, and its text is not checked to be a level.
    pub fn read_mode(&self) -> Option<String> {
        let fallback = self.project.as_ref().unwrap_or(&self.shared);
        for file in self.session.iter().chain([fallback]) {
            if let Ok(bytes) = fs::read(file) {
                let text = String::from_utf8_lossy(&bytes);
                let mode = js::trim(&text);
                return (!mode.is_empty()).then(|| mode.to_owned());
            }
        }
        None
    }
}

/// `getClaudeDir`: CLAUDE_CONFIG_DIR, as Claude Code reads it, else ~/.claude.
fn claude_dir() -> PathBuf {
    match js::env("CLAUDE_CONFIG_DIR") {
        dir if !dir.is_empty() => PathBuf::from(dir),
        _ => home().join(".claude"),
    }
}

/// `os.homedir()`: HOME as it is set, even empty, else the user's entry in the password database.
fn home() -> PathBuf {
    env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(env::home_dir)
        .unwrap_or_default()
}
