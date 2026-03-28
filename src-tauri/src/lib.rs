mod config;
mod error;

use config::ConfigData;
use tracing::info;

#[tauri::command]
fn get_config() -> Result<ConfigData, String> {
    info!("IPC: get_config called");
    config::load_config()
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
        .invoke_handler(tauri::generate_handler![get_config, get_app_version])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
