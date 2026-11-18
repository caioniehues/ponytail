//! The hook process's edges (ponytail-runtime.js): the host's JSON on stdin and Claude Code's output on stdout.

use std::io::{self, Read, Write};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use serde_json::Value;

/// How long a hook waits for a stdin that never ends before it goes on with what arrived (#443, #790).
const STDIN_WAIT: Duration = Duration::from_millis(1000);

/// The JSON Claude Code passes on stdin, without a leading BOM; `Value::Null` for none or an unparseable one.
// shortcut: serde_json refuses a lone-surrogate escape, nesting past 128 and numbers past f64, which JSON.parse takes, so
// such a payload loses its session id; parse leniently if a host ever sends one.
pub fn read_payload() -> Value {
    let text = read_stdin();
    let text = text.strip_prefix('\u{FEFF}').unwrap_or(&text);
    serde_json::from_str(text).unwrap_or(Value::Null)
}

/// Stdin until it ends, fails or STDIN_WAIT passes. The reader thread a stuck stdin holds dies with the process.
fn read_stdin() -> String {
    let (sender, chunks) = mpsc::channel::<Vec<u8>>();
    thread::spawn(move || {
        let mut stdin = io::stdin().lock();
        let mut buf = [0u8; 8192];
        loop {
            match stdin.read(&mut buf) {
                Ok(0) => break,
                Ok(n) if sender.send(buf[..n].to_vec()).is_ok() => {}
                Err(e) if e.kind() == io::ErrorKind::Interrupted => {}
                _ => break,
            }
        }
    });
    let deadline = Instant::now() + STDIN_WAIT;
    let mut bytes = Vec::new();
    while let Some(left) = deadline.checked_duration_since(Instant::now()) {
        match chunks.recv_timeout(left) {
            Ok(chunk) => bytes.extend(chunk),
            Err(_) => break,
        }
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

/// Hidden context for a SubagentStart (or SessionStart) hook as Claude Code takes it: hookSpecificOutput JSON, and
/// nothing at all when there is no context (#1421).
pub fn write_context(event: &str, context: &str) {
    if context.is_empty() {
        return;
    }
    let json = format!(
        r#"{{"hookSpecificOutput":{{"hookEventName":{},"additionalContext":{}}}}}"#,
        Value::from(event),
        Value::from(context)
    );
    write(&json);
}

/// Text on stdout as it is: what Claude Code adds to a UserPromptSubmit prompt as context.
pub fn write(text: &str) {
    let mut stdout = io::stdout().lock();
    // A stdout closed at hook exit is not a hook failure.
    let _ = stdout
        .write_all(text.as_bytes())
        .and_then(|()| stdout.flush());
}
