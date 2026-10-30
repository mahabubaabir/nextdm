import { Icon, type IconName } from "./Icons";
import { CATEGORIES, cx } from "../lib";
import type { DownloadInfo, Filter } from "../types";

const CATEGORY_ICONS: Record<string, IconName> = {
  documents: "documents",
  music: "music",
  video: "video",
  programs: "programs",
  compressed: "compressed",
  images: "images",
  other: "other",
};

export function Sidebar({
  downloads,
  filter,
  onFilter,
}: {
  downloads: DownloadInfo[];
  filter: Filter;
  onFilter: (filter: Filter) => void;
}) {
  const unfinished = downloads.filter((download) => download.status !== "completed").length;
  const finished = downloads.filter((download) => download.status === "completed").length;

  const item = (key: string, label: string, icon: IconName, count: number, active: boolean, onClick: () => void) => (
    <button className={cx("tree-item", active && "selected")} onClick={onClick} key={key}>
      <Icon name={icon} size={15} className="tree-icon" />
      <span className="tree-label">{label}</span>
      {count > 0 ? <span className="tree-count">{count}</span> : null}
    </button>
  );

  return (
    <aside className="sidebar">
      <div className="tree-section">Downloads</div>
      {item("all", "All Downloads", "all", downloads.length, filter.kind === "all", () =>
        onFilter({ kind: "all" }),
      )}
      {item("unfinished", "Unfinished", "unfinished", unfinished, filter.kind === "unfinished", () =>
        onFilter({ kind: "unfinished" }),
      )}
      {item("finished", "Finished", "finished", finished, filter.kind === "finished", () =>
        onFilter({ kind: "finished" }),
      )}

      <div className="tree-section">Categories</div>
      {CATEGORIES.map((category) => {
        const count = downloads.filter((download) => download.category === category.id).length;
        const active = filter.kind === "category" && filter.value === category.id;
        return item(
          category.id,
          category.label,
          CATEGORY_ICONS[category.id] ?? "other",
          count,
          active,
          () => onFilter({ kind: "category", value: category.id }),
        );
      })}

      <div className="sidebar-footer">
        <div className="sidebar-brand">
          <span>NextDM</span>
          <small>Free &amp; open source</small>
        </div>
      </div>
    </aside>
  );
}
