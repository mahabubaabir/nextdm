//! Local IPC server used by the browser native-messaging host.

use std::io;
use std::time::Duration;

#[cfg(unix)]
use std::path::Path;
#[cfg(unix)]
use nextdm_browser_host::ipc::socket_path;
#[cfg(unix)]
use tokio::net::{UnixListener, UnixStream};

#[cfg(windows)]
use nextdm_browser_host::ipc::WINDOWS_IPC_PORT;
#[cfg(windows)]
use tokio::net::{TcpListener, TcpStream};

use nextdm_browser_host::protocol::{HostRequest, HostResponse};
use nextdm_engine::{DownloadSpec, Engine};
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tracing::{info, warn};

#[cfg(unix)]
pub fn spawn(app: AppHandle, engine: Engine) {
    let path = socket_path();
    tauri::async_runtime::spawn(async move {
        if let Some(parent) = path.parent() {
            if let Err(error) = std::fs::create_dir_all(parent) {
                warn!(%error, path = %parent.display(), "could not create IPC directory");
                return;
            }
        }

        if path.exists() {
            if UnixStream::connect(&path).await.is_ok() {
                info!(path = %path.display(), "IPC socket already served by another instance");
                return;
            }
            let _ = std::fs::remove_file(&path);
        }

        let listener = match UnixListener::bind(&path) {
            Ok(listener) => listener,
            Err(error) => {
                warn!(%error, path = %path.display(), "could not bind IPC socket");
                return;
            }
        };
        restrict_permissions(&path);
        info!(path = %path.display(), "browser integration listening");

        loop {
            match listener.accept().await {
                Ok((stream, _)) => {
                    let app = app.clone();
                    let engine = engine.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(error) = handle_unix(app, engine, stream).await {
                            warn!(%error, "browser IPC request failed");
                        }
                    });
                }
                Err(error) => {
                    warn!(%error, "browser IPC accept failed");
                    tokio::time::sleep(Duration::from_millis(250)).await;
                }
            }
        }
    });
}

#[cfg(windows)]
pub fn spawn(app: AppHandle, engine: Engine) {
    let addr = ("127.0.0.1", WINDOWS_IPC_PORT);
    tauri::async_runtime::spawn(async move {
        let listener = match TcpListener::bind(addr).await {
            Ok(listener) => listener,
            Err(error) => {
                warn!(%error, "could not bind IPC TCP socket on Windows");
                return;
            }
        };
        info!("browser integration listening on 127.0.0.1:{}", WINDOWS_IPC_PORT);

        loop {
            match listener.accept().await {
                Ok((stream, _)) => {
                    let app = app.clone();
                    let engine = engine.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(error) = handle_tcp(app, engine, stream).await {
                            warn!(%error, "browser IPC request failed");
                        }
                    });
                }
                Err(error) => {
                    warn!(%error, "browser IPC accept failed");
                    tokio::time::sleep(Duration::from_millis(250)).await;
                }
            }
        }
    });
}

#[cfg(unix)]
fn restrict_permissions(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
}

#[cfg(unix)]
async fn handle_unix(app: AppHandle, engine: Engine, stream: UnixStream) -> io::Result<()> {
    let (reader, writer) = stream.into_split();
    handle_connection_io(app, engine, reader, writer).await
}

#[cfg(windows)]
async fn handle_tcp(app: AppHandle, engine: Engine, stream: TcpStream) -> io::Result<()> {
    let (reader, writer) = stream.into_split();
    handle_connection_io(app, engine, reader, writer).await
}

async fn handle_connection_io<R, W>(
    app: AppHandle,
    engine: Engine,
    reader: R,
    mut writer: W,
) -> io::Result<()>
where
    R: tokio::io::AsyncRead + Unpin,
    W: tokio::io::AsyncWrite + Unpin,
{
    let mut reader = BufReader::new(reader);
    let mut line = String::new();

    let read = tokio::time::timeout(Duration::from_secs(10), reader.read_line(&mut line))
        .await
        .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "timed out reading request"))??;
    if read == 0 {
        return Ok(());
    }

    let response = match serde_json::from_str::<HostRequest>(line.trim()) {
        Ok(request) => dispatch(&app, &engine, request).await,
        Err(error) => HostResponse::error(format!("invalid request: {error}")),
    };

    let mut payload = serde_json::to_vec(&response).map_err(io::Error::other)?;
    payload.push(b'\n');
    writer.write_all(&payload).await?;
    writer.flush().await?;
    Ok(())
}

