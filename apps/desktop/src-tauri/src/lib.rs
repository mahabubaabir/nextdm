//! NextDM desktop shell: Tauri commands, engine lifecycle and event bridge.

mod integration;
mod ipc;

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use nextdm_browser_host::protocol::HostRequest;
use nextdm_engine::{
    DownloadInfo, DownloadSpec, DownloadStatus, Engine, EngineConfig, EngineEvent, EngineStats,
};
use nextdm_media::{MediaInfo, ytdlp};
use serde_json::Value;
use tauri::{
    Emitter, Manager, State,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
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
    state.engine.store().all_settings().map_err(error_string)
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
    state
        .engine
        .set_max_connections(connections)
        .map_err(error_string)
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
fn export_settings_json(state: State<'_, AppState>) -> Result<String, String> {
    let settings = state.engine.store().all_settings().map_err(error_string)?;
    let backup = serde_json::json!({
        "app": "NextDM",
        "version": env!("CARGO_PKG_VERSION"),
        "exportedAt": chrono::Utc::now().to_rfc3339(),
        "settings": settings,
    });
    serde_json::to_string_pretty(&backup).map_err(|e| e.to_string())
}

#[tauri::command]
fn import_settings_json(state: State<'_, AppState>, json: String) -> Result<(), String> {
    let val: serde_json::Value =
        serde_json::from_str(&json).map_err(|e| format!("Invalid JSON: {e}"))?;
    let settings_obj = if let Some(map) = val.get("settings").and_then(|s| s.as_object()) {
        map
    } else if let Some(map) = val.as_object() {
        map
    } else {
        return Err("JSON does not contain a valid settings object".to_string());
    };

    for (k, v) in settings_obj {
        let _ = state.engine.set_setting(k, v.clone());
        if k == "speed_limit" {
            if let Some(limit) = v.as_u64() {
                let _ = state.engine.set_speed_limit((limit > 0).then_some(limit));
            }
        } else if k == "max_connections" {
            if let Some(conns) = v.as_u64() {
                let _ = state.engine.set_max_connections(conns as usize);
            }
        } else if k == "default_dir" {
            if let Some(dir) = v.as_str() {
                let _ = state.engine.set_default_dir(PathBuf::from(dir));
            }
        }
    }
    Ok(())
}

#[tauri::command]
async fn install_yt_dlp_cmd() -> Result<String, String> {
    nextdm_media::install_yt_dlp().await
}

#[tauri::command]
async fn launch_package_installer(version: Option<String>) -> Result<String, String> {
    let ver = version
        .unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string())
        .trim()
        .trim_start_matches('v')
        .to_string();
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());

    // Only reuse a package that matches the requested version exactly.
    // Older `NextDM_*.deb` files must not be installed by accident.
    let exact_names = [
        format!("NextDM_{ver}_amd64.deb"),
        format!("next-dm_{ver}_amd64.deb"),
        format!("next-dm_{ver}-1_amd64.deb"),
    ];
    let mut candidate = None;
    for directory in [
        std::path::PathBuf::from(&home).join("Downloads"),
        std::path::PathBuf::from(&home)
            .join("Downloads")
            .join("Programs"),
    ] {
        for name in &exact_names {
            let path = directory.join(name);
            if path.is_file() {
                candidate = Some(path);
                break;
            }
        }
        if candidate.is_some() {
            break;
        }
    }

    let candidate = match candidate {
        Some(path) => path,
        None => {
            let tmp_deb = std::path::PathBuf::from(format!("/tmp/NextDM_{ver}_amd64.deb"));
            let _ = std::fs::remove_file(&tmp_deb);
            let url = format!(
                "https://github.com/mahabubaabir/nextdm/releases/download/v{ver}/NextDM_{ver}_amd64.deb"
            );
            let status = std::process::Command::new("curl")
                .args(["-fL", "--retry", "2", &url, "-o"])
                .arg(&tmp_deb)
                .status()
                .map_err(|e| format!("Failed to download update: {e}"))?;
            if !status.success() {
                return Err(format!(
                    "Failed to download NextDM v{ver} from GitHub Releases"
                ));
            }
            tmp_deb
        }
    };

    // Never hand an empty file or an HTML error page to the package installer.
    let metadata =
        std::fs::metadata(&candidate).map_err(|e| format!("Update package is missing: {e}"))?;
    if metadata.len() < 1024 {
        let _ = std::fs::remove_file(&candidate);
        return Err("Downloaded update package is empty or invalid".into());
    }
    let is_deb = {
        use std::io::Read;
        let mut magic = [0u8; 8];
        std::fs::File::open(&candidate)
            .and_then(|mut file| file.read_exact(&mut magic))
            .map(|_| &magic[..4] == b"!<ar")
            .unwrap_or(false)
    };
    if !is_deb {
        let _ = std::fs::remove_file(&candidate);
        return Err("Downloaded update package is not a valid .deb file".into());
    }

    #[cfg(target_os = "linux")]
    {
        if std::path::Path::new("/usr/bin/captain").exists() {
            std::process::Command::new("/usr/bin/captain")
                .arg(&candidate)
                .spawn()
                .map_err(|e| format!("Failed to launch Linux Mint package installer: {e}"))?;
            Ok(format!("Opened {}", candidate.display()))
        } else {
            std::process::Command::new("xdg-open")
                .arg(&candidate)
                .spawn()
                .map_err(|e| format!("Failed to open package: {e}"))?;
            Ok(format!("Opened {}", candidate.display()))
        }
    }

    #[cfg(not(target_os = "linux"))]
    {
        Ok(format!("Downloaded {}", candidate.display()))
    }
}

