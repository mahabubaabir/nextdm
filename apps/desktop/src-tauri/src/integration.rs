//! Browser integration installer.
//!
//! Writes the native-messaging manifests and a launcher script, then unpacks
//! the bundled extensions into the user's data directory. Extensions can be loaded
//! directly from the official Web Stores (Chrome Web Store / Firefox Add-ons) or
//! unpacked in developer mode.

use std::fs;
use std::path::{Path, PathBuf};

use include_dir::{include_dir, Dir};
use nextdm_browser_host::{
    ChromiumManifest, FirefoxManifest, CHROMIUM_EXTENSION_ID, FIREFOX_EXTENSION_ID, HOST_NAME,
};

static CHROMIUM_EXTENSION: Dir<'_> =
    include_dir!("$CARGO_MANIFEST_DIR/../../../extensions/chromium");
static FIREFOX_EXTENSION: Dir<'_> =
    include_dir!("$CARGO_MANIFEST_DIR/../../../extensions/firefox");

static CHROME_ZIP: &[u8] = include_bytes!("../extensions/nextdm-chromium.zip");
static FIREFOX_ZIP: &[u8] = include_bytes!("../extensions/nextdm-firefox.xpi");

/// Returns the directory where browser extensions and store packages are saved.
pub fn get_extension_dir() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .ok_or_else(|| "User home directory is not set".to_string())?;

    #[cfg(unix)]
    {
        Ok(home.join(".local/share/nextdm/browser-extension"))
    }
    #[cfg(windows)]
    {
        let appdata = std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(r"AppData\Roaming"));
        Ok(appdata.join(r"nextdm\browser-extension"))
    }
}

/// Checks whether the native messaging host manifest is currently installed.
pub fn is_host_installed() -> bool {
    let home = match std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
    {
        Some(h) => h,
        None => return false,
    };

    #[cfg(unix)]
    {
        for dir in chromium_host_dirs(&home) {
            if dir.join(format!("{HOST_NAME}.json")).is_file() {
                return true;
            }
        }
        if home
            .join(".mozilla/native-messaging-hosts")
            .join(format!("{HOST_NAME}.json"))
            .is_file()
        {
            return true;
        }
    }
    #[cfg(windows)]
    {
        let appdata = std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(r"AppData\Roaming"));
        if appdata
            .join(r"Mozilla\NativeMessagingHosts")
            .join(format!("{HOST_NAME}.json"))
            .is_file()
        {
            return true;
        }
        let local_app_data = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(r"AppData\Local"));
        if local_app_data
            .join(r"Google\Chrome\User Data\NativeMessagingHosts")
            .join(format!("{HOST_NAME}.json"))
            .is_file()
        {
            return true;
        }
    }
    false
}

/// Install manifests and extension files. Returns human-readable status messages.
pub fn install(
    chromium: bool,
    firefox: bool,
    custom_chrome_id: Option<String>,
) -> Result<Vec<String>, String> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .ok_or_else(|| "User home directory is not set".to_string())?;

    let base_ext_dir = get_extension_dir()?;
    let _ = fs::create_dir_all(&base_ext_dir);
    let _ = fs::write(base_ext_dir.join("nextdm-chrome-webstore.zip"), CHROME_ZIP);
    let _ = fs::write(base_ext_dir.join("nextdm-firefox-amo.zip"), FIREFOX_ZIP);

    let host_path = if let Some(host_bin) = find_host_binary(&home) {
        host_bin
    } else {
        #[cfg(unix)]
        {
            let launcher = app_launcher()?;
            let host_dir = home.join(".local/share/nextdm/browser-host");
            fs::create_dir_all(&host_dir).map_err(stringify)?;
            let wrapper = host_dir.join("nextdm-native-host");
            write_wrapper(&wrapper, &launcher)?;
            wrapper
        }
        #[cfg(windows)]
        {
            std::env::current_exe().map_err(stringify)?
        }
    };

    let mut messages = Vec::new();

    if chromium {
        let extension_dir = base_ext_dir.join("chromium");
        extract(&CHROMIUM_EXTENSION, &extension_dir)?;

        let mut allowed_origins = vec![format!("chrome-extension://{CHROMIUM_EXTENSION_ID}/")];
        if let Some(custom) = custom_chrome_id.as_deref() {
            let trimmed = custom.trim();
            if !trimmed.is_empty() && trimmed != CHROMIUM_EXTENSION_ID {
                allowed_origins.push(format!("chrome-extension://{trimmed}/"));
            }
        }

        let manifest = ChromiumManifest {
            name: HOST_NAME.to_string(),
            description: "NextDM download handoff host".to_string(),
            path: host_path.to_string_lossy().to_string(),
            kind: "stdio".to_string(),
            allowed_origins,
        };
        let json = serde_json::to_string_pretty(&manifest).map_err(stringify)?;

        let mut installed = 0;
        for dir in chromium_host_dirs(&home) {
            if write_manifest(&dir, &json).is_ok() {
                installed += 1;
            }
        }

        #[cfg(windows)]
        {
            let manifest_path = base_ext_dir.join(format!("{HOST_NAME}.json"));
            let _ = fs::write(&manifest_path, &json);
            let keys = [
                r"HKCU\Software\Google\Chrome\NativeMessagingHosts\com.nextdm.host",
                r"HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.nextdm.host",
                r"HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.nextdm.host",
                r"HKCU\Software\Vivaldi\NativeMessagingHosts\com.nextdm.host",
            ];
            for key in keys {
                register_windows_registry(key, &manifest_path);
            }
        }

        messages.push(format!(
            "Registered native host for {installed} Chromium browser(s) (Chrome, Brave, Edge, Vivaldi)."
        ));
    }

    if firefox {
        let extension_dir = base_ext_dir.join("firefox");
        extract(&FIREFOX_EXTENSION, &extension_dir)?;

        let manifest = FirefoxManifest {
            name: HOST_NAME.to_string(),
            description: "NextDM download handoff host".to_string(),
            path: host_path.to_string_lossy().to_string(),
            kind: "stdio".to_string(),
            allowed_extensions: vec![FIREFOX_EXTENSION_ID.to_string()],
        };
        let json = serde_json::to_string_pretty(&manifest).map_err(stringify)?;

        #[cfg(unix)]
        let dir = home.join(".mozilla/native-messaging-hosts");
        #[cfg(windows)]
        let dir = std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(r"AppData\Roaming"))
            .join(r"Mozilla\NativeMessagingHosts");

        write_manifest(&dir, &json)?;

        #[cfg(windows)]
        {
            let manifest_path = dir.join(format!("{HOST_NAME}.json"));
            register_windows_registry(
                r"HKCU\Software\Mozilla\NativeMessagingHosts\com.nextdm.host",
                &manifest_path,
            );
        }

        messages.push("Registered native host for Mozilla Firefox.".to_string());
    }

    if messages.is_empty() {
        messages.push("No browsers selected.".to_string());
    } else {
        messages.push("Native messaging is active and ready for downloads.".to_string());
    }

    Ok(messages)
}

