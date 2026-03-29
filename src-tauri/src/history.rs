use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tracing::{debug, info, warn};

use crate::config::{ConfigData, Preset};

// ---------------------------------------------------------------------------
// Data structures
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HistoryEntry {
    pub timestamp: String,
    pub preset: String,
    pub projects: Vec<String>,
    pub branches: HashMap<String, String>,
    pub layout: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PresetSuggestion {
    pub slug: String,
    pub score: u32,
    pub breakdown: ScoreBreakdown,
    pub reason: String,
    pub is_suggested: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ScoreBreakdown {
    pub frequency: u32,
    pub recency: u32,
    pub time_of_day: u32,
    pub git_context: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitContextInput {
    pub is_dirty: bool,
}

// ---------------------------------------------------------------------------
// Timestamp helpers
// ---------------------------------------------------------------------------

/// Parse "yyyy-MM-ddTHH:mm:ss" into (year, month, day, hour, minute, second)
fn parse_timestamp(ts: &str) -> Option<(i64, u32, u32, u32, u32, u32)> {
    // Handle both "2026-03-29T10:30:00" and "2026-03-29T10:30:00.000Z"
    let ts = ts.split('.').next().unwrap_or(ts);
    let ts = ts.trim_end_matches('Z');

    let parts: Vec<&str> = ts.split('T').collect();
    if parts.len() != 2 {
        return None;
    }

    let date_parts: Vec<&str> = parts[0].split('-').collect();
    let time_parts: Vec<&str> = parts[1].split(':').collect();

    if date_parts.len() != 3 || time_parts.len() < 2 {
        return None;
    }

    let year: i64 = date_parts[0].parse().ok()?;
    let month: u32 = date_parts[1].parse().ok()?;
    let day: u32 = date_parts[2].parse().ok()?;
    let hour: u32 = time_parts[0].parse().ok()?;
    let minute: u32 = time_parts[1].parse().ok()?;
    let second: u32 = time_parts.get(2).and_then(|s| s.parse().ok()).unwrap_or(0);

    Some((year, month, day, hour, minute, second))
}

/// Rough epoch-ish value for sorting and delta computation (minutes since a base).
/// Not astronomically precise, but good enough for "hours ago" calculations.
fn timestamp_to_minutes(ts: &str) -> Option<i64> {
    let (year, month, day, hour, minute, _second) = parse_timestamp(ts)?;
    // Rough: 365.25 days/year, 30.44 days/month
    let days = year * 365 + (month as i64) * 30 + day as i64;
    Some(days * 24 * 60 + (hour as i64) * 60 + minute as i64)
}

fn get_hour(ts: &str) -> Option<u32> {
    parse_timestamp(ts).map(|(_, _, _, h, _, _)| h)
}

/// Get "now" as minutes using the same pseudo-epoch as timestamp_to_minutes.
/// The frontend generates timestamps via `new Date().toISOString().slice(0,19)` (UTC).
/// We compute now in UTC to stay consistent.
fn now_minutes() -> i64 {
    let now = std::time::SystemTime::now();
    let secs = now
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    // Decompose epoch seconds into UTC date/time components
    let total_days = secs / 86400;
    let day_secs = secs % 86400;
    let hour = (day_secs / 3600) as i64;
    let minute = ((day_secs % 3600) / 60) as i64;

    // Civil date from days since 1970-01-01 (Howard Hinnant's algorithm)
    let z = total_days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };
    let month = m as i64;
    let day = d as i64;

    // Same formula as timestamp_to_minutes
    let days = year * 365 + month * 30 + day;
    days * 24 * 60 + hour * 60 + minute
}

fn now_hour_utc() -> u32 {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    ((secs % 86400) / 3600) as u32
}

/// Check if a timestamp is within the last N days from now
fn is_within_days(ts: &str, days: u32) -> bool {
    let Some(ts_min) = timestamp_to_minutes(ts) else {
        return false;
    };
    let now_min = now_minutes();
    let delta_minutes = now_min - ts_min;
    delta_minutes >= 0 && delta_minutes < (days as i64) * 24 * 60
}

fn get_time_slot(hour: u32) -> &'static str {
    match hour {
        6..=11 => "matin",
        12..=17 => "apres-midi",
        18..=21 => "soir",
        _ => "nuit",
    }
}

fn current_time_slot() -> &'static str {
    get_time_slot(now_hour_utc())
}

