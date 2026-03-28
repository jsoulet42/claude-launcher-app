use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tracing::{error, info};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConfigData {
    #[serde(rename = "$schema")]
    pub schema: Option<String>,
    pub version: Option<String>,
    pub preferences: Option<Preferences>,
    #[serde(default)]
    pub projects: HashMap<String, Project>,
    #[serde(default)]
    pub presets: HashMap<String, Preset>,
    #[serde(default)]
    pub layouts: HashMap<String, Layout>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Preferences {
    pub theme: Option<String>,
    pub default_preset: Option<String>,
    pub scan_directories: Option<Vec<String>>,
    pub auto_discover_projects: Option<bool>,
    pub daemon: Option<DaemonPrefs>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DaemonPrefs {
    pub enabled: Option<bool>,
    pub watch_interval_ms: Option<u64>,
    pub notify_on_wait: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Project {
    pub name: String,
    pub path: String,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub default_command: Option<String>,
    pub initial_command: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Preset {
    pub name: String,
    pub description: Option<String>,
    pub layout: String,
    pub panels: Vec<Panel>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Panel {
    pub project: String,
    pub command: Option<String>,
    pub initial_command: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Layout {
    pub splits: Vec<String>,
}

/// Find config.json: CWD first, then CWD parent (for Tauri dev where CWD=src-tauri/),
/// then next to executable
pub fn find_config_path() -> Result<PathBuf, String> {
    let mut searched = Vec::new();

    // Try CWD first
    let cwd = std::env::current_dir().map_err(|e| format!("Cannot get CWD: {}", e))?;
    let cwd_config = cwd.join("config.json");
    if cwd_config.exists() {
        info!("Config found at CWD: {}", cwd_config.display());
        return Ok(cwd_config);
    }
    searched.push(cwd_config.display().to_string());

    // Try CWD parent (handles `cargo tauri dev` where CWD is src-tauri/)
    if let Some(parent) = cwd.parent() {
        let parent_config = parent.join("config.json");
        if parent_config.exists() {
            info!("Config found at CWD parent: {}", parent_config.display());
            return Ok(parent_config);
        }
        searched.push(parent_config.display().to_string());
    }

    // Fallback: next to executable
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            let exe_config = exe_dir.join("config.json");
            if exe_config.exists() {
                info!("Config found next to exe: {}", exe_config.display());
                return Ok(exe_config);
            }
            searched.push(exe_config.display().to_string());
        }
    }

    let msg = format!("Config not found: searched in {}", searched.join(", "));
    error!("{}", msg);
    Err(msg)
}

/// Load and parse config.json
pub fn load_config() -> Result<ConfigData, String> {
    let path = find_config_path()?;

    let content = std::fs::read_to_string(&path).map_err(|e| {
        let msg = format!("Cannot read {}: {}", path.display(), e);
        error!("{}", msg);
        msg
    })?;

    // Strip UTF-8 BOM if present (Windows editors often add it)
    let content = content.strip_prefix('\u{feff}').unwrap_or(&content);

    let config: ConfigData = serde_json::from_str(content).map_err(|e| {
        let msg = format!("Invalid JSON in {}: {}", path.display(), e);
        error!("{}", msg);
        msg
    })?;

    info!(
        "Config loaded: {} projects, {} presets, {} layouts",
        config.projects.len(),
        config.presets.len(),
        config.layouts.len()
    );

    Ok(config)
}
