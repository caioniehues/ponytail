//! The level: how hard ponytail pushes for the simplest solution (GLOSSARY). Outside names keep "mode".

use std::fmt;

use crate::js;

/// Off, lite, full or ultra. `review` is a mode the config accepts, never a level.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Level {
    Off,
    Lite,
    Full,
    Ultra,
}

impl Level {
    /// The level when nothing names one (`DEFAULT_MODE` in ponytail-config.js).
    pub const DEFAULT: Level = Level::Full;

    /// `normalizeMode`: a level's name in any case, with JS whitespace around it.
    pub fn from_name(name: &str) -> Option<Level> {
        match js::trim(name).to_lowercase().as_str() {
            "off" => Some(Level::Off),
            "lite" => Some(Level::Lite),
            "full" => Some(Level::Full),
            "ultra" => Some(Level::Ultra),
            _ => None,
        }
    }
}

impl fmt::Display for Level {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Level::Off => "off",
            Level::Lite => "lite",
            Level::Full => "full",
            Level::Ultra => "ultra",
        })
    }
}