#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    #[cfg(unix)]
    {
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map(|_| ())
            .map_err(error_string)
    }
    #[cfg(windows)]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map(|_| ())
            .map_err(error_string)
    }
}

#[tauri::command]
fn reveal_path(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if p.is_dir() {
        return open_path(path);
    }

    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("explorer")
            .arg(format!("/select,\"{}\"", p.display()))
            .spawn();
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg("-R").arg(&p).spawn();
        return Ok(());
    }

    #[cfg(unix)]
    {
        let canonical = p.canonicalize().unwrap_or(p.clone());
        if let Ok(file_url) = url::Url::from_file_path(&canonical) {
            let uri = file_url.to_string();
            // Standard DBus org.freedesktop.FileManager1.ShowItems (Nemo, Nautilus, Dolphin, Thunar)
            // Note: dbus-send string arguments must NOT have enclosing quotes, and startup-id is empty "string:".
            let dbus_result = std::process::Command::new("dbus-send")
                .args([
                    "--session",
                    "--dest=org.freedesktop.FileManager1",
                    "--type=method_call",
                    "/org/freedesktop/FileManager1",
                    "org.freedesktop.FileManager1.ShowItems",
                    &format!("array:string:{}", uri),
                    "string:",
                ])
                .output();

            if let Ok(output) = dbus_result {
                if output.status.success() {
                    return Ok(());
                }
            }
        }

        // Fallback: open parent folder directly
        let directory = p.parent().unwrap_or(&p);
        open_path(directory.to_string_lossy().to_string())
    }
}

#[tauri::command]
async fn probe_url(
    state: State<'_, AppState>,
    url: String,
) -> Result<nextdm_engine::ProbeResult, String> {
    state.engine.probe_url(&url).await.map_err(error_string)
}