// ---------------------------------------------------------------------------
// Path resolution (same pattern as session.rs)
// ---------------------------------------------------------------------------

fn logs_dir() -> PathBuf {
    if let Ok(cwd) = std::env::current_dir() {
        let cwd_logs = cwd.join("logs");
        if cwd_logs.exists() {
            return cwd_logs;
        }

        // Try CWD parent (handles `cargo tauri dev` where CWD is src-tauri/)
        if let Some(parent) = cwd.parent() {
            let parent_logs = parent.join("logs");
            if parent_logs.exists() {
                return parent_logs;
            }
        }

        // Default: create in CWD or CWD parent if inside src-tauri/
        if cwd.ends_with("src-tauri") {
            if let Some(parent) = cwd.parent() {
                return parent.join("logs");
            }
        }
        return cwd_logs;
    }
    PathBuf::from("logs")
}

fn history_path() -> PathBuf {
    logs_dir().join("history.json")
}

// ---------------------------------------------------------------------------
// File I/O with legacy migration
// ---------------------------------------------------------------------------

fn read_history() -> Vec<HistoryEntry> {
    let path = history_path();
    if !path.exists() {
        debug!("No history file at {}", path.display());
        return Vec::new();
    }

    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(e) => {
            warn!("Cannot read history file {}: {}", path.display(), e);
            return Vec::new();
        }
    };

    // Strip BOM UTF-8
    let content = content.strip_prefix('\u{feff}').unwrap_or(&content);

    if content.trim().is_empty() {
        return Vec::new();
    }

    // Parse as generic JSON array for legacy migration
    let values: Vec<serde_json::Value> = match serde_json::from_str(content) {
        Ok(v) => v,
        Err(e) => {
            warn!(
                "Invalid JSON in history file {}: {} — returning empty",
                path.display(),
                e
            );
            return Vec::new();
        }
    };

    let mut entries = Vec::with_capacity(values.len());
    for mut val in values {
        // Legacy migration: "project" (singular) -> "projects" (array)
        if val.get("project").is_some() && val.get("projects").is_none() {
            if let Some(obj) = val.as_object_mut() {
                let project = obj
                    .remove("project")
                    .and_then(|v| v.as_str().map(String::from))
                    .unwrap_or_default();
                let branch = obj
                    .remove("branch")
                    .and_then(|v| v.as_str().map(String::from))
                    .unwrap_or_default();

                obj.insert(
                    "projects".to_string(),
                    serde_json::json!([project]),
                );
                obj.insert(
                    "branches".to_string(),
                    serde_json::json!({ project.clone(): branch }),
                );
                if !obj.contains_key("layout") {
                    obj.insert("layout".to_string(), serde_json::json!(""));
                }
            }
        }

        match serde_json::from_value::<HistoryEntry>(val) {
            Ok(entry) => entries.push(entry),
            Err(e) => {
                warn!("Skipping malformed history entry: {}", e);
            }
        }
    }

    debug!("History read: {} entries from {}", entries.len(), path.display());
    entries
}

fn write_history(entries: &[HistoryEntry]) -> Result<(), String> {
    let dir = logs_dir();
    if !dir.exists() {
        std::fs::create_dir_all(&dir).map_err(|e| {
            let msg = format!("Cannot create logs dir {}: {}", dir.display(), e);
            tracing::error!("{}", msg);
            msg
        })?;
    }

    let path = history_path();
    let json = serde_json::to_string_pretty(entries).map_err(|e| {
        let msg = format!("Cannot serialize history: {}", e);
        tracing::error!("{}", msg);
        msg
    })?;

    std::fs::write(&path, &json).map_err(|e| {
        let msg = format!("Cannot write {}: {}", path.display(), e);
        tracing::error!("{}", msg);
        msg
    })?;

    Ok(())
}

