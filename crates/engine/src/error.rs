use std::path::PathBuf;
use uuid::Uuid;

/// Errors produced by the download engine.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("network error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),

    #[error("invalid URL: {0}")]
    InvalidUrl(#[from] url::ParseError),

    #[error("download not found: {0}")]
    NotFound(Uuid),

    #[error("invalid download directory: {0}")]
    InvalidDirectory(PathBuf),

    #[error("server error: {0}")]
    Server(String),

    #[error("download paused")]
    Paused,

    #[error("download cancelled")]
    Cancelled,

    #[error("{0}")]
    Message(String),
}

impl Error {
    pub fn message(message: impl Into<String>) -> Self {
        Self::Message(message.into())
    }
}

pub type Result<T> = std::result::Result<T, Error>;
