import { Icon } from "./Icons";

export interface ToastMessage {
  id: number;
  kind: "info" | "success" | "error";
  message: string;
}

export function Toasts({
  toasts,
  onDismiss,
}: {
  toasts: ToastMessage[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.kind}`}>
          <Icon
            name={toast.kind === "success" ? "check" : toast.kind === "error" ? "warning" : "info"}
            size={15}
          />
          <span>{toast.message}</span>
          <button className="toast-close" onClick={() => onDismiss(toast.id)} aria-label="Dismiss">
            <Icon name="close" size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
