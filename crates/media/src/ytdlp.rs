//! Async bridge to the optional `yt-dlp` sidecar.

use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::Deserialize;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::{configure_command, yt_dlp_path, MediaFormat, MediaInfo};

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
    let mut cmd = Command::new(yt_dlp_path());
    configure_command(&mut cmd);
    let output = cmd
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
    download_with_progress(url, format_id, output_dir, file_stem, |_, _, _, _| {}).await
}

/// Download a media URL with yt-dlp with live progress callbacks.
pub async fn download_with_progress<F>(
    url: &str,
    format_id: Option<&str>,
    output_dir: &Path,
    file_stem: Option<&str>,
    mut on_progress: F,
) -> Result<PathBuf>
where
    F: FnMut(u64, Option<u64>, u64, Option<u64>) + Send + 'static,
{
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

    let mut cmd = Command::new(yt_dlp_path());
    configure_command(&mut cmd);
    cmd.arg("--no-playlist")
        .arg("--no-warnings")
        .arg("--newline")
        .arg("--merge-output-format")
        .arg("mp4")
        .arg("-f")
        .arg(format)
        .arg("-o")
        .arg(template)
        .arg("--progress-template")
        .arg("download:PROGRESS:%(progress.downloaded_bytes)s:%(progress.total_bytes)s:%(progress.total_bytes_estimate)s:%(progress.speed)s:%(progress.eta)s")
        .arg("--exec")
        .arg("echo FINISHED:{}")
        .arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            MediaError::Missing
        } else {
            MediaError::Io(error)
        }
    })?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| MediaError::Failed("could not capture yt-dlp stdout".into()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| MediaError::Failed("could not capture yt-dlp stderr".into()))?;

    let stderr_handle = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        let mut buffer = String::new();
        while let Ok(Some(line)) = reader.next_line().await {
            buffer.push_str(&line);
            buffer.push('\n');
            if buffer.len() > 4000 {
                let start = buffer.len() - 4000;
                buffer = buffer[start..].to_string();
            }
        }
        buffer
    });

    let mut reader = BufReader::new(stdout).lines();
    let mut finished_path: Option<PathBuf> = None;
    let mut last_progress = std::time::Instant::now();

    while let Ok(Some(line)) = reader.next_line().await {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("PROGRESS:") {
            let parts: Vec<&str> = rest.split(':').collect();
            if parts.len() >= 5 {
                let downloaded = parts[0].parse::<u64>().unwrap_or(0);
                let total = parts[1]
                    .parse::<u64>()
                    .ok()
                    .or_else(|| parts[2].parse::<u64>().ok());
                let speed = parts[3].parse::<f64>().map(|s| s as u64).unwrap_or(0);
                let eta = parts[4].parse::<f64>().map(|e| e as u64).ok();

                if last_progress.elapsed() >= std::time::Duration::from_millis(150) {
                    on_progress(downloaded, total, speed, eta);
                    last_progress = std::time::Instant::now();
                }
            }
        } else if let Some(path_str) = line.strip_prefix("FINISHED:") {
            let path = PathBuf::from(path_str.trim());
            if path.is_file() {
                finished_path = Some(path);
            }
        }
    }

    let status = child.wait().await?;
    let stderr_output = stderr_handle.await.unwrap_or_default();

    if !status.success() {
        return Err(MediaError::Failed(tail(&stderr_output, 1600)));
    }

    if let Some(path) = finished_path {
        return Ok(path);
    }

    // Fallback: look for newly produced files in output_dir
    if let Ok(mut entries) = tokio::fs::read_dir(output_dir).await {
        let mut newest: Option<(PathBuf, std::time::SystemTime)> = None;
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path.is_file() {
                if let Ok(meta) = entry.metadata().await {
                    if let Ok(modified) = meta.modified() {
                        if newest.as_ref().map(|(_, m)| modified > *m).unwrap_or(true) {
                            newest = Some((path, modified));
                        }
                    }
                }
            }
        }
        if let Some((path, _)) = newest {
            return Ok(path);
        }
    }

    Err(MediaError::Failed("yt-dlp reported success but no output file was detected".into()))
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
