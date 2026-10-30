//! Native messaging protocol shared by the host and the extensions.

use std::io::{self, Read, Write};

use serde::{Deserialize, Serialize};

/// Maximum message size accepted by Chromium and Firefox native messaging.
pub const MAX_MESSAGE: usize = 1024 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum HostRequest {
    Ping,
    AddDownload {
        url: String,
        #[serde(default)]
        filename: Option<String>,
        #[serde(default)]
        referrer: Option<String>,
        #[serde(default)]
        cookies: Option<String>,
        #[serde(default)]
        user_agent: Option<String>,
        #[serde(default)]
        headers: std::collections::BTreeMap<String, String>,
    },
    ProbeMedia {
        url: String,
        #[serde(default)]
        referrer: Option<String>,
        #[serde(default)]
        cookies: Option<String>,
    },
    ShowWindow,
    GetVersion,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostResponse {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub download_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

impl HostResponse {
    pub fn ok() -> Self {
        Self {
            ok: true,
            error: None,
            version: None,
            download_id: None,
            data: None,
        }
    }

    pub fn error(message: impl Into<String>) -> Self {
        Self {
            ok: false,
            error: Some(message.into()),
            version: None,
            download_id: None,
            data: None,
        }
    }

    pub fn with_version(mut self, version: impl Into<String>) -> Self {
        self.version = Some(version.into());
        self
    }

    pub fn with_download(mut self, id: impl Into<String>) -> Self {
        self.download_id = Some(id.into());
        self
    }

    pub fn with_data(mut self, data: serde_json::Value) -> Self {
        self.data = Some(data);
        self
    }
}

/// Read one native message (u32 length prefix, native endian).
pub fn read_message<R: Read>(reader: &mut R) -> io::Result<Option<Vec<u8>>> {
    let mut length = [0u8; 4];
    match reader.read_exact(&mut length) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(error) => return Err(error),
    }
    let length = u32::from_ne_bytes(length) as usize;
    if length == 0 || length > MAX_MESSAGE {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("invalid native message length: {length}"),
        ));
    }
    let mut payload = vec![0u8; length];
    reader.read_exact(&mut payload)?;
    Ok(Some(payload))
}

/// Write one native message (u32 length prefix, native endian).
pub fn write_message<W: Write>(writer: &mut W, payload: &[u8]) -> io::Result<()> {
    if payload.len() > MAX_MESSAGE {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "native message exceeds 1 MiB",
        ));
    }
    writer.write_all(&(payload.len() as u32).to_ne_bytes())?;
    writer.write_all(payload)?;
    writer.flush()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_and_reads_messages() {
        let mut buffer = Vec::new();
        write_message(&mut buffer, b"hello").unwrap();
        assert_eq!(&buffer[..4], &5u32.to_ne_bytes());

        let mut cursor = buffer.as_slice();
        assert_eq!(
            read_message(&mut cursor).unwrap().unwrap(),
            b"hello".to_vec()
        );
        assert!(read_message(&mut cursor).unwrap().is_none());
    }

    #[test]
    fn rejects_zero_and_oversized_frames() {
        let mut zero = std::io::Cursor::new(0u32.to_ne_bytes());
        assert!(read_message(&mut zero).is_err());

        let oversized = (MAX_MESSAGE as u32 + 1).to_ne_bytes();
        assert!(read_message(&mut oversized.as_slice()).is_err());
    }

    #[test]
    fn parses_extension_requests() {
        let request: HostRequest = serde_json::from_str(
            r#"{"type":"addDownload","url":"https://example.com/a.zip","headers":{}}"#,
        )
        .unwrap();
        assert!(matches!(
            request,
            HostRequest::AddDownload { ref url, .. } if url == "https://example.com/a.zip"
        ));

        let request: HostRequest = serde_json::from_str(r#"{"type":"getVersion"}"#).unwrap();
        assert!(matches!(request, HostRequest::GetVersion));
    }

    #[test]
    fn serializes_responses_with_camel_case() {
        let value = serde_json::to_value(
            HostResponse::ok()
                .with_version("0.1.0")
                .with_download("abc"),
        )
        .unwrap();
        assert_eq!(value["ok"], true);
        assert_eq!(value["version"], "0.1.0");
        assert_eq!(value["downloadId"], "abc");
        assert!(value.get("error").is_none());
    }
}
