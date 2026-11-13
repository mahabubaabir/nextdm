//! Download manager: orchestration, pause/resume, persistence and events.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use chrono::Utc;
use parking_lot::Mutex;
use reqwest::Client;
use tokio::sync::broadcast;
use tracing::{debug, warn};
use uuid::Uuid;

use crate::download::{self, SpeedLimiter, TransferContext};
use crate::error::{Error, Result};
use crate::storage::{DownloadRecord, Storage};
use crate::types::{
    DownloadInfo, DownloadSpec, DownloadStatus, EngineConfig, EngineEvent, EngineStats, Segment,
};

pub fn category_subfolder(category: &str) -> &'static str {
    match category {
        "video" => "Video",
        "compressed" => "Compressed",
        "documents" => "Documents",
        "music" => "Music",
        "programs" => "Programs",
        "images" => "Images",
        _ => "",
    }
}

#[derive(Clone)]
pub struct Engine {
    inner: Arc<Inner>,
}

pub(crate) struct Inner {
    pub config: EngineConfig,
    pub store: Arc<Storage>,
    pub client: Client,
    pub events: broadcast::Sender<EngineEvent>,
    pub limiter: Arc<SpeedLimiter>,
    default_dir: Mutex<PathBuf>,
    active: Mutex<HashSet<Uuid>>,
    controls: Mutex<HashMap<Uuid, Control>>,
    speeds: Mutex<HashMap<Uuid, u64>>,
    removed: Mutex<HashSet<Uuid>>,
    max_connections: AtomicUsize,
}

#[derive(Clone)]
struct Control {
    pause: Arc<AtomicBool>,
    cancel: Arc<AtomicBool>,
    downloaded: Arc<AtomicU64>,
}

impl Default for Control {
    fn default() -> Self {
        Self {
            pause: Arc::new(AtomicBool::new(false)),
            cancel: Arc::new(AtomicBool::new(false)),
            downloaded: Arc::new(AtomicU64::new(0)),
        }
    }
}

impl Inner {
    fn emit(&self, event: EngineEvent) {
        let _ = self.events.send(event);
    }

    fn is_removed(&self, id: Uuid) -> bool {
        self.removed.lock().contains(&id)
    }

    fn save(&self, record: &DownloadRecord) -> Result<()> {
        if self.is_removed(record.id) {
            return Ok(());
        }
        self.store.save(record)
    }

    fn emit_updated(&self, record: &DownloadRecord) {
        if self.is_removed(record.id) {
            return;
        }
        let mut info = record.info();
        info.speed = *self.speeds.lock().get(&record.id).unwrap_or(&0);
        self.emit(EngineEvent::Updated { download: info });
    }
}

impl Engine {
    /// Create the engine, opening (or creating) its SQLite database.
    pub fn new(config: EngineConfig) -> Result<Self> {
        std::fs::create_dir_all(&config.data_dir)?;
        std::fs::create_dir_all(&config.download_dir)?;
        let config_default_dir = config.download_dir.clone();

        let store = Arc::new(Storage::open(&config.data_dir.join("nextdm.db"))?);
        let client = Client::builder()
            .user_agent(&config.user_agent)
            .connect_timeout(Duration::from_secs(20))
            .redirect(reqwest::redirect::Policy::limited(10))
            .build()?;
        let (events, _) = broadcast::channel(2048);
        let limiter = Arc::new(SpeedLimiter::new(config.speed_limit));
        let max_connections = config.max_connections.clamp(1, 32);

        Ok(Self {
            inner: Arc::new(Inner {
                config,
                store,
                client,
                events,
                limiter,
                default_dir: Mutex::new(config_default_dir.clone()),
                active: Mutex::new(HashSet::new()),
                controls: Mutex::new(HashMap::new()),
                speeds: Mutex::new(HashMap::new()),
                removed: Mutex::new(HashSet::new()),
                max_connections: AtomicUsize::new(max_connections),
            }),
        })
    }

    pub fn subscribe(&self) -> broadcast::Receiver<EngineEvent> {
        self.inner.events.subscribe()
    }

    pub fn config(&self) -> &EngineConfig {
        &self.inner.config
    }

    pub fn default_dir(&self) -> PathBuf {
        self.inner.default_dir.lock().clone()
    }

