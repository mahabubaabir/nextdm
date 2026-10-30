use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row};
use uuid::Uuid;

use crate::error::Result;
use crate::types::{DownloadInfo, DownloadStatus, Segment};

/// Internal persisted representation of a download.
#[derive(Clone, Debug)]
pub struct DownloadRecord {
    pub id: Uuid,
    pub url: String,
    pub final_url: Option<String>,
    pub file_name: String,
    pub directory: PathBuf,
    pub temp_path: PathBuf,
    pub total_size: Option<u64>,
    pub downloaded: u64,
    pub status: DownloadStatus,
    pub resumable: bool,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    pub content_type: Option<String>,
    pub category: String,
    pub error: Option<String>,
    pub segments: Vec<Segment>,
    pub headers: BTreeMap<String, String>,
    pub cookies: Option<String>,
    pub referrer: Option<String>,
    pub queue_id: Option<String>,
    pub priority: i64,
    pub max_connections: Option<usize>,
    pub created_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
}

impl DownloadRecord {
    pub fn path(&self) -> PathBuf {
        self.directory.join(&self.file_name)
    }

    pub fn info(&self) -> DownloadInfo {
        DownloadInfo {
            id: self.id,
            url: self.url.clone(),
            final_url: self.final_url.clone(),
            file_name: self.file_name.clone(),
            directory: self.directory.clone(),
            path: self.path(),
            temp_path: self.temp_path.clone(),
            total_size: self.total_size,
            downloaded: self.downloaded,
            status: self.status,
            resumable: self.resumable,
            content_type: self.content_type.clone(),
            category: self.category.clone(),
            error: self.error.clone(),
            speed: 0,
            eta: None,
            created_at: self.created_at,
            completed_at: self.completed_at,
            priority: self.priority,
            max_connections: self.max_connections,
            queue_id: self.queue_id.clone(),
        }
    }
}

/// SQLite-backed persistence for downloads and settings.
pub struct Storage {
    conn: Mutex<Connection>,
}

impl Storage {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        let storage = Self {
            conn: Mutex::new(conn),
        };
        storage.migrate()?;
        Ok(storage)
    }

    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        let storage = Self {
            conn: Mutex::new(conn),
        };
        storage.migrate()?;
        Ok(storage)
    }

    fn migrate(&self) -> Result<()> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS downloads (
                id             TEXT PRIMARY KEY,
                url            TEXT NOT NULL,
                final_url      TEXT,
                file_name      TEXT NOT NULL,
                directory      TEXT NOT NULL,
                temp_path      TEXT NOT NULL,
                total_size     INTEGER,
                downloaded     INTEGER NOT NULL DEFAULT 0,
                status         TEXT NOT NULL DEFAULT 'queued',
                resumable      INTEGER NOT NULL DEFAULT 0,
                etag           TEXT,
                last_modified  TEXT,
                content_type   TEXT,
                category       TEXT NOT NULL DEFAULT 'other',
                error          TEXT,
                segments       TEXT NOT NULL DEFAULT '[]',
                headers        TEXT NOT NULL DEFAULT '{}',
                cookies        TEXT,
                referrer       TEXT,
                queue_id       TEXT,
                priority       INTEGER NOT NULL DEFAULT 3,
                max_connections INTEGER,
                created_at     TEXT NOT NULL,
                completed_at   TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads(status);
            CREATE INDEX IF NOT EXISTS idx_downloads_created ON downloads(created_at DESC);

            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS queues (
                id         TEXT PRIMARY KEY,
                name       TEXT NOT NULL,
                enabled    INTEGER NOT NULL DEFAULT 1,
                start_at   TEXT,
                stop_at    TEXT,
                created_at TEXT NOT NULL
            );
            "#,
        )?;
        Ok(())
    }

    pub fn save(&self, record: &DownloadRecord) -> Result<()> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        let segments = serde_json::to_string(&record.segments).unwrap_or_else(|_| "[]".into());
        let headers = serde_json::to_string(&record.headers).unwrap_or_else(|_| "{}".into());
        conn.execute(
            r#"
            INSERT INTO downloads (
                id, url, final_url, file_name, directory, temp_path, total_size,
                downloaded, status, resumable, etag, last_modified, content_type,
                category, error, segments, headers, cookies, referrer, queue_id,
                priority, max_connections, created_at, completed_at
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7,
                ?8, ?9, ?10, ?11, ?12, ?13,
                ?14, ?15, ?16, ?17, ?18, ?19, ?20,
                ?21, ?22, ?23, ?24
            )
            ON CONFLICT(id) DO UPDATE SET
                url = excluded.url,
                final_url = excluded.final_url,
                file_name = excluded.file_name,
                directory = excluded.directory,
                temp_path = excluded.temp_path,
                total_size = excluded.total_size,
                downloaded = excluded.downloaded,
                status = excluded.status,
                resumable = excluded.resumable,
                etag = excluded.etag,
                last_modified = excluded.last_modified,
                content_type = excluded.content_type,
                category = excluded.category,
                error = excluded.error,
                segments = excluded.segments,
                headers = excluded.headers,
                cookies = excluded.cookies,
                referrer = excluded.referrer,
                queue_id = excluded.queue_id,
                priority = excluded.priority,
                max_connections = excluded.max_connections,
                completed_at = excluded.completed_at
            "#,
            params![
                record.id.to_string(),
                record.url,
                record.final_url,
                record.file_name,
                record.directory.to_string_lossy(),
                record.temp_path.to_string_lossy(),
                record.total_size.map(|value| value as i64),
                record.downloaded as i64,
                record.status.as_str(),
                record.resumable as i64,
                record.etag,
                record.last_modified,
                record.content_type,
                record.category,
                record.error,
                segments,
                headers,
                record.cookies,
                record.referrer,
                record.queue_id,
                record.priority,
                record.max_connections.map(|value| value as i64),
                record.created_at.to_rfc3339(),
                record.completed_at.map(|value| value.to_rfc3339()),
            ],
        )?;
        Ok(())
    }

    pub fn get(&self, id: Uuid) -> Result<Option<DownloadRecord>> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        let record = conn
            .query_row(
                "SELECT * FROM downloads WHERE id = ?1",
                params![id.to_string()],
                row_to_record,
            )
            .optional()?;
        Ok(record)
    }

    pub fn list(&self) -> Result<Vec<DownloadRecord>> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        let mut statement = conn.prepare("SELECT * FROM downloads ORDER BY created_at DESC")?;
        let rows = statement.query_map([], row_to_record)?;
        let mut records = Vec::new();
        for row in rows {
            records.push(row?);
        }
        Ok(records)
    }

    pub fn update_progress(&self, id: Uuid, downloaded: u64, segments: &[Segment]) -> Result<()> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        let segments = serde_json::to_string(segments).unwrap_or_else(|_| "[]".into());
        conn.execute(
            "UPDATE downloads SET downloaded = ?1, segments = ?2 WHERE id = ?3",
            params![downloaded as i64, segments, id.to_string()],
        )?;
        Ok(())
    }

    pub fn set_status(
        &self,
        id: Uuid,
        status: DownloadStatus,
        error: Option<&str>,
    ) -> Result<()> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        conn.execute(
            "UPDATE downloads SET status = ?1, error = ?2 WHERE id = ?3",
            params![status.as_str(), error, id.to_string()],
        )?;
        Ok(())
    }

    pub fn delete(&self, id: Uuid) -> Result<()> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        conn.execute("DELETE FROM downloads WHERE id = ?1", params![id.to_string()])?;
        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<serde_json::Value>> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        let value: Option<String> = conn
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                params![key],
                |row| row.get(0),
            )
            .optional()?;
        Ok(value.and_then(|value| serde_json::from_str(&value).ok()))
    }

    pub fn set_setting(&self, key: &str, value: &serde_json::Value) -> Result<()> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, serde_json::to_string(value).unwrap_or_default()],
        )?;
        Ok(())
    }

    pub fn all_settings(&self) -> Result<BTreeMap<String, serde_json::Value>> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        let mut statement = conn.prepare("SELECT key, value FROM settings")?;
        let rows = statement.query_map([], |row| {
            let key: String = row.get(0)?;
            let value: String = row.get(1)?;
            Ok((key, value))
        })?;
        let mut settings = BTreeMap::new();
        for row in rows {
            let (key, value) = row?;
            if let Ok(value) = serde_json::from_str(&value) {
                settings.insert(key, value);
            }
        }
        Ok(settings)
    }
}

