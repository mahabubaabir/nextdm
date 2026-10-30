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

use std::path::{Path, PathBuf};

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

/// Resolve the path of the `yt-dlp` binary, allowing an override via env.
/// Checks user's local bin (~/.local/bin) first so user-upgraded pip/binary builds
/// take priority over stale system distribution packages.
pub fn yt_dlp_path() -> String {
    if let Ok(path) = std::env::var("NEXTDM_YTDLP") {
        if !path.trim().is_empty() {
            return path;
        }
    }
    if let Some(home) = home_dir() {
        let local_bin = home.join(".local/bin/yt-dlp");
        if local_bin.is_file() {
            return local_bin.to_string_lossy().to_string();
        }
    }
    let usr_local = Path::new("/usr/local/bin/yt-dlp");
    if usr_local.is_file() {
        return usr_local.to_string_lossy().to_string();
    }
    let usr_bin = Path::new("/usr/bin/yt-dlp");
    if usr_bin.is_file() {
        return usr_bin.to_string_lossy().to_string();
    }
    "yt-dlp".to_string()
}

/// Resolve the path of the `ffmpeg` binary.
pub fn ffmpeg_path() -> Option<String> {
    if let Ok(path) = std::env::var("NEXTDM_FFMPEG") {
        if !path.trim().is_empty() {
            return Some(path);
        }
    }
    if let Some(home) = home_dir() {
        let local_bin = home.join(".local/bin/ffmpeg");
        if local_bin.is_file() {
            return Some(local_bin.to_string_lossy().to_string());
        }
    }
    let usr_local = Path::new("/usr/local/bin/ffmpeg");
    if usr_local.is_file() {
        return Some(usr_local.to_string_lossy().to_string());
    }
    let usr_bin = Path::new("/usr/bin/ffmpeg");
    if usr_bin.is_file() {
        return Some(usr_bin.to_string_lossy().to_string());
    }
    None
}

/// Resolve the path of Node.js for yt-dlp JavaScript extraction runtime.
pub fn node_path() -> Option<String> {
    if let Some(home) = home_dir() {
        let local_bin = home.join(".local/bin/node");
        if local_bin.is_file() {
            return Some(local_bin.to_string_lossy().to_string());
        }
    }
    let usr_local = Path::new("/usr/local/bin/node");
    if usr_local.is_file() {
        return Some(usr_local.to_string_lossy().to_string());
    }
    let usr_bin = Path::new("/usr/bin/node");
    if usr_bin.is_file() {
        return Some(usr_bin.to_string_lossy().to_string());
    }
    None
}

/// Prepares a tokio Command for yt-dlp by configuring PATH, ffmpeg location, and JS runtimes.
pub fn configure_command(cmd: &mut tokio::process::Command) {
    let current_path = std::env::var("PATH").unwrap_or_default();
    let mut new_path = String::new();
    if let Some(home) = home_dir() {
        let local_bin = home.join(".local/bin");
        if local_bin.is_dir() {
            new_path.push_str(&local_bin.to_string_lossy());
            new_path.push(':');
        }
    }
    new_path.push_str("/usr/local/bin:");
    new_path.push_str(&current_path);
    cmd.env("PATH", new_path);

    if let Some(ffmpeg) = ffmpeg_path() {
        cmd.arg("--ffmpeg-location").arg(ffmpeg);
    }
    if let Some(node) = node_path() {
        cmd.arg("--js-runtimes").arg(format!("node:{node}"));
    }
}

/// Best-effort check that the sidecar is available.
pub async fn yt_dlp_available() -> bool {
    let mut cmd = tokio::process::Command::new(yt_dlp_path());
    cmd.arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    cmd.status()
        .await
        .map(|status| status.success())
        .unwrap_or(false)
}
