export type DownloadStatus =
  | "queued"
  | "connecting"
  | "downloading"
  | "paused"
  | "completed"
  | "error"
  | "cancelled"
  | "scheduled";

export interface DownloadInfo {
  id: string;
  url: string;
  finalUrl: string | null;
  fileName: string;
  directory: string;
  path: string;
  tempPath: string;
  totalSize: number | null;
  downloaded: number;
  status: DownloadStatus;
  resumable: boolean;
  contentType: string | null;
  category: string;
  error: string | null;
  speed: number;
  eta: number | null;
  createdAt: string;
  completedAt: string | null;
  priority: number;
  maxConnections: number | null;
  queueId: string | null;
}

export interface EngineStats {
  active: number;
  queued: number;
  completed: number;
  totalSpeed: number;
}

export interface Segment {
  start: number;
  end: number | null;
  written: number;
}

export interface ProbeResult {
  url: string;
  finalUrl: string;
  totalSize: number | null;
  resumable: boolean;
  fileName: string;
  category: string;
  contentType: string | null;
  defaultDir: string;
}

export type EngineEvent =
  | { type: "added"; download: DownloadInfo }
  | { type: "updated"; download: DownloadInfo }
  | {
      type: "progress";
      id: string;
      downloaded: number;
      totalSize: number | null;
      speed: number;
      eta: number | null;
      segments?: Segment[];
    }
  | { type: "completed"; download: DownloadInfo }
  | { type: "removed"; id: string };

export interface MediaFormat {
  formatId: string;
  label: string;
  extension: string;
  kind: string;
  width: number | null;
  height: number | null;
  fps: number | null;
  filesize: number | null;
  bitrate: number | null;
  hasAudio: boolean;
}

export interface MediaInfo {
  title: string;
  webpageUrl: string;
  duration: number | null;
  thumbnail: string | null;
  uploader: string | null;
  formats: MediaFormat[];
  extractor: string;
}

export interface Settings {
  theme: "classic" | "dark" | "glass" | "material3" | "system";
  defaultDir: string;
  maxConnections: number;
  speedLimit: number;
  clipboardMonitor: boolean;
  notifications: boolean;
  confirmRemove: boolean;
  autoResume: boolean;
  closeToTray: boolean;
}

export type Filter =
  | { kind: "all" }
  | { kind: "unfinished" }
  | { kind: "finished" }
  | { kind: "category"; value: string };

export type SortColumn = "fileName" | "size" | "status" | "speed" | "eta" | "date";

export interface SortState {
  column: SortColumn;
  direction: "asc" | "desc";
}
