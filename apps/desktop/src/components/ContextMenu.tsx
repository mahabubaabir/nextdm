import { useEffect, useRef } from "react";
import { Icon, type IconName } from "./Icons";
import { cx } from "../lib";

export interface ContextEntry {
  label?: string;
  icon?: IconName;
  shortcut?: string;
  separator?: boolean;
  disabled?: boolean;
  danger?: boolean;
  onClick?: () => void;
}

export function ContextMenu({
  x,
  y,
  entries,
  onClose,
}: {
  x: number;
  y: number;
  entries: ContextEntry[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const close = (event: Event) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const width = 220;
  const height = entries.length * 28 + 12;
  const left = Math.min(x, window.innerWidth - width - 8);
  const top = Math.min(y, window.innerHeight - height - 8);

  return (
    <div className="context-menu" style={{ left, top, width }} ref={ref} role="menu">
      {entries.map((entry, index) =>
        entry.separator ? (
          <div key={`sep-${index}`} className="menu-separator" />
        ) : (
          <button
            key={`${entry.label}-${index}`}
            className={cx("context-item", entry.danger && "danger")}
            disabled={entry.disabled}
            onClick={() => {
              onClose();
              entry.onClick?.();
            }}
          >
            <span className="context-icon">{entry.icon ? <Icon name={entry.icon} size={14} /> : null}</span>
            <span className="context-label">{entry.label}</span>
            {entry.shortcut ? <span className="menu-shortcut">{entry.shortcut}</span> : null}
          </button>
        ),
      )}
    </div>
  );
}