// ---------------------------------------------------------------------------
// SmartPresets scoring
// ---------------------------------------------------------------------------

fn compute_suggestions(
    config: &ConfigData,
    history: &[HistoryEntry],
    git_context: Option<&GitContextInput>,
) -> Vec<PresetSuggestion> {
    let default_preset = config
        .preferences
        .as_ref()
        .and_then(|p| p.default_preset.clone())
        .unwrap_or_default();

    let now_min = now_minutes();
    let current_slot = current_time_slot();

    // Pre-filter: entries within 7 days and 30 days
    let history_7d: Vec<&HistoryEntry> = history
        .iter()
        .filter(|e| is_within_days(&e.timestamp, 7))
        .collect();
    let total_7d = history_7d.len() as f64;

    let history_30d: Vec<&HistoryEntry> = history
        .iter()
        .filter(|e| is_within_days(&e.timestamp, 30))
        .collect();

    let history_in_slot: Vec<&&HistoryEntry> = history_30d
        .iter()
        .filter(|e| {
            get_hour(&e.timestamp)
                .map(|h| get_time_slot(h) == current_slot)
                .unwrap_or(false)
        })
        .collect();
    let total_in_slot = history_in_slot.len() as f64;

    let mut results: Vec<PresetSuggestion> = config
        .presets
        .iter()
        .map(|(slug, preset)| {
            let mut breakdown = ScoreBreakdown {
                frequency: 0,
                recency: 0,
                time_of_day: 0,
                git_context: 0,
            };

            // 1. Frequency (max 40)
            if total_7d > 0.0 {
                let preset_count = history_7d.iter().filter(|e| e.preset == *slug).count() as f64;
                breakdown.frequency = (preset_count / total_7d * 40.0).round() as u32;
            }

            // 2. Recency (max 30)
            if let Some(last) = history
                .iter()
                .filter(|e| e.preset == *slug)
                .filter_map(|e| timestamp_to_minutes(&e.timestamp).map(|m| (e, m)))
                .max_by_key(|(_, m)| *m)
            {
                let delta_hours = (now_min - last.1) as f64 / 60.0;
                breakdown.recency = if delta_hours < 1.0 {
                    30
                } else if delta_hours < 4.0 {
                    25
                } else if delta_hours < 12.0 {
                    20
                } else if delta_hours < 24.0 {
                    15
                } else if delta_hours < 48.0 {
                    10
                } else if delta_hours < 168.0 {
                    5
                } else {
                    0
                };
            }

            // 3. Time of day (max 20)
            if total_in_slot > 0.0 {
                let preset_in_slot = history_in_slot
                    .iter()
                    .filter(|e| e.preset == *slug)
                    .count() as f64;
                breakdown.time_of_day = (preset_in_slot / total_in_slot * 20.0).round() as u32;
            }

            // 4. Git context (max 10)
            if let Some(ctx) = git_context {
                if ctx.is_dirty {
                    breakdown.git_context = if preset_has_shell_command(preset) {
                        10
                    } else {
                        3
                    };
                } else {
                    breakdown.git_context = if preset.panels.len() <= 2 { 7 } else { 3 };
                }
            }

            let mut score =
                breakdown.frequency + breakdown.recency + breakdown.time_of_day + breakdown.git_context;

            // Bonus: default preset at score 0
            if score == 0 && *slug == default_preset {
                score = 1;
            }

            let reason = build_reason(&breakdown, slug, &history_7d, current_slot);

            PresetSuggestion {
                slug: slug.clone(),
                score,
                breakdown,
                reason,
                is_suggested: false,
            }
        })
        .collect();

    // Sort: score DESC, then default_preset first at equal score, then alphabetic
    results.sort_by(|a, b| {
        b.score
            .cmp(&a.score)
            .then_with(|| {
                let a_is_default = a.slug == default_preset;
                let b_is_default = b.slug == default_preset;
                b_is_default.cmp(&a_is_default)
            })
            .then_with(|| a.slug.cmp(&b.slug))
    });

    // Mark top-1
    if let Some(first) = results.first_mut() {
        first.is_suggested = true;
    }

    if let Some(top) = results.first() {
        info!(
            "Suggestions: top={} score={} ({} presets scored)",
            top.slug,
            top.score,
            results.len()
        );
    }

    results
}

