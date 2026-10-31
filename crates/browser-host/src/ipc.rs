//! Local IPC between the native messaging host and the running NextDM app.
//!
//! On Unix, the transport is a domain socket carrying newline-delimited JSON.
//! On Windows, the transport is a loopback TCP socket (127.0.0.1:42891).

use std::io::{self, BufRead, BufReader};
use std::path::PathBuf;
use std::time::Duration;

#[cfg(unix)]
use std::os::unix::net::UnixStream;

#[cfg(windows)]
use std::net::TcpStream;

use crate::protocol::{HostRequest, HostResponse};

pub const WINDOWS_IPC_PORT: u16 = 42891;

/// Path of the NextDM local socket (Unix).
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
    #[cfg(unix)]
    {
        request_at(&socket_path(), request, timeout)
    }
    #[cfg(windows)]
    {
        request_tcp(WINDOWS_IPC_PORT, request, timeout)
    }
}

/// Send one request to a specific socket path (Unix).
#[cfg(unix)]
pub fn request_at(
    path: &std::path::Path,
    request: &HostRequest,
    timeout: Duration,
) -> io::Result<HostResponse> {
    let stream = UnixStream::connect(path)?;
    stream.set_write_timeout(Some(timeout))?;
    stream.set_read_timeout(Some(timeout))?;
    round_trip_io(stream, request)
}

/// Send one request to a local TCP port (Windows).
#[cfg(windows)]
pub fn request_tcp(
    port: u16,
    request: &HostRequest,
    timeout: Duration,
) -> io::Result<HostResponse> {
    let mut stream = TcpStream::connect(("127.0.0.1", port))?;
    stream.set_write_timeout(Some(timeout))?;
    stream.set_read_timeout(Some(timeout))?;
    round_trip_io(stream, request)
}

fn round_trip_io<S: io::Read + io::Write>(
    mut stream: S,
    request: &HostRequest,
) -> io::Result<HostResponse> {
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
    use std::io::Write;

    #[cfg(unix)]
    #[test]
    fn round_trips_one_request() {
        use std::os::unix::net::UnixListener;
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
