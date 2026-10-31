import { useEffect, useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Modal } from "./Modal";
import { Icon } from "./Icons";
import { formatBytes, formatEta, formatSpeed, statusLabel } from "../lib";
import type { DownloadInfo, Segment } from "../types";

const SEGMENT_COLORS = [
  "#3b82f6", // Blue
  "#10b981", // Emerald
  "#8b5cf6", // Purple
  "#f59e0b", // Amber
  "#06b6d4", // Cyan
  "#ec4899", // Pink
  "#84cc16", // Lime
  "#f97316", // Orange
  "#6366f1", // Indigo
  "#14b8a6", // Teal
  "#e11d48", // Rose
  "#eab308", // Yellow
  "#a855f7", // Violet
  "#22c55e", // Green
  "#0284c7", // Sky
  "#d946ef", // Fuchsia
];

export function DownloadProgressDialog({
  open,
  download,
  onClose,
  onPause,
  onResume,
  onCancel,
}: {
  open: boolean;
  download: DownloadInfo | null;
  onClose: () => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [speedLimit, setSpeedLimit] = useState(0);
  const [showSegmentTable, setShowSegmentTable] = useState(false);

  // Poll segments periodically while open and downloading
  useEffect(() => {
    if (!open || !download) return;

    let active = true;
    const fetchSegments = async () => {
      try {
        const segs = await invoke<Segment[]>("get_segments", { id: download.id });
        if (active) {
          setSegments(segs);
        }
      } catch {
        /* ignore */
      }
    };

    fetchSegments();
    const interval = window.setInterval(fetchSegments, 800);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [open, download?.id, download?.status]);

  const percent = useMemo(() => {
    if (!download?.totalSize || download.totalSize <= 0) {
      return download?.status === "completed" ? 100 : null;
    }
    return Math.min(100, Math.max(0, (download.downloaded / download.totalSize) * 100));
  }, [download?.downloaded, download?.totalSize, download?.status]);

  if (!open || !download) return null;

  const isDownloading = download.status === "downloading" || download.status === "connecting";
  const isPaused = download.status === "paused";

  const handleApplySpeedLimit = async (limit: number) => {
    setSpeedLimit(limit);
    try {
      await invoke("set_speed_limit", { bytesPerSecond: limit });
    } catch {
      /* ignore */
    }
  };

  return (
    <Modal
      title={download.fileName}
      icon={<Icon name="arrowDown" />}
      onClose={onClose}
      width={600}
      footer={
        <div style={{ display: "flex", gap: "8px", width: "100%", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px" }}>
            <span style={{ color: "var(--text-muted, #888)" }}>Speed limiter:</span>
            <select
              className="input"
              value={speedLimit}
              onChange={(e) => handleApplySpeedLimit(Number(e.target.value))}
              style={{ height: "28px", padding: "2px 8px", fontSize: "11px" }}
            >
              <option value={0}>Unlimited</option>
              <option value={512 * 1024}>512 KB/s</option>
              <option value={1024 * 1024}>1 MB/s</option>
              <option value={2 * 1024 * 1024}>2 MB/s</option>
              <option value={5 * 1024 * 1024}>5 MB/s</option>
              <option value={10 * 1024 * 1024}>10 MB/s</option>
            </select>
          </div>

          <div style={{ display: "flex", gap: "8px" }}>
            {isDownloading && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => onPause(download.id)}
              >
                <Icon name="pause" size={14} /> Pause
              </button>
            )}
            {isPaused && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => onResume(download.id)}
              >
                <Icon name="play" size={14} /> Resume
              </button>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => onCancel(download.id)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              title="Keep downloading in background"
            >
              Hide
            </button>
          </div>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {/* Metric Cards Grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: "8px",
            background: "var(--card-bg, rgba(0, 0, 0, 0.03))",
            padding: "10px",
            borderRadius: "8px",
            border: "1px solid var(--border-color, rgba(0, 0, 0, 0.08))",
          }}
        >
          <div>
            <div style={{ fontSize: "11px", color: "var(--text-muted, #888)", marginBottom: "2px" }}>Status</div>
            <div style={{ fontWeight: 600, fontSize: "12px", textTransform: "capitalize" }}>
              {statusLabel(download.status)}
            </div>
          </div>

          <div>
            <div style={{ fontSize: "11px", color: "var(--text-muted, #888)", marginBottom: "2px" }}>Transfer Rate</div>
            <div style={{ fontWeight: 600, fontSize: "12px", color: isDownloading ? "var(--primary-color, #2563eb)" : "inherit" }}>
              {formatSpeed(download.speed)}
            </div>
          </div>

          <div>
            <div style={{ fontSize: "11px", color: "var(--text-muted, #888)", marginBottom: "2px" }}>Time Left</div>
            <div style={{ fontWeight: 600, fontSize: "12px" }}>
              {formatEta(download.eta)}
            </div>
          </div>

          <div>
            <div style={{ fontSize: "11px", color: "var(--text-muted, #888)", marginBottom: "2px" }}>Resume Capable</div>
            <div style={{ fontWeight: 600, fontSize: "12px", color: download.resumable ? "#10b981" : "#f59e0b" }}>
              {download.resumable ? "Yes" : "No"}
            </div>
          </div>
        </div>

        {/* Progress Bar & Size Info */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "6px" }}>
            <span>
              {formatBytes(download.downloaded)} of {formatBytes(download.totalSize)}
              {percent !== null ? ` (${percent.toFixed(1)}%)` : ""}
            </span>
            <span style={{ fontWeight: 600 }}>
              {percent !== null ? `${percent.toFixed(1)}%` : "Downloading…"}
            </span>
          </div>

          <div
            style={{
              height: "12px",
              background: "var(--progress-track, rgba(0, 0, 0, 0.1))",
              borderRadius: "6px",
              overflow: "hidden",
              position: "relative",
            }}
          >
            <div
              style={{
                height: "100%",
                width: percent !== null ? `${percent}%` : "100%",
                background:
                  percent !== null
                    ? "linear-gradient(90deg, #3b82f6, #60a5fa)"
                    : "linear-gradient(90deg, #3b82f6 0%, #93c5fd 50%, #3b82f6 100%)",
                backgroundSize: percent === null ? "200% 100%" : undefined,
                animation: percent === null ? "shimmerPulse 1.6s infinite ease-in-out" : undefined,
                borderRadius: "6px",
                transition: "width 0.3s ease",
              }}
            />
          </div>
        </div>

        {/* Segmented Chunk Visualizer (NextDM Multi-threaded Visualizer) */}
        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "6px",
            }}
          >
            <span style={{ fontSize: "12px", fontWeight: 600, display: "flex", alignItems: "center", gap: "6px" }}>
              <Icon name="grid" size={14} /> Connection Segments ({segments.length || (download.resumable ? download.maxConnections || 1 : 1)} threads)
            </span>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowSegmentTable((prev) => !prev)}
              style={{ padding: "2px 8px", fontSize: "11px", height: "22px" }}
            >
              {showSegmentTable ? "Hide details" : "Show details"}
            </button>
          </div>

          {/* Stitched Multi-segment Ribbon */}
          {segments.length > 0 && download.totalSize ? (
            <div
              style={{
                height: "22px",
                background: "var(--progress-track, rgba(0, 0, 0, 0.08))",
                borderRadius: "6px",
                overflow: "hidden",
                display: "flex",
                gap: "1px",
                padding: "2px",
                border: "1px solid var(--border-color, rgba(0, 0, 0, 0.12))",
              }}
              title="Connection chunks live byte layout"
            >
              {segments.map((segment, index) => {
                const totalFile = download.totalSize || 1;
                const segLen = segment.end != null ? segment.end - segment.start + 1 : totalFile;
                const widthPercent = Math.max(1, (segLen / totalFile) * 100);
                const segWrittenPercent = Math.min(100, Math.max(0, (segment.written / segLen) * 100));
                const color = SEGMENT_COLORS[index % SEGMENT_COLORS.length];

                return (
                  <div
                    key={index}
                    style={{
                      height: "100%",
                      width: `${widthPercent}%`,
                      background: "rgba(0, 0, 0, 0.06)",
                      position: "relative",
                      borderRadius: "2px",
                      overflow: "hidden",
                    }}
                    title={`Thread #${index + 1}: ${formatBytes(segment.written)} / ${formatBytes(segLen)} (${segWrittenPercent.toFixed(0)}%)`}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${segWrittenPercent}%`,
                        background: color,
                        transition: "width 0.4s ease",
                      }}
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <div
              style={{
                height: "22px",
                background: "var(--progress-track, rgba(0, 0, 0, 0.08))",
                borderRadius: "6px",
                overflow: "hidden",
                position: "relative",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${percent}%`,
                  background: "#3b82f6",
                  transition: "width 0.3s ease",
                }}
              />
            </div>
          )}

          {/* Segment Details Table */}
          {showSegmentTable && segments.length > 0 && (
            <div
              style={{
                marginTop: "10px",
                maxHeight: "150px",
                overflowY: "auto",
                border: "1px solid var(--border-color, rgba(0, 0, 0, 0.08))",
                borderRadius: "6px",
                fontSize: "11px",
              }}
            >
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "var(--table-header-bg, rgba(0, 0, 0, 0.04))", textAlign: "left" }}>
                    <th style={{ padding: "4px 8px" }}>Thread</th>
                    <th style={{ padding: "4px 8px" }}>Range</th>
                    <th style={{ padding: "4px 8px" }}>Downloaded</th>
                    <th style={{ padding: "4px 8px" }}>Progress</th>
                  </tr>
                </thead>
                <tbody>
                  {segments.map((seg, idx) => {
                    const segLen = seg.end != null ? seg.end - seg.start + 1 : 0;
                    const p = segLen > 0 ? (seg.written / segLen) * 100 : 0;
                    const color = SEGMENT_COLORS[idx % SEGMENT_COLORS.length];
                    return (
                      <tr key={idx} style={{ borderTop: "1px solid var(--border-color, rgba(0, 0, 0, 0.04))" }}>
                        <td style={{ padding: "4px 8px", display: "flex", alignItems: "center", gap: "6px" }}>
                          <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: color }} />
                          #{idx + 1}
                        </td>
                        <td style={{ padding: "4px 8px", fontFamily: "monospace" }}>
                          {formatBytes(seg.start)} - {seg.end != null ? formatBytes(seg.end) : "end"}
                        </td>
                        <td style={{ padding: "4px 8px" }}>
                          {formatBytes(seg.written)} {segLen > 0 ? `/ ${formatBytes(segLen)}` : ""}
                        </td>
                        <td style={{ padding: "4px 8px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <div
                              style={{
                                width: "60px",
                                height: "6px",
                                background: "rgba(0, 0, 0, 0.1)",
                                borderRadius: "3px",
                                overflow: "hidden",
                              }}
                            >
                              <div style={{ height: "100%", width: `${Math.min(100, p)}%`, background: color }} />
                            </div>
                            <span>{p.toFixed(0)}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

