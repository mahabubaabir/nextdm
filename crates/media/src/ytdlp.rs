//! Async bridge to the optional `yt-dlp` sidecar.

use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::Deserialize;
use tokio::process::Command;

use crate::{yt_dlp_path, MediaFormat, MediaInfo};

#[derive(Debug, thiserror::Error)]
pub enum MediaError {
    #[error("yt-dlp is not installed (install it with your package manager or set NEXTDM_YTDLP)")]
    Missing,
    #[error("yt-dlp failed: {0}")]
    Failed(String),
    #[error("could not parse yt-dlp output: {0}")]
    Parse(#[from] serde_json::Error),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
}

type Result<T> = std::result::Result<T, MediaError>;

#[derive(Debug, Deserialize)]
struct RawInfo {
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    webpage_url: Option<String>,
    #[serde(default)]
    duration: Option<f64>,
    #[serde(default)]
    thumbnail: Option<String>,
    #[serde(default)]
    uploader: Option<String>,
    #[serde(default)]
    extractor: Option<String>,
    #[serde(default)]
    formats: Vec<RawFormat>,
}

#[derive(Debug, Deserialize)]
struct RawFormat {
    format_id: String,
    #[serde(default)]
    ext: Option<String>,
    #[serde(default)]
    vcodec: Option<String>,
    #[serde(default)]
    acodec: Option<String>,
    #[serde(default)]
    width: Option<u32>,
    #[serde(default)]
    height: Option<u32>,
    #[serde(default)]
    fps: Option<f32>,
    #[serde(default)]
    filesize: Option<u64>,
    #[serde(default)]
    filesize_approx: Option<u64>,
    #[serde(default)]
    tbr: Option<f64>,
    #[serde(default)]
    format_note: Option<String>,
}

/// Ask yt-dlp for metadata and a flat list of downloadable formats.
pub async fn probe(url: &str) -> Result<MediaInfo> {
    let output = Command::new(yt_dlp_path())
        .args(["-J", "--no-playlist", "--no-warnings", "--skip-download"])
        .arg(url)
        .stdin(Stdio::null())
        .output()
        .await
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                MediaError::Missing
            } else {
                MediaError::Io(error)
            }
        })?;

    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr);
        return Err(MediaError::Failed(tail(&message, 1200)));
    }

    let raw: RawInfo = serde_json::from_slice(&output.stdout)?;
    let title = raw.title.unwrap_or_else(|| "media".to_string());
    let webpage_url = raw.webpage_url.unwrap_or_else(|| url.to_string());
    let extractor = raw.extractor.unwrap_or_else(|| "generic".to_string());

    let mut formats = Vec::new();
    for format in raw.formats {
        let ext = format.ext.unwrap_or_else(|| "mp4".to_string());
        if matches!(ext.as_str(), "mhtml" | "none") {
            continue;
        }
        let has_video = format.vcodec.as_deref().map(|codec| codec != "none").unwrap_or(false);
        let has_audio = format.acodec.as_deref().map(|codec| codec != "none").unwrap_or(false);
        if !has_video && !has_audio {
            continue;
        }

        let height = format.height.unwrap_or(0);
        let kind = if has_video { "video" } else { "audio" };
        let label = match (has_video, height, &format.format_note) {
            (true, 2160, _) => "2160p 4K".to_string(),
            (true, 1440, _) => "1440p 2K".to_string(),
            (true, 1080, _) => "1080p Full HD".to_string(),
            (true, 720, _) => "720p HD".to_string(),
            (true, h, _) if h > 0 => format!("{h}p"),
            (true, _, Some(note)) => note.clone(),
            (true, _, _) => "Video".to_string(),
            (false, _, Some(note)) => format!("Audio · {note}"),
            (false, _, _) => "Audio".to_string(),
        };

        let bitrate = format.tbr.map(|tbr| (tbr * 1000.0) as u64);
        let filesize = format.filesize.or(format.filesize_approx);
        formats.push(MediaFormat {
            format_id: format.format_id,
            label: format!("{label} · {}", ext.to_uppercase()),
            extension: ext,
            kind: kind.to_string(),
            width: format.width,
            height: format.height,
            fps: format.fps,
            filesize,
            bitrate,
            has_audio,
        });
    }

    formats.sort_by(|a, b| {
        b.height
            .unwrap_or(0)
            .cmp(&a.height.unwrap_or(0))
            .then_with(|| b.bitrate.unwrap_or(0).cmp(&a.bitrate.unwrap_or(0)))
    });
    formats.dedup_by(|a, b| {
        a.format_id == b.format_id && a.extension == b.extension && a.kind == b.kind
    });
    formats.truncate(80);

    Ok(MediaInfo {
        title,
        webpage_url,
        duration: raw.duration,
        thumbnail: raw.thumbnail,
        uploader: raw.uploader,
        formats,
        extractor,
    })
}

/// Download a media URL with yt-dlp and return the produced file.
///
/// `format_id` selects a specific format. When the chooser picks a video-only
/// stream, yt-dlp merges it with the best audio track.
pub async fn download(
    url: &str,
    format_id: Option<&str>,
    output_dir: &Path,
    file_stem: Option<&str>,
) -> Result<PathBuf> {
    tokio::fs::create_dir_all(output_dir).await?;

    let template = match file_stem {
        Some(stem) => output_dir
            .join(format!("{} [%(id)s].%(ext)s", sanitize_stem(stem)))
            .to_string_lossy()
            .to_string(),
        None => output_dir
            .join("%(title).160s [%(id)s].%(ext)s")
            .to_string_lossy()
            .to_string(),
    };

    let format = match format_id {
        Some(id) if !id.is_empty() => format!("{id}+bestaudio/{id}/best"),
        _ => "bv*+ba/b".to_string(),
    };

    let output = Command::new(yt_dlp_path())
        .arg("--no-playlist")
        .arg("--no-warnings")
        .arg("--newline")
        .arg("--merge-output-format")
        .arg("mp4")
        .arg("-f")
        .arg(format)
        .arg("-o")
        .arg(template)
        .arg("--print")
        .arg("after_move:filepath")
        .arg(url)
        .stdin(Stdio::null())
        .output()
        .await
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                MediaError::Missing
            } else {
                MediaError::Io(error)
            }
        })?;

    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr);
        return Err(MediaError::Failed(tail(&message, 1600)));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let path = stdout
        .lines()
        .rev()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(PathBuf::from)
        .find(|path| path.is_file())
        .ok_or_else(|| MediaError::Failed("yt-dlp reported success but no file was produced".into()))?;

    Ok(path)
}

fn sanitize_stem(name: &str) -> String {
    name.chars()
        .map(|character| match character {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            character => character,
        })
        .take(160)
        .collect()
}

fn tail(value: &str, limit: usize) -> String {
    if value.len() <= limit {
        return value.trim().to_string();
    }
    let start = value.len() - limit;
    format!("…{}", value[start..].trim())
}