fn is_media_site_url(url: &str) -> bool {
    let lower = url.to_lowercase();
    lower.contains(".m3u8")
        || lower.contains(".mpd")
        || lower.contains(".f4m")
        || lower.contains(".ism/")
        || lower.contains("youtube.com/watch")
        || lower.contains("youtube.com/shorts")
        || lower.contains("youtube.com/live")
        || lower.contains("youtu.be/")
        || lower.contains("facebook.com/watch")
        || lower.contains("facebook.com/reel")
        || lower.contains("facebook.com/videos")
        || lower.contains("fb.watch/")
        || lower.contains("instagram.com/reel")
        || lower.contains("instagram.com/p/")
        || lower.contains("instagram.com/tv/")
        || lower.contains("tiktok.com/")
        || (lower.contains("twitter.com/") && lower.contains("/status/"))
        || (lower.contains("x.com/") && lower.contains("/status/"))
        || lower.contains("vimeo.com/")
        || lower.contains("dailymotion.com/video")
        || lower.contains("twitch.tv/videos")
        || lower.contains("bilibili.com/video")
        || lower.contains("soundcloud.com/")
        || lower.contains("rumble.com/")
        || lower.contains("streamtape.com/")
}

async fn dispatch(app: &AppHandle, engine: &Engine, request: HostRequest) -> HostResponse {
    match request {
        HostRequest::Ping | HostRequest::GetConfig => {
            let badge_style = engine
                .setting("video_badge_style")
                .ok()
                .flatten()
                .and_then(|v| v.as_str().map(String::from))
                .unwrap_or_else(|| "compact".to_string());
            let mut res = HostResponse::ok();
            res.data = Some(serde_json::json!({
                "badgeStyle": badge_style
            }));
            res
        }
        HostRequest::GetVersion => {
            HostResponse::ok().with_version(env!("CARGO_PKG_VERSION"))
        }
        HostRequest::ShowWindow => {
            show_main(app);
            HostResponse::ok()
        }
        HostRequest::AddDownload {
            url,
            filename,
            referrer,
            cookies,
            user_agent,
            headers,
            is_media,
        } => {
            if is_media || is_media_site_url(&url) {
                info!(url = %url, "intercepted media download URL, opening media dialog");
                show_main(app);
                let _ = tauri::Emitter::emit(
                    app,
                    "browser://media_grab",
                    serde_json::json!({
                        "url": url,
                        "title": filename,
                    }),
                );
                return HostResponse::ok();
            }

            let mut spec = DownloadSpec::new(url);
            spec.file_name = filename.filter(|value| !value.trim().is_empty());
            spec.referrer = referrer.filter(|value| !value.trim().is_empty());
            spec.cookies = cookies.filter(|value| !value.trim().is_empty());
            if let Some(user_agent) = user_agent.filter(|value| !value.trim().is_empty()) {
                spec.headers
                    .insert("User-Agent".to_string(), user_agent);
            }
            spec.headers.extend(headers);

            match engine.add(spec).await {
                Ok(info) => {
                    info!(id = %info.id, file = %info.file_name, "browser download added");
                    show_main(app);
                    let _ = tauri::Emitter::emit(app, "browser://download_added", &info);
                    HostResponse::ok().with_download(info.id.to_string())
                }
                Err(error) => HostResponse::error(format!("failed to queue download: {error}")),
            }
        }
        HostRequest::ProbeMedia { url, .. } => match nextdm_media::ytdlp::probe(&url).await {
            Ok(info) => match serde_json::to_value(info) {
                Ok(value) => HostResponse::ok().with_data(value),
                Err(error) => HostResponse::error(error.to_string()),
            },
            Err(error) => HostResponse::error(error.to_string()),
        },
    }
}

pub fn show_main(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
    let _ = window.set_always_on_top(true);
    let _ = window.set_always_on_top(false);
    let _ = window.request_user_attention(Some(tauri::UserAttentionType::Critical));
}