#[cfg(windows)]
fn register_windows_registry(key: &str, manifest_path: &Path) {
    let path_str = manifest_path.to_string_lossy();
    let _ = std::process::Command::new("reg")
        .args(["add", key, "/ve", "/t", "REG_SZ", "/d", &path_str, "/f"])
        .output();
}

fn find_host_binary(home: &Path) -> Option<PathBuf> {
    if let Ok(current) = std::env::current_exe() {
        if let Some(parent) = current.parent() {
            let names = if cfg!(windows) {
                &["nextdm-host.exe", "NextDM-Host.exe"][..]
            } else {
                &["nextdm-host"][..]
            };
            for name in names {
                let sibling = parent.join(name);
                if sibling.is_file() {
                    return Some(sibling);
                }
            }
        }
    }
    let usr_bin = PathBuf::from("/usr/bin/nextdm-host");
    if usr_bin.is_file() {
        return Some(usr_bin);
    }
    let local_bin = home.join(".local/bin/nextdm-host");
    if local_bin.is_file() {
        return Some(local_bin);
    }
    None
}

fn app_launcher() -> Result<PathBuf, String> {
    if let Some(appimage) = std::env::var_os("APPIMAGE") {
        let path = PathBuf::from(appimage);
        if path.is_file() {
            return Ok(path);
        }
    }
    std::env::current_exe().map_err(stringify)
}

fn write_wrapper(path: &Path, executable: &Path) -> Result<(), String> {
    let quoted = executable.to_string_lossy().replace('\'', "'\\''");
    let script = format!(
        "#!/bin/sh\n\
         # Generated by NextDM. Entry point for browser native messaging.\n\
         NEXTDM_APP='{quoted}'\n\
         export NEXTDM_APP\n\
         exec \"$NEXTDM_APP\" --native-messaging \"$@\"\n"
    );
    fs::write(path, script).map_err(stringify)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o755)).map_err(stringify)?;
    }
    Ok(())
}

fn chromium_host_dirs(home: &Path) -> Vec<PathBuf> {
    #[cfg(unix)]
    {
        let config = home.join(".config");
        let candidates = [
            config.join("chromium/NativeMessagingHosts"),
            config.join("google-chrome/NativeMessagingHosts"),
            config.join("BraveSoftware/Brave-Browser/NativeMessagingHosts"),
            config.join("microsoft-edge/NativeMessagingHosts"),
            config.join("vivaldi/NativeMessagingHosts"),
        ];

        candidates
            .into_iter()
            .filter(|dir| {
                let browser_root = dir.parent().and_then(Path::parent);
                let eager = dir.to_string_lossy().contains("/chromium/")
                    || dir.to_string_lossy().contains("/google-chrome/");
                eager || browser_root.map(Path::exists).unwrap_or(false)
            })
            .collect()
    }
    #[cfg(windows)]
    {
        let local_app_data = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(r"AppData\Local"));
        vec![
            local_app_data.join(r"Google\Chrome\User Data\NativeMessagingHosts"),
            local_app_data.join(r"Microsoft\Edge\User Data\NativeMessagingHosts"),
            local_app_data.join(r"BraveSoftware\Brave-Browser\User Data\NativeMessagingHosts"),
            local_app_data.join(r"Vivaldi\User Data\NativeMessagingHosts"),
        ]
    }
}

fn write_manifest(directory: &Path, json: &str) -> Result<(), String> {
    fs::create_dir_all(directory).map_err(stringify)?;
    fs::write(directory.join(format!("{HOST_NAME}.json")), json).map_err(stringify)
}

fn extract(directory: &Dir<'_>, target: &Path) -> Result<(), String> {
    if target.exists() {
        fs::remove_dir_all(target).map_err(stringify)?;
    }
    fs::create_dir_all(target).map_err(stringify)?;
    directory.extract(target).map_err(stringify)
}

fn stringify(error: impl std::fmt::Display) -> String {
    error.to_string()
}