    pub fn set_default_dir(&self, directory: PathBuf) -> Result<()> {
        if directory.as_os_str().is_empty() {
            return Err(Error::InvalidDirectory(directory));
        }
        std::fs::create_dir_all(&directory)?;
        *self.inner.default_dir.lock() = directory.clone();
        self.inner.store.set_setting(
            "default_dir",
            &serde_json::json!(directory.to_string_lossy().to_string()),
        )?;
        Ok(())
    }

    pub fn store(&self) -> &Arc<Storage> {
        &self.inner.store
    }

    /// Probe a URL and add it to the download list.
    pub async fn add(&self, spec: DownloadSpec) -> Result<DownloadInfo> {
        let url = spec.url.trim();
        let parsed = url::Url::parse(url)?;
        if !matches!(parsed.scheme(), "http" | "https") {
            return Err(Error::message("only http and https URLs are supported"));
        }

        let mut probe_headers = spec.headers.clone();
        if let Some(cookies) = &spec.cookies {
            probe_headers.insert("Cookie".to_string(), cookies.clone());
        }
        if let Some(referrer) = &spec.referrer {
            probe_headers.insert("Referer".to_string(), referrer.clone());
        }

        let probe = download::probe(&self.inner.client, url, &probe_headers).await?;
        let suggested = download::suggested_name(
            spec.file_name.as_deref(),
            probe.disposition.as_deref(),
            &probe.final_url,
            probe.content_type.as_deref(),
        );

        if let Some(ct) = &probe.content_type {
            let ct_lower = ct.to_ascii_lowercase();
            if (ct_lower.starts_with("text/html") || ct_lower.starts_with("application/xhtml+xml"))
                && download::is_media_filename(&suggested)
            {
                return Err(Error::Server(
                    "remote server returned an HTML webpage (text/html) instead of media content. For streaming or embedded video, please use the NextDM Video Extractor.".into(),
                ));
            }
        }

        let category = spec
            .category
            .clone()
            .unwrap_or_else(|| download::classify(&suggested).to_string());

        let directory = match spec.directory {
            Some(dir) => dir,
            None => {
                let base = self.inner.default_dir.lock().clone();
                let category_routing = self
                    .setting("category_routing")
                    .ok()
                    .flatten()
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);
                if category_routing {
                    let sub = category_subfolder(&category);
                    if !sub.is_empty() {
                        base.join(sub)
                    } else {
                        base
                    }
                } else {
                    base
                }
            }
        };
        if directory.as_os_str().is_empty() {
            return Err(Error::InvalidDirectory(directory));
        }
        std::fs::create_dir_all(&directory)?;

