//! Media helpers for NextDM.
//!
//! Direct HTTP, HLS and DASH downloads are handled by `nextdm-engine`; this
//! crate adds site-aware media extraction (YouTube, Facebook, ...) on top of
//! the optional `yt-dlp` sidecar.

use serde::{Deserialize, Serialize};

pub mod ytdlp;

/// A selectable media format reported by the extractor.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaFormat {
    pub format_id: String,
    pub label: String,
    pub extension: String,
    pub kind: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fps: Option<f32>,
    pub filesize: Option<u64>,
    pub bitrate: Option<u64>,
    pub has_audio: bool,
}

/// Result of media probing.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub title: String,
    pub webpage_url: String,
    pub duration: Option<f64>,
    pub thumbnail: Option<String>,
    pub uploader: Option<String>,
    pub formats: Vec<MediaFormat>,
    pub extractor: String,
}

/// Resolve the path of the `yt-dlp` binary, allowing an override via env.
pub fn yt_dlp_path() -> String {
    std::env::var("NEXTDM_YTDLP").unwrap_or_else(|_| "yt-dlp".to_string())
}

/// Best-effort check that the sidecar is available.
pub async fn yt_dlp_available() -> bool {
    tokio::process::Command::new(yt_dlp_path())
        .arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .await
        .map(|status| status.success())
        .unwrap_or(false)
}
