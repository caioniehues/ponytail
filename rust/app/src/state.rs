//! Where Claude Code's live level is kept (ponytail-runtime.js): a file per session, one per project and the shared
//! flag the statusline and the band read, all in the Claude config dir.

use std::env;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

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

    /// `setMode`: the session's file, the project's and the shared flag, which the statusline and the band read. The
    /// text is written as it is: a resumed session writes back whatever its file held.
    pub fn set_mode(&self, mode: &str) -> io::Result<()> {
        for file in self
            .session
            .iter()
            .chain(&self.project)
            .chain([&self.shared])
        {
            write_file(file, mode)?;
        }
        Ok(())
    }

    /// `clearMode`: the session records off, so a stopped session is told from one with no file yet; the project
    /// file and the shared flag go.
    pub fn clear_mode(&self) -> io::Result<()> {
        if let Some(file) = &self.session {
            write_file(file, "off")?;
        }
        for file in self.project.iter().chain([&self.shared]) {
            let _ = fs::remove_file(file);
        }
        Ok(())
    }
}

/// `fs.mkdirSync(path.dirname(file), { recursive: true })`, then `fs.writeFileSync(file, text)`.
pub fn write_file(file: &Path, text: &str) -> io::Result<()> {
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir)?;
    }
    fs::write(file, text)
}

/// How long a session file nobody writes is kept (SESSION_MAX_AGE_MS in ponytail-prune.js).
const SESSION_MAX_AGE: Duration = Duration::from_secs(30 * 24 * 3600);

/// `pruneSessions`: a fresh start drops the session files nothing has written for 30 days, since nothing else deletes
/// them. A missing folder is nothing to do.
pub fn prune_sessions() {
    prune_stale(&claude_dir().join("ponytail-sessions"));
}

/// `pruneStale`: drops the files in `dir` that nothing has written for SESSION_MAX_AGE.
fn prune_stale(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let Some(cutoff) = SystemTime::now().checked_sub(SESSION_MAX_AGE) else {
        return;
    };
    for entry in entries.flatten() {
        let file = entry.path();
        // statSync follows a symlink; unlinking a folder fails, as in JS.
        if fs::metadata(&file)
            .and_then(|meta| meta.modified())
            .is_ok_and(|modified| modified < cutoff)
        {
            let _ = fs::remove_file(&file);
        }
    }
}

/// `getClaudeDir` as the JS string the session-start messages name: CLAUDE_CONFIG_DIR as set, as Claude Code reads it,
/// else path.join(os.homedir(), '.claude').
pub fn claude_dir_name() -> String {
    match js::env("CLAUDE_CONFIG_DIR") {
        dir if !dir.is_empty() => dir,
        _ => js::join(&[&home().to_string_lossy(), ".claude"]),
    }
}

/// [`claude_dir_name`] as a path.
pub fn claude_dir() -> PathBuf {
    PathBuf::from(claude_dir_name())
}

/// `os.homedir()`: HOME as it is set, even empty, else the user's entry in the password database.
pub fn home() -> PathBuf {
    env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(env::home_dir)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;

    #[test]
    fn prune_drops_only_files_idle_past_the_max_age() {
        let dir = env::temp_dir().join(format!("ponytail-prune-{}", std::process::id()));
        fs::create_dir_all(&dir).expect("temp dir");
        let (old, recent) = (dir.join("old"), dir.join("recent"));
        fs::write(&old, "ultra").expect("old file");
        fs::write(&recent, "lite").expect("recent file");
        let forty_days_ago = SystemTime::now() - Duration::from_secs(40 * 24 * 3600);
        File::options()
            .write(true)
            .open(&old)
            .and_then(|f| f.set_modified(forty_days_ago))
            .expect("old mtime");
        prune_stale(&dir);
        let left = (old.exists(), recent.exists());
        let _ = fs::remove_dir_all(&dir);
        assert_eq!(left, (false, true), "old and recent file kept");
        prune_stale(&dir.join("missing"));
    }
}
