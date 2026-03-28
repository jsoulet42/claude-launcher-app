//! Terminal manager — lifecycle, events, and Tauri IPC commands.
//!
//! Manages a collection of ConPTY terminals, each with an async reader task
//! that streams output to the frontend via Tauri events.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use std::thread::JoinHandle;

use tauri::{AppHandle, Emitter};

use crate::conpty::{ConPty, ConPtyOptions};

// ─── Public types (serialized over IPC) ──────────────────────────────────────

/// Status of a terminal.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum TerminalStatus {
    Running,
    Exited,
    Error,
}

/// Public info about a terminal, returned by list_terminals and create_terminal.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalInfo {
    pub id: String,
    pub shell: String,
    pub cwd: Option<String>,
    pub cols: u16,
    pub rows: u16,
    pub status: TerminalStatus,
}

// ─── IPC param / result structs ──────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CreateTerminalParams {
    pub shell: Option<String>,
    pub cwd: Option<String>,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Serialize)]
pub struct CreateTerminalResult {
    pub id: String,
}

#[derive(Debug, Deserialize)]
pub struct WriteTerminalParams {
    pub id: String,
    pub data: String,
}

#[derive(Debug, Deserialize)]
pub struct ResizeTerminalParams {
    pub id: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Deserialize)]
pub struct CloseTerminalParams {
    pub id: String,
}

// ─── Event payloads ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct TerminalOutputEvent {
    pub id: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TerminalExitEvent {
    pub id: String,
    pub code: i32,
}

#[derive(Debug, Clone, Serialize)]
pub struct TerminalErrorEvent {
    pub id: String,
    pub error: String,
}

// ─── Internal terminal struct ────────────────────────────────────────────────

/// Internal terminal state — not serialized, holds the ConPty and reader task.
struct Terminal {
    info: TerminalInfo,
    conpty: Arc<ConPty>,
    /// Handle to the reader thread that continuously reads output
    reader_handle: Option<JoinHandle<()>>,
}

// ─── TerminalManager ─────────────────────────────────────────────────────────

/// Manages all terminals. Stored as Tauri managed state.
pub struct TerminalManager {
    terminals: Arc<Mutex<HashMap<String, Terminal>>>,
    app_handle: AppHandle,
}

impl TerminalManager {
    pub fn new(app_handle: AppHandle) -> Self {
        tracing::info!("TerminalManager initialized");
        Self {
            terminals: Arc::new(Mutex::new(HashMap::new())),
            app_handle,
        }
    }

    /// Create a terminal, spawn the shell, start the async output reader.
    pub fn create(
        &self,
        shell: Option<String>,
        cwd: Option<String>,
        cols: u16,
        rows: u16,
    ) -> Result<TerminalInfo, String> {
        // Validate dimensions
        if cols < 1 || rows < 1 {
            let msg = format!("Invalid terminal size: cols={} rows={} (must be >= 1)", cols, rows);
            tracing::error!("{}", msg);
            return Err(msg);
        }

        let id = uuid::Uuid::new_v4().to_string();
        let resolved_shell = resolve_shell(shell);

        tracing::info!(
            "Creating terminal id={} shell={} cwd={:?} cols={} rows={}",
            id, resolved_shell, cwd, cols, rows
        );

        let options = ConPtyOptions {
            shell: resolved_shell.clone(),
            cwd: cwd.clone(),
            cols,
            rows,
        };

        let conpty = ConPty::new(options).map_err(|e| {
            let msg = format!("Failed to create ConPTY: {}", e);
            tracing::error!("{}", msg);
            msg
        })?;

        let conpty = Arc::new(conpty);

        let info = TerminalInfo {
            id: id.clone(),
            shell: resolved_shell,
            cwd,
            cols,
            rows,
            status: TerminalStatus::Running,
        };

        // Spawn the output reader task
        let reader_handle = spawn_reader(
            id.clone(),
            conpty.clone(),
            self.app_handle.clone(),
            self.terminals.clone(),
        );

        let terminal = Terminal {
            info: info.clone(),
            conpty,
            reader_handle: Some(reader_handle),
        };

        {
            let mut map = self.terminals.lock().map_err(|e| {
                let msg = format!("Failed to lock terminals map: {}", e);
                tracing::error!("{}", msg);
                msg
            })?;
            map.insert(id.clone(), terminal);
        }

        tracing::info!("Terminal {} created successfully", id);
        Ok(info)
    }

