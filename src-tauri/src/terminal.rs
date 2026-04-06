//! Terminal manager — lifecycle, events, and Tauri IPC commands.
//!
//! Manages a collection of PTY terminals, each with an async reader task
//! that streams output to the frontend via Tauri events.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use std::thread::JoinHandle;

use tauri::{AppHandle, Emitter};

use crate::pty::{Pty, PtyOptions};

// ─── ANSI cursor diagnostic flag (P34 cursor-phantom-debug) ──────────────────
//
// When enabled, the reader thread scans each output chunk for cursor-related
// ANSI escape sequences (CUP, DECTCEM, DECSCUSR, save/restore, bracketed paste)
// and logs them via tracing with target="ansi_cursor". Scope is intentionally
// limited to cursor sequences — other ANSI sequences (SGR colors, scroll region,
// clear screen) are NOT logged to keep signal/noise ratio usable.
//
// Default off (zero cost in the hot path: a single relaxed AtomicBool load).
static ANSI_CURSOR_DEBUG: AtomicBool = AtomicBool::new(false);

fn ansi_cursor_debug_enabled() -> bool {
    ANSI_CURSOR_DEBUG.load(Ordering::Relaxed)
}

pub fn set_ansi_cursor_debug(enabled: bool) {
    ANSI_CURSOR_DEBUG.store(enabled, Ordering::Relaxed);
}

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
    pub created_at: u64,
    pub exit_code: Option<i32>,
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

#[derive(Debug, Clone, Serialize)]
pub struct ClaudeDoneEvent {
    pub id: String,
    pub title: String,
    pub timestamp: u64,
    pub last_message: Option<String>,
}

// ─── Claude state for OSC title detection ───────────────────────────────────

/// Tracks Claude Code agent state by parsing OSC title sequences.
/// Stored locally in the reader thread to avoid deadlocks.
struct ClaudeState {
    is_working: bool,
    last_title: String,
    osc_buffer: String,
    last_output_buffer: String,
}

// ─── Internal terminal struct ────────────────────────────────────────────────

/// Internal terminal state — not serialized, holds the Pty and reader task.
struct Terminal {
    info: TerminalInfo,
    pty: Arc<Pty>,
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

        let options = PtyOptions {
            shell: resolved_shell.clone(),
            cwd: cwd.clone(),
            cols,
            rows,
        };

        let pty = Pty::new(options).map_err(|e| {
            let msg = format!("Failed to create PTY: {}", e);
            tracing::error!("{}", msg);
            msg
        })?;

        let pty = Arc::new(pty);

        let created_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        let info = TerminalInfo {
            id: id.clone(),
            shell: resolved_shell,
            cwd,
            cols,
            rows,
            status: TerminalStatus::Running,
            created_at,
            exit_code: None,
        };

        // Spawn the output reader task
        let reader_handle = spawn_reader(
            id.clone(),
            pty.clone(),
            self.app_handle.clone(),
            self.terminals.clone(),
        );

