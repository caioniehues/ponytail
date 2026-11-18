//! JavaScript semantics the hooks rely on, so the Rust reads values the way the JS reference does.

use std::env;

use serde_json::Value;

/// JS `\s` as a regex class: the characters of [`is_space`].
pub const SPACE: &str = r"[\t\n\x0B\x0C\r \xA0\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}]";

/// `String.prototype.trim`: JS whitespace differs from Unicode `White_Space` (U+FEFF counts, U+0085 does not).
pub fn trim(text: &str) -> &str {
    text.trim_matches(is_space)
}

/// A character of JS `\s` and `trim`: WhiteSpace and LineTerminator in ECMA-262.
pub fn is_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n'
            | '\u{B}'
            | '\u{C}'
            | '\r'
            | ' '
            | '\u{A0}'
            | '\u{1680}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202F}'
            | '\u{205F}'
            | '\u{3000}'
            | '\u{FEFF}'
            | '\u{2000}'..='\u{200A}'
    )
}

/// `process.env[name]`, where unset reads as empty, and bytes that are not UTF-8 are replaced.
pub fn env(name: &str) -> String {
    env::var_os(name)
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// `Boolean(value)` for a parsed JSON value.
pub fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|f| f != 0.0),
        Value::String(s) => !s.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

/// `String(value)` for a parsed JSON value.
pub fn string(value: &Value) -> String {
    match value {
        Value::Null => "null".to_owned(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => number(n.as_f64().unwrap_or_default()),
        Value::String(s) => s.clone(),
        // Array.prototype.join writes null as nothing.
        Value::Array(items) => items
            .iter()
            .map(|item| {
                if item.is_null() {
                    String::new()
                } else {
                    string(item)
                }
            })
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(_) => "[object Object]".to_owned(),
    }
}

/// `Number.prototype.toString()`: plain digits from 1e-6 up to 1e21, an exponent with its sign outside that.
fn number(n: f64) -> String {
    if n == 0.0 {
        return "0".to_owned();
    }
    if (1e-6..1e21).contains(&n.abs()) {
        return n.to_string();
    }
    let exponent = format!("{n:e}");
    match exponent.split_once('e') {
        Some((mantissa, power)) if !power.starts_with('-') => format!("{mantissa}e+{power}"),
        _ => exponent,
    }
}

/// `path.posix.normalize`: `.` and `..` resolved, slashes collapsed, a trailing slash kept.
pub fn normalize(path: &str) -> String {
    if path.is_empty() {
        return ".".to_owned();
    }
    let absolute = path.starts_with('/');
    let mut parts: Vec<&str> = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." if parts.last().is_some_and(|last| *last != "..") => {
                parts.pop();
            }
            ".." if !absolute => parts.push(".."),
            ".." => {}
            _ => parts.push(part),
        }
    }
    let mut out = parts.join("/");
    if out.is_empty() && !absolute {
        out.push('.');
    }
    if !out.is_empty() && path.ends_with('/') {
        out.push('/');
    }
    if absolute { format!("/{out}") } else { out }
}
