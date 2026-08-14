mod commands;
mod config;
mod error;
mod git;
mod history;
mod pty;
mod scanner;
mod session;
mod terminal;

use config::{ConfigData, ValidationLevel, ValidationMessage};
use tauri::Manager;
use terminal::TerminalManager;
use tracing::{error, info};

#[tauri::command]
fn get_config() -> Result<ConfigData, String> {
    info!("IPC: get_config called");
    config::load_config()
}

#[tauri::command]
fn save_config(config: ConfigData) -> Result<(), String> {
    info!("IPC: save_config called");
    let messages = config::validate_config(&config);
    let errors: Vec<&ValidationMessage> = messages
        .iter()
        .filter(|m| m.level == ValidationLevel::Error)
        .collect();
    if !errors.is_empty() {
        let msg = format!(
            "Config invalide, sauvegarde refusee :\n{}",
            errors.iter().map(|e| format!("  - [{}] {}", e.path, e.message)).collect::<Vec<_>>().join("\n")
        );
        error!("{}", msg);
        return Err(msg);
    }
    config::save_config(&config)
}

#[tauri::command]
fn validate_config(config: ConfigData) -> Vec<ValidationMessage> {
    info!("IPC: validate_config called");
    config::validate_config(&config)
}

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// WebKitGTK + pilote NVIDIA propriétaire : le renderer DMABUF produit des
/// artefacts d'affichage (frames périmées, zones non redessinées) — dans un
/// terminal embarqué, ça donne des listes de complétion "au-dessus" du prompt,
/// des caractères fantômes et des lignes qui semblent se dupliquer, alors que
/// la logique PTY/xterm est correcte (vérifié par repro WSLg : rendu sain).
/// Le contournement standard Tauri est de désactiver DMABUF avant la création
/// du webview. On ne l'applique que si un pilote NVIDIA est présent, et jamais
/// par-dessus un choix explicite de l'utilisateur.
#[cfg(target_os = "linux")]
fn apply_webkit_gpu_workarounds() {
    let nvidia = std::path::Path::new("/proc/driver/nvidia").exists()
        || std::path::Path::new("/sys/module/nvidia").exists();
    if nvidia && std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        info!("NVIDIA driver detected — setting WEBKIT_DISABLE_DMABUF_RENDERER=1 (WebKitGTK rendering artifact workaround)");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    info!("Claude Launcher v{} starting", env!("CARGO_PKG_VERSION"));

    #[cfg(target_os = "linux")]
    apply_webkit_gpu_workarounds();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let manager = TerminalManager::new(handle);
            app.manage(manager);
            info!("TerminalManager registered as managed state");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            validate_config,
            get_app_version,
            terminal::get_default_shell,
            terminal::create_terminal,
            terminal::write_terminal,
            terminal::resize_terminal,
            terminal::close_terminal,
            terminal::list_terminals,
            terminal::get_terminal_buffer,
            terminal::debug_log,
            terminal::set_ansi_cursor_debug_cmd,
            git::get_git_info,
            git::get_git_branch,
            git::format_title,
            scanner::scan_projects,
            scanner::detect_project_stack,
            commands::resolve_initial_commands,
            session::save_session,
            session::load_session,
            session::clear_session,
            history::add_history_entry,
            history::get_history,
            history::get_last_launch,
            history::get_preset_suggestions,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::ExitRequested { .. } = &event {
            info!("Application exit requested — closing all terminals");
            if let Some(manager) = app_handle.try_state::<TerminalManager>() {
                manager.close_all();
            }
        }
    });
}