        let final_path = download::unique_path(&directory, &suggested);
        let file_name = final_path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| suggested.clone());
        let temp_path = download::temp_path_for(&final_path);
        let max_connections = spec
            .max_connections
            .unwrap_or_else(|| self.inner.max_connections.load(Ordering::Relaxed))
            .clamp(1, 32);

        let total_size = probe.total_size;
        let segments = if probe.resumable {
            download::build_segments(
                total_size.unwrap_or(0),
                max_connections,
                self.inner.config.chunk_size,
            )
        } else if let Some(total) = total_size {
            if total == 0 {
                Vec::new()
            } else {
                vec![Segment::new(0, Some(total - 1))]
            }
        } else {
            vec![Segment::new(0, None)]
        };

        let now = Utc::now();
        let zero_bytes = total_size == Some(0);
        let record = DownloadRecord {
            id: Uuid::new_v4(),
            url: url.to_string(),
            final_url: Some(probe.final_url),
            file_name,
            directory,
            temp_path,
            total_size,
            downloaded: 0,
            status: if zero_bytes {
                DownloadStatus::Completed
            } else {
                DownloadStatus::Queued
            },
            resumable: probe.resumable,
            etag: probe.etag,
            last_modified: probe.last_modified,
            content_type: probe.content_type,
            category,
            error: None,
            segments,
            headers: spec.headers,
            cookies: spec.cookies,
            referrer: spec.referrer,
            queue_id: spec.queue_id,
            priority: spec.priority.unwrap_or(3),
            max_connections: Some(max_connections),
            created_at: now,
            completed_at: if zero_bytes { Some(now) } else { None },
        };

        if zero_bytes {
            std::fs::File::create(record.path())?;
        }

        self.inner.save(&record)?;
        let mut info = record.info();
        info.speed = 0;
        self.inner.emit(EngineEvent::Added {
            download: info.clone(),
        });

        if !zero_bytes && spec.start_immediately {
            self.start(record.id)?;
        }

        Ok(info)
    }

    /// Start (or continue) a download.
    pub fn start(&self, id: Uuid) -> Result<()> {
        let record = self
            .inner
            .store
            .get(id)?
            .ok_or(Error::NotFound(id))?;
        if record.status == DownloadStatus::Completed {
            return Ok(());
        }

        {
            let mut active = self.inner.active.lock();
            if !active.insert(id) {
                return Ok(());
            }
        }

        let control = Control::default();
        self.inner.controls.lock().insert(id, control);
        self.inner.removed.lock().remove(&id);

        if tokio::runtime::Handle::try_current().is_err() {
            self.inner.active.lock().remove(&id);
            self.inner.controls.lock().remove(&id);
            return Err(Error::message(
                "the download engine requires a Tokio runtime",
            ));
        }

        let inner = self.inner.clone();
        tokio::spawn(async move {
            if let Err(error) = run_download(inner.clone(), id).await {
                warn!(%id, %error, "download task failed");
            }
            inner.active.lock().remove(&id);
            inner.controls.lock().remove(&id);
            inner.speeds.lock().remove(&id);
            inner.removed.lock().remove(&id);

            // A resume may have arrived while the worker was shutting down.
            if let Ok(Some(record)) = inner.store.get(id) {
                if record.status == DownloadStatus::Queued {
                    let engine = Engine {
                        inner: inner.clone(),
                    };
                    if let Err(error) = engine.start(id) {
                        warn!(%id, %error, "failed to restart download after resume");
                    }
                }
            }
        });

        Ok(())
    }

    pub fn pause(&self, id: Uuid) -> Result<()> {
        let mut record = self
            .inner
            .store
            .get(id)?
            .ok_or(Error::NotFound(id))?;
        if record.status.is_terminal() {
            return Ok(());
        }

        if let Some(control) = self.inner.controls.lock().get(&id) {
            control.pause.store(true, Ordering::Relaxed);
        }
        self.inner.speeds.lock().insert(id, 0);

        record.status = DownloadStatus::Paused;
        record.error = None;
        self.inner.save(&record)?;
        self.inner.emit_updated(&record);
        Ok(())
    }

    pub fn resume(&self, id: Uuid) -> Result<()> {
        let mut record = self
            .inner
            .store
            .get(id)?
            .ok_or(Error::NotFound(id))?;
        if record.status == DownloadStatus::Completed {
            return Ok(());
        }

        if let Some(control) = self.inner.controls.lock().get(&id) {
            control.pause.store(false, Ordering::Relaxed);
            control.cancel.store(false, Ordering::Relaxed);
        }

        record.status = DownloadStatus::Queued;
        record.error = None;
        self.inner.save(&record)?;
        self.inner.emit_updated(&record);
        self.start(id)
    }

    pub fn cancel(&self, id: Uuid) -> Result<()> {
        if let Some(control) = self.inner.controls.lock().get(&id) {
            control.cancel.store(true, Ordering::Relaxed);
            control.pause.store(false, Ordering::Relaxed);
        }

        let Some(mut record) = self.inner.store.get(id)? else {
            return Ok(());
        };
        let active = self.inner.active.lock().contains(&id);
        if !active {
            let _ = std::fs::remove_file(&record.temp_path);
        }
        record.status = DownloadStatus::Cancelled;
        record.error = None;
        self.inner.save(&record)?;
        self.inner.emit_updated(&record);
        Ok(())
    }

    pub fn remove(&self, id: Uuid, delete_file: bool) -> Result<()> {
        if let Some(control) = self.inner.controls.lock().get(&id) {
            control.cancel.store(true, Ordering::Relaxed);
            control.pause.store(false, Ordering::Relaxed);
        }
        self.inner.removed.lock().insert(id);

        if let Some(record) = self.inner.store.get(id)? {
            let _ = std::fs::remove_file(&record.temp_path);
            if delete_file {
                let _ = std::fs::remove_file(record.path());
            }
        }
        self.inner.store.delete(id)?;
        self.inner.speeds.lock().remove(&id);
        self.inner.emit(EngineEvent::Removed { id });
        Ok(())
    }

    pub fn get(&self, id: Uuid) -> Result<Option<DownloadInfo>> {
        let record = self.inner.store.get(id)?;
        Ok(record.map(|record| self.decorate(record)))
    }

    pub fn get_segments(&self, id: Uuid) -> Result<Vec<Segment>> {
        let record = self.inner.store.get(id)?;
        Ok(record.map(|r| r.segments).unwrap_or_default())
    }

    pub async fn probe_url(&self, url: &str) -> Result<crate::types::ProbeResult> {
        let url = url.trim();
        let parsed = url::Url::parse(url)?;
        if !matches!(parsed.scheme(), "http" | "https") {
            return Err(Error::message("only http and https URLs are supported"));
        }
        let headers = std::collections::BTreeMap::new();
        let probe = download::probe(&self.inner.client, url, &headers).await?;
        let suggested = download::suggested_name(
            None,
            probe.disposition.as_deref(),
            &probe.final_url,
            probe.content_type.as_deref(),
        );
        let category = download::classify(&suggested).to_string();
        let base_dir = self.inner.default_dir.lock().clone();
        let category_routing = self
            .setting("category_routing")
            .ok()
            .flatten()
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

        let target_dir = if category_routing {
            let sub = category_subfolder(&category);
            if !sub.is_empty() {
                base_dir.join(sub)
            } else {
                base_dir
            }
        } else {
            base_dir
        };
        let default_dir = target_dir.to_string_lossy().to_string();

        Ok(crate::types::ProbeResult {
            url: url.to_string(),
            final_url: probe.final_url,
            total_size: probe.total_size,
            resumable: probe.resumable,
            file_name: suggested,
            category,
            content_type: probe.content_type,
            default_dir,
        })
    }

    pub fn list(&self) -> Result<Vec<DownloadInfo>> {
        let records = self.inner.store.list()?;
        Ok(records.into_iter().map(|record| self.decorate(record)).collect())
    }

    fn decorate(&self, record: DownloadRecord) -> DownloadInfo {
        let mut info = record.info();
        let speeds = self.inner.speeds.lock();
        info.speed = *speeds.get(&record.id).unwrap_or(&0);
        if let Some(total) = info.total_size {
            if info.speed > 0 && info.downloaded < total {
                info.eta = Some((total - info.downloaded) / info.speed);
            }
        }
        info
    }

    pub fn stats(&self) -> Result<EngineStats> {
        let records = self.inner.store.list()?;
        let speeds = self.inner.speeds.lock();
        let mut stats = EngineStats {
            active: 0,
            queued: 0,
            completed: 0,
            total_speed: 0,
        };
        for record in &records {
            match record.status {
                DownloadStatus::Connecting | DownloadStatus::Downloading => stats.active += 1,
                DownloadStatus::Queued | DownloadStatus::Scheduled => stats.queued += 1,
                DownloadStatus::Completed => stats.completed += 1,
                _ => {}
            }
            stats.total_speed += *speeds.get(&record.id).unwrap_or(&0);
        }
        Ok(stats)
    }

    /// Restart transfers that were mid-flight when the application last exited.
    pub fn resume_pending(&self) -> Result<usize> {
        let records = self.inner.store.list()?;
        let mut started = 0;
        for record in records {
            if matches!(
                record.status,
                DownloadStatus::Queued | DownloadStatus::Connecting | DownloadStatus::Downloading
            ) {
                self.start(record.id)?;
                started += 1;
            }
        }
        Ok(started)
    }

    pub fn set_speed_limit(&self, bytes_per_second: Option<u64>) -> Result<()> {
        self.inner.limiter.set_rate(bytes_per_second);
        self.inner.store.set_setting(
            "speed_limit",
            &serde_json::json!(bytes_per_second.unwrap_or(0)),
        )?;
        Ok(())
    }

    pub fn speed_limit(&self) -> Option<u64> {
        self.inner.limiter.rate()
    }

    pub fn set_max_connections(&self, connections: usize) -> Result<()> {
        let connections = connections.clamp(1, 32);
        self.inner
            .max_connections
            .store(connections, Ordering::Relaxed);
        self.inner
            .store
            .set_setting("max_connections", &serde_json::json!(connections))?;
        Ok(())
    }

    pub fn max_connections(&self) -> usize {
        self.inner.max_connections.load(Ordering::Relaxed)
    }

    pub fn setting(&self, key: &str) -> Result<Option<serde_json::Value>> {
        self.inner.store.get_setting(key)
    }

    pub fn set_setting(&self, key: &str, value: serde_json::Value) -> Result<()> {
        self.inner.store.set_setting(key, &value)
    }

    /// Register a file that was produced by an external helper (for example
    /// the yt-dlp media bridge) so it appears in the download list.
    pub fn register_completed_file(
        &self,
        path: PathBuf,
        source_url: String,
    ) -> Result<DownloadInfo> {
        let metadata = std::fs::metadata(&path)?;
        let directory = path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| self.inner.default_dir.lock().clone());
        let file_name = path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| "media".to_string());
        let now = Utc::now();

        let record = DownloadRecord {
            id: Uuid::new_v4(),
            url: source_url,
            final_url: None,
            file_name: file_name.clone(),
            directory,
            temp_path: download::temp_path_for(&path),
            total_size: Some(metadata.len()),
            downloaded: metadata.len(),
            status: DownloadStatus::Completed,
            resumable: false,
            etag: None,
            last_modified: None,
            content_type: None,
            category: download::classify(&file_name).to_string(),
            error: None,
            segments: Vec::new(),
            headers: BTreeMap::new(),
            cookies: None,
            referrer: None,
            queue_id: None,
            priority: 3,
            max_connections: None,
            created_at: now,
            completed_at: Some(now),
        };

        self.inner.save(&record)?;
        let info = record.info();
        self.inner.emit(EngineEvent::Added {
            download: info.clone(),
        });
        self.inner.emit(EngineEvent::Completed {
            download: info.clone(),
        });
        Ok(info)
    }

    /// Create an active media download record in the store and emit an EngineEvent::Added.
    pub fn create_media_download(
        &self,
        url: String,
        file_name: String,
        directory: PathBuf,
        expected_size: Option<u64>,
    ) -> Result<DownloadInfo> {
        let temp_path = download::temp_path_for(&directory.join(&file_name));
        let now = Utc::now();
        let record = DownloadRecord {
            id: Uuid::new_v4(),
            url,
            final_url: None,
            file_name: file_name.clone(),
            directory,
            temp_path,
            total_size: expected_size,
            downloaded: 0,
            status: DownloadStatus::Downloading,
            resumable: false,
            etag: None,
            last_modified: None,
            content_type: Some("video/mp4".to_string()),
            category: download::classify(&file_name).to_string(),
            error: None,
            segments: Vec::new(),
            headers: BTreeMap::new(),
            cookies: None,
            referrer: None,
            queue_id: None,
            priority: 3,
            max_connections: Some(1),
            created_at: now,
            completed_at: None,
        };

        self.inner.save(&record)?;
        let info = record.info();
        self.inner.emit(EngineEvent::Added {
            download: info.clone(),
        });
        Ok(info)
    }

    /// Update media download progress and broadcast EngineEvent::Progress.
    pub fn update_media_progress(
        &self,
        id: Uuid,
        downloaded: u64,
        total: Option<u64>,
        speed: u64,
        eta: Option<u64>,
    ) -> Result<()> {
        if let Some(mut record) = self.inner.store.get(id)? {
            record.downloaded = downloaded;
            if let Some(t) = total {
                if t > 0 {
                    record.total_size = Some(t);
                }
            }
            record.status = DownloadStatus::Downloading;
            let _ = self.inner.save(&record);
            self.inner.emit(EngineEvent::Progress {
                id,
                downloaded,
                total_size: record.total_size,
                speed,
                eta,
                segments: Vec::new(),
            });
        }
        Ok(())
    }

    /// Mark the media download as completed with the final produced file.
    pub fn complete_media_download(&self, id: Uuid, final_path: PathBuf) -> Result<DownloadInfo> {
        let metadata = std::fs::metadata(&final_path)?;
        let file_name = final_path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| "media.mp4".to_string());
        let directory = final_path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| self.inner.default_dir.lock().clone());
        let now = Utc::now();

        let mut record = match self.inner.store.get(id)? {
            Some(record) => record,
            None => {
                return self.register_completed_file(final_path, String::new());
            }
        };

        record.file_name = file_name;
        record.directory = directory;
        record.total_size = Some(metadata.len());
        record.downloaded = metadata.len();
        record.status = DownloadStatus::Completed;
        record.completed_at = Some(now);
        record.error = None;

        self.inner.save(&record)?;
        let info = record.info();
        self.inner.emit(EngineEvent::Updated {
            download: info.clone(),
        });
        self.inner.emit(EngineEvent::Completed {
            download: info.clone(),
        });
        Ok(info)
    }

    /// Mark the media download as failed.
    pub fn fail_media_download(&self, id: Uuid, error_message: String) -> Result<()> {
        if let Some(mut record) = self.inner.store.get(id)? {
            record.status = DownloadStatus::Error;
            record.error = Some(error_message);
            self.inner.save(&record)?;
            self.inner.emit(EngineEvent::Updated {
                download: record.info(),
            });
        }
        Ok(())
    }

    /// Ask every active transfer to pause. Used when the app is closing.
    pub async fn shutdown(&self) {
        let controls: Vec<Control> = self.inner.controls.lock().values().cloned().collect();
        for control in controls {
            control.pause.store(true, Ordering::Relaxed);
        }
        tokio::time::sleep(Duration::from_millis(350)).await;
    }
}

