import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Modal } from "./Modal";
import { Icon, type IconName } from "./Icons";
import { AboutView } from "./AboutView";
import { cx } from "../lib";
import type { Settings } from "../types";

type Tab = "general" | "downloads" | "connections" | "speed" | "media" | "browser" | "backup" | "advanced";

const TABS: Array<{ id: Tab; label: string; icon: IconName }> = [
  { id: "general", label: "General", icon: "options" },
  { id: "downloads", label: "Downloads", icon: "download" },
  { id: "connections", label: "Connections", icon: "connections" },
  { id: "speed", label: "Speed Limit", icon: "speed" },
  { id: "media", label: "Media", icon: "media" },
  { id: "browser", label: "Browser", icon: "globe" },
  { id: "backup", label: "Backup & Restore", icon: "refresh" },
  { id: "advanced", label: "About", icon: "info" },
];

export function OptionsDialog({
  open,
  settings,
  onClose,
  onSave,
  onPreviewTheme,
}: {
  open: boolean;
  settings: Settings;
  onClose: () => void;
  onSave: (settings: Settings) => void;
  onPreviewTheme: (theme: Settings["theme"]) => void;
}) {
  const [tab, setTab] = useState<Tab>("general");
  const [draft, setDraft] = useState<Settings>(settings);
  const [speedKb, setSpeedKb] = useState(Math.round(settings.speedLimit / 1024));
  const [ytDlp, setYtDlp] = useState<boolean | null>(null);
  const [checkingMedia, setCheckingMedia] = useState(false);
  const [browserBusy, setBrowserBusy] = useState(false);
  const [browserResult, setBrowserResult] = useState("");
  const [hostInstalled, setHostInstalled] = useState<boolean | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(settings);
    setSpeedKb(Math.round(settings.speedLimit / 1024));
    setTab("general");
    setBrowserResult("");
    setYtDlp(null);
    invoke<boolean>("check_browser_integration")
      .then(setHostInstalled)
      .catch(() => setHostInstalled(false));
    // Intentionally reset only when the dialog opens; theme previews update
    // the parent settings object while the user is editing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (tab === "browser") {
      invoke<boolean>("check_browser_integration")
        .then(setHostInstalled)
        .catch(() => setHostInstalled(false));
    }
  }, [tab]);

  if (!open) return null;

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const checkMedia = async () => {
    setCheckingMedia(true);
    try {
      setYtDlp(await invoke<boolean>("yt_dlp_available"));
    } catch {
      setYtDlp(false);
    } finally {
      setCheckingMedia(false);
    }
  };

  const installBrowsers = async () => {
    setBrowserBusy(true);
    setBrowserResult("");
    try {
      const messages = await invoke<string[]>("install_browser_integration", {
        chromium: true,
        firefox: true,
        customChromeId: null,
      });
      setBrowserResult(messages.join(" "));
      setHostInstalled(true);
    } catch (caught) {
      setBrowserResult(String(caught));
    } finally {
      setBrowserBusy(false);
    }
  };

  const openExtFolder = async () => {
    try {
      await invoke("open_extensions_dir");
    } catch (err) {
      console.error(err);
    }
  };

  const openExternalUrl = async (url: string) => {
    try {
      await openUrl(url);
    } catch {
      window.open(url, "_blank");
    }
  };

  const [backupBusy, setBackupBusy] = useState(false);
  const [backupMessage, setBackupMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleExportBackup = async () => {
    setBackupBusy(true);
    setBackupMessage(null);
    try {
      const jsonStr = await invoke<string>("export_settings_json");
      const blob = new Blob([jsonStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const dateStr = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `nextdm-settings-backup-${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setBackupMessage({ type: "success", text: "Settings backup JSON exported successfully!" });
    } catch (err) {
      setBackupMessage({ type: "error", text: `Export failed: ${String(err)}` });
    } finally {
      setBackupBusy(false);
    }
  };

  const handleImportBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBackupBusy(true);
    setBackupMessage(null);
    try {
      const text = await file.text();
      await invoke("import_settings_json", { jsonStr: text });
      const parsed = JSON.parse(text);
      const updated = { ...draft, ...parsed };
      setDraft(updated);
      onSave(updated);
      setBackupMessage({ type: "success", text: "Settings successfully restored from backup!" });
    } catch (err) {
      setBackupMessage({ type: "error", text: `Import failed: ${String(err)}` });
    } finally {
      setBackupBusy(false);
      e.target.value = "";
    }
  };

  const save = () => {
    onSave({ ...draft, speedLimit: Math.max(0, speedKb) * 1024 });
  };

  return (
    <Modal
      title="NextDM Options"
      subtitle="Configure transfers, integration and appearance."
      icon={<Icon name="options" size={18} />}
      width={760}
      onClose={onClose}
      className="options-modal"
      footer={
        <>
          <span className="modal-hint">Settings are stored locally</span>
          <div className="modal-actions">
            <button className="secondary-button" onClick={onClose}>
              Cancel
            </button>
            <button className="primary-button" onClick={save}>
              <Icon name="check" size={15} /> Save
            </button>
          </div>
        </>
      }
    >
      <div className="options-layout">
        <nav className="options-tabs">
          {TABS.map((item) => (
            <button
              key={item.id}
              className={cx("options-tab", tab === item.id && "active")}
              onClick={() => setTab(item.id)}
            >
              <Icon name={item.icon} size={15} />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="options-panel">
          {tab === "general" ? (
            <section className="option-section">
              <h3>Appearance</h3>
              <label className="option-row">
                <span>Theme</span>
                <select
                  value={draft.theme}
                  onChange={(event) => {
                    const theme = event.target.value as Settings["theme"];
                    update("theme", theme);
                    onPreviewTheme(theme);
                  }}
                >
                  <option value="classic">Classic Linux Mint</option>
                  <option value="dark">Modern Dark</option>
                  <option value="glass">Liquid Glass</option>
                  <option value="material3">Material 3 Expressive</option>
                  <option value="system">Follow system</option>
                </select>
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={draft.compactView}
                  onChange={(event) => update("compactView", event.target.checked)}
                />
                <span>Compact toolbar & interface mode</span>
              </label>

              <h3>Downloads folder</h3>
              <div className="input-row">
                <input
                  className="text-input"
                  value={draft.defaultDir}
                  onChange={(event) => update("defaultDir", event.target.value)}
                />
                <button
                  className="secondary-button compact"
                  onClick={async () => {
                    try {
                      const selected = await openDialog({ directory: true, multiple: false, defaultPath: draft.defaultDir });
                      if (typeof selected === "string") update("defaultDir", selected);
                    } catch {
                      /* cancelled */
                    }
                  }}
                >
                  <Icon name="folder" size={14} /> Browse
                </button>
              </div>
              <label className="checkbox-row" style={{ marginTop: "8px" }}>
                <input
                  type="checkbox"
                  checked={draft.categoryRouting ?? true}
                  onChange={(event) => update("categoryRouting", event.target.checked)}
                />
                <span>Automatically sort downloads into category subfolders (Video, Compressed, Documents, Music, Programs, Images)</span>
              </label>

              <h3>Startup & System</h3>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={draft.autostart}
                  onChange={(event) => update("autostart", event.target.checked)}
                />
                <span>Launch NextDM automatically on system startup</span>
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={draft.closeToTray}
                  onChange={(event) => update("closeToTray", event.target.checked)}
                />
                <span>Keep NextDM running in background / system tray when the window is closed</span>
              </label>

              <h3>Behavior</h3>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={draft.clipboardMonitor}
                  onChange={(event) => update("clipboardMonitor", event.target.checked)}
                />
                <span>Monitor the clipboard for download links</span>
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={draft.notifications}
                  onChange={(event) => update("notifications", event.target.checked)}
                />
                <span>Show a notification when a download completes</span>
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={draft.confirmRemove}
                  onChange={(event) => update("confirmRemove", event.target.checked)}
                />
                <span>Ask for confirmation before removing downloads</span>
              </label>
            </section>
          ) : null}

          {tab === "downloads" ? (
            <section className="option-section">
              <h3>Startup</h3>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={draft.autoResume}
                  onChange={(event) => update("autoResume", event.target.checked)}
                />
                <span>Resume unfinished downloads when NextDM starts</span>
              </label>
              <p className="option-note">
                Transfers interrupted by a crash or power loss keep their partial data and resume from
                the last acknowledged byte range. Servers that do not support ranges restart from zero.
              </p>

              <h3>Completion</h3>
              <p className="option-note">
                Finished files are moved from the temporary <code>.nextdm</code> part file into the
                selected folder. Use <strong>Open folder</strong> in the context menu to find them.
              </p>
            </section>
          ) : null}

          {tab === "connections" ? (
            <section className="option-section">
              <h3>Parallel connections</h3>
              <label className="option-row">
                <span>Default connections per download</span>
                <input
                  className="number-input"
                  type="number"
                  min={1}
                  max={32}
                  value={draft.maxConnections}
                  onChange={(event) =>
                    update("maxConnections", Math.max(1, Math.min(32, Number(event.target.value) || 1)))
                  }
                />
              </label>
              <p className="option-note">
                More connections can increase speed on servers that support byte ranges. Values above 8
                rarely help and may be throttled. Individual downloads can override this value.
              </p>
              <h3>Resume</h3>
              <p className="option-note">
                NextDM validates the remote ETag or Last-Modified value before appending to a partial
                file. If the remote file changed, the download restarts safely.
              </p>
            </section>
          ) : null}

          {tab === "speed" ? (
            <section className="option-section">
              <h3>Global speed limit</h3>
              <label className="option-row">
                <span>Maximum speed (KB/s)</span>
                <input
                  className="number-input"
                  type="number"
                  min={0}
                  step={64}
                  value={speedKb}
                  onChange={(event) => setSpeedKb(Math.max(0, Number(event.target.value) || 0))}
                />
              </label>
              <p className="option-note">
                Set to <strong>0</strong> for unlimited speed. The limit applies to the sum of all active
                downloads and takes effect immediately.
              </p>
            </section>
          ) : null}

          {tab === "media" ? (
            <section className="option-section">
              <h3>Media backend</h3>
              <p className="option-note">
                NextDM uses its own segmented engine for direct files, HLS and DASH streams. Site media
                (YouTube, Facebook and similar) is handled by <code>yt-dlp</code>, which keeps extraction
                reliable as sites change.
              </p>
              <div className="option-row">
                <span>yt-dlp status</span>
                <div className="inline-field">
                  {ytDlp === null ? <span className="muted">Not checked</span> : null}
                  {ytDlp === true ? (
                    <span className="status-ok">
                      <Icon name="check" size={13} /> Available
                    </span>
                  ) : null}
                  {ytDlp === false ? (
                    <span className="status-bad">
                      <Icon name="warning" size={13} /> Not found
                    </span>
                  ) : null}
                  <button className="secondary-button compact" onClick={checkMedia} disabled={checkingMedia}>
                    {checkingMedia ? <span className="spinner dark" /> : <Icon name="refresh" size={13} />} Check
                  </button>
                </div>
              </div>
              <p className="option-note">
                Install with <code>sudo apt install yt-dlp ffmpeg</code> or{" "}
                <code>python3 -m pip install -U yt-dlp</code>. Set <code>NEXTDM_YTDLP</code> to use a
                custom binary path.
              </p>
            </section>
          ) : null}

          {tab === "browser" ? (
            <section className="option-section">
              <h3>Browser Integration</h3>
              <p className="option-note">
                Connect NextDM directly to your web browser to capture downloads and grab online videos with 1 click.
              </p>

              {/* Host Status Card */}
              <div className="integration-card">
                <div className="integration-card-header">
                  <div className="integration-card-title">
                    <Icon name="globe" size={16} />
                    <span>Native Messaging Host</span>
                  </div>
                  {hostInstalled ? (
                    <span className="status-pill status-pill-ok">
                      <Icon name="check" size={12} /> Registered & Active
                    </span>
                  ) : (
                    <span className="status-pill status-pill-warn">
                      <Icon name="warning" size={12} /> Not Registered
                    </span>
                  )}
                </div>
                <p className="integration-card-desc">
                  Registers the native communication bridge on this system for Chrome, Brave, Edge, Vivaldi, Chromium, and Firefox.
                </p>
                <div className="integration-card-actions">
                  <button
                    className="primary-button compact"
                    onClick={installBrowsers}
                    disabled={browserBusy}
                  >
                    {browserBusy ? <span className="spinner" /> : <Icon name="refresh" size={13} />}
                    {hostInstalled ? "Re-register Native Host" : "Register Native Messaging Host"}
                  </button>
                  <button
                    className="secondary-button compact"
                    onClick={openExtFolder}
                    title="Open the local extensions and store bundles folder"
                  >
                    <Icon name="folder" size={13} />
                    Open Extensions Folder
                  </button>
                </div>
                {browserResult ? (
                  <div className="integration-alert">
                    <Icon name="check" size={14} />
                    <span>{browserResult}</span>
                  </div>
                ) : null}
              </div>

              {/* Web Store Distribution */}
              <div className="integration-card">
                <div className="integration-card-header">
                  <div className="integration-card-title">
                    <Icon name="external" size={16} />
                    <span>Browser Extension Installation</span>
                  </div>
                  <span className="status-pill status-pill-info">Universal for Any PC</span>
                </div>
                <p className="integration-card-desc">
                  Install the companion browser extension to capture downloads and grab online videos with 1 click. Works on any computer without needing developer mode or unpacking files.
                </p>
                <div className="store-links-grid">
                  <div className="store-link-item">
                    <div className="store-item-info">
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <strong>Mozilla Firefox Add-on</strong>
                        <span className="status-pill status-pill-ok" style={{ fontSize: "11px", padding: "1px 6px" }}>
                          ✓ Approved & Live
                        </span>
                      </div>
                      <span className="muted">Official 1-click install from Mozilla Add-ons (AMO)</span>
                    </div>
                    <div className="inline-field">
                      <button
                        className="primary-button compact"
                        onClick={() => openExternalUrl("https://addons.mozilla.org/en-US/firefox/addon/nextdm-integration/")}
                      >
                        <Icon name="external" size={13} /> Add to Firefox (AMO)
                      </button>
                    </div>
                  </div>
                  <div className="store-link-item">
                    <div className="store-item-info">
                      <strong>Chrome / Chromium / Brave / Edge</strong>
                      <span className="muted">For Google Chrome, Brave, Edge & Vivaldi</span>
                    </div>
                    <div className="inline-field" style={{ gap: "6px" }}>
                      <button
                        className="secondary-button compact"
                        onClick={openExtFolder}
                        title="Open folder containing ready-to-upload store packages and unpacked extension"
                      >
                        <Icon name="folder" size={13} /> Extensions Folder
                      </button>
                      <button
                        className="secondary-button compact"
                        onClick={() => openExternalUrl("https://chrome.google.com/webstore/devconsole")}
                        title="Upload nextdm-chrome-webstore.zip to Chrome Web Store"
                      >
                        <Icon name="external" size={13} /> Developer Dashboard
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Developer / Offline Mode */}
              <div className="integration-card">
                <div className="integration-card-header">
                  <div className="integration-card-title">
                    <Icon name="options" size={16} />
                    <span>Developer / Manual Unpacked Mode</span>
                  </div>
                </div>
                <p className="integration-card-desc">
                  For developing or testing the unpacked extension locally without installing from the web store:
                </p>
                <ul className="integration-steps">
                  <li>
                    <strong>Chromium / Chrome / Brave / Edge:</strong> Open <code>chrome://extensions</code>, enable <em>Developer mode</em>, click <em>Load unpacked</em>, and select the unpacked <code>chromium</code> folder.
                  </li>
                  <li>
                    <strong>Firefox:</strong> You do not need developer mode! Install the official signed add-on from the <button type="button" onClick={() => openExternalUrl("https://addons.mozilla.org/en-US/firefox/addon/nextdm-integration/")} style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit" }}>Mozilla Add-ons Store</button> with 1 click.
                  </li>
                </ul>
              </div>

              {/* Video Grabber Settings */}
              <h3>Video Download Grabber</h3>
              <p className="option-note">
                Configure the floating download button displayed on YouTube, Facebook, and video websites:
              </p>
              <label className="option-row">
                <span>Floating badge style</span>
                <select
                  value={draft.videoBadgeStyle}
                  onChange={(event) =>
                    update("videoBadgeStyle", event.target.value as "compact" | "full")
                  }
                >
                  <option value="compact">Compact Icon Only (Mini Grabber)</option>
                  <option value="full">Download Video (Full Button)</option>
                </select>
              </label>
              <p className="option-note">
                Supported: Chromium, Chrome, Brave, Edge, Vivaldi and Firefox. The integration listens only
                on the local machine and never opens a public port.
              </p>
            </section>
          ) : null}

          {tab === "backup" ? (
            <section className="option-section">
              <h3>Backup & Restore Settings</h3>
              <p className="option-note">
                Export your NextDM preferences, download folders, network configs, and appearance to a JSON backup file to restore on another computer.
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginTop: "16px" }}>
                <div
                  style={{
                    padding: "16px",
                    background: "var(--surface)",
                    border: "1px solid var(--border-soft)",
                    borderRadius: "8px",
                  }}
                >
                  <h4 style={{ margin: "0 0 6px 0", fontSize: "14px", fontWeight: 600 }}>Export Configuration</h4>
                  <p style={{ margin: "0 0 12px 0", fontSize: "12px", color: "var(--muted)" }}>
                    Download all your custom settings into a portable JSON backup file.
                  </p>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={handleExportBackup}
                    disabled={backupBusy}
                  >
                    <Icon name="download" size={14} /> Export Backup (.json)
                  </button>
                </div>

                <div
                  style={{
                    padding: "16px",
                    background: "var(--surface)",
                    border: "1px solid var(--border-soft)",
                    borderRadius: "8px",
                  }}
                >
                  <h4 style={{ margin: "0 0 6px 0", fontSize: "14px", fontWeight: 600 }}>Restore Configuration</h4>
                  <p style={{ margin: "0 0 12px 0", fontSize: "12px", color: "var(--muted)" }}>
                    Restore settings from a previously saved NextDM JSON backup file.
                  </p>
                  <label
                    className="secondary-button"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      cursor: "pointer",
                      padding: "8px 14px",
                    }}
                  >
                    <Icon name="refresh" size={14} /> Import Backup (.json)
                    <input
                      type="file"
                      accept=".json,application/json"
                      style={{ display: "none" }}
                      onChange={handleImportBackup}
                    />
                  </label>
                </div>

                {backupMessage && (
                  <div
                    style={{
                      padding: "10px 14px",
                      borderRadius: "6px",
                      fontSize: "13px",
                      background:
                        backupMessage.type === "success"
                          ? "rgba(52, 211, 153, 0.15)"
                          : "rgba(239, 68, 68, 0.15)",
                      border: `1px solid ${
                        backupMessage.type === "success"
                          ? "rgba(52, 211, 153, 0.3)"
                          : "rgba(239, 68, 68, 0.3)"
                      }`,
                      color: backupMessage.type === "success" ? "#34d399" : "#ef4444",
                    }}
                  >
                    {backupMessage.text}
                  </div>
                )}
              </div>
            </section>
          ) : null}

          {tab === "advanced" ? (
            <section className="option-section">
              <AboutView engineVersion="0.1.1" />
            </section>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
