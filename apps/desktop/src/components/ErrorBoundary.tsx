import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("NextDM uncaught UI exception:", error, errorInfo);
    this.setState({ error, errorInfo });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
            background: "var(--bg, #111318)",
            color: "var(--text, #e2e8f0)",
            fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            zIndex: 999999,
          }}
        >
          <div
            style={{
              maxWidth: "560px",
              width: "100%",
              background: "var(--surface, #1e222b)",
              border: "1px solid var(--border-soft, #333a47)",
              borderRadius: "12px",
              padding: "28px",
              boxShadow: "0 16px 40px rgba(0, 0, 0, 0.4)",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div
                style={{
                  width: "40px",
                  height: "40px",
                  borderRadius: "8px",
                  background: "rgba(239, 68, 68, 0.15)",
                  color: "#ef4444",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "20px",
                  fontWeight: 700,
                }}
              >
                !
              </div>
              <div>
                <h2 style={{ margin: 0, fontSize: "17px", fontWeight: 600 }}>NextDM UI Recovery</h2>
                <p style={{ margin: "2px 0 0 0", fontSize: "13px", color: "var(--muted, #94a3b8)" }}>
                  An unexpected error occurred while rendering the interface.
                </p>
              </div>
            </div>

            <div
              style={{
                background: "rgba(0, 0, 0, 0.3)",
                padding: "12px 14px",
                borderRadius: "8px",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                fontSize: "12px",
                fontFamily: "monospace",
                color: "#fca5a5",
                maxHeight: "160px",
                overflowY: "auto",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
              }}
            >
              {this.state.error?.message || "Unknown error"}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "8px" }}>
              <button
                type="button"
                onClick={this.handleReset}
                style={{
                  padding: "8px 16px",
                  borderRadius: "6px",
                  border: "1px solid var(--border-soft, #333a47)",
                  background: "transparent",
                  color: "var(--text, #e2e8f0)",
                  fontSize: "13px",
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                Dismiss & Try Again
              </button>
              <button
                type="button"
                onClick={this.handleReload}
                style={{
                  padding: "8px 18px",
                  borderRadius: "6px",
                  border: "none",
                  background: "var(--accent, #6366f1)",
                  color: "#ffffff",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Reload NextDM
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
