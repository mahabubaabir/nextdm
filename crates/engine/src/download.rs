use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use parking_lot::Mutex;
use percent_encoding::percent_decode_str;
use reqwest::header::{
    ACCEPT_ENCODING, CONTENT_DISPOSITION, CONTENT_RANGE, CONTENT_TYPE, ETAG, LAST_MODIFIED, RANGE,
};
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncSeekExt, AsyncWriteExt};
use url::Url;

use crate::error::{Error, Result};
use crate::types::Segment;

/// Result of probing a remote URL with a one-byte range request.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Probe {
    pub final_url: String,
    pub total_size: Option<u64>,
    pub resumable: bool,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    pub content_type: Option<String>,
    pub disposition: Option<String>,
}

/// Global token-bucket speed limiter shared by every active transfer.
pub struct SpeedLimiter {
    rate: AtomicU64,
    bucket: Mutex<Bucket>,
}

struct Bucket {
    tokens: f64,
    last: Instant,
}

impl SpeedLimiter {
    pub fn new(rate: Option<u64>) -> Self {
        let rate = rate.unwrap_or(0);
        Self {
            rate: AtomicU64::new(rate),
            bucket: Mutex::new(Bucket {
                tokens: rate as f64,
                last: Instant::now(),
            }),
        }
    }

    pub fn set_rate(&self, rate: Option<u64>) {
        let rate = rate.unwrap_or(0);
        self.rate.store(rate, Ordering::Relaxed);
        let mut bucket = self.bucket.lock();
        bucket.tokens = rate as f64;
        bucket.last = Instant::now();
    }

    pub fn rate(&self) -> Option<u64> {
        match self.rate.load(Ordering::Relaxed) {
            0 => None,
            rate => Some(rate),
        }
    }

    /// Wait until `bytes` may be transferred. Returns immediately when unlimited.
    pub async fn acquire(&self, bytes: u64) {
        let rate = self.rate.load(Ordering::Relaxed);
        if rate == 0 || bytes == 0 {
            return;
        }

        loop {
            let wait = {
                let mut bucket = self.bucket.lock();
                let now = Instant::now();
                let elapsed = now.duration_since(bucket.last).as_secs_f64();
                bucket.last = now;
                let capacity = rate as f64;
                bucket.tokens = (bucket.tokens + elapsed * capacity).min(capacity);

                if bucket.tokens >= bytes as f64 {
                    bucket.tokens -= bytes as f64;
                    return;
                }

                let missing = bytes as f64 - bucket.tokens;
                (missing / capacity).min(0.25)
            };

            tokio::time::sleep(Duration::from_secs_f64(wait.max(0.002))).await;
        }
    }
}

/// Apply user supplied headers to a request, ignoring malformed entries.
pub fn apply_headers(
    mut request: reqwest::RequestBuilder,
    headers: &BTreeMap<String, String>,
) -> reqwest::RequestBuilder {
    for (name, value) in headers {
        if name.eq_ignore_ascii_case("range")
            || name.eq_ignore_ascii_case("accept-encoding")
            || name.eq_ignore_ascii_case("host")
            || name.eq_ignore_ascii_case("content-length")
        {
            continue;
        }
        if let (Ok(name), Ok(value)) = (
            reqwest::header::HeaderName::from_bytes(name.as_bytes()),
            reqwest::header::HeaderValue::from_str(value),
        ) {
            request = request.header(name, value);
        }
    }
    request
}

