import { Icon, Logo, type IconName } from "./Icons";
import {
  categoryLabel,
  cx,
  formatBytes,
  formatDate,
  formatEta,
  formatSpeed,
  progressOf,
  statusLabel,
} from "../lib";
import type { DownloadInfo, SortColumn, SortState } from "../types";
import type { MouseEvent } from "react";

const CATEGORY_ICONS: Record<string, IconName> = {
  documents: "documents",
  music: "music",
  video: "video",
  programs: "programs",
  compressed: "compressed",
  images: "images",
  other: "other",
};

const COLUMNS: Array<{ id: SortColumn | "category"; label: string; sortable: boolean; className?: string }> = [
  { id: "fileName", label: "File Name", sortable: true, className: "col-name" },
  { id: "size", label: "Size", sortable: true, className: "col-size" },
  { id: "status", label: "Status", sortable: true, className: "col-status" },
  { id: "speed", label: "Speed", sortable: true, className: "col-speed" },
  { id: "eta", label: "Time Left", sortable: true, className: "col-eta" },
  { id: "date", label: "Date Added", sortable: true, className: "col-date" },
  { id: "category", label: "Category", sortable: false, className: "col-category" },
];

function statusText(download: DownloadInfo): string {
  const label = statusLabel(download.status);
  if (download.status === "downloading" || download.status === "connecting") {
    const progress = progressOf(download);
    if (progress != null) return `${label} ${Math.floor(progress * 100)}%`;
  }
  if (download.status === "paused") {
    const progress = progressOf(download);
    if (progress != null) return `${label} ${Math.floor(progress * 100)}%`;
  }
  return label;
}

export function DownloadTable({
  downloads,
  total,
  selected,
  sort,
  onSort,
  onSelect,
  onOpen,
  onContextMenu,
  onAdd,
  onMedia,
}: {
  downloads: DownloadInfo[];
  total: number;
  selected: Set<string>;
  sort: SortState;
  onSort: (column: SortColumn) => void;
  onSelect: (id: string, event: MouseEvent) => void;
  onOpen: (download: DownloadInfo) => void;
  onContextMenu: (download: DownloadInfo, event: MouseEvent) => void;
  onAdd: () => void;
  onMedia: () => void;
}) {
  return (
    <div className="table-wrap">
      <table className="download-table">
        <thead>
          <tr>
            {COLUMNS.map((column) => {
              const active = column.sortable && sort.column === column.id;
              return (
                <th
                  key={column.id}
                  className={cx(column.className, column.sortable && "sortable", active && "sorted")}
                  onClick={() => {
                    if (column.sortable) onSort(column.id as SortColumn);
                  }}
                >
                  <span>{column.label}</span>
                  {active ? (
                    <span className="sort-arrow">{sort.direction === "asc" ? "▲" : "▼"}</span>
                  ) : null}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {downloads.map((download) => {
            const progress = progressOf(download);
            const active = ["connecting", "downloading", "queued"].includes(download.status);
            return (
              <tr
                key={download.id}
                className={cx("download-row", selected.has(download.id) && "selected")}
                onClick={(event) => onSelect(download.id, event)}
                onDoubleClick={() => onOpen(download)}
                onContextMenu={(event) => onContextMenu(download, event)}
              >
                <td className="col-name">
                  <div className="name-line">
                    <Icon
                      name={CATEGORY_ICONS[download.category] ?? "file"}
                      size={16}
                      className={`file-icon category-${download.category}`}
                    />
                    <span className="file-name" title={download.path}>
                      {download.fileName}
                    </span>
                  </div>
                  {progress != null && download.status !== "completed" ? (
                    <div className="row-progress" aria-hidden>
                      <div className="row-progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
                    </div>
                  ) : null}
                </td>
                <td className="col-size num">{formatBytes(download.totalSize)}</td>
                <td className={cx("col-status", `state-${download.status}`)}>
                  <span className="status-dot" />
                  <span title={download.error ?? undefined}>{statusText(download)}</span>
                </td>
                <td className="col-speed num">{active ? formatSpeed(download.speed) : "—"}</td>
                <td className="col-eta num">{active ? formatEta(download.eta) : "—"}</td>
                <td className="col-date">{formatDate(download.createdAt)}</td>
                <td className="col-category muted">{categoryLabel(download.category)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {downloads.length === 0 ? (
        <div className="empty-state">
          <Logo size={54} />
          <h3>{total === 0 ? "No downloads yet" : "Nothing matches this view"}</h3>
          <p>
            {total === 0
              ? "Paste a link, add a URL, or download a video from the web."
              : "Try another category or clear the search filter."}
          </p>
          {total === 0 ? (
            <div className="empty-actions">
              <button className="primary-button" onClick={onAdd}>
                <Icon name="add" size={15} /> Add URL
              </button>
              <button className="secondary-button" onClick={onMedia}>
                <Icon name="media" size={15} /> Download video
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
