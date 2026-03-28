//! Low-level ConPTY wrapper for Windows pseudo-terminals.
//!
//! This module provides a safe(ish) Rust wrapper around the Windows ConPTY API,
//! handling pipe creation, pseudo-console allocation, process spawning, and I/O.

use std::mem;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::path::PathBuf;
use std::ptr;

use windows::Win32::Foundation::{CloseHandle, BOOL, HANDLE, WAIT_OBJECT_0, WAIT_TIMEOUT};
use windows::Win32::Security::SECURITY_ATTRIBUTES;
use windows::Win32::System::Console::{
    ClosePseudoConsole, CreatePseudoConsole, ResizePseudoConsole, COORD, HPCON,
};
use windows::Win32::System::Pipes::CreatePipe;
use windows::Win32::System::Threading::{
    CreateProcessW, DeleteProcThreadAttributeList, GetExitCodeProcess,
    InitializeProcThreadAttributeList, UpdateProcThreadAttribute, WaitForSingleObject,
    CREATE_UNICODE_ENVIRONMENT, EXTENDED_STARTUPINFO_PRESENT, LPPROC_THREAD_ATTRIBUTE_LIST,
    PROCESS_INFORMATION, STARTUPINFOEXW,
};
use windows::Win32::Storage::FileSystem::{ReadFile, WriteFile};

/// Not directly exposed in windows-rs 0.58 — defined per MS docs.
const PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE: usize = 0x00020016;

/// Options for creating a ConPTY instance.
pub struct ConPtyOptions {
    pub shell: String,
    pub cwd: Option<String>,
    pub cols: u16,
    pub rows: u16,
}

/// Handle to a ConPTY pseudo-console with its associated pipes and child process.
///
/// The console handle is wrapped in Mutex<Option<>> so it can be closed early
/// from the process watcher thread. Closing the console unblocks any pending
/// ReadFile on the output pipe — this is the standard pattern for detecting
/// process exit with ConPTY (the pipe does NOT close automatically on exit).
pub struct ConPty {
    /// Wrapped in Mutex<Option<>> so close_console() can close it from another thread.
    console: std::sync::Mutex<Option<HPCON>>,
    /// Pipe write-end for sending data to the ConPTY stdin
    pipe_input: OwnedHandle,
    /// Pipe read-end for receiving data from the ConPTY stdout
    pipe_output: OwnedHandle,
    /// Handle to the spawned child process (shell)
    process: OwnedHandle,
}

// SAFETY: ConPty handles are thread-safe — Windows pipe and console handles
// can be used from any thread. The OS serializes concurrent writes.
unsafe impl Send for ConPty {}
unsafe impl Sync for ConPty {}

impl ConPty {
    /// Create a new ConPTY and spawn the shell process.
    ///
    /// Steps:
    /// 1. CreatePipe x2 (stdin pair + stdout pair)
    /// 2. CreatePseudoConsole with requested size
    /// 3. InitializeProcThreadAttributeList + UpdateProcThreadAttribute
    /// 4. CreateProcessW with STARTUPINFOEXW
    pub fn new(options: ConPtyOptions) -> Result<Self, std::io::Error> {
        tracing::info!(
            "ConPty::new shell={} cwd={:?} cols={} rows={}",
            options.shell,
            options.cwd,
            options.cols,
            options.rows
        );

        unsafe {
            // --- Create pipes ---
            let mut pty_input_read = HANDLE::default();
            let mut pty_input_write = HANDLE::default();
            let sa = SECURITY_ATTRIBUTES {
                nLength: mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
                bInheritHandle: BOOL(1),
                lpSecurityDescriptor: ptr::null_mut(),
            };
            CreatePipe(&mut pty_input_read, &mut pty_input_write, Some(&sa), 0)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, format!("CreatePipe (stdin): {}", e)))?;

            let mut pty_output_read = HANDLE::default();
            let mut pty_output_write = HANDLE::default();
            CreatePipe(&mut pty_output_read, &mut pty_output_write, Some(&sa), 0)
                .map_err(|e| {
                    let _ = CloseHandle(pty_input_read);
                    let _ = CloseHandle(pty_input_write);
                    std::io::Error::new(std::io::ErrorKind::Other, format!("CreatePipe (stdout): {}", e))
                })?;

