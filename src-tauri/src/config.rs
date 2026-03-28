use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tracing::{error, info, warn};

// ---------------------------------------------------------------------------
// Data structures
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Validation types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Clone, PartialEq)]
pub enum ValidationLevel {
    Error,
    Warning,
}

#[derive(Debug, Serialize, Clone)]
pub struct ValidationMessage {
    pub level: ValidationLevel,
    pub path: String,
    pub message: String,
}

// ---------------------------------------------------------------------------
// Config file location
// ---------------------------------------------------------------------------

/// Find config.json: CWD first, then CWD parent (for Tauri dev where CWD=src-tauri/),
/// then next to executable.
pub fn find_config_path() -> Option<PathBuf> {
    // Try CWD first
    if let Ok(cwd) = std::env::current_dir() {
        let cwd_config = cwd.join("config.json");
        if cwd_config.exists() {
            info!("Config found at CWD: {}", cwd_config.display());
            return Some(cwd_config);
        }

        // Try CWD parent (handles `cargo tauri dev` where CWD is src-tauri/)
        if let Some(parent) = cwd.parent() {
            let parent_config = parent.join("config.json");
            if parent_config.exists() {
                info!("Config found at CWD parent: {}", parent_config.display());
                return Some(parent_config);
            }
        }
    }

    // Fallback: next to executable
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            let exe_config = exe_dir.join("config.json");
            if exe_config.exists() {
                info!("Config found next to exe: {}", exe_config.display());
                return Some(exe_config);
            }
        }
    }

    None
}

/// Determine where to write config.json — existing path or CWD fallback.
fn config_write_path() -> PathBuf {
    if let Some(existing) = find_config_path() {
        return existing;
    }
    // Fallback: CWD, or CWD parent if we're inside src-tauri/
    let cwd = std::env::current_dir().unwrap_or_default();
    if cwd.ends_with("src-tauri") {
        if let Some(parent) = cwd.parent() {
            return parent.join("config.json");
        }
    }
    cwd.join("config.json")
}

// ---------------------------------------------------------------------------
// Slug / color / path validation helpers
// ---------------------------------------------------------------------------

fn is_valid_slug(s: &str) -> bool {
    if s.is_empty() {
        return false;
    }
    let mut prev_hyphen = true; // treat start as if preceded by hyphen to reject leading -
    for ch in s.chars() {
        if ch == '-' {
            if prev_hyphen {
                return false; // double hyphen or leading hyphen
            }
            prev_hyphen = true;
        } else if ch.is_ascii_lowercase() || ch.is_ascii_digit() {
            prev_hyphen = false;
        } else {
            return false;
        }
    }
    !prev_hyphen // reject trailing hyphen
}

fn is_valid_hex_color(s: &str) -> bool {
    if s.len() != 7 {
        return false;
    }
    let bytes = s.as_bytes();
    if bytes[0] != b'#' {
        return false;
    }
    bytes[1..].iter().all(|b| b.is_ascii_hexdigit())
}

