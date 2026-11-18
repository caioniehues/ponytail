//! The user's ponytail config (ponytail-config.js): the default level, from PONYTAIL_DEFAULT_MODE or config.json.

use std::fs;
use std::io::ErrorKind;
use std::path::PathBuf;

use serde_json::{Map, Value};

use crate::level::Level;
use crate::{js, state};

/// `getDefaultMode`: PONYTAIL_DEFAULT_MODE, then config.json's defaultMode, then full. Review is never a default (#377).
pub fn default_level() -> Level {
    Level::from_name(&js::env("PONYTAIL_DEFAULT_MODE"))
        .or_else(|| {
            let config = parse(&fs::read(path()).ok()?).ok()?;
            Level::from_name(config.get("defaultMode")?.as_str()?)
        })
        .unwrap_or(Level::DEFAULT)
}

/// `writeDefaultMode`: sets defaultMode in config.json and keeps its other keys. Err holds why the file was left alone:
/// only a missing file starts empty, since anything else would overwrite the user's other keys.
// shortcut: an fs or JSON error reads as Rust words it (`Not a directory (os error 20)`, `trailing comma at line 3 column
// 1`), not as node or V8 do (the broken-config case is in SKIP in rust/cases/record.js); numbers are written as serde_json
// writes them (`1.0` stays `1.0`, JSON.stringify writes `1`), keys that look like integers keep their place (JS puts
// them first), and a lone-surrogate escape JSON.parse takes makes the file unreadable here (no default read, none saved);
// match node if a user's config has one.
pub fn write_default(level: Level) -> Result<(), String> {
    let path = path();
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let mut config = match fs::read(&path) {
        Ok(bytes) => parse(&bytes).map_err(|e| e.to_string())?,
        Err(e) if e.kind() == ErrorKind::NotFound => Value::Object(Map::new()),
        Err(e) => return Err(e.to_string()),
    };
    let Value::Object(map) = &mut config else {
        // path.join's form of the path, as the JS message names it.
        return Err(format!(
            "{} must contain a JSON object",
            js::normalize(&path.to_string_lossy())
        ));
    };
    map.insert("defaultMode".to_owned(), Value::from(level.to_string()));
    let text = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(&path, text).map_err(|e| e.to_string())
}

/// `getConfigPath` off Windows, where the binary never runs: $XDG_CONFIG_HOME/ponytail, else ~/.config/ponytail.
fn path() -> PathBuf {
    let xdg = js::env("XDG_CONFIG_HOME");
    let dir = if xdg.is_empty() {
        state::home().join(".config")
    } else {
        PathBuf::from(xdg)
    };
    dir.join("ponytail").join("config.json")
}

/// The file as `readFileSync(path, 'utf8')` and JSON.parse read it, without a leading BOM.
fn parse(bytes: &[u8]) -> serde_json::Result<Value> {
    let text = String::from_utf8_lossy(bytes);
    serde_json::from_str(text.strip_prefix('\u{FEFF}').unwrap_or(&text))
}