            // --- Create pseudo console ---
            let size = COORD {
                X: options.cols as i16,
                Y: options.rows as i16,
            };

            let console = CreatePseudoConsole(size, pty_input_read, pty_output_write, 0)
                .map_err(|e| {
                    let _ = CloseHandle(pty_input_read);
                    let _ = CloseHandle(pty_input_write);
                    let _ = CloseHandle(pty_output_read);
                    let _ = CloseHandle(pty_output_write);
                    std::io::Error::new(std::io::ErrorKind::Other, format!("CreatePseudoConsole: {}", e))
                })?;

            // Close the pipe ends that the ConPTY now owns
            let _ = CloseHandle(pty_input_read);
            let _ = CloseHandle(pty_output_write);

            // --- Initialize proc thread attribute list ---
            let mut attr_list_size: usize = 0;
            let _ = InitializeProcThreadAttributeList(
                LPPROC_THREAD_ATTRIBUTE_LIST(ptr::null_mut()),
                1,
                0,
                &mut attr_list_size,
            );

            let attr_list_buf = vec![0u8; attr_list_size];
            let attr_list = LPPROC_THREAD_ATTRIBUTE_LIST(attr_list_buf.as_ptr() as *mut _);

            InitializeProcThreadAttributeList(attr_list, 1, 0, &mut attr_list_size)
                .map_err(|e| {
                    ClosePseudoConsole(console);
                    let _ = CloseHandle(pty_input_write);
                    let _ = CloseHandle(pty_output_read);
                    std::io::Error::new(std::io::ErrorKind::Other, format!("InitializeProcThreadAttributeList: {}", e))
                })?;

            UpdateProcThreadAttribute(
                attr_list,
                0,
                PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE,
                Some(console.0 as *const std::ffi::c_void),
                mem::size_of::<HPCON>(),
                None,
                None,
            )
            .map_err(|e| {
                DeleteProcThreadAttributeList(attr_list);
                ClosePseudoConsole(console);
                let _ = CloseHandle(pty_input_write);
                let _ = CloseHandle(pty_output_read);
                std::io::Error::new(std::io::ErrorKind::Other, format!("UpdateProcThreadAttribute: {}", e))
            })?;

            // --- Spawn the shell process ---
            let mut startup_info = STARTUPINFOEXW::default();
            startup_info.StartupInfo.cb = mem::size_of::<STARTUPINFOEXW>() as u32;
            startup_info.lpAttributeList = attr_list;

            let mut proc_info = PROCESS_INFORMATION::default();

            let mut cmd_wide: Vec<u16> = options
                .shell
                .encode_utf16()
                .chain(std::iter::once(0))
                .collect();

            let cwd_wide: Option<Vec<u16>> = options.cwd.as_ref().map(|cwd| {
                let path = PathBuf::from(cwd);
                path.to_string_lossy()
                    .encode_utf16()
                    .chain(std::iter::once(0))
                    .collect()
            });
            let cwd_ptr = cwd_wide
                .as_ref()
                .map(|v| windows::core::PCWSTR(v.as_ptr()))
                .unwrap_or(windows::core::PCWSTR::null());

            let create_result = CreateProcessW(
                None,
                windows::core::PWSTR(cmd_wide.as_mut_ptr()),
                None,
                None,
                false,
                EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT,
                None,
                cwd_ptr,
                &startup_info.StartupInfo,
                &mut proc_info,
            );

            DeleteProcThreadAttributeList(attr_list);

            create_result.map_err(|e| {
                ClosePseudoConsole(console);
                let _ = CloseHandle(pty_input_write);
                let _ = CloseHandle(pty_output_read);
                std::io::Error::new(std::io::ErrorKind::Other, format!("CreateProcessW: {}", e))
            })?;

            let _ = CloseHandle(proc_info.hThread);

            let pipe_input = OwnedHandle::from_raw_handle(pty_input_write.0);
            let pipe_output = OwnedHandle::from_raw_handle(pty_output_read.0);
            let process = OwnedHandle::from_raw_handle(proc_info.hProcess.0);

            tracing::info!("ConPty created successfully, process spawned");

