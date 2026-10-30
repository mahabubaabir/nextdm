//! NextDM desktop shell: Tauri commands, engine lifecycle and event bridge.

mod integration;
mod ipc;

use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use nextdm_browser_host::protocol::HostRequest;
use nextdm_engine::{
    DownloadInfo, DownloadSpec, DownloadStatus, Engine, EngineConfig, EngineEvent, EngineStats,
};
use nextdm_media::{ytdlp, MediaInfo};
use serde_json::Value;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, State,
};
use tracing::info;

struct AppState {
    engine: Engine,
    quitting: AtomicBool,
}

fn error_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[tauri::command]
async fn add_download(
    state: State<'_, AppState>,
    spec: DownloadSpec,
) -> Result<DownloadInfo, String> {
    state.engine.add(spec).await.map_err(error_string)
}

#[tauri::command]
fn list_downloads(state: State<'_, AppState>) -> Result<Vec<DownloadInfo>, String> {
    state.engine.list().map_err(error_string)
}

#[tauri::command]
fn get_download(state: State<'_, AppState>, id: String) -> Result<Option<DownloadInfo>, String> {
    let id = uuid::Uuid::parse_str(&id).map_err(error_string)?;
    state.engine.get(id).map_err(error_string)
}

#[tauri::command]
async fn start_download(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let id = uuid::Uuid::parse_str(&id).map_err(error_string)?;
    state.engine.start(id).map_err(error_string)
}

#[tauri::command]
async fn pause_download(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let id = uuid::Uuid::parse_str(&id).map_err(error_string)?;
    state.engine.pause(id).map_err(error_string)
}

#[tauri::command]
async fn resume_download(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let id = uuid::Uuid::parse_str(&id).map_err(error_string)?;
    state.engine.resume(id).map_err(error_string)
}

#[tauri::command]
async fn cancel_download(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let id = uuid::Uuid::parse_str(&id).map_err(error_string)?;
    state.engine.cancel(id).map_err(error_string)
}

#[tauri::command]
async fn remove_download(
    state: State<'_, AppState>,
    id: String,
    delete_file: bool,
) -> Result<(), String> {
    let id = uuid::Uuid::parse_str(&id).map_err(error_string)?;
    state.engine.remove(id, delete_file).map_err(error_string)
}

#[tauri::command]
fn download_stats(state: State<'_, AppState>) -> Result<EngineStats, String> {
    state.engine.stats().map_err(error_string)
}

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> Result<BTreeMap<String, Value>, String> {
    state
        .engine
        .store()
        .all_settings()
        .map_err(error_string)
}

#[tauri::command]
fn set_setting(state: State<'_, AppState>, key: String, value: Value) -> Result<(), String> {
    state.engine.set_setting(&key, value).map_err(error_string)
}

#[tauri::command]
fn set_speed_limit(state: State<'_, AppState>, bytes_per_second: u64) -> Result<(), String> {
    state
        .engine
        .set_speed_limit((bytes_per_second > 0).then_some(bytes_per_second))
        .map_err(error_string)
}

#[tauri::command]
fn set_max_connections(state: State<'_, AppState>, connections: usize) -> Result<(), String> {
    state.engine.set_max_connections(connections).map_err(error_string)
}

#[tauri::command]
fn default_download_dir(state: State<'_, AppState>) -> String {
    state.engine.default_dir().to_string_lossy().to_string()
}

#[tauri::command]
fn set_default_dir(state: State<'_, AppState>, path: String) -> Result<(), String> {
    state
        .engine
        .set_default_dir(PathBuf::from(path))
        .map_err(error_string)
}

#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    std::process::Command::new("xdg-open")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(error_string)
}

#[tauri::command]
fn reveal_path(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    let directory = path.parent().unwrap_or(&path);
    open_path(directory.to_string_lossy().to_string())
}

#[tauri::command]
async fn yt_dlp_available() -> bool {
    nextdm_media::yt_dlp_available().await
}

#[tauri::command]
async fn media_probe(url: String) -> Result<MediaInfo, String> {
    ytdlp::probe(&url).await.map_err(error_string)
}

#[tauri::command]
async fn media_download(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    url: String,
    format_id: Option<String>,
    directory: Option<String>,
    file_stem: Option<String>,
) -> Result<DownloadInfo, String> {
    let directory = directory
        .map(PathBuf::from)
        .unwrap_or_else(|| state.engine.default_dir());

    let _ = app.emit(
        "media://status",
        serde_json::json!({ "phase": "downloading", "url": url }),
    );

    let path = ytdlp::download(&url, format_id.as_deref(), &directory, file_stem.as_deref())
        .await
        .map_err(|error| {
            let _ = app.emit(
                "media://status",
                serde_json::json!({ "phase": "error", "url": url, "message": error.to_string() }),
            );
            error_string(error)
        })?;

    let info = state
        .engine
        .register_completed_file(path, url.clone())
        .map_err(error_string)?;

    let _ = app.emit(
        "media://status",
        serde_json::json!({ "phase": "finished", "url": url, "download": info }),
    );
    Ok(info)
}

#[tauri::command]
fn engine_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[tauri::command]
fn install_browser_integration(chromium: bool, firefox: bool) -> Result<Vec<String>, String> {
    integration::install(chromium, firefox)
}