#[tauri::command]
fn get_segments(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<nextdm_engine::Segment>, String> {
    let id = uuid::Uuid::parse_str(&id).map_err(error_string)?;
    state.engine.get_segments(id).map_err(error_string)
}

#[tauri::command]
async fn yt_dlp_available() -> bool {
    nextdm_media::yt_dlp_available().await
}

#[tauri::command]
async fn media_probe(url: String, cookies: Option<String>) -> Result<MediaInfo, String> {
    ytdlp::probe(&url, cookies.as_deref())
        .await
        .map_err(error_string)
}

#[tauri::command]
async fn media_download(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    url: String,
    format_id: Option<String>,
    directory: Option<String>,
    file_stem: Option<String>,
    expected_size: Option<u64>,
    cookies: Option<String>,
    format_kind: Option<String>,
    extension: Option<String>,
) -> Result<DownloadInfo, String> {
    let audio_only = format_kind
        .as_deref()
        .map(|kind| kind.trim().eq_ignore_ascii_case("audio"))
        .unwrap_or(false);

    let base_dir = directory
        .map(|d| d.trim().to_string())
        .filter(|d| !d.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| state.engine.default_dir());

    let category_routing = state
        .engine
        .setting("category_routing")
        .ok()
        .flatten()
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let category = if audio_only { "music" } else { "video" };
    let sub = if category_routing {
        nextdm_engine::manager::category_subfolder(category)
    } else {
        ""
    };
    let directory = if !sub.is_empty()
        && !base_dir
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.eq_ignore_ascii_case(sub))
    {
        base_dir.join(sub)
    } else {
        base_dir
    };

    let raw_name = file_stem
        .clone()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| {
            if audio_only {
                "audio".to_string()
            } else {
                "video".to_string()
            }
        });
    let default_ext = if audio_only {
        extension
            .as_deref()
            .map(|e| e.trim().trim_start_matches('.'))
            .filter(|e| !e.is_empty())
            .unwrap_or("m4a")
    } else {
        "mp4"
    };
    let lower_name = raw_name.to_ascii_lowercase();
    let has_media_ext = [
        ".mp4", ".mkv", ".webm", ".mov", ".m4a", ".mp3", ".opus", ".ogg", ".wav", ".flac", ".aac",
    ]
    .iter()
    .any(|ext| lower_name.ends_with(ext));
    let initial_name = if has_media_ext {
        raw_name
    } else {
        format!("{raw_name}.{default_ext}")
    };

    // 1. Immediately create an active downloading record in the engine so it appears in the UI
    let info = state
        .engine
        .create_media_download(url.clone(), initial_name, directory.clone(), expected_size)
        .map_err(error_string)?;

    let download_id = info.id;
    let engine = state.engine.clone();
    let app_handle = app.clone();
    let target_url = url.clone();
    let download_cookies = cookies;

    // 2. Spawn the background download with live progress streaming
    tauri::async_runtime::spawn(async move {
        let callback_engine = engine.clone();

        let progress_cb = move |downloaded: u64,
                                total: Option<u64>,
                                speed: u64,
                                eta: Option<u64>| {
            let _ =
                callback_engine.update_media_progress(download_id, downloaded, total, speed, eta);
        };

        match ytdlp::download_media_with_progress(
            &target_url,
            format_id.as_deref(),
            &directory,
            file_stem.as_deref(),
            download_cookies.as_deref(),
            audio_only,
            progress_cb,
        )
        .await
        {
            Ok(path) => match engine.complete_media_download(download_id, path) {
                Ok(completed_info) => {
                    let _ = app_handle.emit(
                        "media://status",
                        serde_json::json!({
                            "phase": "finished",
                            "url": target_url,
                            "download": completed_info,
                        }),
                    );
                }
                Err(err) => {
                    let _ = engine.fail_media_download(download_id, err.to_string());
                }
            },
            Err(err) => {
                let error_msg = err.to_string();
                let was_active = engine
                    .get(download_id)
                    .ok()
                    .flatten()
                    .is_some_and(|item| item.status != nextdm_engine::DownloadStatus::Cancelled);
                let _ = engine.fail_media_download(download_id, error_msg.clone());
                if was_active {
                    let _ = app_handle.emit(
                        "media://status",
                        serde_json::json!({
                            "phase": "error",
                            "url": target_url,
                            "message": error_msg,
                        }),
                    );
                }
            }
        }
    });

    Ok(info)
}

#[tauri::command]
fn engine_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[tauri::command]
fn install_browser_integration(
    chromium: bool,
    firefox: bool,
    custom_chrome_id: Option<String>,
) -> Result<Vec<String>, String> {
    integration::install(chromium, firefox, custom_chrome_id)
}

#[tauri::command]
fn check_browser_integration() -> bool {
    integration::is_host_installed()
}

#[tauri::command]
fn open_extensions_dir() -> Result<(), String> {
    let dir = integration::get_extension_dir()?;
    let _ = std::fs::create_dir_all(&dir);
    open_path(dir.to_string_lossy().to_string())
}

#[tauri::command]
fn quit_app_cmd(app: tauri::AppHandle) {
    quit_app(&app);
}

#[tauri::command]
fn get_autostart(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri::Manager;
    #[cfg(unix)]
    {
        let config_dir = app.path().config_dir().map_err(|e| e.to_string())?;
        let desktop_file = config_dir.join("autostart").join("nextdm.desktop");
        Ok(desktop_file.exists())
    }
    #[cfg(windows)]
    {
        if let Some(appdata) = std::env::var_os("APPDATA") {
            let startup = std::path::PathBuf::from(appdata)
                .join(r"Microsoft\Windows\Start Menu\Programs\Startup")
                .join("NextDM.bat");
            return Ok(startup.exists());
        }
        Ok(false)
    }
}