async fn run_download(inner: Arc<Inner>, id: Uuid) -> Result<()> {
    let mut record = match inner.store.get(id)? {
        Some(record) => record,
        None => return Ok(()),
    };
    let control = inner
        .controls
        .lock()
        .get(&id)
        .cloned()
        .ok_or_else(|| Error::message("missing download control"))?;

    if control.cancel.load(Ordering::Relaxed) {
        finish_cancelled(&inner, &mut record).await?;
        return Ok(());
    }

    record.status = DownloadStatus::Connecting;
    record.error = None;
    inner.save(&record)?;
    inner.emit_updated(&record);

    let headers = effective_headers(&record);
    let probe = match download::probe(&inner.client, &record.url, &headers).await {
        Ok(probe) => probe,
        Err(error) => {
            if control.cancel.load(Ordering::Relaxed) {
                finish_cancelled(&inner, &mut record).await?;
            } else if control.pause.load(Ordering::Relaxed) {
                finish_paused(&inner, &mut record, &control)?;
            } else {
                finish_failed(&inner, &mut record, error)?;
            }
            return Ok(());
        }
    };

    if control.cancel.load(Ordering::Relaxed) {
        finish_cancelled(&inner, &mut record).await?;
        return Ok(());
    }
    if control.pause.load(Ordering::Relaxed) {
        finish_paused(&inner, &mut record, &control)?;
        return Ok(());
    }

    let total_size = probe.total_size;
    if total_size == Some(0) {
        std::fs::File::create(record.path())?;
        record.total_size = Some(0);
        record.downloaded = 0;
        record.segments.clear();
        record.status = DownloadStatus::Completed;
        record.completed_at = Some(Utc::now());
        inner.save(&record)?;
        inner.emit(EngineEvent::Completed {
            download: record.info(),
        });
        return Ok(());
    }

    let mut keep_existing = record.resumable
        && record.total_size == total_size
        && record.total_size.is_some()
        && !record.segments.is_empty()
        && validators_match(&record, &probe);

    if keep_existing {
        match tokio::fs::metadata(&record.temp_path).await {
            Ok(metadata) if metadata.len() > 0 => {}
            _ => keep_existing = false,
        }
    }

    if keep_existing {
        // Recompute counters from persisted segments in case they drifted.
        record.downloaded = record.segments.iter().map(|segment| segment.written).sum();
    } else {
        record.final_url = Some(probe.final_url.clone());
        record.total_size = total_size;
        record.resumable = probe.resumable;
        record.etag = probe.etag.clone();
        record.last_modified = probe.last_modified.clone();
        record.content_type = probe.content_type.clone();
        record.downloaded = 0;
        record.segments = if probe.resumable {
            download::build_segments(
                total_size.unwrap_or(0),
                record
                    .max_connections
                    .unwrap_or_else(|| inner.max_connections.load(Ordering::Relaxed)),
                inner.config.chunk_size,
            )
        } else if let Some(total) = total_size {
            vec![Segment::new(0, Some(total - 1))]
        } else {
            vec![Segment::new(0, None)]
        };
        let _ = tokio::fs::remove_file(&record.temp_path).await;
    }

    if record.segments.is_empty() {
        finish_completed(&inner, &mut record).await?;
        return Ok(());
    }

    if record.resumable {
        if let Some(total) = record.total_size {
            let file = tokio::fs::OpenOptions::new()
                .create(true)
                .write(true)
                .read(true)
                .open(&record.temp_path)
                .await?;
            if file.metadata().await?.len() != total {
                file.set_len(total).await?;
            }
        }
    }

    control
        .downloaded
        .store(record.downloaded, Ordering::SeqCst);

    record.status = DownloadStatus::Downloading;
    inner.save(&record)?;
    inner.emit_updated(&record);

    if record.segments.iter().all(Segment::is_complete) {
        finish_completed(&inner, &mut record).await?;
        return Ok(());
    }

    let segments = Arc::new(Mutex::new(record.segments.clone()));
    let done = Arc::new(AtomicBool::new(false));
    let monitor = tokio::spawn(progress_loop(
        inner.clone(),
        id,
        control.downloaded.clone(),
        segments.clone(),
        done.clone(),
        record.total_size,
    ));

    let max_connections = record
        .max_connections
        .unwrap_or_else(|| inner.max_connections.load(Ordering::Relaxed));
    let outcome = {
        let context = TransferContext {
            client: &inner.client,
            url: &record.url,
            headers: &headers,
            resumable: record.resumable,
            temp_path: &record.temp_path,
            limiter: &inner.limiter,
            pause: &control.pause,
            cancel: &control.cancel,
            downloaded: &control.downloaded,
            segments: &segments,
        };
        download::run_segments(&context, max_connections).await
    };

    done.store(true, Ordering::SeqCst);
    monitor.abort();

    if inner.is_removed(id) {
        return Ok(());
    }

    record.segments = segments.lock().clone();
    record.downloaded = control.downloaded.load(Ordering::SeqCst);

    match outcome {
        Ok(()) => {
            if control.pause.load(Ordering::Relaxed) {
                finish_paused(&inner, &mut record, &control)?;
            } else if control.cancel.load(Ordering::Relaxed) {
                finish_cancelled(&inner, &mut record).await?;
            } else {
                finish_completed(&inner, &mut record).await?;
            }
        }
        Err(Error::Paused) => finish_paused(&inner, &mut record, &control)?,
        Err(Error::Cancelled) => finish_cancelled(&inner, &mut record).await?,
        Err(error) => {
            if control.cancel.load(Ordering::Relaxed) {
                finish_cancelled(&inner, &mut record).await?;
            } else if control.pause.load(Ordering::Relaxed) {
                finish_paused(&inner, &mut record, &control)?;
            } else {
                finish_failed(&inner, &mut record, error)?;
            }
        }
    }

    Ok(())
}