/// Probe a URL using `Range: bytes=0-0` to discover size and resume support.
pub async fn probe(
    client: &Client,
    url: &str,
    headers: &BTreeMap<String, String>,
) -> Result<Probe> {
    let parsed = Url::parse(url)?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(Error::message("only http and https URLs are supported"));
    }

    let request = client
        .get(parsed)
        .header(ACCEPT_ENCODING, "identity")
        .header(RANGE, "bytes=0-0");
    let request = apply_headers(request, headers);

    let response = request.send().await?;
    let status = response.status();
    let final_url = response.url().to_string();
    let etag = header_string(response.headers(), ETAG);
    let last_modified = header_string(response.headers(), LAST_MODIFIED);
    let content_type = header_string(response.headers(), CONTENT_TYPE);
    let disposition = header_string(response.headers(), CONTENT_DISPOSITION);
    let content_range = header_string(response.headers(), CONTENT_RANGE);

    let mut probe = Probe {
        final_url,
        total_size: None,
        resumable: false,
        etag,
        last_modified,
        content_type,
        disposition,
    };

    match status {
        StatusCode::PARTIAL_CONTENT => {
            let (start, end, total) = content_range
                .as_deref()
                .and_then(parse_content_range)
                .ok_or_else(|| {
                    Error::Server("server sent 206 without a valid Content-Range".into())
                })?;
            if start != Some(0) || end != Some(0) {
                return Err(Error::Server(
                    "server returned an unexpected range for the probe".into(),
                ));
            }
            probe.resumable = true;
            probe.total_size = total;
        }
        StatusCode::OK => {
            // The server ignored the range request: single stream, no resume.
            probe.total_size = response.content_length();
        }
        StatusCode::RANGE_NOT_SATISFIABLE => {
            probe.resumable = true;
            probe.total_size = content_range
                .as_deref()
                .and_then(parse_content_range)
                .and_then(|(_, _, total)| total);
        }
        other => {
            return Err(Error::Server(format!(
                "server responded with HTTP {}",
                other.as_u16()
            )));
        }
    }

    Ok(probe)
}

fn header_string(headers: &reqwest::header::HeaderMap, name: reqwest::header::HeaderName) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

/// Parse `bytes start-end/total`, `bytes start-end/*` or `bytes * /total`.
fn parse_content_range(value: &str) -> Option<(Option<u64>, Option<u64>, Option<u64>)> {
    let value = value.trim().strip_prefix("bytes")?.trim();
    let (range, total) = value.split_once('/')?;
    let total = if total.trim() == "*" {
        None
    } else {
        total.trim().parse::<u64>().ok()
    };
    let range = range.trim();
    if range == "*" {
        return Some((None, None, total));
    }
    let (start, end) = range.split_once('-')?;
    Some((
        start.trim().parse::<u64>().ok(),
        end.trim().parse::<u64>().ok(),
        total,
    ))
}

/// Build evenly sized segments for a known total size.
pub fn build_segments(total: u64, max_connections: usize, chunk_size: u64) -> Vec<Segment> {
    if total == 0 {
        return Vec::new();
    }

    let chunk_size = chunk_size.max(64 * 1024);
    let chunks = total.div_ceil(chunk_size).max(1);
    let count = (max_connections.clamp(1, 32) as u64)
        .min(chunks)
        .max(1);
    let part = total.div_ceil(count);

    let mut segments = Vec::with_capacity(count as usize);
    let mut start = 0u64;
    while start < total {
        let end = (start + part).min(total) - 1;
        segments.push(Segment::new(start, Some(end)));
        start = end + 1;
    }
    segments
}

/// Shared state for an in-flight segmented transfer.
pub struct TransferContext<'a> {
    pub client: &'a Client,
    pub url: &'a str,
    pub headers: &'a BTreeMap<String, String>,
    pub resumable: bool,
    pub temp_path: &'a Path,
    pub limiter: &'a SpeedLimiter,
    pub pause: &'a AtomicBool,
    pub cancel: &'a AtomicBool,
    pub downloaded: &'a AtomicU64,
    pub segments: &'a Mutex<Vec<Segment>>,
}

/// Run all segments with at most `max_connections` concurrent workers.
pub async fn run_segments(ctx: &TransferContext<'_>, max_connections: usize) -> Result<()> {
    let count = ctx.segments.lock().len();
    if count == 0 {
        return Ok(());
    }

    let concurrency = max_connections.clamp(1, 32).min(count);
    let tasks = futures_util::stream::iter(0..count)
        .map(|index| segment_worker(ctx, index))
        .buffer_unordered(concurrency);

    futures_util::pin_mut!(tasks);
    while let Some(result) = tasks.next().await {
        result?;
    }
    Ok(())
}