/// If another NextDM instance already owns the IPC socket, ask it to show its
/// window and report success so this process can exit.
fn forward_to_running_instance() -> bool {
    let path = nextdm_browser_host::ipc::socket_path();
    let Ok(mut stream) = std::os::unix::net::UnixStream::connect(path) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));

    let Ok(payload) = serde_json::to_vec(&HostRequest::ShowWindow) else {
        return false;
    };
    if stream.write_all(&payload).is_err() || stream.write_all(b"\n").is_err() {
        return false;
    }

    let mut line = String::new();
    let _ = BufReader::new(stream).read_line(&mut line);
    true
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, "tray-show", "Show NextDM", true, None::<&str>)?;
    let pause_item = MenuItem::with_id(app, "tray-pause", "Pause all", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "tray-quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &pause_item, &quit_item])?;

    let mut builder = TrayIconBuilder::with_id("nextdm-tray")
        .tooltip("NextDM")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "tray-show" => show_main(app),
            "tray-pause" => pause_all(app),
            "tray-quit" => quit_app(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn pause_all(app: &tauri::AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    match state.engine.list() {
        Ok(downloads) => {
            for download in downloads {
                if matches!(
                    download.status,
                    DownloadStatus::Queued | DownloadStatus::Connecting | DownloadStatus::Downloading
                ) {
                    let _ = state.engine.pause(download.id);
                }
            }
        }
        Err(error) => tracing::warn!(%error, "could not pause downloads from the tray"),
    }
}

fn quit_app(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<AppState>() {
        state.quitting.store(true, Ordering::SeqCst);
        tauri::async_runtime::block_on(state.engine.shutdown());
    }
    let _ = std::fs::remove_file(nextdm_browser_host::ipc::socket_path());
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if std::env::var_os("NEXTDM_ALLOW_MULTIPLE").is_none() && forward_to_running_instance() {
        return;
    }

    let filter = tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
        "nextdm_engine=info,nextdm_desktop_lib=info".into()
    });
    let _ = tracing_subscriber::fmt().with_env_filter(filter).try_init();

    let background = std::env::args().skip(1).any(|arg| arg == "--background");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(move |app| {
            let data_dir = app.path().app_data_dir()?;
            let download_dir = app
                .path()
                .download_dir()
                .unwrap_or_else(|_| data_dir.join("Downloads"));
            let config = EngineConfig::new(data_dir, download_dir);
            let engine = Engine::new(config)?;

            if let Some(Value::Number(limit)) = engine.setting("speed_limit")? {
                if let Some(limit) = limit.as_u64() {
                    engine.set_speed_limit((limit > 0).then_some(limit))?;
                }
            }
            if let Some(Value::Number(connections)) = engine.setting("max_connections")? {
                if let Some(connections) = connections.as_u64() {
                    engine.set_max_connections(connections as usize)?;
                }
            }
            if let Some(Value::String(directory)) = engine.setting("default_dir")? {
                engine.set_default_dir(PathBuf::from(directory))?;
            }

            let auto_resume = engine
                .setting("auto_resume")?
                .and_then(|value| value.as_bool())
                .unwrap_or(true);

            app.manage(AppState {
                engine: engine.clone(),
                quitting: AtomicBool::new(false),
            });

            build_tray(app)?;
            ipc::spawn(app.handle().clone(), engine.clone());

            let resume_engine = engine.clone();
            tauri::async_runtime::spawn(async move {
                if auto_resume {
                    match resume_engine.resume_pending() {
                        Ok(resumed) => info!(resumed, "resumed unfinished downloads"),
                        Err(error) => tracing::warn!(%error, "failed to resume downloads"),
                    }
                }
                info!("engine ready");
            });

            if background {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut events = engine.subscribe();
                loop {
                    match events.recv().await {
                        Ok(event) => {
                            let _ = handle.emit("engine://event", event);
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                            info!(skipped, "dropped engine events");
                        }
                        Err(_) => break,
                    }
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                let keep_running = app
                    .try_state::<AppState>()
                    .map(|state| {
                        !state.quitting.load(Ordering::SeqCst)
                            && state
                                .engine
                                .setting("close_to_tray")
                                .ok()
                                .flatten()
                                .and_then(|value| value.as_bool())
                                .unwrap_or(false)
                    })
                    .unwrap_or(false);

                if keep_running {
                    api.prevent_close();
                    let _ = window.hide();
                    return;
                }

                if let Some(state) = app.try_state::<AppState>() {
                    tauri::async_runtime::block_on(state.engine.shutdown());
                }
                let _ = std::fs::remove_file(nextdm_browser_host::ipc::socket_path());
            }
        })
        .invoke_handler(tauri::generate_handler![
            add_download,
            list_downloads,
            get_download,
            start_download,
            pause_download,
            resume_download,
            cancel_download,
            remove_download,
            download_stats,
            get_settings,
            set_setting,
            set_speed_limit,
            set_max_connections,
            default_download_dir,
            set_default_dir,
            open_path,
            reveal_path,
            yt_dlp_available,
            media_probe,
            media_download,
            engine_version,
            install_browser_integration,
        ])
        .run(tauri::generate_context!())
        .expect("error while running NextDM");
}

/// Native messaging entry point. Called by the browser through the installed
/// launcher script before Tauri is initialized.
pub fn run_native_host() -> ! {
    std::process::exit(nextdm_browser_host::run_native_host());
}

#[allow(dead_code)]
fn _assert_event_is_send_sync() {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<EngineEvent>();
}
