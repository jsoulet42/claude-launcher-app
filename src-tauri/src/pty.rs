//! Cross-platform pseudo-terminal wrapper.
//!
//! Thin wrapper around the `portable-pty` crate, which provides a unified PTY
//! API over ConPTY (Windows) and openpty (Unix). Replaces the previous
//! Windows-only `conpty.rs` module while keeping an identical public API so
//! `terminal.rs` only needs a mechanical rename.

use std::io::{Read, Write};
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtySize};

/// Options for creating a Pty instance.
pub struct PtyOptions {
    /// Command-line to spawn, e.g. `"pwsh.exe -NoExit"` or `"pwsh.exe -NoExit -Command claude"`.
    /// Parsed into program + args via `split_command`.
    pub shell: String,
    pub cwd: Option<String>,
    pub cols: u16,
    pub rows: u16,
}

/// Handle to a PTY pair with its associated child process.
///
/// The master, child, reader and writer are all wrapped in `Mutex` because
/// `portable-pty` exposes them as `Send` but not `Sync`. The reader/writer
/// trait objects are not `Clone` either, so we own them behind the mutex.
///
/// `killer` is a separate `ChildKiller` cloned from the child at creation
/// time. It can be used to signal the child (kill) WITHOUT acquiring the
/// `child` Mutex — which is essential because `child.wait()` blocks that
/// Mutex for the entire lifetime of the process (held by the watcher thread).
pub struct Pty {
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
    killer: Arc<Mutex<Box<dyn ChildKiller + Send + Sync>>>,
    reader: Arc<Mutex<Box<dyn Read + Send>>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
}

impl Pty {
    /// Create a new PTY and spawn the shell process.
    pub fn new(options: PtyOptions) -> Result<Self, std::io::Error> {
        tracing::info!(
            "Pty::new shell={} cwd={:?} cols={} rows={}",
            options.shell,
            options.cwd,
            options.cols,
            options.rows
        );

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: options.rows,
                cols: options.cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| {
                let msg = format!("openpty: {}", e);
                tracing::error!("{}", msg);
                std::io::Error::new(std::io::ErrorKind::Other, msg)
            })?;

