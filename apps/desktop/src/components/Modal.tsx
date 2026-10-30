import { useEffect, type ReactNode } from "react";
import { Icon } from "./Icons";

export function Modal({
  title,
  subtitle,
  icon,
  width = 560,
  children,
  footer,
  onClose,
  closeDisabled = false,
  className,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  width?: number;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  closeDisabled?: boolean;
  className?: string;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !closeDisabled) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, closeDisabled]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !closeDisabled) onClose();
      }}
    >
      <div className={`modal ${className ?? ""}`} style={{ width }} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">
          <div className="modal-title">
            {icon ?? <Icon name="download" size={18} />}
            <div>
              <h2>{title}</h2>
              {subtitle ? <p>{subtitle}</p> : null}
            </div>
          </div>
          <button className="icon-button" onClick={onClose} disabled={closeDisabled} title="Close (Esc)">
            <Icon name="close" size={15} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-footer">{footer}</footer> : null}
      </div>
    </div>
  );
}
