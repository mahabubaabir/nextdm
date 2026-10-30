import type { DownloadInfo, DownloadStatus, Settings } from "./types";

export const CATEGORIES = [
  { id: "documents", label: "Documents" },
  { id: "music", label: "Music" },
  { id: "video", label: "Video" },
  { id: "programs", label: "Programs" },
  { id: "compressed", label: "Compressed" },
  { id: "images", label: "Images" },
  { id: "other", label: "Other" },
] as const;

export const DEFAULT_SETTINGS: Settings = {
  theme: "classic",
  defaultDir: "",
  maxConnections: 8,
  speedLimit: 0,
  clipboardMonitor: false,
  notifications: true,
  confirmRemove: true,
  autoResume: true,
  closeToTray: false,
};

const STATUS_LABELS: Record<DownloadStatus, string> = {
  queued: "Queued",
  connecting: "Connecting",
  downloading: "Downloading",
  paused: "Paused",
  completed: "Complete",
  error: "Error",
  cancelled: "Cancelled",
  scheduled: "Scheduled",
};

export function statusLabel(status: DownloadStatus): string {
  return STATUS_LABELS[status] ?? status;
}

export function categoryLabel(category: string): string {
  return CATEGORIES.find((item) => item.id === category)?.label ?? "Other";
}

export function formatBytes(bytes: number | null | undefined, precision = 1): string {
  if (bytes == null || Number.isNaN(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : precision)} ${units[unit]}`;
}

export function formatSpeed(bytesPerSecond: number | null | undefined): string {
  if (!bytesPerSecond || bytesPerSecond <= 0) return "—";
  return `${formatBytes(bytesPerSecond)}/s`;
}

export function formatEta(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "—";
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(secs).padStart(2, "0")}s`;
  return `${secs}s`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

export function progressOf(download: DownloadInfo): number | null {
  if (!download.totalSize || download.totalSize <= 0) {
    return download.status === "completed" ? 1 : null;
  }
  return Math.min(1, Math.max(0, download.downloaded / download.totalSize));
}

export function isActive(download: DownloadInfo): boolean {
  return ["queued", "connecting", "downloading"].includes(download.status);
}

export function isPaused(download: DownloadInfo): boolean {
  return download.status === "paused";
}

export function isFinished(download: DownloadInfo): boolean {
  return download.status === "completed";
}

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export function fileNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    return decodeURIComponent(segments[segments.length - 1] ?? "download");
  } catch {
    return "download";
  }
}

export function isProbablyUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export const DOWNLOADABLE_EXTENSIONS = [
  ".zip", ".rar", ".7z", ".tar.gz", ".tar.bz2", ".tar.xz", ".tgz", ".iso",
  ".deb", ".rpm", ".appimage", ".exe", ".msi", ".dmg", ".pkg", ".apk",
  ".mp4", ".mkv", ".avi", ".mov", ".webm", ".flv", ".mp3", ".flac", ".wav",
  ".pdf", ".docx", ".xlsx", ".pptx"
];

export function isDownloadableUrl(url: string): boolean {
  if (!isProbablyUrl(url)) return false;
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase();
    return DOWNLOADABLE_EXTENSIONS.some((ext) => pathname.endsWith(ext));
  } catch {
    return false;
  }
}

export function playCompletionSound(): void {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    // First tone (pleasant C5 ~523.25 Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(523.25, now);
    gain1.gain.setValueAtTime(0.18, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.18);

    // Second ascending tone (crisp G5 ~783.99 Hz)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(783.99, now + 0.12);
    gain2.gain.setValueAtTime(0.22, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.38);
  } catch {
    /* AudioContext not allowed or not supported */
  }
}
