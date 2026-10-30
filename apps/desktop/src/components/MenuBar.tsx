import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icons";
import { cx } from "../lib";

export interface MenuItem {
  label?: string;
  shortcut?: string;
  separator?: boolean;
  disabled?: boolean;
  checked?: boolean;
  danger?: boolean;
  onClick?: () => void;
}

export interface MenuDefinition {
  label: string;
  items: MenuItem[];
}

export function MenuBar({ menus }: { menus: MenuDefinition[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const root = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(null);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <nav className="menubar" ref={root}>
      {menus.map((menu, index) => (
        <div className="menu" key={menu.label}>
          <button
            className={cx("menu-trigger", open === index && "open")}
            onClick={() => setOpen(open === index ? null : index)}
            onMouseEnter={() => {
              if (open !== null && open !== index) setOpen(index);
            }}
          >
            {menu.label}
          </button>
          {open === index ? (
            <div className="menu-popover" role="menu">
              {menu.items.map((item, itemIndex) =>
                item.separator ? (
                  <div className="menu-separator" key={`sep-${itemIndex}`} />
                ) : (
                  <button
                    key={`${item.label}-${itemIndex}`}
                    className={cx("menu-item", item.danger && "danger")}
                    role="menuitem"
                    disabled={item.disabled}
                    onClick={() => {
                      setOpen(null);
                      item.onClick?.();
                    }}
                  >
                    <span className="menu-check">{item.checked ? <Icon name="check" size={12} /> : null}</span>
                    <span className="menu-label">{item.label}</span>
                    {item.shortcut ? <span className="menu-shortcut">{item.shortcut}</span> : null}
                  </button>
                ),
              )}
            </div>
          ) : null}
        </div>
      ))}
    </nav>
  );
}
