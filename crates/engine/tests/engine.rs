//! Integration tests for the segmented download engine.
//!
//! A small local HTTP server supports (or deliberately ignores) range
//! requests, so the tests exercise real sockets rather than mocks.

use std::net::SocketAddr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use nextdm_engine::{DownloadSpec, DownloadStatus, Engine, EngineConfig, EngineEvent};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use uuid::Uuid;

#[derive(Clone)]
struct ServerConfig {
    data: Arc<Vec<u8>>,
    ranges: bool,
    chunk_delay: Duration,
    resume_requests: Arc<AtomicUsize>,
}

impl ServerConfig {
    fn new(data: Vec<u8>, ranges: bool) -> Self {
        Self {
            data: Arc::new(data),
            ranges,
            chunk_delay: Duration::ZERO,
            resume_requests: Arc::new(AtomicUsize::new(0)),
        }
    }

    fn delayed(mut self, delay: Duration) -> Self {
        self.chunk_delay = delay;
        self
    }
}

async fn spawn_server(config: ServerConfig) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address: SocketAddr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                break;
            };
            let config = config.clone();
            tokio::spawn(async move {
                let _ = serve(&mut socket, config).await;
            });
        }
    });
    format!("http://{address}")
}

async fn serve(socket: &mut tokio::net::TcpStream, config: ServerConfig) -> std::io::Result<()> {
    let mut request = Vec::new();
    let mut buffer = [0u8; 1024];
    loop {
        let read = socket.read(&mut buffer).await?;
        if read == 0 {
            return Ok(());
        }
        request.extend_from_slice(&buffer[..read]);
        if request.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
        if request.len() > 64 * 1024 {
            return Ok(());
        }
    }

    let text = String::from_utf8_lossy(&request);
    let mut range = None;
    for line in text.lines().skip(1) {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        if name.eq_ignore_ascii_case("range") {
            range = parse_range(value.trim());
        }
    }

    let total = config.data.len() as u64;
    let full = &config.data[..];

    let (status, body, content_range) = match range {
        Some((start, end)) if config.ranges => {
            if start >= total {
                ("416 Range Not Satisfiable", &[][..], Some(format!("bytes */{total}")))
            } else {
                if start > 0 {
                    config.resume_requests.fetch_add(1, Ordering::SeqCst);
                }
                let end = end.unwrap_or(total - 1).min(total - 1);
                let body = &full[start as usize..=end as usize];
                (
                    "206 Partial Content",
                    body,
                    Some(format!("bytes {start}-{end}/{total}")),
                )
            }
        }
        _ => ("200 OK", full, None),
    };

    let mut head = format!(
        "HTTP/1.1 {status}\r\nContent-Length: {}\r\nContent-Type: application/octet-stream\r\n\
         Content-Disposition: attachment; filename=\"payload.bin\"\r\n\
         Accept-Ranges: bytes\r\nETag: \"nextdm-test-v1\"\r\nConnection: close\r\n",
        body.len()
    );
    if let Some(range) = content_range {
        head.push_str(&format!("Content-Range: {range}\r\n"));
    }
    head.push_str("\r\n");
    socket.write_all(head.as_bytes()).await?;

    for chunk in body.chunks(16 * 1024) {
        if !config.chunk_delay.is_zero() {
            tokio::time::sleep(config.chunk_delay).await;
        }
        socket.write_all(chunk).await?;
    }
    let _ = socket.shutdown().await;
    Ok(())
}

fn parse_range(value: &str) -> Option<(u64, Option<u64>)> {
    let value = value.strip_prefix("bytes=")?;
    let (start, end) = value.split_once('-')?;
    let start = start.trim().parse().ok()?;
    let end = end.trim().parse().ok();
    Some((start, end))
}

fn payload(size: usize) -> Vec<u8> {
    (0..size).map(|index| ((index % 251) as u8).wrapping_mul(31)).collect()
}

fn config(temp: &tempfile::TempDir) -> EngineConfig {
    EngineConfig::new(temp.path().join("data"), temp.path().join("downloads"))
}

