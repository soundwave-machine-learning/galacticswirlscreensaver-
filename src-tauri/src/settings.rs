//! Settings persistence: a single small JSON file in the per-user roaming
//! config directory (%APPDATA%\com.soundwavian.field\settings.json).
//! The front end owns the schema; this side only validates that it is
//! modest-sized JSON and writes it atomically.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

const FILE_NAME: &str = "settings.json";
const MAX_BYTES: usize = 64 * 1024;

pub fn path(config_dir: &Path) -> PathBuf {
    config_dir.join(FILE_NAME)
}

pub fn load(config_dir: &Path) -> Option<String> {
    let text = fs::read_to_string(path(config_dir)).ok()?;
    if text.len() > MAX_BYTES {
        return None;
    }
    serde_json::from_str::<serde_json::Value>(&text).ok()?;
    Some(text)
}

pub fn save(config_dir: &Path, json: &str) -> Result<(), String> {
    if json.len() > MAX_BYTES {
        return Err("settings too large".into());
    }
    let value: serde_json::Value = serde_json::from_str(json).map_err(|e| e.to_string())?;
    if !value.is_object() {
        return Err("settings must be a JSON object".into());
    }
    fs::create_dir_all(config_dir).map_err(|e| e.to_string())?;
    let target = path(config_dir);
    let tmp = config_dir.join(format!("{FILE_NAME}.tmp"));
    {
        let mut f = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        f.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
        f.sync_all().ok();
    }
    fs::rename(&tmp, &target).map_err(|e| e.to_string())
}

/// Screensaver: should every monitor render the field (default) or only
/// the primary one (others are plain black)?
pub fn all_displays(config_dir: &Path) -> bool {
    load(config_dir)
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .and_then(|v| v.get("displays").and_then(|d| d.as_str()).map(|s| s != "primary"))
        .unwrap_or(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("sfield-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn roundtrip() {
        let d = tmpdir("rt");
        assert!(load(&d).is_none());
        save(&d, r#"{"preset":"orbit","displays":"primary"}"#).unwrap();
        assert!(load(&d).unwrap().contains("orbit"));
        assert!(!all_displays(&d));
        save(&d, r#"{"displays":"all"}"#).unwrap();
        assert!(all_displays(&d));
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn rejects_bad_input() {
        let d = tmpdir("bad");
        assert!(save(&d, "not json").is_err());
        assert!(save(&d, "[1,2,3]").is_err());
        assert!(save(&d, &"x".repeat(MAX_BYTES + 1)).is_err());
        assert!(all_displays(&d));
        fs::remove_dir_all(&d).ok();
    }
}
