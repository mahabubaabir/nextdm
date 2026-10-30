import { Icon, type IconName } from "./Icons";
import { cx } from "../lib";

interface ToolbarProps {
  onAdd: () => void;
  onStart: () => void;
  onPause: () => void;
  onRemove: () => void;
  onOptions: () => void;
  onMedia: () => void;
  onRefresh: () => void;
  search: string;
  onSearch: (value: string) => void;
  canStart: boolean;
  canPause: boolean;
  canRemove: boolean;
  theme: string;
  onToggleTheme: () => void;
}

function ToolButton({
  icon,
  label,
  onClick,
  disabled,
  className,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button className={cx("tool-button", className)} onClick={onClick} disabled={disabled}>
      <Icon name={icon} size={18} />
      <span>{label}</span>
    </button>
  );
}

export function Toolbar({
  onAdd,
  onStart,
  onPause,
  onRemove,
  onOptions,
  onMedia,
  onRefresh,
  search,
  onSearch,
  canStart,
  canPause,
  canRemove,
  theme,
  onToggleTheme,
}: ToolbarProps) {
  return (
    <div className="toolbar" role="toolbar">
      <div className="toolbar-group">
        <ToolButton icon="add" label="Add URL" onClick={onAdd} />
        <ToolButton icon="media" label="Media" onClick={onMedia} className="accent" />
      </div>
      <div className="toolbar-separator" />
      <div className="toolbar-group">
        <ToolButton icon="start" label="Start" onClick={onStart} disabled={!canStart} />
        <ToolButton icon="pause" label="Pause" onClick={onPause} disabled={!canPause} />
        <ToolButton icon="remove" label="Remove" onClick={onRemove} disabled={!canRemove} />
      </div>
      <div className="toolbar-separator" />
      <div className="toolbar-group">
        <ToolButton icon="options" label="Options" onClick={onOptions} />
        <ToolButton icon="refresh" label="Refresh" onClick={onRefresh} />
      </div>
      <div className="toolbar-spacer" />
      <label className="search-box">
        <Icon name="search" size={14} />
        <input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Search downloads"
          spellCheck={false}
          aria-label="Search downloads"
        />
        {search ? (
          <button className="search-clear" onClick={() => onSearch("")} title="Clear search">
            <Icon name="close" size={12} />
          </button>
        ) : null}
      </label>
      <button
        className="icon-button theme-toggle"
        onClick={onToggleTheme}
        title={`Theme: ${theme}`}
        aria-label="Toggle theme"
      >
        {theme === "dark" ? <Icon name="refresh" size={15} /> : <Icon name="monitor" size={15} />}
      </button>
    </div>
  );
}