fn effective_headers(record: &DownloadRecord) -> BTreeMap<String, String> {
    let mut headers = record.headers.clone();
    if let Some(cookies) = &record.cookies {
        headers.insert("Cookie".to_string(), cookies.clone());
    }
    if let Some(referrer) = &record.referrer {
        headers.insert("Referer".to_string(), referrer.clone());
    }
    headers
}

fn validators_match(record: &DownloadRecord, probe: &download::Probe) -> bool {
    match (&record.etag, &probe.etag) {
        (Some(stored), Some(remote)) => stored == remote,
        (None, None) => match (&record.last_modified, &probe.last_modified) {
            (Some(stored), Some(remote)) => stored == remote,
            _ => true,
        },
        _ => false,
    }
}

fn finish_paused(inner: &Inner, record: &mut DownloadRecord, control: &Control) -> Result<()> {
    // If the user already requested resume while the worker was stopping, hand
    // control back to the queue instead of ending in the paused state.
    if !control.pause.load(Ordering::Relaxed) && !control.cancel.load(Ordering::Relaxed) {
        record.status = DownloadStatus::Queued;
        record.error = None;
        inner.save(record)?;
        inner.speeds.lock().insert(record.id, 0);
        inner.emit_updated(record);
        return Ok(());
    }

    record.status = DownloadStatus::Paused;
    record.error = None;
    inner.save(record)?;
    inner.speeds.lock().insert(record.id, 0);
    inner.emit_updated(record);
    Ok(())
}