fn row_to_record(row: &Row<'_>) -> rusqlite::Result<DownloadRecord> {
    let id: String = row.get("id")?;
    let segments: String = row.get("segments")?;
    let headers: String = row.get("headers")?;
    let created_at: String = row.get("created_at")?;
    let completed_at: Option<String> = row.get("completed_at")?;
    let status: String = row.get("status")?;
    let resumable: i64 = row.get("resumable")?;
    let priority: i64 = row.get("priority")?;
    let total_size: Option<i64> = row.get("total_size")?;
    let downloaded: i64 = row.get("downloaded")?;
    let max_connections: Option<i64> = row.get("max_connections")?;

    Ok(DownloadRecord {
        id: Uuid::parse_str(&id).unwrap_or_else(|_| Uuid::new_v4()),
        url: row.get("url")?,
        final_url: row.get("final_url")?,
        file_name: row.get("file_name")?,
        directory: PathBuf::from(row.get::<_, String>("directory")?),
        temp_path: PathBuf::from(row.get::<_, String>("temp_path")?),
        total_size: total_size.map(|value| value.max(0) as u64),
        downloaded: downloaded.max(0) as u64,
        status: DownloadStatus::parse(&status),
        resumable: resumable != 0,
        etag: row.get("etag")?,
        last_modified: row.get("last_modified")?,
        content_type: row.get("content_type")?,
        category: row.get("category")?,
        error: row.get("error")?,
        segments: serde_json::from_str(&segments).unwrap_or_default(),
        headers: serde_json::from_str(&headers).unwrap_or_default(),
        cookies: row.get("cookies")?,
        referrer: row.get("referrer")?,
        queue_id: row.get("queue_id")?,
        priority,
        max_connections: max_connections.map(|value| value.max(1) as usize),
        created_at: DateTime::parse_from_rfc3339(&created_at)
            .map(|value| value.with_timezone(&Utc))
            .unwrap_or_else(|_| Utc::now()),
        completed_at: completed_at.and_then(|value| {
            DateTime::parse_from_rfc3339(&value)
                .ok()
                .map(|value| value.with_timezone(&Utc))
        }),
    })
}