async fn segment_worker(ctx: &TransferContext<'_>, index: usize) -> Result<()> {
    let mut attempts = 0u32;
    loop {
        if ctx.cancel.load(Ordering::Relaxed) {
            return Err(Error::Cancelled);
        }
        if ctx.pause.load(Ordering::Relaxed) {
            return Err(Error::Paused);
        }

        let (start, end, written) = {
            let segments = ctx.segments.lock();
            let segment = &segments[index];
            (segment.start, segment.end, segment.written)
        };

        if end
            .map(|end| written > end.saturating_sub(start))
            .unwrap_or(false)
        {
            return Ok(());
        }
        match transfer_once(ctx, index, start, end, written).await {
            Ok(()) => return Ok(()),
            Err(Error::Paused) => return Err(Error::Paused),
            Err(Error::Cancelled) => return Err(Error::Cancelled),
            Err(error) => {
                if !ctx.resumable {
                    // The server cannot resume; rewind this segment before retrying.
                    let rewind = {
                        let mut segments = ctx.segments.lock();
                        let segment = &mut segments[index];
                        let rewind = segment.written;
                        segment.written = 0;
                        rewind
                    };
                    if rewind > 0 {
                        ctx.downloaded.fetch_sub(rewind, Ordering::Relaxed);
                        if let Ok(file) = tokio::fs::OpenOptions::new()
                            .write(true)
                            .open(ctx.temp_path)
                            .await
                        {
                            let _ = file.set_len(0).await;
                        }
                    }
                }

                let current = {
                    let segments = ctx.segments.lock();
                    segments[index].written
                };
                if current > written {
                    attempts = 0;
                } else {
                    attempts += 1;
                }

                if attempts >= 4 || error_is_fatal(&error) {
                    return Err(error);
                }

                let backoff = Duration::from_millis(400 * (1 << attempts.min(3)));
                tokio::time::sleep(backoff).await;
            }
        }
    }
}

fn error_is_fatal(error: &Error) -> bool {
    match error {
        Error::Http(_) => false,
        Error::Server(message) => message.starts_with("server responded with HTTP 4"),
        _ => true,
    }
}

async fn transfer_once(
    ctx: &TransferContext<'_>,
    index: usize,
    start: u64,
    end: Option<u64>,
    written: u64,
) -> Result<()> {
    let expected = end.map(|end| end.saturating_sub(start) + 1);
    if let Some(expected) = expected {
        if written >= expected {
            return Ok(());
        }
    }

    let range_start = start + written;
    let mut request = ctx
        .client
        .get(ctx.url)
        .header(ACCEPT_ENCODING, "identity");
    request = apply_headers(request, ctx.headers);
    if ctx.resumable {
        if let Some(end) = end {
            request = request.header(RANGE, format!("bytes={range_start}-{end}"));
        }
    }

    let response = request.send().await?;
    let status = response.status();

    if status == StatusCode::RANGE_NOT_SATISFIABLE {
        if expected.map(|expected| written >= expected).unwrap_or(false) {
            return Ok(());
        }
        return Err(Error::Server(
            "server rejected the resume range (HTTP 416)".into(),
        ));
    }

    if !status.is_success() {
        return Err(Error::Server(format!(
            "server responded with HTTP {}",
            status.as_u16()
        )));
    }

    if range_start == 0 && written == 0 {
        if let Some(ct) = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
        {
            let ct_lower = ct.to_ascii_lowercase();
            if ct_lower.starts_with("text/html") || ct_lower.starts_with("application/xhtml+xml") {
                let file_str = ctx.temp_path.to_string_lossy();
                let clean_name = file_str.trim_end_matches(".part");
                if is_media_filename(clean_name) {
                    return Err(Error::Server(
                        "remote server returned an HTML webpage (text/html) instead of media content. For streaming or embedded video, please use the NextDM Video Extractor.".into(),
                    ));
                }
            }
        }
    }

    if ctx.resumable {
        if status != StatusCode::PARTIAL_CONTENT {
            return Err(Error::Server(
                "server did not honor the range request".into(),
            ));
        }
        if let Some(value) = response
            .headers()
            .get(CONTENT_RANGE)
            .and_then(|value| value.to_str().ok())
            .and_then(parse_content_range)
        {
            if let Some(response_start) = value.0 {
                if response_start != range_start {
                    return Err(Error::Server(format!(
                        "server resumed at byte {response_start}, expected {range_start}"
                    )));
                }
            }
        }
    }

    let mut options = tokio::fs::OpenOptions::new();
    options.write(true).create(true);
    if !ctx.resumable {
        options.truncate(true);
    }
    let mut file = options.open(ctx.temp_path).await?;
    if ctx.resumable {
        file.seek(std::io::SeekFrom::Start(range_start)).await?;
    }

    let mut written = written;
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        if ctx.cancel.load(Ordering::Relaxed) {
            file.flush().await?;
            return Err(Error::Cancelled);
        }
        if ctx.pause.load(Ordering::Relaxed) {
            file.flush().await?;
            return Err(Error::Paused);
        }

        let chunk = chunk?;
        if chunk.is_empty() {
            continue;
        }
        ctx.limiter.acquire(chunk.len() as u64).await;
        file.write_all(&chunk).await?;
        written += chunk.len() as u64;
        ctx.downloaded
            .fetch_add(chunk.len() as u64, Ordering::Relaxed);

        let mut segments = ctx.segments.lock();
        segments[index].written = written;
    }

    file.flush().await?;

    if let Some(expected) = expected {
        if written < expected {
            return Err(Error::Server(format!(
                "connection closed early ({written} of {expected} bytes)"
            )));
        }
    }

    Ok(())
}