fn finish_failed(inner: &Inner, record: &mut DownloadRecord, error: Error) -> Result<()> {
    record.status = DownloadStatus::Error;
    record.error = Some(error.to_string());
    inner.save(record)?;
    inner.speeds.lock().insert(record.id, 0);
    inner.emit_updated(record);
    Ok(())
}

async fn finish_cancelled(inner: &Inner, record: &mut DownloadRecord) -> Result<()> {
    let _ = tokio::fs::remove_file(&record.temp_path).await;
    record.status = DownloadStatus::Cancelled;
    record.error = None;
    record.downloaded = 0;
    inner.save(record)?;
    inner.speeds.lock().insert(record.id, 0);
    inner.emit_updated(record);
    Ok(())
}

async fn finish_completed(inner: &Inner, record: &mut DownloadRecord) -> Result<()> {
    if let Some(total) = record.total_size {
        if let Ok(metadata) = tokio::fs::metadata(&record.temp_path).await {
            if metadata.len() != total {
                if metadata.len() < total {
                    return finish_failed(
                        inner,
                        record,
                        Error::message(format!(
                            "transfer ended early ({} of {total} bytes)",
                            metadata.len()
                        )),
                    );
                }
                let file = tokio::fs::OpenOptions::new()
                    .write(true)
                    .open(&record.temp_path)
                    .await?;
                file.set_len(total).await?;
            }
        }
    }

    let final_path = download::unique_path(&record.directory, &record.file_name);
    tokio::fs::rename(&record.temp_path, &final_path).await?;
    if let Some(name) = final_path.file_name() {
        record.file_name = name.to_string_lossy().to_string();
    }
    record.status = DownloadStatus::Completed;
    record.completed_at = Some(Utc::now());
    record.error = None;
    record.downloaded = record.total_size.unwrap_or(record.downloaded);
    inner.save(record)?;
    inner.speeds.lock().insert(record.id, 0);

    let mut info = record.info();
    info.speed = 0;
    info.eta = None;
    if !inner.is_removed(record.id) {
        inner.emit(EngineEvent::Completed { download: info });
    }
    debug!(id = %record.id, path = %record.path().display(), "download completed");
    Ok(())
}

