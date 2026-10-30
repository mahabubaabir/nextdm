//! Local IPC between the native messaging host and the running NextDM app.
//!
//! The transport is a Unix domain socket carrying newline-delimited JSON. One
//! connection normally carries exactly one request/response pair.

use std::io::{self, BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::time::Duration;

use crate::protocol::{HostRequest, HostResponse};

/// Path of the NextDM local socket.
///
/// `XDG_RUNTIME_DIR` is preferred so the socket disappears with the login
/// session. When it is unavailable we fall back to the cache directory.
pub fn socket_path() -> PathBuf {
    if let Some(runtime) = std::env::var_os("XDG_RUNTIME_DIR") {
        let runtime = PathBuf::from(runtime);
        if runtime.is_dir() {
            return runtime.join("nextdm.sock");
        }
    }
    if let Some(cache) = std::env::var_os("XDG_CACHE_HOME") {
        return PathBuf::from(cache).join("nextdm").join("nextdm.sock");
    }
    if let Some(home) = std::env::var_os("HOME") {
        return PathBuf::from(home).join(".cache/nextdm/nextdm.sock");
    }
    PathBuf::from("/tmp/nextdm.sock")
}

/// Send one request to the running app and wait for its response.
pub fn request(request: &HostRequest, timeout: Duration) -> io::Result<HostResponse> {
    request_at(&socket_path(), request, timeout)
}

/// Send one request to a specific socket path. Used by tests and tools.
pub fn request_at(
    path: &std::path::Path,
    request: &HostRequest,
    timeout: Duration,
) -> io::Result<HostResponse> {
    let mut stream = UnixStream::connect(path)?;
    stream.set_write_timeout(Some(timeout))?;
    stream.set_read_timeout(Some(timeout))?;

    let payload = serde_json::to_vec(request)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    stream.write_all(&payload)?;
    stream.write_all(b"\n")?;
    stream.flush()?;

    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    reader.read_line(&mut line)?;
    let line = line.trim();
    if line.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::UnexpectedEof,
            "NextDM closed the connection without a response",
        ));
    }
    serde_json::from_str(line)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
}

/// Quick liveness check for the local app socket.
pub fn is_running() -> bool {
    request(&HostRequest::Ping, Duration::from_millis(500)).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::net::UnixListener;

    #[test]
    fn round_trips_one_request() {
        let directory =
            std::env::temp_dir().join(format!("nextdm-ipc-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("nextdm.sock");

        let listener = UnixListener::bind(&path).unwrap();
        let server = std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            let request: HostRequest = serde_json::from_str(line.trim()).unwrap();
            assert!(matches!(request, HostRequest::Ping));

            let mut writer = stream;
            writer.write_all(br#"{"ok":true,"version":"0.1.0"}"#).unwrap();
            writer.write_all(b"\n").unwrap();
            writer.flush().unwrap();
        });

        let response = request_at(&path, &HostRequest::Ping, Duration::from_secs(2)).unwrap();
        assert!(response.ok);
        assert_eq!(response.version.as_deref(), Some("0.1.0"));
        server.join().unwrap();
        let _ = std::fs::remove_dir_all(&directory);
    }
}
