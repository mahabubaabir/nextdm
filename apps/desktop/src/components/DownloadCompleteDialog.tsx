import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Modal } from "./Modal";
import { Icon } from "./Icons";
import { formatBytes, playCompletionSound } from "../lib";
import type { DownloadInfo } from "../types";

export function DownloadCompleteDialog({
  open,
  download,
  onClose,
}: {
  open: boolean;
  download: DownloadInfo | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (open && download) {
      playCompletionSound();
    }
  }, [open, download?.id]);

  if (!open || !download) return null;

  const handleOpenFile = async () => {
    try {
      await invoke("open_path", { path: download.path });
    } catch {
      /* ignore */
    }
    onClose();
  };

  const handleOpenFolder = async () => {
    try {
      await invoke("reveal_path", { path: download.path });
    } catch {
      /* ignore */
    }
    onClose();
  };

  return (
    <Modal
      title="Download Complete"
      icon={<Icon name="check" />}
      onClose={onClose}
      width={480}
      footer={
        <div style={{ display: "flex", gap: "8px", width: "100%", justifyContent: "flex-end" }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
          >
            Close
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleOpenFolder}
          >
            <Icon name="folder" size={14} /> Open Folder
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleOpenFile}
            style={{ fontWeight: 600 }}
          >
            Open File
          </button>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "16px", alignItems: "center", textAlign: "center", padding: "10px 0" }}>
        <div
          style={{
            width: "56px",
            height: "56px",
            borderRadius: "50%",
            background: "rgba(16, 185, 129, 0.15)",
            border: "2px solid #10b981",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#10b981",
          }}
        >
          <Icon name="check" size={28} />
        </div>

        <div>
          <h3
            style={{
              fontSize: "15px",
              fontWeight: 700,
              margin: "0 0 6px 0",
              wordBreak: "break-all",
            }}
          >
            {download.fileName}
          </h3>
          <p style={{ margin: 0, fontSize: "12px", color: "var(--text-muted, #888)" }}>
            Finished downloading {formatBytes(download.totalSize || download.downloaded)}
          </p>
        </div>

        <div
          style={{
            width: "100%",
            padding: "10px 12px",
            background: "var(--card-bg, rgba(0, 0, 0, 0.04))",
            border: "1px solid var(--border-color, rgba(0, 0, 0, 0.08))",
            borderRadius: "6px",
            fontSize: "11px",
            textAlign: "left",
            wordBreak: "break-all",
            color: "var(--text-muted, #888)",
          }}
        >
          <strong style={{ color: "inherit" }}>Location: </strong>
          {download.path}
        </div>
      </div>
    </Modal>
  );
}