    /// Write data to a terminal's stdin.
    pub fn write(&self, id: &str, data: &str) -> Result<(), String> {
        let map = self.terminals.lock().map_err(|e| {
            let msg = format!("Failed to lock terminals map: {}", e);
            tracing::error!("{}", msg);
            msg
        })?;

        let terminal = map.get(id).ok_or_else(|| {
            let msg = format!("Terminal not found: {}", id);
            tracing::error!("{}", msg);
            msg
        })?;

        terminal.conpty.write(data.as_bytes()).map_err(|e| {
            let msg = format!("Failed to write to terminal {}: {}", id, e);
            tracing::error!("{}", msg);
            msg
        })?;

        Ok(())
    }

    /// Resize a terminal.
    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        if cols < 1 || rows < 1 {
            let msg = format!("Invalid terminal size: cols={} rows={} (must be >= 1)", cols, rows);
            tracing::error!("{}", msg);
            return Err(msg);
        }

        let mut map = self.terminals.lock().map_err(|e| {
            let msg = format!("Failed to lock terminals map: {}", e);
            tracing::error!("{}", msg);
            msg
        })?;

        let terminal = map.get_mut(id).ok_or_else(|| {
            let msg = format!("Terminal not found: {}", id);
            tracing::error!("{}", msg);
            msg
        })?;

        terminal.conpty.resize(cols, rows).map_err(|e| {
            let msg = format!("Failed to resize terminal {}: {}", id, e);
            tracing::error!("{}", msg);
            msg
        })?;

        terminal.info.cols = cols;
        terminal.info.rows = rows;

        Ok(())
    }

    /// Close a terminal: remove from map, abort reader, emit exit event.
    pub fn close(&self, id: &str) -> Result<(), String> {
        let mut map = self.terminals.lock().map_err(|e| {
            let msg = format!("Failed to lock terminals map: {}", e);
            tracing::error!("{}", msg);
            msg
        })?;

        let mut terminal = map.remove(id).ok_or_else(|| {
            let msg = format!("Terminal not found: {}", id);
            tracing::error!("{}", msg);
            msg
        })?;

        // Take the reader handle — the thread will exit naturally when
        // the ConPty is dropped (pipe closes, ReadFile returns 0).
        // We don't join here to avoid blocking the IPC command.
        let _reader_handle = terminal.reader_handle.take();

        // Get exit code before dropping the ConPty
        let code = terminal.conpty.exit_code().unwrap_or(-1);

        // Drop terminal (and ConPty) explicitly
        drop(terminal);

        // Emit exit event
        let _ = self.app_handle.emit(
            "terminal:exit",
            TerminalExitEvent {
                id: id.to_string(),
                code,
            },
        );

        tracing::info!("Terminal {} closed", id);
        Ok(())
    }

    /// List all terminals with their current status.
    pub fn list(&self) -> Vec<TerminalInfo> {
        let map = match self.terminals.lock() {
            Ok(m) => m,
            Err(e) => {
                tracing::error!("Failed to lock terminals map: {}", e);
                return Vec::new();
            }
        };

        map.values().map(|t| t.info.clone()).collect()
    }
}

// ─── Shell resolution ────────────────────────────────────────────────────────

/// Resolve the shell to use: explicit param > COMSPEC env var > pwsh.exe fallback.
fn resolve_shell(shell: Option<String>) -> String {
    if let Some(s) = shell {
        return s;
    }
    std::env::var("COMSPEC").unwrap_or_else(|_| "pwsh.exe".to_string())
}

// ─── Output reader + process watcher threads ───────────────────────────────

