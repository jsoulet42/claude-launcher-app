mod config;
mod conpty;
mod error;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    info!("Claude Launcher v{} starting", env!("CARGO_PKG_VERSION"));

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
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
            terminal::create_terminal,
            terminal::write_terminal,
            terminal::resize_terminal,
            terminal::close_terminal,
            terminal::list_terminals,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
