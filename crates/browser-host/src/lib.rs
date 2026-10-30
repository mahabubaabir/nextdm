//! Native messaging host bridging Chromium/Firefox extensions to NextDM.
//!
//! The host speaks the browser native-messaging framing (a native-endian u32
//! length followed by a UTF-8 JSON payload). Installing the manifest files is
//! handled by the desktop app.

use serde::{Deserialize, Serialize};

pub mod host;
pub mod ipc;
pub mod protocol;

pub use host::run_native_host;

/// Native messaging manifest for Chromium-based browsers.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ChromiumManifest {
    pub name: String,
    pub description: String,
    pub path: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub allowed_origins: Vec<String>,
}

/// Native messaging manifest for Firefox.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FirefoxManifest {
    pub name: String,
    pub description: String,
    pub path: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub allowed_extensions: Vec<String>,
}

pub const HOST_NAME: &str = "com.nextdm.host";
pub const CHROMIUM_EXTENSION_ID: &str = "ciljeaclhfhipchfaocjmoanpbacibli";
pub const FIREFOX_EXTENSION_ID: &str = "nextdm@nextdm.app";
pub const HOST_VERSION: &str = env!("CARGO_PKG_VERSION");