fn preset_has_shell_command(preset: &Preset) -> bool {
    preset.panels.iter().any(|panel| {
        panel
            .command
            .as_ref()
            .map(|cmd| {
                let cmd = cmd.to_lowercase();
                cmd.contains("pwsh")
                    || cmd.contains("shell")
                    || cmd.contains("log")
                    || cmd.contains("dev")
            })
            .unwrap_or(false)
    })
}

fn build_reason(
    breakdown: &ScoreBreakdown,
    slug: &str,
    history_7d: &[&HistoryEntry],
    current_slot: &str,
) -> String {
    let mut parts = Vec::new();

    if breakdown.frequency > 20 {
        let count = history_7d.iter().filter(|e| e.preset == slug).count();
        parts.push(format!("Utilise {}x cette semaine", count));
    }

    if breakdown.recency > 20 {
        parts.push("Lance recemment".to_string());
    }

    if breakdown.time_of_day > 10 {
        parts.push(format!("creneau {}", current_slot));
    }

    if breakdown.git_context > 5 {
        parts.push("projet avec modifs en cours".to_string());
    }

    if parts.is_empty() {
        "Preset par defaut".to_string()
    } else {
        parts.join(", ")
    }
}

// ---------------------------------------------------------------------------
// Tauri IPC commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn add_history_entry(entry: HistoryEntry) -> Result<(), String> {
    info!(
        "IPC: add_history_entry — preset={} projects={:?}",
        entry.preset, entry.projects
    );

    let mut entries = read_history();
    entries.push(entry);

    // Rotation: remove entries older than 30 days
    entries.retain(|e| is_within_days(&e.timestamp, 30));

    // FIFO: max 500
    if entries.len() > 500 {
        let excess = entries.len() - 500;
        entries.drain(..excess);
    }

    write_history(&entries)?;

    info!("History now contains {} entries", entries.len());
    Ok(())
}

#[tauri::command]
pub fn get_history(limit: Option<u32>) -> Result<Vec<HistoryEntry>, String> {
    info!("IPC: get_history called (limit={:?})", limit);

    let mut entries = read_history();

    // Sort by timestamp DESC
    entries.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

    if let Some(lim) = limit {
        if lim > 0 {
            entries.truncate(lim as usize);
        }
    }

    debug!("History returned: {} entries", entries.len());
    Ok(entries)
}

#[tauri::command]
pub fn get_last_launch() -> Result<Option<HistoryEntry>, String> {
    info!("IPC: get_last_launch called");

    let mut entries = read_history();
    if entries.is_empty() {
        info!("No launch history found");
        return Ok(None);
    }

    entries.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    let last = entries.into_iter().next();

    if let Some(ref entry) = last {
        debug!("Last launch: preset={}", entry.preset);
    }

    Ok(last)
}

#[tauri::command]
pub fn get_preset_suggestions(
    config: ConfigData,
    git_context: Option<GitContextInput>,
) -> Result<Vec<PresetSuggestion>, String> {
    info!("IPC: get_preset_suggestions called");

    let history = read_history();
    let suggestions = compute_suggestions(&config, &history, git_context.as_ref());

    Ok(suggestions)
}
