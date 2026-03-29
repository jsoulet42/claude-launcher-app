use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tracing::{info, warn};

// ---------------------------------------------------------------------------
// Data structures
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SavedSession {
    pub version: u32,
    pub saved_at: String,
    pub active_workspace_index: usize,
    pub workspaces: Vec<SavedWorkspace>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SavedWorkspace {
    pub name: String,
    pub color: Option<String>,
    pub layout: SavedLayoutNode,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type")]
pub enum SavedLayoutNode {
    #[serde(rename = "terminal")]
    Terminal {
        shell: String,
        cwd: Option<String>,
    },
    #[serde(rename = "split")]
    Split {
        direction: String,
        ratio: f64,
        children: Vec<SavedLayoutNode>,
    },
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/// Find the sessions directory: CWD/sessions first, then CWD parent/sessions
/// (for Tauri dev where CWD is src-tauri/).
fn sessions_dir() -> PathBuf {
    if let Ok(cwd) = std::env::current_dir() {
        let cwd_sessions = cwd.join("sessions");
        if cwd_sessions.exists() {
            return cwd_sessions;
        }

        // Try CWD parent (handles `cargo tauri dev` where CWD is src-tauri/)
        if let Some(parent) = cwd.parent() {
            let parent_sessions = parent.join("sessions");
            if parent_sessions.exists() {
                return parent_sessions;
            }
        }

        // Default: create in CWD or CWD parent if inside src-tauri/
        if cwd.ends_with("src-tauri") {
            if let Some(parent) = cwd.parent() {
                return parent.join("sessions");
            }
        }
        return cwd_sessions;
    }
    PathBuf::from("sessions")
}

fn session_path() -> PathBuf {
    sessions_dir().join("current-state.json")
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

fn validate_session(session: &SavedSession) -> Result<(), String> {
    if session.version != 1 {
        return Err(format!(
            "Unsupported session version: {} (expected 1)",
            session.version
        ));
    }
    for (i, ws) in session.workspaces.iter().enumerate() {
        validate_layout_node(&ws.layout, &format!("workspace[{}]", i))?;
    }
    Ok(())
}

fn validate_layout_node(node: &SavedLayoutNode, path: &str) -> Result<(), String> {
    match node {
        SavedLayoutNode::Terminal { .. } => Ok(()),
        SavedLayoutNode::Split { children, .. } => {
            if children.len() != 2 {
                return Err(format!(
                    "{}: split node must have exactly 2 children, got {}",
                    path,
                    children.len()
                ));
            }
            validate_layout_node(&children[0], &format!("{}.left", path))?;
            validate_layout_node(&children[1], &format!("{}.right", path))?;
            Ok(())
        }
    }
}

// ---------------------------------------------------------------------------
// Tauri IPC commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn save_session(session: SavedSession) -> Result<(), String> {
    info!(
        "IPC: save_session called — {} workspaces",
        session.workspaces.len()
    );

    let dir = sessions_dir();
    if !dir.exists() {
        std::fs::create_dir_all(&dir).map_err(|e| {
            let msg = format!("Cannot create sessions dir {}: {}", dir.display(), e);
            tracing::error!("{}", msg);
            msg
        })?;
    }

    let path = session_path();
    let json = serde_json::to_string_pretty(&session).map_err(|e| {
        let msg = format!("Cannot serialize session: {}", e);
        tracing::error!("{}", msg);
        msg
    })?;

    std::fs::write(&path, &json).map_err(|e| {
        let msg = format!("Cannot write {}: {}", path.display(), e);
        tracing::error!("{}", msg);
        msg
    })?;

    info!(
        "Session saved: {} workspaces → {}",
        session.workspaces.len(),
        path.display()
    );
    Ok(())
}

#[tauri::command]
pub fn load_session() -> Result<Option<SavedSession>, String> {
    info!("IPC: load_session called");

    let path = session_path();
    if !path.exists() {
        info!("No saved session found at {}", path.display());
        return Ok(None);
    }

    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(e) => {
            warn!("Cannot read session file {}: {}", path.display(), e);
            return Ok(None);
        }
    };

    // Strip BOM UTF-8 (Windows editors may add it)
    let content = content.strip_prefix('\u{feff}').unwrap_or(&content);

    let session: SavedSession = match serde_json::from_str(content) {
        Ok(s) => s,
        Err(e) => {
            warn!(
                "Invalid JSON in session file {}: {} — ignoring",
                path.display(),
                e
            );
            return Ok(None);
        }
    };

    // Validate structure
    if let Err(e) = validate_session(&session) {
        warn!("Session validation failed: {} — ignoring", e);
        return Ok(None);
    }

    info!(
        "Session loaded: {} workspaces from {}",
        session.workspaces.len(),
        path.display()
    );
    Ok(Some(session))
}

#[tauri::command]
pub fn clear_session() -> Result<(), String> {
    info!("IPC: clear_session called");

    let path = session_path();
    if !path.exists() {
        info!("No session file to clear");
        return Ok(());
    }

    std::fs::remove_file(&path).map_err(|e| {
        let msg = format!("Cannot delete {}: {}", path.display(), e);
        tracing::error!("{}", msg);
        msg
    })?;

    info!("Session file cleared: {}", path.display());
    Ok(())
}