/// Derive a file name from a URL when the server provides no hint.
pub fn file_name_from_url(url: &str) -> String {
    let Ok(parsed) = Url::parse(url) else {
        return "download".to_string();
    };
    let name = parsed
        .path_segments()
        .and_then(|segments| segments.filter(|segment| !segment.is_empty()).next_back())
        .map(|segment| percent_decode_str(segment).decode_utf8_lossy().to_string())
        .unwrap_or_default();
    if name.is_empty() {
        "download".to_string()
    } else {
        name
    }
}

/// Pick the best available remote file name.
pub fn suggested_name(
    spec_name: Option<&str>,
    disposition: Option<&str>,
    url: &str,
    content_type: Option<&str>,
) -> String {
    let mut name = spec_name
        .map(str::to_string)
        .or_else(|| disposition.and_then(file_name_from_disposition))
        .unwrap_or_else(|| file_name_from_url(url));
    name = sanitize_file_name(&name);

    if Path::new(&name).extension().is_none() {
        if let Some(extension) = content_type.and_then(extension_for_mime) {
            name = format!("{name}.{extension}");
        }
    }
    name
}

fn file_name_from_disposition(value: &str) -> Option<String> {
    let mut plain = None;
    for part in value.split(';') {
        let Some((key, value)) = part.split_once('=') else {
            continue;
        };
        let key = key.trim().to_ascii_lowercase();
        let value = value.trim().trim_matches('"');
        if key == "filename*" {
            let value = value
                .strip_prefix("UTF-8''")
                .or_else(|| value.strip_prefix("utf-8''"))
                .unwrap_or(value);
            return Some(percent_decode_str(value).decode_utf8_lossy().to_string());
        }
        if key == "filename" {
            plain = Some(value.to_string());
        }
    }
    plain
}

pub fn sanitize_file_name(name: &str) -> String {
    let mut cleaned: String = name
        .chars()
        .map(|character| match character {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0' => '_',
            character if character.is_control() => '_',
            character => character,
        })
        .collect();

    cleaned = cleaned.trim().trim_matches('.').to_string();
    if cleaned.chars().count() > 180 {
        cleaned = cleaned.chars().take(180).collect::<String>().trim().to_string();
    }
    if cleaned.is_empty() || cleaned == "." || cleaned == ".." {
        return "download".to_string();
    }
    cleaned
}

pub fn is_media_filename(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".mp4")
        || lower.ends_with(".mkv")
        || lower.ends_with(".webm")
        || lower.ends_with(".avi")
        || lower.ends_with(".mov")
        || lower.ends_with(".flv")
        || lower.ends_with(".wmv")
        || lower.ends_with(".ts")
        || lower.ends_with(".m4v")
        || lower.ends_with(".mp3")
        || lower.ends_with(".m4a")
        || lower.ends_with(".aac")
        || lower.ends_with(".wav")
        || lower.ends_with(".flac")
        || lower.ends_with(".ogg")
        || lower.ends_with(".opus")
}

fn extension_for_mime(content_type: &str) -> Option<&'static str> {
    let mime = content_type
        .split(';')
        .next()
        .unwrap_or(content_type)
        .trim()
        .to_ascii_lowercase();
    Some(match mime.as_str() {
        "video/mp4" => "mp4",
        "video/webm" => "webm",
        "video/x-matroska" => "mkv",
        "video/quicktime" => "mov",
        "video/mp2t" => "ts",
        "audio/mpeg" => "mp3",
        "audio/mp4" | "audio/x-m4a" => "m4a",
        "audio/aac" => "aac",
        "audio/flac" => "flac",
        "audio/wav" | "audio/x-wav" => "wav",
        "audio/ogg" => "ogg",
        "application/pdf" => "pdf",
        "application/zip" => "zip",
        "application/x-7z-compressed" => "7z",
        "application/x-rar-compressed" => "rar",
        "application/x-tar" => "tar",
        "application/gzip" => "gz",
        "application/x-iso9660-image" => "iso",
        "application/vnd.android.package-archive" => "apk",
        "application/x-msdownload" => "exe",
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/svg+xml" => "svg",
        "text/plain" => "txt",
        "text/html" => "html",
        _ => return None,
    })
}

