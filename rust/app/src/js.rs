//! JavaScript semantics the hooks rely on, so the Rust reads values the way the JS reference does.

use std::env;

use regex::{Regex, RegexBuilder};
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

/// `Number(text)` for a string: JS-trimmed, empty is 0, `0x`/`0o`/`0b` integers without a sign, `Infinity` with
/// one, and decimals (`5.`, `.5`, exponents) as Rust parses them; NaN for anything else.
pub fn to_number(text: &str) -> f64 {
    let text = trim(text);
    if text.is_empty() {
        return 0.0;
    }
    for (prefix, radix) in [
        ("0x", 16),
        ("0X", 16),
        ("0o", 8),
        ("0O", 8),
        ("0b", 2),
        ("0B", 2),
    ] {
        if let Some(digits) = text.strip_prefix(prefix) {
            if digits.is_empty() {
                return f64::NAN;
            }
            return digits
                .chars()
                .try_fold(0.0, |n, c| {
                    c.to_digit(radix)
                        .map(|d| n * f64::from(radix) + f64::from(d))
                })
                .unwrap_or(f64::NAN);
        }
    }
    let unsigned = text.strip_prefix(['+', '-']).unwrap_or(text);
    if unsigned == "Infinity" {
        return if text.starts_with('-') {
            f64::NEG_INFINITY
        } else {
            f64::INFINITY
        };
    }
    // Rust's grammar is JS's StrDecimalLiteral plus inf, infinity and nan in any case, which JS reads as NaN.
    if unsigned.starts_with(|c: char| c.is_ascii_alphabetic()) {
        return f64::NAN;
    }
    text.parse().unwrap_or(f64::NAN)
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

/// A JS regex literal's source (no u flag) in the regex crate's syntax: `\s` is JS whitespace, `\w` is ASCII, and a
/// `[` inside a class is a literal. Flags: `m` and `i`.
pub fn regex(source: &str, flags: &str) -> Regex {
    let space = SPACE;
    let mut out = String::new();
    let mut in_class = false;
    let mut chars = source.chars();
    while let Some(c) = chars.next() {
        match c {
            '\\' => match chars.next() {
                Some('s') if in_class => out.push_str(&space[1..space.len() - 1]),
                Some('s') => out.push_str(space),
                Some('w') if in_class => out.push_str("0-9A-Za-z_"),
                Some('w') => out.push_str("[0-9A-Za-z_]"),
                Some(escaped) => {
                    out.push('\\');
                    out.push(escaped);
                }
                None => out.push('\\'),
            },
            '[' if in_class => out.push_str(r"\["),
            '[' => {
                in_class = true;
                out.push('[');
            }
            ']' if in_class => {
                in_class = false;
                out.push(']');
            }
            _ => out.push(c),
        }
    }
    RegexBuilder::new(&out)
        .multi_line(flags.contains('m'))
        .case_insensitive(flags.contains('i'))
        .build()
        // INFALLIBLE: callers pass fixed patterns, which the replayed cases compile.
        .unwrap_or_else(|e| panic!("pattern {source:?} does not compile: {e}"))
}
