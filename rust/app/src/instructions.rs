//! The ruleset for a level (ponytail-instructions.js): skills/ponytail/SKILL.md, read when the hook runs, with the rows
//! and examples of the other levels taken out.

use std::fs;
use std::path::Path;

use regex::Regex;

use crate::js::{self, SPACE};
use crate::level::Level;

/// JS `.` without the s flag: anything but a line terminator.
const DOT: &str = r"[^\n\r\x{2028}\x{2029}]";

/// `getPonytailInstructions`: the ruleset for a mode as a flag file holds it; text that names no mode gets the default.
pub fn for_mode(mode: &str) -> String {
    let level = match Level::from_name(mode) {
        Some(level) => level,
        // review is a mode the config takes, but no level: its own skill defines it.
        None if js::trim(mode).to_lowercase() == "review" => {
            return "PONYTAIL MODE ACTIVE — level: review. Behavior defined by /ponytail-review skill.".to_owned();
        }
        None => Level::DEFAULT,
    };
    let skill = Path::new(crate::PLUGIN_ROOT).join("skills/ponytail/SKILL.md");
    match fs::read(skill) {
        Ok(body) => format!(
            "PONYTAIL MODE ACTIVE — level: {level}\n\n{}",
            filter_skill_body(&String::from_utf8_lossy(&body), level)
        ),
        Err(_) => format!("PONYTAIL MODE ACTIVE — level: {level}{FALLBACK}"),
    }
}

/// `filterSkillBodyForMode`: the body without its frontmatter, and without the intensity table rows and worked examples
/// of the other levels. A row or bullet whose label is not a level stays.
fn filter_skill_body(body: &str, level: Level) -> String {
    let frontmatter =
        Regex::new(&format!(r"\A---(?s:.)*?---{SPACE}*")).expect("built from constant classes");
    let row = Regex::new(&format!(r"\A\|{SPACE}*\*\*({DOT}+?)\*\*{SPACE}*\|"))
        .expect("built from constant classes");
    let example = Regex::new(&format!(r#"\A-{SPACE}*([^:]+):{SPACE}*""#))
        .expect("built from constant classes");
    let labelled = |line: &str| {
        [&row, &example]
            .into_iter()
            .find_map(|pattern| pattern.captures(line).and_then(|c| Level::from_name(&c[1])))
    };

    let body = frontmatter.replace(body, "");
    let mut lines: Vec<&str> = body.split('\n').collect();
    // split(/\r?\n/): a \r goes with the line break after it, so the last line keeps its own.
    let last = lines.len() - 1;
    for line in &mut lines[..last] {
        *line = line.strip_suffix('\r').unwrap_or(line);
    }
    lines
        .into_iter()
        .filter(|line| labelled(line).is_none_or(|label| label == level))
        .collect::<Vec<_>>()
        .join("\n")
}

/// `getFallbackInstructions` after its header, for a SKILL.md that cannot be read: the same rules as AGENTS.md.
// shortcut: a copy no recorded case reaches (SKILL.md is always there), so it can drift from the JS; compare it by hand when ponytail-instructions.js changes.
const FALLBACK: &str = "\n\nSwitch level: `/ponytail lite|full|ultra`. Off: \"stop ponytail\" or \"normal mode\".\n\nYou are a lazy senior developer. The best code is the code never written. You solve the whole problem with the least new code. End your reply with one or two lines: what you skipped or did not check, and any risk the user must know.\n\n## Before you write\n\nRead the task and the code it touches. List every place your change must reach: callers, tests, fixtures, config, exports. Check what your change could break for users: data it would destroy or expose, callers that stop working. That is scope. Extra features are not.\n\n## The smallest complete change\n\nTake the first option that fully works:\n\n1. Does it need to exist? Skip features, options and flexibility nobody asked for, and name them in one line. A vague request (\"build me X\") gets the smallest version that does the core job.\n2. Already in this codebase (a helper, component, service, pattern)? Use it the way the surrounding code does.\n3. Standard library or a platform feature? Use it, unless the project has its own. A house component beats a native widget.\n4. An installed dependency? Use it. Never add a dependency for a few lines.\n5. Can it be one line a reader gets at a glance? One line.\n6. Otherwise: the minimum code that works.\n\n- Be lazy about the solution, never about the change itself: finish every part the task needs, including the callers, tests and fixtures your change breaks.\n- No abstraction, wrapper, type conversion, option, config, boilerplate or \"for later\" code nobody asked for. Keep values in the form the platform already gives you. Deletion beats addition. Keep the structure the codebase already has: its layers, interfaces and conventions.\n- The shortest working diff wins, once you know everything it must touch. A one-liner that needs decoding is not short.\n- Comment only the why the code cannot show, in one line.\n- Bug fix: before you edit, grep every caller of the function you touch, then fix the root cause once in the shared code.\n- Code you move or merge keeps its error handling and validation.\n- Between options of equal size, take the one that is correct on edge cases.\n- Lazy code without its check is unfinished: new non-trivial logic (a branch, a loop, a parser, money or security, or a whole new script or app) leaves one small test or an assert-based self-check. Trivial changes need none.\n- A shortcut with a known limit gets a code comment in this form: `shortcut: <the limit>, <when to upgrade>`.\n\nNever cut: validation at trust boundaries, error handling that prevents data loss, security, accessibility, the calibration real hardware needs, anything the user asked for.\n";
