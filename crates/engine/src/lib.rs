//! NextDM download engine.
//!
//! This crate is UI-independent: it exposes an [`Engine`] that persists downloads
//! in SQLite, performs ranged HTTP transfers with resume support, and broadcasts
//! progress events that the desktop shell forwards to the React UI.

pub mod download;
pub mod error;
pub mod manager;
pub mod storage;
pub mod types;

pub use download::SpeedLimiter;
pub use error::{Error, Result};
pub use manager::Engine;
pub use storage::Storage;
pub use types::{
    DownloadInfo, DownloadSpec, DownloadStatus, EngineConfig, EngineEvent, EngineStats, Segment,
};
