use std::collections::BTreeMap;
use std::path::PathBuf;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Lifecycle state of a download.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DownloadStatus {
    #[default]
    Queued,
    Connecting,
    Downloading,
    Paused,
    Completed,
    Error,
    Cancelled,
    Scheduled,
}

impl DownloadStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Connecting => "connecting",
            Self::Downloading => "downloading",
            Self::Paused => "paused",
            Self::Completed => "completed",
            Self::Error => "error",
            Self::Cancelled => "cancelled",
            Self::Scheduled => "scheduled",
        }
    }

    pub fn parse(value: &str) -> Self {
        match value {
            "connecting" => Self::Connecting,
            "downloading" => Self::Downloading,
            "paused" => Self::Paused,
            "completed" => Self::Completed,
            "error" => Self::Error,
            "cancelled" => Self::Cancelled,
            "scheduled" => Self::Scheduled,
            _ => Self::Queued,
        }
    }

    /// Statuses for transfers that can still make progress.
    pub fn is_active(self) -> bool {
        matches!(self, Self::Queued | Self::Connecting | Self::Downloading)
    }

    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Cancelled)
    }
}

/// A byte range of the target file. `end` is inclusive and `None` when the
/// server did not report a total size (single-stream, non-resumable transfer).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Segment {
    pub start: u64,
    pub end: Option<u64>,
    /// Bytes already written for this segment.
    pub written: u64,
}

impl Segment {
    pub fn new(start: u64, end: Option<u64>) -> Self {
        Self {
            start,
            end,
            written: 0,
        }
    }

    pub fn total_len(&self) -> Option<u64> {
        self.end.map(|end| end.saturating_sub(self.start) + 1)
    }

    pub fn is_complete(&self) -> bool {
        self.total_len()
            .map(|len| self.written >= len)
            .unwrap_or(false)
    }

    pub fn remaining(&self) -> Option<u64> {
        self.total_len().map(|len| len.saturating_sub(self.written))
    }
}

/// Request used to add a new download.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadSpec {
    pub url: String,
    #[serde(default)]
    pub directory: Option<PathBuf>,
    #[serde(default)]
    pub file_name: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    #[serde(default)]
    pub cookies: Option<String>,
    #[serde(default)]
    pub referrer: Option<String>,
    #[serde(default)]
    pub queue_id: Option<String>,
    #[serde(default)]
    pub priority: Option<i64>,
    #[serde(default)]
    pub max_connections: Option<usize>,
    #[serde(default = "default_true")]
    pub start_immediately: bool,
}

fn default_true() -> bool {
    true
}

impl DownloadSpec {
    pub fn new(url: impl Into<String>) -> Self {
        Self {
            url: url.into(),
            directory: None,
            file_name: None,
            category: None,
            headers: BTreeMap::new(),
            cookies: None,
            referrer: None,
            queue_id: None,
            priority: None,
            max_connections: None,
            start_immediately: true,
        }
    }
}

/// Serializable view of a download handed to the UI.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadInfo {
    pub id: Uuid,
    pub url: String,
    pub final_url: Option<String>,
    pub file_name: String,
    pub directory: PathBuf,
    pub path: PathBuf,
    pub temp_path: PathBuf,
    pub total_size: Option<u64>,
    pub downloaded: u64,
    pub status: DownloadStatus,
    pub resumable: bool,
    pub content_type: Option<String>,
    pub category: String,
    pub error: Option<String>,
    pub speed: u64,
    pub eta: Option<u64>,
    pub created_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub priority: i64,
    pub max_connections: Option<usize>,
    pub queue_id: Option<String>,
}

/// Events broadcast by the engine. The Tauri layer forwards these to the UI.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum EngineEvent {
    Added {
        download: DownloadInfo,
    },
    Updated {
        download: DownloadInfo,
    },
    Progress {
        id: Uuid,
        downloaded: u64,
        total_size: Option<u64>,
        speed: u64,
        eta: Option<u64>,
    },
    Completed {
        download: DownloadInfo,
    },
    Removed {
        id: Uuid,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStats {
    pub active: usize,
    pub queued: usize,
    pub completed: usize,
    pub total_speed: u64,
}

/// Engine configuration.
#[derive(Clone, Debug)]
pub struct EngineConfig {
    /// Directory containing the engine database and optional metadata.
    pub data_dir: PathBuf,
    /// Default directory for finished files.
    pub download_dir: PathBuf,
    pub max_connections: usize,
    /// Preferred chunk size when splitting a file into segments.
    pub chunk_size: u64,
    /// Global speed limit in bytes per second. `None` means unlimited.
    pub speed_limit: Option<u64>,
    pub user_agent: String,
}

impl EngineConfig {
    pub fn new(data_dir: impl Into<PathBuf>, download_dir: impl Into<PathBuf>) -> Self {
        Self {
            data_dir: data_dir.into(),
            download_dir: download_dir.into(),
            max_connections: 8,
            chunk_size: 2 * 1024 * 1024,
            speed_limit: None,
            user_agent: format!(
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 \
                 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 NextDM/{}",
                env!("CARGO_PKG_VERSION")
            ),
        }
    }
}
