//! Stdio native-messaging host.
//!
//! Browsers start this process through the installed manifest. It forwards
//! requests to the running NextDM app over a Unix socket. When the app is not
//! running, download requests start it and wait for the socket to come up.

use std::io;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use crate::ipc;
use crate::protocol::{self, HostRequest, HostResponse};

/// Exit code returned by the host process.
pub fn run_native_host() -> i32 {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut reader = stdin.lock();
    let mut writer = stdout.lock();

    loop {
        let payload = match protocol::read_message(&mut reader) {
            Ok(Some(payload)) => payload,
            Ok(None) => return 0,
            Err(error) => {
                tracing::warn!(%error, "native messaging read failed");
                return 1;
            }
        };

        let response = match serde_json::from_slice::<HostRequest>(&payload) {
            Ok(request) => handle(request),
            Err(error) => HostResponse::error(format!("invalid request: {error}")),
        };

        let encoded = match serde_json::to_vec(&response) {
            Ok(encoded) => encoded,
            Err(error) => {
                tracing::warn!(%error, "native messaging serialization failed");
                return 1;
            }
        };
        if let Err(error) = protocol::write_message(&mut writer, &encoded) {
            tracing::warn!(%error, "native messaging write failed");
            return 1;
        }
    }
}

fn handle(request: HostRequest) -> HostResponse {
    let response_timeout = match &request {
        HostRequest::Ping
        | HostRequest::ShowWindow
        | HostRequest::GetVersion
        | HostRequest::GetConfig => Duration::from_secs(4),
        HostRequest::AddDownload { .. } => Duration::from_secs(180),
        HostRequest::ProbeMedia { .. } => Duration::from_secs(300),
    };

    // Probe first with a short timeout: connecting to a live socket is instant,
    // while a stale socket fails immediately. The actual request can take much
    // longer because adding a download performs a network probe.
    if ipc::request(&HostRequest::Ping, Duration::from_millis(700)).is_ok() {
        return match ipc::request(&request, response_timeout) {
            Ok(response) => response,
            Err(error) => HostResponse::error(format!("NextDM did not answer: {error}")),
        };
    }

    if matches!(
        request,
        HostRequest::Ping | HostRequest::GetVersion | HostRequest::ShowWindow
    ) {
        return HostResponse::error("NextDM is not running");
    }

    if let Err(error) = launch_app() {
        return HostResponse::error(format!(
            "NextDM is not running and could not be started: {error}"
        ));
    }

    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        if ipc::request(&HostRequest::Ping, Duration::from_millis(700)).is_ok() {
            return match ipc::request(&request, response_timeout) {
                Ok(response) => response,
                Err(error) => HostResponse::error(format!("NextDM did not answer: {error}")),
            };
        }
        if Instant::now() >= deadline {
            return HostResponse::error("NextDM was started but did not become ready in time");
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

/// Start the desktop app detached from the browser process.
fn launch_app() -> io::Result<()> {
    let executable = find_desktop_binary();

    let mut command = Command::new(executable);
    command
        .arg("--background")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }

    command.spawn().map(|_| ())
}

fn find_desktop_binary() -> PathBuf {
    if let Some(app) = std::env::var_os("NEXTDM_APP") {
        let p = PathBuf::from(app);
        if p.exists() {
            return p;
        }
    }

    if let Ok(current) = std::env::current_exe() {
        let file_stem = current
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();
        // If current binary is the desktop executable itself (not a dedicated host binary),
        // use it directly.
        if !file_stem.contains("host") && current.is_file() {
            return current;
        }

        if let Some(parent) = current.parent() {
            let names = if cfg!(windows) {
                &["NextDM.exe", "nextdm.exe", "nextdm-desktop.exe"][..]
            } else {
                &["nextdm-desktop", "NextDM", "nextdm"][..]
            };
            for name in names {
                let sibling = parent.join(name);
                if sibling.is_file() {
                    return sibling;
                }
            }
        }
    }

    if let Some(home) = std::env::var_os("HOME") {
        let local = PathBuf::from(home).join(".local/bin/nextdm-desktop");
        if local.is_file() {
            return local;
        }
    }

    let sys = PathBuf::from("/usr/bin/nextdm-desktop");
    if sys.is_file() {
        return sys;
    }

    PathBuf::from("nextdm-desktop")
}