#[tauri::command]
fn set_autostart(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    use tauri::Manager;
    #[cfg(unix)]
    {
        let config_dir = app.path().config_dir().map_err(|e| e.to_string())?;
        let autostart_dir = config_dir.join("autostart");
        let desktop_file = autostart_dir.join("nextdm.desktop");

        if !enabled {
            if desktop_file.exists() {
                let _ = std::fs::remove_file(desktop_file);
            }
            return Ok(());
        }

        std::fs::create_dir_all(&autostart_dir).map_err(|e| e.to_string())?;

        let exec_cmd = if std::path::Path::new("/usr/bin/nextdm-desktop").exists() {
            "/usr/bin/nextdm-desktop --background".to_string()
        } else if let Ok(current) = std::env::current_exe() {
            format!("{} --background", current.to_string_lossy())
        } else {
            "nextdm-desktop --background".to_string()
        };

        let content = format!(
            "[Desktop Entry]\n\
             Type=Application\n\
             Name=NextDM\n\
             Comment=NextDM Download Manager\n\
             Exec={exec_cmd}\n\
             Icon=nextdm\n\
             Terminal=false\n\
             Categories=Network;FileTransfer;\n\
             StartupNotify=false\n\
             X-GNOME-Autostart-enabled=true\n"
        );

        std::fs::write(&desktop_file, content).map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(windows)]
    {
        if let Some(appdata) = std::env::var_os("APPDATA") {
            let startup_dir = std::path::PathBuf::from(appdata)
                .join(r"Microsoft\Windows\Start Menu\Programs\Startup");
            let startup_bat = startup_dir.join("NextDM.bat");

            if !enabled {
                if startup_bat.exists() {
                    let _ = std::fs::remove_file(startup_bat);
                }
                return Ok(());
            }

            let _ = std::fs::create_dir_all(&startup_dir);
            let current = std::env::current_exe().map_err(|e| e.to_string())?;
            let content = format!(
                "@start \"\" \"{}\" --background\r\n",
                current.to_string_lossy()
            );
            std::fs::write(&startup_bat, content).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

/// If another NextDM instance already owns the IPC socket/port, ask it to show its
/// window and report success so this process can exit.
fn forward_to_running_instance() -> bool {
    nextdm_browser_host::ipc::request(&HostRequest::ShowWindow, Duration::from_secs(2)).is_ok()
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
                    DownloadStatus::Queued
                        | DownloadStatus::Connecting
                        | DownloadStatus::Downloading
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
    #[cfg(unix)]
    let _ = std::fs::remove_file(nextdm_browser_host::ipc::socket_path());
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if std::env::var_os("NEXTDM_ALLOW_MULTIPLE").is_none() && forward_to_running_instance() {
        return;
    }

    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| "nextdm_engine=info,nextdm_desktop_lib=info".into());
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

            // Automatically verify and install browser native-messaging manifests and Windows registry keys
            tauri::async_runtime::spawn(async move {
                if let Err(err) = integration::install(true, true, None) {
                    tracing::warn!("Auto browser integration registration: {err}");
                } else {
                    tracing::info!("Auto browser integration manifests and registry verified");
                }
                #[cfg(windows)]
                {
                    if !nextdm_media::yt_dlp_available().await {
                        tracing::info!("yt-dlp not detected on Windows; downloading official binary in background...");
                        let _ = nextdm_media::install_yt_dlp().await;
                    }
                }
            });

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
                                .unwrap_or(true)
                    })
                    .unwrap_or(true);

                if keep_running {
                    api.prevent_close();
                    let _ = window.hide();
                    return;
                }

                if let Some(state) = app.try_state::<AppState>() {
                    tauri::async_runtime::block_on(state.engine.shutdown());
                }
                #[cfg(unix)]
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
            probe_url,
            get_segments,
            engine_version,
            install_browser_integration,
            check_browser_integration,
            open_extensions_dir,
            quit_app_cmd,
            get_autostart,
            set_autostart,
            export_settings_json,
            import_settings_json,
            install_yt_dlp_cmd,
            launch_package_installer,
        ])
        .run(tauri::generate_context!())
        .expect("error while running NextDM");
}

/// Native messaging entry point. Called by the browser through the installed
/// launcher script before Tauri is initialized.
pub fn run_native_host() -> ! {
    std::process::exit(nextdm_browser_host::run_native_host());
}

/// Headless installer for browser native-messaging integration.
pub fn install_integration_headless() -> Result<Vec<String>, String> {
    integration::install(true, true, None)
}

#[allow(dead_code)]
fn _assert_event_is_send_sync() {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<EngineEvent>();
}