        let terminal = Terminal {
            info: info.clone(),
            pty,
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

        terminal.pty.write(data.as_bytes()).map_err(|e| {
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

        terminal.pty.resize(cols, rows).map_err(|e| {
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
        // the console is closed (ReadFile returns 0/error).
        let _reader_handle = terminal.reader_handle.take();

        // Kill the child FIRST via the independent killer. This unblocks the
        // watcher thread (which was holding the Child Mutex inside wait()),
        // so subsequent exit_code() / drop can acquire the Child Mutex.
        terminal.pty.close_console();

        // Now that the watcher has released the Child Mutex, exit_code() can
        // call try_wait() without deadlocking.
        let code = terminal.pty.exit_code().unwrap_or(-1);

        // Drop terminal explicitly
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

    /// Close all terminals. Called on app exit to prevent zombie processes.
    pub fn close_all(&self) {
        let ids: Vec<String> = {
            let map = match self.terminals.lock() {
                Ok(m) => m,
                Err(_) => return,
            };
            map.keys().cloned().collect()
        };
        for id in &ids {
            let _ = self.close(id);
        }
        tracing::info!("All terminals closed ({} total)", ids.len());
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

/// Default shell for the current OS.
/// Windows: pwsh.exe (preferred) > COMSPEC (cmd.exe fallback).
/// Unix: $SHELL > /bin/bash fallback.
fn default_shell() -> String {
    #[cfg(windows)]
    {
        // Prefer pwsh over cmd.exe — pwsh is the modern interactive shell on Windows.
        // COMSPEC typically points to cmd.exe which lacks features for interactive use.
        if which_exists("pwsh.exe") {
            "pwsh.exe".to_string()
        } else if which_exists("pwsh") {
            "pwsh".to_string()
        } else {
            std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
        }
    }
    #[cfg(unix)]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    }
}

/// Check if a program exists on PATH.
fn which_exists(program: &str) -> bool {
    if let Ok(path) = std::env::var("PATH") {
        let sep = if cfg!(windows) { ';' } else { ':' };
        for dir in path.split(sep) {
            let candidate = std::path::Path::new(dir).join(program);
            if candidate.exists() {
                return true;
            }
        }
    }
    false
}

/// Tauri IPC command: return the default shell for the current OS.
#[tauri::command]
pub fn get_default_shell() -> String {
    default_shell()
}

/// Resolve the shell to use: explicit param > OS default.
/// Adds flags to keep the shell interactive when needed.
fn resolve_shell(shell: Option<String>) -> String {
    let raw = match shell {
        Some(s) if !s.is_empty() => s,
        _ => default_shell(),
    };

    // Extract just the filename for comparison (COMSPEC/SHELL can return full paths)
    let base = std::path::Path::new(raw.trim())
        .file_name()
        .and_then(|f| f.to_str())
        .unwrap_or(raw.trim())
        .to_lowercase();

    // Windows shells: pwsh/powershell need -NoExit to stay interactive.
    if base == "pwsh" || base == "pwsh.exe" || base == "powershell" || base == "powershell.exe" {
        format!("{} -NoExit", raw.trim())
    } else if base == "cmd" || base == "cmd.exe" {
        raw
    }
    // Unix shells: launch as login + interactive shell (-li) so ALL config files
    // are sourced. Login mode loads /etc/profile + ~/.zprofile/~/.bash_profile,
    // and interactive mode loads ~/.zshrc/~/.bashrc. Both are needed because:
    // - Desktop launch has minimal env (login fixes PATH from profiles)
    // - Many users add PATH entries in .zshrc/.bashrc only (interactive fixes that)
    else if base == "bash" || base == "zsh" || base == "sh" {
        format!("{} -li", raw.trim())
    } else if base == "fish" {
        // fish uses -l for login, always interactive in a PTY
        format!("{} -l", raw.trim())
    }
    // Unknown command: wrap in the default shell as login+interactive + command.
    else {
        let ds = default_shell();
        let ds_base = std::path::Path::new(ds.trim())
            .file_name()
            .and_then(|f| f.to_str())
            .unwrap_or(ds.trim())
            .to_lowercase();
        if ds_base == "pwsh" || ds_base == "pwsh.exe" || ds_base == "powershell" || ds_base == "powershell.exe" {
            format!("{} -NoExit -Command {}", ds, raw.trim())
        } else if ds_base == "cmd" || ds_base == "cmd.exe" {
            format!("{} /c {}", ds, raw.trim())
        } else {
            // Unix: login+interactive shell + command so full env is loaded
            format!("{} -lic {}", ds, raw.trim())
        }
    }
}

// ─── OSC title parser for Claude detection ──────────────────────────────────

/// Braille spinner characters used by Claude Code when working.
const BRAILLE_SPINNERS: &[char] = &['\u{2802}', '\u{2810}', '\u{2808}', '\u{2801}', '\u{2804}', '\u{2820}'];

/// Star character emitted by Claude Code when done.
const CLAUDE_DONE_CHAR: char = '\u{2733}'; // ✳

/// Strip ANSI escape sequences from a string (best-effort, fast).
fn strip_ansi(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            // Skip CSI sequences: ESC [ ... final_byte
            if chars.peek() == Some(&'[') {
                chars.next(); // consume '['
                loop {
                    match chars.next() {
                        Some(c) if (0x40..=0x7E).contains(&(c as u32)) => break,
                        None => break,
                        _ => {}
                    }
                }
            } else if chars.peek() == Some(&']') {
                // Skip OSC sequences: ESC ] ... BEL or ST
                chars.next();
                loop {
                    match chars.next() {
                        Some('\x07') => break,
                        Some('\x1b') => {
                            if chars.peek() == Some(&'\\') {
                                chars.next();
                            }
                            break;
                        }
                        None => break,
                        _ => {}
                    }
                }
            } else {
                // Skip other escape sequences (2-byte)
                chars.next();
            }
        } else if c == '\x07' || c == '\x0e' || c == '\x0f' {
            // Skip BEL and shift chars
        } else {
            out.push(c);
        }
    }
    out
}

/// Parse OSC title sequences from terminal output data.
/// Detects Claude Code spinner→done transitions and emits `claude:done` events.
fn parse_osc_titles(
    data: &str,
    state: &mut ClaudeState,
    id: &str,
    app_handle: &AppHandle,
) {
    // Accumulate stripped output for last_message extraction
    let stripped = strip_ansi(data);
    state.last_output_buffer.push_str(&stripped);
    if state.last_output_buffer.len() > 500 {
        // Keep last 500 chars (char-safe: use char_indices to find boundary)
        let char_count = state.last_output_buffer.chars().count();
        if char_count > 500 {
            let skip = char_count - 500;
            if let Some((byte_idx, _)) = state.last_output_buffer.char_indices().nth(skip) {
                state.last_output_buffer.drain(..byte_idx);
            }
        }
    }

    // Prepend any buffered partial OSC sequence
    let scan = if state.osc_buffer.is_empty() {
        data.to_string()
    } else {
        let mut combined = std::mem::take(&mut state.osc_buffer);
        combined.push_str(data);
        combined
    };

    let osc_start = "\x1b]0;";
    let osc_end = '\x07';

    let mut pos = 0;
    let bytes = scan.as_bytes();
    let len = bytes.len();

    while pos < len {
        // Find next OSC start
        if let Some(rel) = scan[pos..].find(osc_start) {
            let start = pos + rel + osc_start.len();
            // Find the BEL terminator
            if let Some(end_rel) = scan[start..].find(osc_end) {
                let title = &scan[start..start + end_rel];
                process_osc_title(title, state, id, app_handle);
                pos = start + end_rel + 1;
            } else {
                // Incomplete OSC — buffer it
                state.osc_buffer = scan[pos + rel..].to_string();
                if state.osc_buffer.len() > 500 {
                    tracing::warn!(
                        "OSC buffer exceeded 500 chars for terminal {}, resetting",
                        id
                    );
                    state.osc_buffer.clear();
                }
                return;
            }
        } else {
            break;
        }
    }
}

/// Process a single extracted OSC title string.
fn process_osc_title(
    title: &str,
    state: &mut ClaudeState,
    id: &str,
    app_handle: &AppHandle,
) {
    let first_char = match title.chars().next() {
        Some(c) => c,
        None => return,
    };

    tracing::debug!("OSC title for terminal {}: {:?}", id, title);

    if BRAILLE_SPINNERS.contains(&first_char) {
        state.is_working = true;
        // Store the title after the spinner + space
        let rest = title.trim_start_matches(|c: char| BRAILLE_SPINNERS.contains(&c) || c == ' ');
        state.last_title = rest.to_string();
    } else if first_char == CLAUDE_DONE_CHAR && state.is_working {
        // Transition: working → done
        let rest = title.trim_start_matches(|c: char| c == CLAUDE_DONE_CHAR || c == ' ');
        let conv_title = if rest.is_empty() {
            state.last_title.clone()
        } else {
            rest.to_string()
        };

        // Extract last_message: look for ● in the output buffer
        let last_message = extract_last_message(&state.last_output_buffer);

        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        let event = ClaudeDoneEvent {
            id: id.to_string(),
            title: conv_title.clone(),
            timestamp,
            last_message,
        };

        tracing::info!("claude:done detected for terminal {}: {}", id, conv_title);

        let _ = app_handle.emit("claude:done", event);

        state.is_working = false;
        state.last_title = conv_title;
    } else if first_char == CLAUDE_DONE_CHAR {
        // Idle title (✳ Claude Code) — not a transition, ignore
        let rest = title.trim_start_matches(|c: char| c == CLAUDE_DONE_CHAR || c == ' ');
        if !rest.is_empty() {
            state.last_title = rest.to_string();
        }
    }
}

/// Extract the last message from the output buffer by looking for ● marker.
fn extract_last_message(buffer: &str) -> Option<String> {
    // Look for the ● (U+25CF) character which precedes Claude's last response
    if let Some(pos) = buffer.rfind('\u{25CF}') {
        let after = &buffer[pos + '\u{25CF}'.len_utf8()..];
        let trimmed = after.trim();
        if !trimmed.is_empty() {
            // Take first 200 chars max
            let msg: String = trimmed.chars().take(200).collect();
            return Some(msg);
        }
    }
    None
}

// ─── Output reader + process watcher threads ───────────────────────────────

/// Spawn two threads for a terminal:
/// 1. **Reader thread**: continuously reads output from the PTY master and emits events.
/// 2. **Watcher thread**: waits for the child process to exit, then closes the
///    PTY (via kill) to unblock the reader's blocking read call.
///
/// This two-thread pattern is needed because the PTY master does NOT return EOF
/// pipe when the child process exits — the pipe stays open as long as the
/// console handle exists. The watcher closes the console, which breaks the
/// pipe, which makes ReadFile return 0/error, which exits the reader loop.
fn spawn_reader(
    id: String,
    pty: Arc<Pty>,
    app_handle: AppHandle,
    terminals: Arc<Mutex<HashMap<String, Terminal>>>,
) -> JoinHandle<()> {
    // Spawn the process watcher thread
    let watcher_pty = pty.clone();
    let watcher_id = id.clone();
    std::thread::Builder::new()
        .name(format!("terminal-watcher-{}", &id[..8]))
        .spawn(move || {
            tracing::debug!("Watcher thread started for terminal {}", watcher_id);
            watcher_pty.wait_for_exit();
            tracing::debug!("Process exited for terminal {}, closing console", watcher_id);
            watcher_pty.close_console();
        })
        .expect("Failed to spawn terminal watcher thread");

    // Spawn the reader thread
    std::thread::Builder::new()
        .name(format!("terminal-reader-{}", &id[..8]))
        .spawn(move || {
            let mut buf = [0u8; 4096];
            let mut pending: Vec<u8> = Vec::new(); // incomplete UTF-8 bytes
            let mut claude_state = ClaudeState {
                is_working: false,
                last_title: String::new(),
                osc_buffer: String::new(),
                last_output_buffer: String::new(),
            };

            loop {
                match pty.read(&mut buf) {
                    Ok(0) => {
                        // Pipe closed — process exited (or console was closed by watcher)
                        let code = pty.exit_code().unwrap_or(-1);
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
                                t.info.exit_code = Some(code);
                            }
                        }
                        break;
                    }
                    Ok(n) => {
                        // UTF-8 incremental decoder: prepend pending bytes
                        let data_bytes = if pending.is_empty() {
                            buf[..n].to_vec()
                        } else {
                            let mut combined = std::mem::take(&mut pending);
                            combined.extend_from_slice(&buf[..n]);
                            combined
                        };

                        // Find the last valid UTF-8 boundary
                        let valid_len = find_utf8_boundary(&data_bytes);
                        if valid_len < data_bytes.len() {
                            pending = data_bytes[valid_len..].to_vec();
                        }

                        if valid_len > 0 {
                            // P34 diagnostic — scan ANSI cursor sequences on raw bytes (no-op if flag off)
                            scan_ansi_cursor_sequences(&id, &data_bytes[..valid_len]);

                            let data = String::from_utf8_lossy(&data_bytes[..valid_len]).to_string();

                            // Parse OSC titles for Claude detection BEFORE emitting output
                            // Wrapped in catch_unwind to prevent parser bugs from killing the reader
                            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                                parse_osc_titles(&data, &mut claude_state, &id, &app_handle);
                            })).map_err(|e| {
                                tracing::error!("OSC parser panicked for terminal {}: {:?}", id, e);
                            });

                            let _ = app_handle.emit(
                                "terminal:output",
                                TerminalOutputEvent {
                                    id: id.clone(),
                                    data,
                                },
                            );
                        }
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

// ─── ANSI cursor sequence scanner (P34 diagnostic) ──────────────────────────
//
// Scans a byte slice for cursor-related ANSI escape sequences and logs each
// match via tracing (target="ansi_cursor"). Bytes-level scanner (no regex dep),
// multi-byte safe (operates on raw bytes, never slices UTF-8 strings).
//
// Sequences detected (scope intentionally limited — cursor-only):
//   CSI n;m H  → CUP (cursor position absolute)
//   CSI n;m f  → HVP (alias of CUP)
//   CSI n A/B/C/D  → CUU/CUD/CUF/CUB (relative move)
//   CSI s      → save cursor
//   CSI u      → restore cursor
//   ESC 7      → DECSC (save cursor)
//   ESC 8      → DECRC (restore cursor)
//   CSI n SP q → DECSCUSR (cursor style)
//   CSI ?25 h/l → DECTCEM (show/hide cursor)
//   CSI ?2004 h/l → bracketed paste mode on/off
//
// Hot path: early return if flag disabled. When enabled, single-pass scan.
fn scan_ansi_cursor_sequences(term_id: &str, bytes: &[u8]) {
    if !ansi_cursor_debug_enabled() {
        return;
    }
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let mut i = 0;
    while i < bytes.len() {
        // Find next ESC (0x1B)
        if bytes[i] != 0x1B {
            i += 1;
            continue;
        }
        // ESC alone or ESC 7 / ESC 8 (2-byte sequences DECSC/DECRC)
        if i + 1 >= bytes.len() {
            break;
        }
        let next = bytes[i + 1];
        if next == b'7' {
            log_cursor_seq(term_id, ts, "DECSC", &bytes[i..i + 2]);
            i += 2;
            continue;
        }
        if next == b'8' {
            log_cursor_seq(term_id, ts, "DECRC", &bytes[i..i + 2]);
            i += 2;
            continue;
        }
        // Only CSI (ESC [) interests us from here
        if next != b'[' {
            i += 1;
            continue;
        }
        // Scan CSI params until final byte (0x40..=0x7E, range from ECMA-48)
        let mut j = i + 2;
        while j < bytes.len() {
            let b = bytes[j];
            if (0x40..=0x7E).contains(&b) {
                break;
            }
            j += 1;
        }
        if j >= bytes.len() {
            // Incomplete CSI at buffer end — stop scanning, will resume next chunk
            break;
        }
        let final_byte = bytes[j];
        let params = &bytes[i + 2..j];
        let full = &bytes[i..=j];
        match final_byte {
            b'H' => log_cursor_seq(term_id, ts, "CUP", full),
            b'f' => log_cursor_seq(term_id, ts, "HVP", full),
            b'A' => log_cursor_seq(term_id, ts, "CUU", full),
            b'B' => log_cursor_seq(term_id, ts, "CUD", full),
            b'C' => log_cursor_seq(term_id, ts, "CUF", full),
            b'D' => log_cursor_seq(term_id, ts, "CUB", full),
            b's' => log_cursor_seq(term_id, ts, "SCP", full),
            b'u' => log_cursor_seq(term_id, ts, "RCP", full),
            b'q' => {
                // DECSCUSR is "CSI n SP q" — check that the byte before final is 0x20 (space)
                if params.last() == Some(&0x20) {
                    log_cursor_seq(term_id, ts, "DECSCUSR", full);
                }
            }
            b'h' | b'l' => {
                // DECTCEM: "?25h"/"?25l"; bracketed paste: "?2004h"/"?2004l"
                if params.starts_with(b"?25") && params.len() == 3 {
                    log_cursor_seq(term_id, ts, "DECTCEM", full);
                } else if params.starts_with(b"?2004") && params.len() == 5 {
                    log_cursor_seq(term_id, ts, "BRACKETED_PASTE", full);
                }
            }
            _ => {}
        }
        i = j + 1;
    }
}

fn log_cursor_seq(term_id: &str, ts: u64, seq_type: &str, raw: &[u8]) {
    // Escape raw bytes for log readability: ESC → \e, other non-printable → \xNN
    let mut escaped = String::with_capacity(raw.len() * 2);
    for &b in raw {
        match b {
            0x1B => escaped.push_str("\\e"),
            0x20..=0x7E => escaped.push(b as char),
            _ => escaped.push_str(&format!("\\x{:02x}", b)),
        }
    }
    // Use INFO level so the default EnvFilter ("info") picks it up without needing
    // a custom target directive. The scanner only runs when ANSI_CURSOR_DEBUG is on,
    // so INFO noise is bounded by the user toggle.
    tracing::info!(
        target: "ansi_cursor",
        "ts={} term_id={} seq={} raw={}",
        ts,
        term_id,
        seq_type,
        escaped
    );
}

// ─── UTF-8 boundary helper ──────────────────────────────────────────────────

/// Find the last valid UTF-8 boundary in a byte slice.
/// Returns the length of the valid prefix. Incomplete multi-byte sequences
/// at the end are excluded so they can be prepended to the next read.
fn find_utf8_boundary(bytes: &[u8]) -> usize {
    if std::str::from_utf8(bytes).is_ok() {
        return bytes.len();
    }
    let len = bytes.len();
    // Walk backwards up to 4 bytes to find incomplete sequence
    for i in 1..=4.min(len) {
        let pos = len - i;
        let b = bytes[pos];
        if b < 0x80 {
            // ASCII byte — the error is elsewhere, return full length
            return len;
        }
        // Check if this is a leading byte of a multi-byte sequence
        let expected_len = if b >= 0xF0 {
            4
        } else if b >= 0xE0 {
            3
        } else if b >= 0xC0 {
            2
        } else {
            continue; // continuation byte, keep looking
        };
        // If the sequence is incomplete, split here
        if pos + expected_len > len {
            return pos;
        }
        // Sequence has enough bytes but is invalid — no incomplete char
        return len;
    }
    len
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
    // Detect bracketed paste (`\x1b[200~` prefix) to trace potential duplicates/disappearances.
    // Pastes log at INFO (visible in prod), regular writes stay at DEBUG.
    // Detect bracketed paste to trace potential duplicates/disappearances.
    // Pastes log at INFO (visible in prod), regular writes stay at DEBUG.
    let is_paste = params.data.starts_with("\x1b[200~");
    let write_id = uuid::Uuid::new_v4().simple().to_string();
    let short_id = &write_id[..8];
    if is_paste {
        tracing::info!(
            "IPC: write_terminal id={} write_id={} PASTE len={}",
            params.id,
            short_id,
            params.data.len()
        );
    } else {
        tracing::debug!(
            "IPC: write_terminal id={} write_id={} len={}",
            params.id,
            short_id,
            params.data.len()
        );
    }
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

#[derive(Debug, Deserialize)]
pub struct SetAnsiCursorDebugParams {
    pub enabled: bool,
}

/// P34 diagnostic — toggle ANSI cursor sequence logging.
#[tauri::command]
pub fn set_ansi_cursor_debug_cmd(params: SetAnsiCursorDebugParams) -> Result<(), String> {
    tracing::info!("IPC: set_ansi_cursor_debug enabled={}", params.enabled);
    set_ansi_cursor_debug(params.enabled);
    Ok(())
}