async fn wait_for_status(engine: &Engine, id: Uuid, status: DownloadStatus, seconds: u64) -> nextdm_engine::DownloadInfo {
    let deadline = Instant::now() + Duration::from_secs(seconds);
    loop {
        if let Some(info) = engine.get(id).unwrap() {
            if info.status == status {
                return info;
            }
            if info.status == DownloadStatus::Error {
                panic!("download failed: {:?}", info.error);
            }
        }
        if Instant::now() >= deadline {
            let info = engine.get(id).unwrap();
            panic!("timed out waiting for {status:?}, last state: {info:?}");
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn downloads_segmented_file() {
    let data = payload(2 * 1024 * 1024);
    let url = spawn_server(ServerConfig::new(data.clone(), true)).await;
    let temp = tempfile::tempdir().unwrap();
    let engine = Engine::new(config(&temp)).unwrap();

    let info = engine.add(DownloadSpec::new(url.clone())).await.unwrap();
    let info = wait_for_status(&engine, info.id, DownloadStatus::Completed, 20).await;

    assert!(info.resumable);
    assert_eq!(info.total_size, Some(data.len() as u64));
    assert_eq!(info.downloaded, data.len() as u64);
    assert_eq!(info.file_name, "payload.bin");
    assert_eq!(std::fs::read(&info.path).unwrap(), data);
    assert!(!info.temp_path.exists());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn pauses_and_resumes_without_relisting() {
    let data = payload(8 * 1024 * 1024);
    let server = ServerConfig::new(data.clone(), true).delayed(Duration::from_millis(18));
    let resume_requests = server.resume_requests.clone();
    let url = spawn_server(server).await;
    let temp = tempfile::tempdir().unwrap();
    let engine = Engine::new(config(&temp)).unwrap();
    let mut events = engine.subscribe();

    let mut spec = DownloadSpec::new(url);
    spec.max_connections = Some(4);
    let info = engine.add(spec).await.unwrap();

    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let event = tokio::time::timeout(Duration::from_secs(5), events.recv())
            .await
            .expect("no progress events")
            .expect("event channel closed");
        if let EngineEvent::Progress { downloaded, .. } = event {
            if downloaded > 800 * 1024 {
                break;
            }
        }
        if Instant::now() >= deadline {
            panic!("download finished before it could be paused");
        }
    }

    engine.pause(info.id).unwrap();
    tokio::time::sleep(Duration::from_millis(800)).await;

    let paused = engine.get(info.id).unwrap().unwrap();
    assert_eq!(paused.status, DownloadStatus::Paused);
    assert!(paused.downloaded > 0);
    assert!(paused.temp_path.exists());

    engine.resume(info.id).unwrap();
    let completed = wait_for_status(&engine, info.id, DownloadStatus::Completed, 30).await;

    assert_eq!(std::fs::read(&completed.path).unwrap(), data);
    assert!(
        resume_requests.load(Ordering::SeqCst) > 0,
        "expected the server to receive a mid-file range request"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn persists_queue_across_restarts() {
    let url = spawn_server(ServerConfig::new(payload(4096), true)).await;
    let temp = tempfile::tempdir().unwrap();

    let id = {
        let engine = Engine::new(config(&temp)).unwrap();
        let mut spec = DownloadSpec::new(url.clone());
        spec.start_immediately = false;
        let info = engine.add(spec).await.unwrap();
        assert_eq!(info.status, DownloadStatus::Queued);
        info.id
    };

    let engine = Engine::new(config(&temp)).unwrap();
    let downloads = engine.list().unwrap();
    assert_eq!(downloads.len(), 1);
    assert_eq!(downloads[0].id, id);
    assert_eq!(downloads[0].url, url);
    assert_eq!(downloads[0].status, DownloadStatus::Queued);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn falls_back_for_servers_without_ranges() {
    let data = payload(512 * 1024);
    let url = spawn_server(ServerConfig::new(data.clone(), false)).await;
    let temp = tempfile::tempdir().unwrap();
    let engine = Engine::new(config(&temp)).unwrap();

    let info = engine.add(DownloadSpec::new(url)).await.unwrap();
    assert!(!info.resumable);
    let info = wait_for_status(&engine, info.id, DownloadStatus::Completed, 20).await;
    assert_eq!(std::fs::read(&info.path).unwrap(), data);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn cancelling_removes_partial_file() {
    let data = payload(8 * 1024 * 1024);
    let url = spawn_server(
        ServerConfig::new(data, true).delayed(Duration::from_millis(18)),
    )
    .await;
    let temp = tempfile::tempdir().unwrap();
    let engine = Engine::new(config(&temp)).unwrap();
    let mut events = engine.subscribe();

    let info = engine.add(DownloadSpec::new(url)).await.unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let event = tokio::time::timeout(Duration::from_secs(5), events.recv())
            .await
            .expect("no progress events")
            .expect("event channel closed");
        if let EngineEvent::Progress { downloaded, .. } = event {
            if downloaded > 100 * 1024 {
                break;
            }
        }
        if Instant::now() >= deadline {
            break;
        }
    }

    let paused = engine.get(info.id).unwrap().unwrap();
    let temp_path = paused.temp_path.clone();
    engine.cancel(info.id).unwrap();
    tokio::time::sleep(Duration::from_millis(700)).await;

    let cancelled = engine.get(info.id).unwrap().unwrap();
    assert_eq!(cancelled.status, DownloadStatus::Cancelled);
    assert!(!temp_path.exists());
}
