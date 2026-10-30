import { formatBytes, formatSpeed } from "../lib";
import type { DownloadInfo } from "../types";

export function StatusBar({
  downloads,
  selectedCount,
  filterLabel,
  speedLimit,
}: {
  downloads: DownloadInfo[];
  selectedCount: number;
  filterLabel: string;
  speedLimit: number;
}) {
  const active = downloads.filter((download) =>
    ["queued", "connecting", "downloading"].includes(download.status),
  );
  const totalSpeed = downloads.reduce((sum, download) => sum + (download.speed ?? 0), 0);

  return (
    <footer className="statusbar">
      <div className="status-left">
        <span>
          {downloads.length} item{downloads.length === 1 ? "" : "s"}
        </span>
        {selectedCount > 0 ? <span className="status-selected">{selectedCount} selected</span> : null}
        <span className="status-separator">|</span>
        <span>{filterLabel}</span>
      </div>
      <div className="status-right">
        <span className="status-speed">
          {active.length} active · {formatSpeed(totalSpeed)}
        </span>
        <span className="status-separator">|</span>
        <span>
          Limit: {speedLimit > 0 ? formatBytes(speedLimit) + "/s" : "unlimited"}
        </span>
      </div>
    </footer>
  );
}