/// Spawn two threads for a terminal:
/// 1. **Reader thread**: continuously reads output from ConPTY and emits events.
/// 2. **Watcher thread**: waits for the child process to exit, then closes the
///    ConPTY console to unblock the reader's ReadFile call.
///
/// This two-thread pattern is needed because ConPTY does NOT close the output
/// pipe when the child process exits — the pipe stays open as long as the
/// console handle exists. The watcher closes the console, which breaks the
/// pipe, which makes ReadFile return 0/error, which exits the reader loop.
fn spawn_reader(
    id: String,
    conpty: Arc<ConPty>,
    app_handle: AppHandle,
    terminals: Arc<Mutex<HashMap<String, Terminal>>>,
) -> JoinHandle<()> {
    // Spawn the process watcher thread
    let watcher_conpty = conpty.clone();
    let watcher_id = id.clone();
    std::thread::Builder::new()
        .name(format!("terminal-watcher-{}", &id[..8]))
        .spawn(move || {
            tracing::debug!("Watcher thread started for terminal {}", watcher_id);
            watcher_conpty.wait_for_exit();
            tracing::debug!("Process exited for terminal {}, closing console", watcher_id);
            watcher_conpty.close_console();
        })
        .expect("Failed to spawn terminal watcher thread");

    // Spawn the reader thread
    std::thread::Builder::new()
        .name(format!("terminal-reader-{}", &id[..8]))
        .spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match conpty.read(&mut buf) {
                    Ok(0) => {
                        // Pipe closed — process exited (or console was closed by watcher)
                        let code = conpty.exit_code().unwrap_or(-1);
                        tracing::info!("Terminal {} exited with code {}", id, code);
                        let _ = app_handle.emit(
                            "terminal:exit",
                            TerminalExitEvent {
                                id: id.clone(),
                                code,
                            },
                        );
                        if let Ok(mut map) = terminals.lock() {
                            if let Some(t) = map.get_mut(&id) {
                                t.info.status = TerminalStatus::Exited;
                            }
                        }
                        break;
                    }
                    Ok(n) => {
                        tracing::debug!("Terminal {} read {} bytes", id, n);
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = app_handle.emit(
                            "terminal:output",
                            TerminalOutputEvent {
                                id: id.clone(),
                                data,
                            },
                        );
                    }
                    Err(e) => {
                        tracing::error!("Terminal {} read error: {}", id, e);
                        let _ = app_handle.emit(
                            "terminal:error",
                            TerminalErrorEvent {
                                id: id.clone(),
                                error: e.to_string(),
                            },
                        );
                        if let Ok(mut map) = terminals.lock() {
                            if let Some(t) = map.get_mut(&id) {
                                t.info.status = TerminalStatus::Error;
                            }
                        }
                        break;
                    }
                }
            }
        })
        .expect("Failed to spawn terminal reader thread")
}

// ─── Tauri commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub fn create_terminal(
    params: CreateTerminalParams,
    manager: tauri::State<'_, TerminalManager>,
) -> Result<CreateTerminalResult, String> {
    tracing::info!(
        "IPC: create_terminal shell={:?} cwd={:?} cols={} rows={}",
        params.shell,
        params.cwd,
        params.cols,
        params.rows
    );
    let info = manager.create(params.shell, params.cwd, params.cols, params.rows)?;
    Ok(CreateTerminalResult { id: info.id })
}

#[tauri::command]
pub fn write_terminal(
    params: WriteTerminalParams,
    manager: tauri::State<'_, TerminalManager>,
) -> Result<(), String> {
    tracing::debug!(
        "IPC: write_terminal id={} len={}",
        params.id,
        params.data.len()
    );
    manager.write(&params.id, &params.data)
}

#[tauri::command]
pub fn resize_terminal(
    params: ResizeTerminalParams,
    manager: tauri::State<'_, TerminalManager>,
) -> Result<(), String> {
    tracing::info!(
        "IPC: resize_terminal id={} cols={} rows={}",
        params.id,
        params.cols,
        params.rows
    );
    manager.resize(&params.id, params.cols, params.rows)
}

#[tauri::command]
pub fn close_terminal(
    params: CloseTerminalParams,
    manager: tauri::State<'_, TerminalManager>,
) -> Result<(), String> {
    tracing::info!("IPC: close_terminal id={}", params.id);
    manager.close(&params.id)
}

#[tauri::command]
pub fn list_terminals(
    manager: tauri::State<'_, TerminalManager>,
) -> Result<Vec<TerminalInfo>, String> {
    tracing::debug!("IPC: list_terminals");
    Ok(manager.list())
}