            Ok(ConPty {
                console: std::sync::Mutex::new(Some(console)),
                pipe_input,
                pipe_output,
                process,
            })
        }
    }

    /// Write data to the ConPTY stdin pipe.
    pub fn write(&self, data: &[u8]) -> Result<usize, std::io::Error> {
        let handle = HANDLE(self.pipe_input.as_raw_handle());
        let mut bytes_written = 0u32;
        unsafe {
            WriteFile(handle, Some(data), Some(&mut bytes_written), None)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::BrokenPipe, format!("WriteFile: {}", e)))?;
        }
        Ok(bytes_written as usize)
    }

    /// Read data from the ConPTY stdout pipe (blocking).
    /// Returns Ok(0) when the pipe is closed (process exited or console closed).
    pub fn read(&self, buf: &mut [u8]) -> Result<usize, std::io::Error> {
        let handle = HANDLE(self.pipe_output.as_raw_handle());
        let mut bytes_read = 0u32;
        unsafe {
            match ReadFile(handle, Some(buf), Some(&mut bytes_read), None) {
                Ok(()) => Ok(bytes_read as usize),
                Err(e) => {
                    let hresult: i32 = e.code().0;
                    tracing::debug!(
                        "ConPty ReadFile error: hresult=0x{:08X} ({}) bytes_read={}",
                        hresult as u32, e, bytes_read
                    );
                    // Any ReadFile error after process exit = EOF.
                    // Common: ERROR_BROKEN_PIPE, ERROR_NO_DATA, ERROR_PIPE_NOT_CONNECTED.
                    Ok(0)
                }
            }
        }
    }

    /// Resize the ConPTY to new dimensions.
    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), std::io::Error> {
        let size = COORD {
            X: cols as i16,
            Y: rows as i16,
        };
        let guard = self.console.lock().map_err(|e| {
            std::io::Error::new(std::io::ErrorKind::Other, format!("Console lock poisoned: {}", e))
        })?;
        if let Some(console) = *guard {
            unsafe {
                ResizePseudoConsole(console, size)
                    .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, format!("ResizePseudoConsole: {}", e)))?;
            }
            tracing::debug!("ConPty resized to {}x{}", cols, rows);
        }
        Ok(())
    }

    /// Check if the child process is still alive.
    pub fn is_alive(&self) -> bool {
        let handle = HANDLE(self.process.as_raw_handle());
        unsafe {
            let result = WaitForSingleObject(handle, 0);
            result == WAIT_TIMEOUT
        }
    }

    /// Wait for the child process to exit (blocking).
    /// Returns true if the process exited, false on error.
    pub fn wait_for_exit(&self) -> bool {
        let handle = HANDLE(self.process.as_raw_handle());
        unsafe {
            let result = WaitForSingleObject(handle, u32::MAX);
            result == WAIT_OBJECT_0
        }
    }

    /// Close the ConPTY console handle early.
    /// This unblocks any pending ReadFile on the output pipe.
    /// Safe to call multiple times — subsequent calls are no-ops.
    pub fn close_console(&self) {
        if let Ok(mut guard) = self.console.lock() {
            if let Some(console) = guard.take() {
                unsafe {
                    ClosePseudoConsole(console);
                }
                tracing::debug!("ConPty console closed early (process exited)");
            }
        }
    }

    /// Get the exit code of the child process, if it has exited.
    pub fn exit_code(&self) -> Option<i32> {
        let handle = HANDLE(self.process.as_raw_handle());
        let mut code: u32 = 0;
        unsafe {
            if GetExitCodeProcess(handle, &mut code).is_ok() {
                if code == 259 {
                    // STILL_ACTIVE
                    None
                } else {
                    Some(code as i32)
                }
            } else {
                None
            }
        }
    }
}

impl Drop for ConPty {
    fn drop(&mut self) {
        // Close the console first (if not already closed) to unblock ReadFile
        if let Ok(mut guard) = self.console.lock() {
            if let Some(console) = guard.take() {
                unsafe {
                    ClosePseudoConsole(console);
                }
            }
        }
        tracing::debug!("ConPty dropped, handles released");
        // OwnedHandle fields are dropped automatically after this
    }
}
