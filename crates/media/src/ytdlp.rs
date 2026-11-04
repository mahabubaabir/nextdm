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
    #[serde(default)]
    resolution: Option<String>,
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

        let ext_lower = ext.to_lowercase();
        let is_video_container = matches!(
            ext_lower.as_str(),
            "mp4" | "mkv" | "webm" | "mov" | "avi" | "flv" | "3gp"
        );
        let is_audio_container = matches!(
            ext_lower.as_str(),
            "m4a" | "mp3" | "opus" | "ogg" | "aac" | "wav" | "flac"
        );

        let vcodec_str = format.vcodec.as_deref().unwrap_or("");
        let acodec_str = format.acodec.as_deref().unwrap_or("");

        let has_video = if vcodec_str == "none" {
            false
        } else if !vcodec_str.is_empty() {
            true
        } else {
            is_video_container || (!is_audio_container && format.height.unwrap_or(0) > 0)
        };

        let has_audio = if acodec_str == "none" {
            false
        } else if !acodec_str.is_empty() {
            true
        } else {
            is_audio_container || is_video_container
        };

        if !has_video && !has_audio {
            continue;
        }

        let mut height = format.height.unwrap_or(0);
        if height == 0 {
            if format.format_id == "hd" {
                height = 720;
            } else if format.format_id == "sd" {
                height = 360;
            } else if let Some(res) = &format.resolution {
                if let Some((_, h_str)) = res.split_once('x') {
                    if let Ok(h) = h_str.trim().parse::<u32>() {
                        height = h;
                    }
                }
            } else if let Some(note) = &format.format_note {
                if let Some(h_str) = note.strip_suffix('p') {
                    if let Ok(h) = h_str.parse::<u32>() {
                        height = h;
                    }
                }
            }
        }

        let vcodec_lower = vcodec_str.to_lowercase();
        let video_codec_name = if vcodec_lower.starts_with("avc1") || vcodec_lower.contains("h264") {
            "H.264"
        } else if vcodec_lower.starts_with("av01") || vcodec_lower.contains("av1") {
            "AV1"
        } else if vcodec_lower.starts_with("vp09") || vcodec_lower.contains("vp9") {
            "VP9"
        } else if vcodec_lower.starts_with("hev1")
            || vcodec_lower.starts_with("hvc1")
            || vcodec_lower.contains("h265")
            || vcodec_lower.contains("hevc")
        {
            "HEVC"
        } else if format.format_id == "hd" || format.format_id == "sd" || (has_video && ext_lower == "mp4") {
            "H.264"
        } else {
            ""
        };

        let acodec_lower = acodec_str.to_lowercase();
        let audio_codec_name = if acodec_lower.starts_with("mp4a") || acodec_lower.contains("aac") {
            "AAC"
        } else if acodec_lower.contains("opus") {
            "Opus"
        } else if acodec_lower.contains("mp3") {
            "MP3"
        } else if acodec_lower.contains("vorbis") {
            "Vorbis"
        } else if ext_lower == "m4a" {
            "AAC"
        } else {
            ""
        };

        let kind = if has_video { "video" } else { "audio" };
        let base_label = match (has_video, height, format.format_id.as_str(), &format.format_note) {
            (true, _, "hd", _) => "HD 720p".to_string(),
            (true, _, "sd", _) => "SD 360p".to_string(),
            (true, 2160, _, _) => "2160p 4K".to_string(),
            (true, 1440, _, _) => "1440p 2K".to_string(),
            (true, 1080, _, _) => "1080p Full HD".to_string(),
            (true, 720, _, _) => "720p HD".to_string(),
            (true, h, _, _) if h > 0 => format!("{h}p"),
            (true, _, _, Some(note)) if !note.trim().is_empty() => note.clone(),
            (true, _, _, _) => "Video".to_string(),
            (false, _, _, Some(note)) if !note.trim().is_empty() => format!("Audio · {note}"),
            (false, _, _, _) => "Audio".to_string(),
        };

        let label = if has_video {
            if !video_codec_name.is_empty() {
                format!("{base_label} ({video_codec_name}) · {}", ext.to_uppercase())
            } else {
                format!("{base_label} · {}", ext.to_uppercase())
            }
        } else if !audio_codec_name.is_empty() {
            format!("Audio ({audio_codec_name}) · {}", ext.to_uppercase())
        } else {
            format!("{base_label} · {}", ext.to_uppercase())
        };

        let bitrate = format.tbr.map(|tbr| (tbr * 1000.0) as u64);
        let filesize = format.filesize.or(format.filesize_approx);
        formats.push(MediaFormat {
            format_id: format.format_id,
            label,
            extension: ext,
            kind: kind.to_string(),
            width: format.width,
            height: if height > 0 { Some(height) } else { format.height },
            fps: format.fps,
            filesize,
            bitrate,
            has_audio,
        });
    }

    // Helper to score codec preference: H.264 (4) > VP9 (3) > HEVC (2) > other (2) > AV1 (1)
    fn codec_score(label: &str) -> u8 {
        if label.contains("(H.264)") {
            4
        } else if label.contains("(VP9)") {
            3
        } else if label.contains("(HEVC)") {
            2
        } else if label.contains("(AV1)") {
            1
        } else {
            2
        }
    }

    formats.sort_by(|a, b| {
        // 1. Video before audio
        match (a.kind.as_str(), b.kind.as_str()) {
            ("video", "audio") => return std::cmp::Ordering::Less,
            ("audio", "video") => return std::cmp::Ordering::Greater,
            _ => {}
        }

        if a.kind == "video" {
            // 2. Resolution (height) descending
            let h_a = a.height.unwrap_or(0);
            let h_b = b.height.unwrap_or(0);
            if h_a != h_b {
                return h_b.cmp(&h_a);
            }

            // 3. Codec preference (universal H.264 first)
            let score_a = codec_score(&a.label);
            let score_b = codec_score(&b.label);
            if score_a != score_b {
                return score_b.cmp(&score_a);
            }

            // 4. Combined audio+video stream over video-only
            if a.has_audio != b.has_audio {
                return b.has_audio.cmp(&a.has_audio);
            }

            // 5. Bitrate descending
            b.bitrate.unwrap_or(0).cmp(&a.bitrate.unwrap_or(0))
        } else {
            // For audio: AAC first, then bitrate
            let aac_a = a.label.contains("AAC") || a.extension.eq_ignore_ascii_case("m4a");
            let aac_b = b.label.contains("AAC") || b.extension.eq_ignore_ascii_case("m4a");
            if aac_a != aac_b {
                return aac_b.cmp(&aac_a);
            }
            b.bitrate.unwrap_or(0).cmp(&a.bitrate.unwrap_or(0))
        }
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
        Some(id) if !id.is_empty() => {
            format!("{id}+ba[acodec^=mp4a]/{id}+ba[ext=m4a]/{id}+ba/{id}/best")
        }
        _ => {
            "bv*[vcodec^=avc1]+ba[acodec^=mp4a]/bv*[vcodec^=avc1]+ba[ext=m4a]/bv*[vcodec^=avc1]+ba/b[vcodec^=avc1]/best[ext=mp4]/bv*+ba/b".to_string()
        }
    };

    let mut cmd = Command::new(yt_dlp_path());
    configure_command(&mut cmd);
    cmd.arg("--no-playlist")
        .arg("--no-warnings")
        .arg("--newline")
        // Prefer universally playable H.264 video and AAC audio across all platforms
        .arg("-S")
        .arg("vcodec:h264,vcodec:vp9,res,acodec:m4a,acodec:aac")
        // Always produce standard MP4 container
        .arg("--merge-output-format")
        .arg("mp4")
        // Ensure any merged audio in MP4 is standardized to stereo AAC (replaces incompatible Opus),
        // and add faststart so the file begins playing immediately without waiting for whole-file index
        .arg("--postprocessor-args")
        .arg("Merger+ffmpeg_o:-c:v copy -c:a aac -b:a 192k -movflags +faststart")
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
                let downloaded = parts[0].parse::<f64>().map(|v| v as u64).unwrap_or(0);
                let total = parts[1]
                    .parse::<f64>()
                    .ok()
                    .or_else(|| parts[2].parse::<f64>().ok())
                    .map(|v| v as u64);
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
