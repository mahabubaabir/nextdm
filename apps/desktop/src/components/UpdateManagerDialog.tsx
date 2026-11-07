import { useState, useEffect } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Icon } from "./Icons";

export interface UpdateManagerDialogProps {
  open: boolean;
  currentVersion: string;
  onClose: () => void;
  onOpenOptions?: () => void;
}

interface UpdateItem {
  id: string;
  name: string;
  description: string;
  type: "package" | "web";
  currentVersion: string;
  newVersion: string;
  size: string;
  selected: boolean;
}

export function UpdateManagerDialog({
  open,
  currentVersion,
  onClose,
  onOpenOptions,
}: UpdateManagerDialogProps) {
  const [activeTab, setActiveTab] = useState<"info" | "packages" | "changelog">("changelog");
  const [selectedRowId, setSelectedRowId] = useState<string>("desktop");
  const [checking, setChecking] = useState(false);
  const [latestTag, setLatestTag] = useState<string>("");
  const [releaseUrl, setReleaseUrl] = useState<string>("");
  const [changelogBody, setChangelogBody] = useState<string>("");
  const [isInstalling, setIsInstalling] = useState(false);
  const [installStatus, setInstallStatus] = useState<string>("");

  const [items, setItems] = useState<UpdateItem[]>([
    {
      id: "desktop",
      name: "nextdm-desktop",
      description: "Next-gen segmented download manager core & UI",
      type: "package",
      currentVersion: currentVersion,
      newVersion: "0.1.1",
      size: "14.2 MB",
      selected: true,
    },
    {
      id: "host",
      name: "nextdm-browser-host",
      description: "Native messaging integration companion for Firefox & Chromium",
      type: "web",
      currentVersion: currentVersion,
      newVersion: "0.1.1",
      size: "2.1 MB",
      selected: true,
    },
  ]);

  const fetchLatestRelease = async () => {
    setChecking(true);
    setInstallStatus("");
    try {
      const res = await fetch("https://api.github.com/repos/mahabubaabir/nextdm/releases/latest", {
        headers: { Accept: "application/vnd.github.v3+json" },
      });
      if (res.ok) {
        const data = await res.json();
        const tag = (data.tag_name || "").replace(/^v/, "") || "0.1.1";
        setLatestTag(tag);
        setReleaseUrl(data.html_url || "https://github.com/mahabubaabir/nextdm/releases");
        if (data.body) {
          setChangelogBody(data.body);
        }
        setItems((prev) =>
          prev.map((item) => ({
            ...item,
            newVersion: tag,
          }))
        );
      }
    } catch {
      // Fallback to bundled release notes
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (open) {
      fetchLatestRelease();
    }
  }, [open]);

  if (!open) return null;

  const handleClear = () => {
    setItems((prev) => prev.map((item) => ({ ...item, selected: false })));
  };

  const handleSelectAll = () => {
    setItems((prev) => prev.map((item) => ({ ...item, selected: true })));
  };

  const toggleSelect = (id: string) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, selected: !item.selected } : item))
    );
  };

  const selectedCount = items.filter((i) => i.selected).length;

  const handleInstall = async () => {
    setIsInstalling(true);
    setInstallStatus("Preparing package download...");
    try {
      // Direct download link for Linux Mint .deb
      const debUrl = `https://github.com/mahabubaabir/nextdm/releases/download/v${latestTag || "0.1.1"}/NextDM_${latestTag || "0.1.1"}_amd64.deb`;
      setInstallStatus("Opening download package in installer...");
      await openUrl(debUrl);
      setTimeout(() => {
        setInstallStatus("Package opened! Follow system prompt to complete installation.");
        setIsInstalling(false);
      }, 1500);
    } catch {
      if (releaseUrl) {
        openUrl(releaseUrl);
      } else {
        openUrl("https://github.com/mahabubaabir/nextdm/releases");
      }
      setIsInstalling(false);
    }
  };

  const defaultChangelog = `
## NextDM v${latestTag || "0.1.1"} (2026-11-07)

### 🎬 Media Playback & Stream Extraction
- Fixed unplayable video downloads: If an embedded web player uses blob: URLs or fragmented .ts chunks, NextDM extracts high-quality streams directly from the webpage URL.
- Universal MP4 remuxing: Added -c:v copy -c:a aac -movflags +faststart to ensure all streams play in standard Linux Mint video players (Celluloid, VLC, MPV).
- Streaming playlist interception: Direct routing for .m3u8, .mpd, .f4m, and .ism/ manifests into the Media extractor.

### 🎨 Liquid Glass Design Refinement
- Removed "Trend" labels across theme selectors.
- Frosted glass button transparency with backdrop blur (blur(14px)), specular borders, and glowing hover states.

### 💾 Settings Backup & Restore
- Portable JSON backup file export & import for transferring settings to new computers.

### 📁 Category Folder Routing
- Automatic sorting of files into category subfolders (Video, Compressed, Documents, Music, Programs, Images).
- Dynamic folder switching in pre-download popup dialog.

### 🚀 Auto-Update Checker & GitHub Sync
- Linux Mint Update Manager parity UI and automated release updates.
`;

  return (
    <div
      className="modal-backdrop"
      style={{
        zIndex: 200,
        backgroundColor: "rgba(0, 0, 0, 0.65)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="mint-update-window"
        style={{
          width: "900px",
          maxWidth: "96vw",
          height: "640px",
          maxHeight: "94vh",
          backgroundColor: "#242424",
          color: "#e6e6e6",
          borderRadius: "8px",
          boxShadow: "0 25px 65px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(255, 255, 255, 0.12)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          fontFamily: "Ubuntu, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          animation: "modal-in 0.15s ease",
        }}
      >
        {/* Title Bar */}
        <div
          style={{
            height: "36px",
            backgroundColor: "#1e1e1e",
            borderBottom: "1px solid #333333",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 12px",
            userSelect: "none",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Icon name="mint" size={18} />
            <span style={{ fontSize: "13px", fontWeight: 600, color: "#ffffff" }}>
              Update Manager
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "#999",
              cursor: "pointer",
              padding: "4px",
              display: "flex",
              alignItems: "center",
              borderRadius: "4px",
            }}
            title="Close"
          >
            <Icon name="close" size={14} />
          </button>
        </div>

        {/* Traditional Linux Mint Menu Bar */}
        <div
          style={{
            height: "26px",
            backgroundColor: "#262626",
            borderBottom: "1px solid #383838",
            display: "flex",
            alignItems: "center",
            padding: "0 8px",
            fontSize: "12px",
            color: "#cccccc",
            gap: "14px",
            userSelect: "none",
          }}
        >
          <span style={{ cursor: "pointer" }} onClick={onClose}>
            File
          </span>
          <span style={{ cursor: "pointer" }} onClick={onOpenOptions}>
            Edit
          </span>
          <span style={{ cursor: "pointer" }}>View</span>
          <span style={{ cursor: "pointer" }} onClick={onClose}>
            Help
          </span>
        </div>

        {/* Linux Mint Action Toolbar */}
        <div
          style={{
            padding: "8px 12px",
            backgroundColor: "#2c2c2c",
            borderBottom: "1px solid #383838",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            userSelect: "none",
          }}
        >
          <button
            type="button"
            className="mint-tool-btn"
            onClick={handleClear}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "3px",
              background: "none",
              border: "none",
              color: "#e0e0e0",
              cursor: "pointer",
              padding: "4px 8px",
              borderRadius: "4px",
              fontSize: "11px",
            }}
          >
            <Icon name="clear" size={18} />
            <span>Clear</span>
          </button>

          <button
            type="button"
            className="mint-tool-btn"
            onClick={handleSelectAll}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "3px",
              background: "none",
              border: "none",
              color: "#e0e0e0",
              cursor: "pointer",
              padding: "4px 8px",
              borderRadius: "4px",
              fontSize: "11px",
            }}
          >
            <Icon name="selectAll" size={18} />
            <span>Select All</span>
          </button>

          <button
            type="button"
            className="mint-tool-btn"
            onClick={fetchLatestRelease}
            disabled={checking}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "3px",
              background: "none",
              border: "none",
              color: checking ? "#888888" : "#e0e0e0",
              cursor: checking ? "default" : "pointer",
              padding: "4px 8px",
              borderRadius: "4px",
              fontSize: "11px",
            }}
          >
            <Icon name="refresh" size={18} className={checking ? "spinner" : ""} />
            <span>{checking ? "Checking…" : "Refresh"}</span>
          </button>

          <div style={{ width: "1px", height: "28px", backgroundColor: "#404040", margin: "0 4px" }} />

          <button
            type="button"
            className="mint-tool-btn mint-install-btn"
            onClick={handleInstall}
            disabled={isInstalling || selectedCount === 0}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "3px",
              background: "rgba(135, 195, 117, 0.12)",
              border: "1px solid rgba(135, 195, 117, 0.35)",
              color: "#a4e292",
              cursor: selectedCount === 0 || isInstalling ? "default" : "pointer",
              padding: "4px 12px",
              borderRadius: "4px",
              fontSize: "11px",
              fontWeight: 600,
            }}
          >
            <Icon name="installUpdates" size={18} />
            <span>{isInstalling ? "Installing…" : "Install Updates"}</span>
          </button>
        </div>

        {/* Upper Half: Updates Table */}
        <div style={{ flex: 1, minHeight: "200px", display: "flex", flexDirection: "column", backgroundColor: "#1e1e1e" }}>
          {/* Table Header */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "50px 70px 1fr 140px",
              padding: "7px 12px",
              backgroundColor: "#2a2a2a",
              borderBottom: "1px solid #3a3a3a",
              fontSize: "11.5px",
              fontWeight: 600,
              color: "#aaaaaa",
              userSelect: "none",
            }}
          >
            <span>Type</span>
            <span>Upgrade</span>
            <span>Name</span>
            <span>New Version</span>
          </div>

          {/* Table Rows */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {items.map((item) => {
              const isSelectedRow = selectedRowId === item.id;
              return (
                <div
                  key={item.id}
                  onClick={() => setSelectedRowId(item.id)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "50px 70px 1fr 140px",
                    padding: "10px 12px",
                    alignItems: "center",
                    borderBottom: "1px solid #282828",
                    backgroundColor: isSelectedRow ? "#2c3b4e" : "transparent",
                    cursor: "pointer",
                    fontSize: "12px",
                    transition: "background-color 0.12s",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {item.type === "package" ? (
                      <Icon name="package" size={16} style={{ color: "#38bdf8" }} />
                    ) : (
                      <Icon name="globe" size={16} style={{ color: "#a855f7" }} />
                    )}
                  </div>

                  <div
                    style={{ display: "flex", alignItems: "center", paddingLeft: "14px" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSelect(item.id);
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={item.selected}
                      onChange={() => toggleSelect(item.id)}
                      style={{ cursor: "pointer", width: "15px", height: "15px", accentColor: "#3b82f6" }}
                    />
                  </div>

                  <div>
                    <div style={{ fontWeight: 600, color: "#ffffff", fontSize: "12.5px" }}>
                      {item.name}
                    </div>
                    <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "1px" }}>
                      {item.description}
                    </div>
                  </div>

                  <div style={{ fontFamily: "monospace", fontSize: "12px", color: "#87c375" }}>
                    {item.newVersion}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Splitter Line */}
        <div style={{ height: "4px", backgroundColor: "#333333", borderTop: "1px solid #444" }} />

        {/* Lower Half: Tabbed Info & Changelog Panel */}
        <div
          style={{
            height: "220px",
            backgroundColor: "#222222",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Mint Style Tabs */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              padding: "6px 12px 0",
              borderBottom: "1px solid #333333",
              userSelect: "none",
            }}
          >
            <button
              type="button"
              onClick={() => setActiveTab("info")}
              style={{
                background: activeTab === "info" ? "#2e2e2e" : "transparent",
                border: "1px solid",
                borderColor: activeTab === "info" ? "#444444 #444444 transparent #444444" : "transparent",
                borderTopLeftRadius: "6px",
                borderTopRightRadius: "6px",
                color: activeTab === "info" ? "#ffffff" : "#999999",
                padding: "6px 14px",
                fontSize: "12px",
                cursor: "pointer",
                fontWeight: activeTab === "info" ? 600 : 400,
              }}
            >
              Information
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("packages")}
              style={{
                background: activeTab === "packages" ? "#2e2e2e" : "transparent",
                border: "1px solid",
                borderColor: activeTab === "packages" ? "#444444 #444444 transparent #444444" : "transparent",
                borderTopLeftRadius: "6px",
                borderTopRightRadius: "6px",
                color: activeTab === "packages" ? "#ffffff" : "#999999",
                padding: "6px 14px",
                fontSize: "12px",
                cursor: "pointer",
                fontWeight: activeTab === "packages" ? 600 : 400,
              }}
            >
              Packages
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("changelog")}
              style={{
                background: activeTab === "changelog" ? "#2e2e2e" : "transparent",
                border: "1px solid",
                borderColor: activeTab === "changelog" ? "#444444 #444444 transparent #444444" : "transparent",
                borderTopLeftRadius: "6px",
                borderTopRightRadius: "6px",
                color: activeTab === "changelog" ? "#ffffff" : "#999999",
                padding: "6px 14px",
                fontSize: "12px",
                cursor: "pointer",
                fontWeight: activeTab === "changelog" ? 600 : 400,
              }}
            >
              Changelog
            </button>
          </div>

          {/* Tab Content */}
          <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px", fontSize: "12px" }}>
            {activeTab === "info" && (
              <div style={{ display: "grid", gridTemplateColumns: "130px 1fr", gap: "8px 16px" }}>
                <span style={{ color: "#888888" }}>Size:</span>
                <span style={{ fontWeight: 600 }}>14.2 MB download (42 MB on disk)</span>

                <span style={{ color: "#888888" }}>Maintainer:</span>
                <span>Marbor Tech by Mahabub H. Aabir &lt;mahabub.aabir@yahoo.com&gt;</span>

                <span style={{ color: "#888888" }}>Source:</span>
                <span style={{ color: "#38bdf8" }}>GitHub Releases (mahabubaabir/nextdm)</span>

                <span style={{ color: "#888888" }}>Architecture:</span>
                <span>x86_64 (amd64)</span>

                <span style={{ color: "#888888" }}>License:</span>
                <span>GNU General Public License v3.0</span>

                <span style={{ color: "#888888" }}>Repository:</span>
                <a
                  href="https://github.com/mahabubaabir/nextdm"
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "#87c375", textDecoration: "none" }}
                >
                  https://github.com/mahabubaabir/nextdm
                </a>
              </div>
            )}

            {activeTab === "packages" && (
              <div>
                <p style={{ margin: "0 0 10px 0", color: "#999" }}>
                  The following packages will be upgraded on your Linux Mint system:
                </p>
                <table style={{ width: "100%", textAlign: "left", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ color: "#777", borderBottom: "1px solid #333" }}>
                      <th style={{ padding: "4px 8px" }}>Package</th>
                      <th style={{ padding: "4px 8px" }}>Installed</th>
                      <th style={{ padding: "4px 8px" }}>Available</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ borderBottom: "1px solid #2a2a2a" }}>
                      <td style={{ padding: "6px 8px", fontWeight: 600 }}>nextdm-desktop</td>
                      <td style={{ padding: "6px 8px", color: "#888" }}>{currentVersion}</td>
                      <td style={{ padding: "6px 8px", color: "#87c375" }}>{latestTag || "0.1.1"}</td>
                    </tr>
                    <tr style={{ borderBottom: "1px solid #2a2a2a" }}>
                      <td style={{ padding: "6px 8px", fontWeight: 600 }}>nextdm-browser-host</td>
                      <td style={{ padding: "6px 8px", color: "#888" }}>{currentVersion}</td>
                      <td style={{ padding: "6px 8px", color: "#87c375" }}>{latestTag || "0.1.1"}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "6px 8px", fontWeight: 600 }}>nextdm-media</td>
                      <td style={{ padding: "6px 8px", color: "#888" }}>{currentVersion}</td>
                      <td style={{ padding: "6px 8px", color: "#87c375" }}>{latestTag || "0.1.1"}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {activeTab === "changelog" && (
              <div
                style={{
                  whiteSpace: "pre-wrap",
                  fontFamily: "monospace",
                  fontSize: "11.5px",
                  lineHeight: "1.55",
                  color: "#d1d5db",
                  backgroundColor: "#1a1a1a",
                  padding: "10px 14px",
                  borderRadius: "6px",
                  border: "1px solid #2d2d2d",
                }}
              >
                {changelogBody || defaultChangelog.trim()}
              </div>
            )}
          </div>
        </div>

        {/* Status Bar */}
        <div
          style={{
            height: "30px",
            backgroundColor: "#1a1a1a",
            borderTop: "1px solid #333333",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 14px",
            fontSize: "11.5px",
            color: "#aaaaaa",
            userSelect: "none",
          }}
        >
          <span>
            {selectedCount} update{selectedCount === 1 ? "" : "s"} selected (
            {selectedCount === 1 ? "14.2 MB" : "16.3 MB"})
          </span>

          {installStatus && (
            <span style={{ color: "#87c375", fontWeight: 500 }}>{installStatus}</span>
          )}

          <div style={{ display: "flex", gap: "10px" }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                background: "transparent",
                border: "none",
                color: "#999999",
                cursor: "pointer",
                padding: "2px 8px",
                fontSize: "11.5px",
              }}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
