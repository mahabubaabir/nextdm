import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Modal } from "./Modal";
import { Icon } from "./Icons";
import { formatBytes, formatDuration } from "../lib";
import type { MediaFormat, MediaInfo } from "../types";

export function MediaDialog({
  open,
  initialUrl,
  defaultDir,
  onClose,
  onDownload,
}: {
  open: boolean;
  initialUrl?: string;
  defaultDir: string;
  onClose: () => void;
  onDownload: (url: string, formatId: string | null, fileStem: string, expectedSize?: number | null) => void;
}) {
  const [url, setUrl] = useState("");
  const [info, setInfo] = useState<MediaInfo | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [available, setAvailable] = useState<boolean | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const analyze = async (targetUrl = url) => {
    const trimmed = targetUrl.trim();
    if (!trimmed) return;
    setLoading(true);
    setError("");
    setInfo(null);
    setSelected(null);
    try {
      const result = await invoke<MediaInfo>("media_probe", { url: trimmed });
      setInfo(result);
      const best = result.formats.find((format) => format.kind === "video") ?? result.formats[0];
      setSelected(best ? best.formatId : null);
    } catch (caught) {
      setError(String(caught));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setInfo(null);
    setSelected(null);
    setLoading(false);
    setError("");
    let cancelled = false;

    invoke<boolean>("yt_dlp_available")
      .then((value) => {
        if (!cancelled) setAvailable(value);
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });

    const targetUrl = initialUrl?.trim() || "";
    setUrl(targetUrl);

    if (targetUrl) {
      setLoading(true);
      invoke<MediaInfo>("media_probe", { url: targetUrl })
        .then((result) => {
          if (cancelled) return;
          setInfo(result);
          const best = result.formats.find((format) => format.kind === "video") ?? result.formats[0];
          setSelected(best ? best.formatId : null);
        })
        .catch((err) => {
          if (cancelled) return;
          setError(String(err));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    } else {
      const timer = window.setTimeout(() => inputRef.current?.focus(), 60);
      return () => {
        cancelled = true;
        window.clearTimeout(timer);
      };
    }

    return () => {
      cancelled = true;
    };
  }, [open, initialUrl]);

  if (!open) return null;

  const startDownload = () => {
    if (!info) return;
    const chosenFormat = selected ? info.formats.find((f) => f.formatId === selected) : null;
    const expectedSize = chosenFormat ? chosenFormat.filesize : null;
    onDownload(info.webpageUrl || url.trim(), selected, info.title, expectedSize);
    onClose();
  };

  const grouped = info
    ? [
        { kind: "video", label: "Video", formats: info.formats.filter((format) => format.kind === "video") },
        { kind: "audio", label: "Audio only", formats: info.formats.filter((format) => format.kind === "audio") },
      ].filter((group) => group.formats.length > 0)
    : [];

  return (
    <Modal
      title="Download Video"
      subtitle="YouTube, Facebook and other media sites through yt-dlp."
      icon={<Icon name="media" size={18} />}
      width={700}
      onClose={onClose}
      footer={
        <>
          <span className="modal-hint">
            {available === false
              ? "yt-dlp not detected"
              : defaultDir
                ? `Saved to ${defaultDir}`
                : "Files are saved to your download folder"}
          </span>
          <div className="modal-actions">
            <button className="secondary-button" onClick={onClose}>
              Cancel
            </button>
            <button className="primary-button" onClick={startDownload} disabled={!info || info.formats.length === 0}>
              <Icon name="download" size={15} /> Download
            </button>
          </div>
        </>
      }
    >
      {available === false ? (
        <div className="inline-warning">
          <Icon name="warning" size={16} />
          <div>
            <strong>yt-dlp is required for site media.</strong>
            <p>
              Install it with <code>sudo apt install yt-dlp</code> or{" "}
              <code>python3 -m pip install -U yt-dlp</code>, then reopen this dialog. Also install{" "}
              <code>ffmpeg</code> so video and audio streams can be merged.
            </p>
          </div>
        </div>
      ) : null}

      <div className="media-url-row">
        <input
          ref={inputRef}
          className="text-input"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") analyze();
          }}
          placeholder="Paste a video link"
          spellCheck={false}
        />
        <button className="primary-button" onClick={() => analyze()} disabled={loading || !url.trim()}>
          {loading ? <span className="spinner" /> : <Icon name="search" size={15} />}
          {loading ? "Analyzing…" : "Analyze"}
        </button>
      </div>

      {error ? (
        <div className="inline-error" role="alert">
          <Icon name="warning" size={15} />
          <pre>{error}</pre>
        </div>
      ) : null}

      {info ? (
        <div className="media-result">
          <div className="media-summary">
            {info.thumbnail ? (
              <img
                src={info.thumbnail}
                alt=""
                className="media-thumb"
                onError={(event) => {
                  (event.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <div className="media-thumb placeholder">
                <Icon name="video" size={26} />
              </div>
            )}
            <div className="media-meta">
              <h3 title={info.title}>{info.title}</h3>
              <p>
                {info.uploader ? `${info.uploader} · ` : ""}
                {formatDuration(info.duration)} · {info.extractor}
              </p>
              <p className="muted">{info.formats.length} formats available</p>
            </div>
          </div>

          <div className="format-list">
            <label className={`format-row ${selected === null ? "selected" : ""}`}>
              <input type="radio" checked={selected === null} onChange={() => setSelected(null)} />
              <span className="format-label">Best available quality</span>
              <span className="format-detail">video + audio, merged automatically</span>
            </label>
            {grouped.map((group) => (
              <div key={group.kind}>
                <div className="format-group-label">{group.label}</div>
                {group.formats.map((format) => (
                  <FormatRow
                    key={format.formatId}
                    format={format}
                    selected={selected === format.formatId}
                    onSelect={() => setSelected(format.formatId)}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : (
        !loading && (
          <div className="media-placeholder">
            <Icon name="globe" size={30} />
            <p>Paste a link and press Analyze to list available qualities.</p>
            <small>Downloading media may be subject to the site's terms of service.</small>
          </div>
        )
      )}
    </Modal>
  );
}

function FormatRow({
  format,
  selected,
  onSelect,
}: {
  format: MediaFormat;
  selected: boolean;
  onSelect: () => void;
}) {
  const resolution = format.height ? `${format.width ?? "?"}×${format.height}` : format.kind === "audio" ? "Audio" : "—";
  const details = [
    resolution,
    format.fps ? `${Math.round(format.fps)} fps` : null,
    format.filesize ? formatBytes(format.filesize) : null,
    format.bitrate ? `${Math.round(format.bitrate / 1000)} kbps` : null,
    format.hasAudio ? "with audio" : "no audio",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <label className={`format-row ${selected ? "selected" : ""}`}>
      <input type="radio" checked={selected} onChange={onSelect} />
      <span className="format-label">{format.label}</span>
      <span className="format-detail">{details}</span>
    </label>
  );
}
