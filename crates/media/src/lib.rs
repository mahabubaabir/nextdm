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
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

/// Target destination for automatically downloaded yt-dlp binary.
pub fn default_yt_dlp_install_path() -> Result<PathBuf, String> {
    #[cfg(windows)]
    {
        let local_app_data = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("USERPROFILE").map(|u| PathBuf::from(u).join(r"AppData\Local")))
            .ok_or_else(|| "Could not determine LOCALAPPDATA directory".to_string())?;
        let bin_dir = local_app_data.join("nextdm").join("bin");
        std::fs::create_dir_all(&bin_dir).map_err(|e| e.to_string())?;
        Ok(bin_dir.join("yt-dlp.exe"))
    }
    #[cfg(unix)]
    {
        let home = home_dir().ok_or_else(|| "Could not determine HOME directory".to_string())?;
        let bin_dir = home.join(".local/share/nextdm/bin");
        std::fs::create_dir_all(&bin_dir).map_err(|e| e.to_string())?;
        Ok(bin_dir.join("yt-dlp"))
    }
}

/// Resolve the path of the `yt-dlp` binary, allowing an override via env.
pub fn yt_dlp_path() -> String {
    if let Ok(path) = std::env::var("NEXTDM_YTDLP") {
        if !path.trim().is_empty() {
            return path;
        }
    }

    // Check sibling of current executable (portable / installed bundle)
    if let Ok(current) = std::env::current_exe() {
        if let Some(parent) = current.parent() {
            let names = if cfg!(windows) {
                &["yt-dlp.exe", "yt_dlp.exe", "bin/yt-dlp.exe"][..]
            } else {
                &["yt-dlp", "bin/yt-dlp"][..]
            };
            for name in names {
                let candidate = parent.join(name);
                if candidate.is_file() {
                    return candidate.to_string_lossy().to_string();
                }
            }
        }
    }

    #[cfg(windows)]
    {
        if let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
            let candidate = local.join(r"nextdm\bin\yt-dlp.exe");
            if candidate.is_file() {
                return candidate.to_string_lossy().to_string();
            }
        }
        if let Some(appdata) = std::env::var_os("APPDATA").map(PathBuf::from) {
            let candidate = appdata.join(r"nextdm\bin\yt-dlp.exe");
            if candidate.is_file() {
                return candidate.to_string_lossy().to_string();
            }
        }
    }

    #[cfg(unix)]
    {
        if let Some(home) = home_dir() {
            let candidate = home.join(".local/share/nextdm/bin/yt-dlp");
            if candidate.is_file() {
                return candidate.to_string_lossy().to_string();
            }
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
    }

    if cfg!(windows) {
        "yt-dlp.exe".to_string()
    } else {
        "yt-dlp".to_string()
    }
}

/// Resolve the path of the `ffmpeg` binary.
pub fn ffmpeg_path() -> Option<String> {
    if let Ok(path) = std::env::var("NEXTDM_FFMPEG") {
        if !path.trim().is_empty() {
            return Some(path);
        }
    }

    // Check sibling of current executable
    if let Ok(current) = std::env::current_exe() {
        if let Some(parent) = current.parent() {
            let names = if cfg!(windows) {
                &["ffmpeg.exe", "bin/ffmpeg.exe"][..]
            } else {
                &["ffmpeg", "bin/ffmpeg"][..]
            };
            for name in names {
                let candidate = parent.join(name);
                if candidate.is_file() {
                    return Some(candidate.to_string_lossy().to_string());
                }
            }
        }
    }

    #[cfg(windows)]
    {
        if let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
            let candidate = local.join(r"nextdm\bin\ffmpeg.exe");
            if candidate.is_file() {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
        if let Some(appdata) = std::env::var_os("APPDATA").map(PathBuf::from) {
            let candidate = appdata.join(r"nextdm\bin\ffmpeg.exe");
            if candidate.is_file() {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
    }

    #[cfg(unix)]
    {
        if let Some(home) = home_dir() {
            let candidate = home.join(".local/share/nextdm/bin/ffmpeg");
            if candidate.is_file() {
                return Some(candidate.to_string_lossy().to_string());
            }
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
    let path_sep = if cfg!(windows) { ";" } else { ":" };
    let mut extra_dirs = Vec::new();

    if let Ok(current) = std::env::current_exe() {
        if let Some(parent) = current.parent() {
            extra_dirs.push(parent.to_path_buf());
            let bin = parent.join("bin");
            if bin.is_dir() {
                extra_dirs.push(bin);
            }
        }
    }

    #[cfg(windows)]
    {
        if let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
            extra_dirs.push(local.join(r"nextdm\bin"));
        }
        if let Some(appdata) = std::env::var_os("APPDATA").map(PathBuf::from) {
            extra_dirs.push(appdata.join(r"nextdm\bin"));
        }
    }

    #[cfg(unix)]
    {
        if let Some(home) = home_dir() {
            extra_dirs.push(home.join(".local/share/nextdm/bin"));
            extra_dirs.push(home.join(".local/bin"));
        }
        extra_dirs.push(PathBuf::from("/usr/local/bin"));
    }

    let mut new_path = String::new();
    for dir in extra_dirs {
        if dir.exists() {
            new_path.push_str(&dir.to_string_lossy());
            new_path.push_str(path_sep);
        }
    }
    new_path.push_str(&current_path);
    cmd.env("PATH", new_path);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

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
    configure_command(&mut cmd);
    cmd.arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    cmd.status()
        .await
        .map(|status| status.success())
        .unwrap_or(false)
}

/// Download and install the latest official yt-dlp binary from GitHub.
pub async fn install_yt_dlp() -> Result<String, String> {
    let target_path = default_yt_dlp_install_path()?;

    let download_url = if cfg!(windows) {
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
    } else {
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"
    };

    let client = reqwest::Client::builder()
        .user_agent("NextDM/0.1.0 (https://github.com/mahabubaabir/nextdm)")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let response = client
        .get(download_url)
        .send()
        .await
        .map_err(|e| format!("Failed to download yt-dlp: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Failed to download yt-dlp: HTTP status {}",
            response.status()
        ));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read yt-dlp binary stream: {e}"))?;

    let temp_path = target_path.with_extension(format!("tmp.{}", uuid::Uuid::new_v4()));
    tokio::fs::write(&temp_path, &bytes)
        .await
        .map_err(|e| format!("Failed to write yt-dlp binary: {e}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&temp_path, std::fs::Permissions::from_mode(0o755));
    }

    tokio::fs::rename(&temp_path, &target_path)
        .await
        .map_err(|e| format!("Failed to save yt-dlp binary to target path: {e}"))?;

    Ok(format!("yt-dlp successfully installed to {}", target_path.display()))
}