/// Content category used by the sidebar tree.
pub fn classify(name: &str) -> &'static str {
    let extension = Path::new(name)
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match extension.as_str() {
        "mp4" | "mkv" | "avi" | "mov" | "webm" | "flv" | "m4v" | "ts" | "mpg" | "mpeg"
        | "wmv" | "3gp" => "video",
        "mp3" | "m4a" | "aac" | "flac" | "wav" | "ogg" | "opus" | "wma" => "music",
        "zip" | "rar" | "7z" | "tar" | "gz" | "bz2" | "xz" | "iso" | "tgz" | "zst" => "compressed",
        "pdf" | "doc" | "docx" | "xls" | "xlsx" | "ppt" | "pptx" | "txt" | "epub" | "mobi"
        | "odt" | "rtf" | "csv" => "documents",
        "exe" | "msi" | "deb" | "rpm" | "appimage" | "dmg" | "pkg" | "apk" | "sh" => "programs",
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "svg" | "bmp" | "tif" | "tiff" => "images",
        _ => "other",
    }
}

/// Avoid clobbering existing files by adding ` (1)`, ` (2)`, ...
pub fn unique_path(directory: &Path, name: &str) -> PathBuf {
    let candidate = directory.join(name);
    if !candidate.exists() {
        return candidate;
    }

    let path = Path::new(name);
    let stem = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("download");
    let extension = path.extension().and_then(|extension| extension.to_str());

    for index in 1..10_000u32 {
        let candidate = match extension {
            Some(extension) => format!("{stem} ({index}).{extension}"),
            None => format!("{stem} ({index})"),
        };
        let candidate = directory.join(candidate);
        if !candidate.exists() {
            return candidate;
        }
    }

    directory.join(format!("{stem}-{}", uuid::Uuid::new_v4()))
}

/// Partial data lives next to the target file with a `.nextdm` suffix.
pub fn temp_path_for(final_path: &Path) -> PathBuf {
    let mut value = final_path.as_os_str().to_os_string();
    value.push(".nextdm");
    PathBuf::from(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_content_range() {
        assert_eq!(
            parse_content_range("bytes 0-0/1234"),
            Some((Some(0), Some(0), Some(1234)))
        );
        assert_eq!(parse_content_range("bytes */99"), Some((None, None, Some(99))));
        assert_eq!(parse_content_range("garbage"), None);
    }

    #[test]
    fn splits_evenly() {
        let segments = build_segments(10, 4, 1024);
        assert_eq!(segments.len(), 1);
        assert_eq!(segments[0].total_len(), Some(10));

        let segments = build_segments(10 * 1024 * 1024, 4, 1024 * 1024);
        assert_eq!(segments.len(), 4);
        assert_eq!(segments.iter().map(|s| s.total_len().unwrap()).sum::<u64>(), 10 * 1024 * 1024);
        assert_eq!(segments[0].start, 0);
        assert_eq!(segments.last().unwrap().end, Some(10 * 1024 * 1024 - 1));
    }

    #[test]
    fn sanitizes_names() {
        assert_eq!(sanitize_file_name("../evil.txt"), "_evil.txt");
        assert_eq!(sanitize_file_name("   "), "download");
        assert_eq!(sanitize_file_name(".."), "download");
    }

    #[test]
    fn reads_disposition() {
        assert_eq!(
            file_name_from_disposition("attachment; filename=\"report.pdf\"; size=1"),
            Some("report.pdf".into())
        );
        assert_eq!(
            file_name_from_disposition("attachment; filename*=UTF-8''na%C3%AFve.txt"),
            Some("naïve.txt".into())
        );
    }

    #[test]
    fn classifies_extensions() {
        assert_eq!(classify("movie.MP4"), "video");
        assert_eq!(classify("song.mp3"), "music");
        assert_eq!(classify("archive.7z"), "compressed");
        assert_eq!(classify("unknown.bin"), "other");
    }
}
