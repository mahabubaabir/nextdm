import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Modal } from "./Modal";
import { Icon } from "./Icons";
import { isProbablyUrl } from "../lib";
import type { DownloadInfo } from "../types";

export function AddDownloadDialog({
  open,
  defaultDir,
  maxConnections,
  initialUrls,
  onClose,
  onAdded,
}: {
  open: boolean;
  defaultDir: string;
  maxConnections: number;
  initialUrls?: string;
  onClose: () => void;
  onAdded: (count: number) => void;
}) {
  const [urls, setUrls] = useState("");
  const [directory, setDirectory] = useState(defaultDir);
  const [fileName, setFileName] = useState("");
  const [connections, setConnections] = useState(Math.max(1, Math.min(16, maxConnections)));
  const [startNow, setStartNow] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const urlRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setUrls(initialUrls ?? "");
    setDirectory(defaultDir);
    setFileName("");
    setConnections(Math.max(1, Math.min(16, maxConnections)));
    setStartNow(true);
    setBusy(false);
    setError("");
    setProgress("");
    const timer = window.setTimeout(() => urlRef.current?.focus(), 60);
    return () => window.clearTimeout(timer);
  }, [open, initialUrls, defaultDir, maxConnections]);

  if (!open) return null;

  const submit = async () => {
    const list = urls
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean);

    if (list.length === 0) {
      setError("Enter at least one URL.");
      return;
    }
    const invalid = list.filter((value) => !isProbablyUrl(value));
    if (invalid.length > 0) {
      setError(`Not a valid http(s) URL: ${invalid[0]}`);
      return;
    }

    setBusy(true);
    setError("");
    const failures: string[] = [];
    let added = 0;

    for (const [index, url] of list.entries()) {
      setProgress(list.length > 1 ? `Adding ${index + 1} of ${list.length}…` : "Contacting server…");
      try {
        await invoke<DownloadInfo>("add_download", {
          spec: {
            url,
            directory: directory.trim() || null,
            fileName: list.length === 1 && fileName.trim() ? fileName.trim() : null,
            headers: {},
            maxConnections: connections,
            startImmediately: startNow,
          },
        });
        added += 1;
      } catch (caught) {
        failures.push(`${url}: ${String(caught)}`);
      }
    }

    setBusy(false);
    setProgress("");

    if (added > 0) onAdded(added);
    if (failures.length > 0) {
      setError(failures.join("\n"));
      return;
    }
    onClose();
  };

  return (
    <Modal
      title="Add Download"
      subtitle="Paste one or more links, one per line."
      icon={<Icon name="add" size={18} />}
      width={620}
      onClose={busy ? () => undefined : onClose}
      closeDisabled={busy}
      footer={
        <>
          <span className="modal-hint">Ctrl+N</span>
          <div className="modal-actions">
            <button className="secondary-button" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button className="primary-button" onClick={submit} disabled={busy}>
              {busy ? <span className="spinner" /> : <Icon name="download" size={15} />}
              {busy ? "Adding…" : "Start Download"}
            </button>
          </div>
        </>
      }
    >
      <div className="form-grid">
        <label className="field-label">Address</label>
        <textarea
          ref={urlRef}
          className="url-textarea"
          rows={urls.includes("\n") ? 5 : 3}
          value={urls}
          onChange={(event) => setUrls(event.target.value)}
          placeholder={"https://example.com/file.zip\nhttps://example.com/video.mp4"}
          spellCheck={false}
          disabled={busy}
        />

        <label className="field-label">Save to</label>
        <div className="input-row">
          <input
            className="text-input"
            value={directory}
            onChange={(event) => setDirectory(event.target.value)}
            placeholder={defaultDir}
            disabled={busy}
          />
          <button
            className="secondary-button compact"
            disabled={busy}
            onClick={async () => {
              try {
                const selected = await openDialog({ directory: true, multiple: false, defaultPath: directory });
                if (typeof selected === "string") setDirectory(selected);
              } catch {
                /* dialog cancelled */
              }
            }}
          >
            <Icon name="folder" size={14} /> Browse
          </button>
        </div>

        <label className="field-label">File name</label>
        <input
          className="text-input"
          value={fileName}
          onChange={(event) => setFileName(event.target.value)}
          placeholder="Use server file name"
          disabled={busy || urls.split(/\r?\n/).filter((value) => value.trim()).length > 1}
        />

        <label className="field-label">Connections</label>
        <div className="inline-field">
          <input
            className="number-input"
            type="number"
            min={1}
            max={16}
            value={connections}
            onChange={(event) => setConnections(Math.max(1, Math.min(16, Number(event.target.value) || 1)))}
            disabled={busy}
          />
          <span className="field-help">Parallel segments for servers that support byte ranges.</span>
        </div>

        <label className="field-label">Options</label>
        <label className="checkbox-row">
          <input type="checkbox" checked={startNow} onChange={(event) => setStartNow(event.target.checked)} disabled={busy} />
          <span>Start download immediately</span>
        </label>
      </div>

      {progress ? (
        <div className="inline-info">
          <span className="spinner dark" /> {progress}
        </div>
      ) : null}

      {error ? (
        <div className="inline-error" role="alert">
          <Icon name="warning" size={15} />
          <pre>{error}</pre>
        </div>
      ) : null}
    </Modal>
  );
}