async fn progress_loop(
    inner: Arc<Inner>,
    id: Uuid,
    downloaded: Arc<AtomicU64>,
    segments: Arc<Mutex<Vec<Segment>>>,
    done: Arc<AtomicBool>,
    total_size: Option<u64>,
) {
    let mut last_bytes = downloaded.load(Ordering::Relaxed);
    let mut last_time = Instant::now();
    let mut tick = 0u32;

    loop {
        tokio::time::sleep(Duration::from_millis(500)).await;
        if done.load(Ordering::SeqCst) || inner.is_removed(id) {
            break;
        }

        let now = Instant::now();
        let current = downloaded.load(Ordering::Relaxed);
        let elapsed = now.duration_since(last_time).as_secs_f64().max(0.001);
        let speed = ((current.saturating_sub(last_bytes)) as f64 / elapsed) as u64;
        last_bytes = current;
        last_time = now;
        tick += 1;

        inner.speeds.lock().insert(id, speed);
        let eta = match total_size {
            Some(total) if speed > 0 && current < total => Some((total - current) / speed),
            _ => None,
        };
        let snapshot = segments.lock().clone();
        inner.emit(EngineEvent::Progress {
            id,
            downloaded: current,
            total_size,
            speed,
            eta,
            segments: snapshot.clone(),
        });

        if tick % 4 == 0 {
            if let Err(error) = inner.store.update_progress(id, current, &snapshot) {
                warn!(%id, %error, "failed to persist download progress");
            }
        }
    }
}