fn is_windows_absolute_path(s: &str) -> bool {
    let bytes = s.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_uppercase()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/')
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

pub fn validate_config(config: &ConfigData) -> Vec<ValidationMessage> {
    let mut msgs: Vec<ValidationMessage> = Vec::new();

    // 1. Version
    match &config.version {
        Some(v) if v == "1.0" => {}
        Some(v) => msgs.push(ValidationMessage {
            level: ValidationLevel::Error,
            path: "version".into(),
            message: format!(
                "Version '{}' non supportee. Version actuelle : 1.0",
                v
            ),
        }),
        None => msgs.push(ValidationMessage {
            level: ValidationLevel::Error,
            path: "version".into(),
            message: "Champ 'version' manquant. Valeur attendue : \"1.0\"".into(),
        }),
    }

    // 2. Slugs projets
    for slug in config.projects.keys() {
        if !is_valid_slug(slug) {
            msgs.push(ValidationMessage {
                level: ValidationLevel::Error,
                path: format!("projects.{}", slug),
                message: format!(
                    "Le slug '{}' est invalide. Format attendu : kebab-case (ex: 'easy-sap'). \
                     Pattern : ^[a-z0-9]+(-[a-z0-9]+)*$",
                    slug
                ),
            });
        }
    }

    // 3. Chemins & couleurs projets
    for (slug, project) in &config.projects {
        let prefix = format!("projects.{}", slug);

        if !is_windows_absolute_path(&project.path) {
            msgs.push(ValidationMessage {
                level: ValidationLevel::Error,
                path: format!("{}.path", prefix),
                message: format!(
                    "Le chemin '{}' n'est pas un chemin Windows absolu. Format attendu : C:\\...",
                    project.path
                ),
            });
        } else if !std::path::Path::new(&project.path).exists() {
            msgs.push(ValidationMessage {
                level: ValidationLevel::Warning,
                path: format!("{}.path", prefix),
                message: format!(
                    "Le projet '{}' pointe vers '{}' qui n'existe pas",
                    slug, project.path
                ),
            });
        }

        if let Some(color) = &project.color {
            if !is_valid_hex_color(color) {
                msgs.push(ValidationMessage {
                    level: ValidationLevel::Error,
                    path: format!("{}.color", prefix),
                    message: format!(
                        "La couleur '{}' est invalide. Format attendu : #rrggbb (ex: #e74c3c)",
                        color
                    ),
                });
            }
        }
    }

    // 4. Slugs presets
    for slug in config.presets.keys() {
        if !is_valid_slug(slug) {
            msgs.push(ValidationMessage {
                level: ValidationLevel::Error,
                path: format!("presets.{}", slug),
                message: format!(
                    "Le slug preset '{}' est invalide. Format attendu : kebab-case",
                    slug
                ),
            });
        }
    }

    // 5. Slugs layouts
    for slug in config.layouts.keys() {
        if !is_valid_slug(slug) {
            msgs.push(ValidationMessage {
                level: ValidationLevel::Error,
                path: format!("layouts.{}", slug),
                message: format!(
                    "Le slug layout '{}' est invalide. Format attendu : kebab-case",
                    slug
                ),
            });
        }
    }

    // 6-8. References croisees presets → layouts & projects, coherence panels
    for (slug, preset) in &config.presets {
        let prefix = format!("presets.{}", slug);

        // preset.layout must exist in layouts
        if let Some(layout) = config.layouts.get(&preset.layout) {
            // panels count must match layout
            let expected = layout.splits.len() + 1;
            if preset.panels.len() != expected {
                msgs.push(ValidationMessage {
                    level: ValidationLevel::Error,
                    path: format!("{}.panels", prefix),
                    message: format!(
                        "Le preset '{}' a {} panneau(x) mais le layout '{}' en attend {}",
                        slug,
                        preset.panels.len(),
                        preset.layout,
                        expected
                    ),
                });
            }
        } else {
            let available: Vec<&String> = config.layouts.keys().collect();
            msgs.push(ValidationMessage {
                level: ValidationLevel::Error,
                path: format!("{}.layout", prefix),
                message: format!(
                    "Le preset '{}' reference le layout '{}' qui n'existe pas. Layouts disponibles : {}",
                    slug,
                    preset.layout,
                    available.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", ")
                ),
            });
        }

        // panels project references
        for (i, panel) in preset.panels.iter().enumerate() {
            if panel.project != "{{auto}}" && !config.projects.contains_key(&panel.project) {
                msgs.push(ValidationMessage {
                    level: ValidationLevel::Error,
                    path: format!("{}.panels[{}].project", prefix, i),
                    message: format!(
                        "Le panneau {} du preset '{}' reference le projet '{}' qui n'existe pas",
                        i, slug, panel.project
                    ),
                });
            }
        }
    }

    msgs
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

fn default_layouts() -> HashMap<String, Layout> {
    let mut m = HashMap::new();
    m.insert("single".into(), Layout { splits: vec![] });
    m.insert("horizontal-2".into(), Layout { splits: vec!["H".into()] });
    m.insert("horizontal-3".into(), Layout { splits: vec!["H".into(), "H".into()] });
    m.insert("vertical-2".into(), Layout { splits: vec!["V".into()] });
    m.insert("grid-2x2".into(), Layout {
        splits: vec!["H".into(), "V".into(), "focus-1".into(), "V".into()],
    });
    m.insert("main-plus-sidebar".into(), Layout { splits: vec!["H(70%)".into()] });
    m
}

pub fn apply_defaults(config: &mut ConfigData) {
    // Preferences
    let prefs = config.preferences.get_or_insert_with(|| Preferences {
        theme: None,
        default_preset: None,
        scan_directories: None,
        auto_discover_projects: None,
        daemon: None,
    });
    if prefs.theme.is_none() {
        prefs.theme = Some("dark".into());
    }
    if prefs.scan_directories.is_none() {
        prefs.scan_directories = Some(vec![]);
    }
    if prefs.auto_discover_projects.is_none() {
        prefs.auto_discover_projects = Some(false);
    }
    let daemon = prefs.daemon.get_or_insert_with(|| DaemonPrefs {
        enabled: None,
        watch_interval_ms: None,
        notify_on_wait: None,
    });
    if daemon.enabled.is_none() {
        daemon.enabled = Some(true);
    }
    if daemon.watch_interval_ms.is_none() {
        daemon.watch_interval_ms = Some(5000);
    }
    if daemon.notify_on_wait.is_none() {
        daemon.notify_on_wait = Some(true);
    }

    // Projects defaults
    for project in config.projects.values_mut() {
        if project.color.is_none() {
            project.color = Some("#808080".into());
        }
        if project.icon.is_none() {
            project.icon = Some("folder".into());
        }
        if project.default_command.is_none() {
            project.default_command = Some("claude".into());
        }
    }

    // Default layouts — add missing ones, don't overwrite user-defined
    for (key, layout) in default_layouts() {
        config.layouts.entry(key).or_insert(layout);
    }
}

// ---------------------------------------------------------------------------
// Create default config
// ---------------------------------------------------------------------------

pub fn create_default_config() -> ConfigData {
    let mut config = ConfigData {
        schema: Some("./config-schema.json".into()),
        version: Some("1.0".into()),
        preferences: None,
        projects: HashMap::new(),
        presets: HashMap::new(),
        layouts: HashMap::new(),
    };
    apply_defaults(&mut config);
    config
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

pub fn save_config(config: &ConfigData) -> Result<(), String> {
    let path = config_write_path();
    info!("Saving config to {}", path.display());

    let json = serde_json::to_string_pretty(config).map_err(|e| {
        let msg = format!("Cannot serialize config: {}", e);
        error!("{}", msg);
        msg
    })?;

    std::fs::write(&path, &json).map_err(|e| {
        let msg = format!("Cannot write {}: {}", path.display(), e);
        error!("{}", msg);
        msg
    })?;

    info!("Config saved successfully");
    Ok(())
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

/// Load and parse config.json. Creates a default config if the file doesn't exist.
pub fn load_config() -> Result<ConfigData, String> {
    let path = match find_config_path() {
        Some(p) => p,
        None => {
            info!("No config.json found, creating default config");
            let config = create_default_config();
            save_config(&config)?;
            return Ok(config);
        }
    };

    let content = std::fs::read_to_string(&path).map_err(|e| {
        let msg = format!("Cannot read {}: {}", path.display(), e);
        error!("{}", msg);
        msg
    })?;

    // Strip UTF-8 BOM if present (Windows editors often add it)
    let content = content.strip_prefix('\u{feff}').unwrap_or(&content);

    let mut config: ConfigData = serde_json::from_str(content).map_err(|e| {
        let msg = format!("JSON invalide dans {} : {}", path.display(), e);
        error!("{}", msg);
        msg
    })?;

    apply_defaults(&mut config);

    let messages = validate_config(&config);

    // Log warnings
    for msg in &messages {
        if msg.level == ValidationLevel::Warning {
            warn!("[{}] {}", msg.path, msg.message);
        }
    }

    // Collect errors
    let errors: Vec<&ValidationMessage> = messages
        .iter()
        .filter(|m| m.level == ValidationLevel::Error)
        .collect();

    if !errors.is_empty() {
        let error_text = errors
            .iter()
            .map(|e| format!("  - [{}] {}", e.path, e.message))
            .collect::<Vec<_>>()
            .join("\n");
        let msg = format!("Erreurs de validation dans config.json :\n{}", error_text);
        error!("{}", msg);
        return Err(msg);
    }

    info!(
        "Config loaded: {} projects, {} presets, {} layouts",
        config.projects.len(),
        config.presets.len(),
        config.layouts.len()
    );

    Ok(config)
}