        let (program, args) = split_command(&options.shell);
        if program.is_empty() {
            let msg = format!("Pty::new: empty shell command: {:?}", options.shell);
            tracing::error!("{}", msg);
            return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, msg));
        }

        let mut cmd = CommandBuilder::new(&program);
        for a in &args {
            cmd.arg(a);
        }
        if let Some(cwd) = options.cwd.as_ref() {
            cmd.cwd(cwd);
        }

        // Ensure TERM is set for xterm.js compatibility. When the app is launched
        // from a desktop shortcut (not a terminal), TERM may not be inherited.
        if cmd.get_env("TERM").is_none() {
            cmd.env("TERM", "xterm-256color");
            tracing::debug!("TERM not set, defaulting to xterm-256color");
        }

        let child = pair.slave.spawn_command(cmd).map_err(|e| {
            let msg = format!("spawn_command: {}", e);
            tracing::error!("{}", msg);
            std::io::Error::new(std::io::ErrorKind::Other, msg)
        })?;

        // Clone the killer BEFORE wrapping child in Mutex. This killer is
        // independent — it can terminate the child without locking the main
        // Child Mutex (which is held by the watcher thread during wait()).
        let killer = child.clone_killer();

        // Drop the slave explicitly: once the child inherited it, we don't need
        // to hold it. Keeping it open would prevent the master from seeing EOF
        // when the child exits.
        drop(pair.slave);

        let reader = pair.master.try_clone_reader().map_err(|e| {
            let msg = format!("try_clone_reader: {}", e);
            tracing::error!("{}", msg);
            std::io::Error::new(std::io::ErrorKind::Other, msg)
        })?;

        let writer = pair.master.take_writer().map_err(|e| {
            let msg = format!("take_writer: {}", e);
            tracing::error!("{}", msg);
            std::io::Error::new(std::io::ErrorKind::Other, msg)
        })?;

        tracing::info!("Pty created successfully, process spawned (program={})", program);

        Ok(Pty {
            master: Arc::new(Mutex::new(pair.master)),
            child: Arc::new(Mutex::new(child)),
            killer: Arc::new(Mutex::new(killer)),
            reader: Arc::new(Mutex::new(reader)),
            writer: Arc::new(Mutex::new(writer)),
        })
    }

    /// Write data to the PTY master (goes to the child's stdin).
    pub fn write(&self, data: &[u8]) -> Result<usize, std::io::Error> {
        let mut w = self.writer.lock().map_err(|e| {
            std::io::Error::new(
                std::io::ErrorKind::Other,
                format!("writer lock poisoned: {}", e),
            )
        })?;
        let n = w.write(data)?;
        w.flush()?;
        Ok(n)
    }

    /// Read data from the PTY master (blocking).
    /// Returns Ok(0) when EOF is reached (child exited or master dropped).
    pub fn read(&self, buf: &mut [u8]) -> Result<usize, std::io::Error> {
        let mut r = self.reader.lock().map_err(|e| {
            std::io::Error::new(
                std::io::ErrorKind::Other,
                format!("reader lock poisoned: {}", e),
            )
        })?;
        match r.read(buf) {
            Ok(n) => Ok(n),
            Err(e) => {
                tracing::debug!("Pty read error: {} ({:?})", e, e.kind());
                // Any read error after child exit = EOF. Match the tolerant
                // behaviour of the previous ConPty implementation.
                Ok(0)
            }
        }
    }

    /// Resize the PTY to new dimensions.
    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), std::io::Error> {
        let master = self.master.lock().map_err(|e| {
            std::io::Error::new(
                std::io::ErrorKind::Other,
                format!("master lock poisoned: {}", e),
            )
        })?;
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| {
                let msg = format!("resize: {}", e);
                tracing::error!("{}", msg);
                std::io::Error::new(std::io::ErrorKind::Other, msg)
            })?;
        tracing::debug!("Pty resized to {}x{}", cols, rows);
        Ok(())
    }

    /// Check if the child process is still alive.
    #[allow(dead_code)]
    pub fn is_alive(&self) -> bool {
        let mut child = match self.child.lock() {
            Ok(c) => c,
            Err(_) => return false,
        };
        matches!(child.try_wait(), Ok(None))
    }

    /// Wait for the child process to exit (blocking).
    /// Returns true if wait succeeded, false on error.
    pub fn wait_for_exit(&self) -> bool {
        let mut child = match self.child.lock() {
            Ok(c) => c,
            Err(_) => return false,
        };
        child.wait().is_ok()
    }

    /// Close the PTY early by killing the child process.
    /// This releases any pending blocking read() (EOF on reader).
    /// Safe to call multiple times — subsequent calls are no-ops once the
    /// child has already exited.
    ///
    /// Uses the independent `killer` (not the main Child Mutex) so it works
    /// even while the watcher thread is blocked inside `child.wait()`.
    pub fn close_console(&self) {
        if let Ok(mut killer) = self.killer.lock() {
            let _ = killer.kill();
            tracing::debug!("Pty closed early (kill sent via killer)");
        }
    }

    /// Get the exit code of the child process, if it has exited.
    pub fn exit_code(&self) -> Option<i32> {
        let mut child = self.child.lock().ok()?;
        match child.try_wait() {
            Ok(Some(status)) => Some(status.exit_code() as i32),
            _ => None,
        }
    }
}

impl Drop for Pty {
    fn drop(&mut self) {
        // Use the independent killer — the child Mutex may be held by the
        // watcher thread blocked in wait().
        if let Ok(mut killer) = self.killer.lock() {
            let _ = killer.kill();
        }
        tracing::debug!("Pty dropped");
    }
}

/// Split a shell command-line into (program, args), honouring double quotes.
///
/// Covers the formats produced by `resolve_shell()` in terminal.rs, e.g.:
///   `"pwsh.exe"`                                 -> ("pwsh.exe", [])
///   `"pwsh.exe -NoExit"`                         -> ("pwsh.exe", ["-NoExit"])
///   `"pwsh.exe -NoExit -Command claude"`         -> ("pwsh.exe", ["-NoExit", "-Command", "claude"])
///   `"pwsh.exe -NoExit -Command \"echo hi\""`    -> ("pwsh.exe", ["-NoExit", "-Command", "echo hi"])
fn split_command(cmdline: &str) -> (String, Vec<String>) {
    let mut parts: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    for c in cmdline.chars() {
        match c {
            '"' => in_quotes = !in_quotes,
            ' ' if !in_quotes => {
                if !current.is_empty() {
                    parts.push(std::mem::take(&mut current));
                }
            }
            _ => current.push(c),
        }
    }
    if !current.is_empty() {
        parts.push(current);
    }
    if parts.is_empty() {
        return (String::new(), Vec::new());
    }
    let program = parts.remove(0);
    (program, parts)
}
