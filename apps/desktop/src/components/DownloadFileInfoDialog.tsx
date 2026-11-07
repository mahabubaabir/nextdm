import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Modal } from "./Modal";
import { Icon } from "./Icons";
import { CATEGORIES, formatBytes, isMediaSiteUrl, isProbablyUrl, joinCategoryPath } from "../lib";
import type { DownloadInfo, ProbeResult } from "../types";

export function DownloadFileInfoDialog({
  open,
  initialUrl,
  defaultDir,
  categoryRouting = true,
  maxConnections,
  onClose,
  onStart,
  onLater,
  onOpenMediaExtractor,
}: {
  open: boolean;
  initialUrl: string;
  defaultDir: string;
  categoryRouting?: boolean;
  maxConnections: number;
  onClose: () => void;
  onStart: (download: DownloadInfo) => void;
  onLater: (download: DownloadInfo) => void;
  onOpenMediaExtractor?: (url: string) => void;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [fileName, setFileName] = useState("");
  const [directory, setDirectory] = useState(defaultDir);
  const [category, setCategory] = useState("other");
  const [connections, setConnections] = useState(Math.max(1, Math.min(16, maxConnections)));
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<ProbeResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const initialProbeDone = useRef(false);

  useEffect(() => {
    if (!open) {
      initialProbeDone.current = false;
      return;
    }
    setUrl(initialUrl);
    setDirectory(defaultDir);
    setConnections(Math.max(1, Math.min(16, maxConnections)));
    setError("");
    setProbeResult(null);

    if (initialUrl && isProbablyUrl(initialUrl)) {
      doProbe(initialUrl);
    }
  }, [open, initialUrl, defaultDir, maxConnections]);

  const doProbe = async (targetUrl: string) => {
    if (!targetUrl || !isProbablyUrl(targetUrl)) return;
    setProbing(true);
    setError("");
    try {
      const res = await invoke<ProbeResult>("probe_url", { url: targetUrl });
      setProbeResult(res);
      setFileName(res.fileName);
      setCategory(res.category);
      if (res.defaultDir) {
        setDirectory(res.defaultDir);
      }
    } catch (err) {
      setError(`Probe failed: ${String(err)}`);
    } finally {
      setProbing(false);
    }
  };

  const handleChooseDir = async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        defaultPath: directory || defaultDir || undefined,
      });
      if (typeof selected === "string") {
        setDirectory(selected);
      }
    } catch {
      /* cancelled */
    }
  };

  const submit = async (startImmediately: boolean) => {
    if (!url.trim() || !isProbablyUrl(url.trim())) {
      setError("Please enter a valid HTTP or HTTPS URL.");
      return;
    }

    if (isMediaSiteUrl(url.trim()) && onOpenMediaExtractor) {
      onOpenMediaExtractor(url.trim());
      onClose();
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const info = await invoke<DownloadInfo>("add_download", {
        spec: {
          url: url.trim(),
          directory: directory.trim() || null,
          fileName: fileName.trim() || null,
          category: category || null,
          headers: {},
          maxConnections: connections,
          startImmediately,
        },
      });

      if (startImmediately) {
        onStart(info);
      } else {
        onLater(info);
      }
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <Modal
      title="Download File Info"
      icon={<Icon name="arrowDown" />}
      onClose={onClose}
      width={560}
      footer={
        <div style={{ display: "flex", gap: "8px", width: "100%", justifyContent: "flex-end" }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => submit(false)}
            disabled={submitting || probing}
            title="Add to queue paused"
          >
            Download Later
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => submit(true)}
            disabled={submitting || probing}
            style={{ fontWeight: 600 }}
          >
            {submitting ? "Starting…" : "Start Download"}
          </button>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {isMediaSiteUrl(url) && (
          <div
            style={{
              padding: "10px 12px",
              background: "rgba(59, 130, 246, 0.12)",
              border: "1px solid rgba(59, 130, 246, 0.3)",
              borderRadius: "8px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "10px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px" }}>
              <Icon name="media" size={16} />
              <span>
                <strong>Video Stream Detected:</strong> Use Video Extractor to download the high-quality MP4/MP3 media.
              </span>
            </div>
            {onOpenMediaExtractor && (
              <button
                type="button"
                className="btn btn-primary"
                style={{ padding: "4px 10px", fontSize: "12px", whiteSpace: "nowrap" }}
                onClick={() => {
                  onOpenMediaExtractor(url.trim());
                  onClose();
                }}
              >
                Open Extractor
              </button>
            )}
          </div>
        )}

        {error && (
          <div
            style={{
              padding: "8px 12px",
              background: "rgba(239, 68, 68, 0.12)",
              border: "1px solid rgba(239, 68, 68, 0.3)",
              borderRadius: "6px",
              color: "#ef4444",
              fontSize: "12px",
              wordBreak: "break-all",
            }}
          >
            {error}
          </div>
        )}

        <div>
          <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
            URL Address
          </label>
          <div style={{ display: "flex", gap: "6px" }}>
            <input
              type="text"
              className="input"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/file.zip"
              style={{ flex: 1, fontFamily: "monospace", fontSize: "12px" }}
            />
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => doProbe(url)}
              disabled={probing || !url}
              title="Query remote server for file info"
            >
              {probing ? "Probing…" : "Probe"}
            </button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 140px", gap: "10px" }}>
          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
              File Name
            </label>
            <input
              type="text"
              className="input"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              placeholder={probing ? "Detecting filename…" : "download.ext"}
              style={{ width: "100%" }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
              Category
            </label>
            <select
              className="input"
              value={category}
              onChange={(e) => {
                const newCat = e.target.value;
                setCategory(newCat);
                if (categoryRouting) {
                  setDirectory((prev) => joinCategoryPath(prev || defaultDir, newCat));
                }
              }}
              style={{ width: "100%", height: "34px" }}
            >
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
            Save Folder
          </label>
          <div style={{ display: "flex", gap: "6px" }}>
            <input
              type="text"
              className="input"
              value={directory}
              onChange={(e) => setDirectory(e.target.value)}
              placeholder="/home/user/Downloads"
              style={{ flex: 1, fontSize: "12px" }}
            />
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleChooseDir}
            >
              Browse…
            </button>
          </div>
        </div>

        {/* Server & Capability Probe Card */}
        <div
          style={{
            padding: "12px",
            background: "var(--card-bg, rgba(0, 0, 0, 0.04))",
            border: "1px solid var(--border-color, rgba(0, 0, 0, 0.08))",
            borderRadius: "8px",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "10px",
            fontSize: "12px",
          }}
        >
          <div>
            <span style={{ color: "var(--text-muted, #888)", display: "block", marginBottom: "2px" }}>
              File Size:
            </span>
            <span style={{ fontWeight: 600, fontSize: "13px" }}>
              {probing ? "Probing remote size…" : probeResult?.totalSize != null ? formatBytes(probeResult.totalSize) : "Unknown (stream)"}
            </span>
          </div>

          <div>
            <span style={{ color: "var(--text-muted, #888)", display: "block", marginBottom: "2px" }}>
              Resume Capability:
            </span>
            {probing ? (
              <span>Checking…</span>
            ) : probeResult ? (
              probeResult.resumable ? (
                <span style={{ color: "#10b981", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: "4px" }}>
                  <Icon name="check" size={14} /> Yes (Resumable)
                </span>
              ) : (
                <span style={{ color: "#f59e0b", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: "4px" }}>
                  ⚠ No (Single stream)
                </span>
              )
            ) : (
              <span style={{ color: "var(--text-muted, #888)" }}>Unknown</span>
            )}
          </div>

          <div>
            <span style={{ color: "var(--text-muted, #888)", display: "block", marginBottom: "2px" }}>
              Max Connections:
            </span>
            <select
              className="input"
              value={connections}
              onChange={(e) => setConnections(Number(e.target.value))}
              disabled={probeResult?.resumable === false}
              style={{ width: "90px", padding: "2px 6px", height: "26px", fontSize: "11px" }}
            >
              {[1, 2, 4, 8, 16, 24, 32].map((num) => (
                <option key={num} value={num}>
                  {num} {num === 1 ? "thread" : "threads"}
                </option>
              ))}
            </select>
          </div>

          <div>
            <span style={{ color: "var(--text-muted, #888)", display: "block", marginBottom: "2px" }}>
              Content Type:
            </span>
            <span style={{ fontFamily: "monospace", fontSize: "11px" }}>
              {probeResult?.contentType || "—"}
            </span>
          </div>
        </div>
      </div>
    </Modal>
  );
}

