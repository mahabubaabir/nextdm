import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Modal } from "./Modal";
import { Icon, type IconName } from "./Icons";
import { cx } from "../lib";
import type { Settings } from "../types";

type Tab = "general" | "downloads" | "connections" | "speed" | "media" | "browser" | "advanced";

const TABS: Array<{ id: Tab; label: string; icon: IconName }> = [
  { id: "general", label: "General", icon: "options" },
  { id: "downloads", label: "Downloads", icon: "download" },
  { id: "connections", label: "Connections", icon: "connections" },
  { id: "speed", label: "Speed Limit", icon: "speed" },
  { id: "media", label: "Media", icon: "media" },
  { id: "browser", label: "Browser", icon: "globe" },
  { id: "advanced", label: "Advanced", icon: "monitor" },
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
                  <option value="glass">Liquid Glass (Modern Trend)</option>
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
                    <span>Web Store Installation (Universal for Any PC)</span>
                  </div>
                  <span className="status-pill status-pill-info">Recommended</span>
                </div>
                <p className="integration-card-desc">
                  Upload the extension to Chrome Web Store and Firefox Add-ons (AMO) for 1-click installation on any computer without needing developer mode or unpacking files. Ready-to-upload store packages (.zip) are bundled automatically.
                </p>
                <div className="store-links-grid">
                  <div className="store-link-item">
                    <div className="store-item-info">
                      <strong>Chrome / Chromium Web Store</strong>
                      <span className="muted">For Google Chrome, Brave, Edge & Vivaldi</span>
                    </div>
                    <div className="inline-field">
                      <button
                        className="secondary-button compact"
                        onClick={() => openExternalUrl("https://chrome.google.com/webstore/devconsole")}
                      >
                        <Icon name="external" size={13} /> Open Developer Dashboard
                      </button>
                    </div>
                  </div>
                  <div className="store-link-item">
                    <div className="store-item-info">
                      <strong>Mozilla Firefox Add-ons (AMO)</strong>
                      <span className="muted">For Firefox, Floorp, LibreWolf & Waterfox</span>
                    </div>
                    <div className="inline-field">
                      <button
                        className="secondary-button compact"
                        onClick={() => openExternalUrl("https://addons.mozilla.org/developers/addon/submit/upload-listed")}
                      >
                        <Icon name="external" size={13} /> Open Add-on Developer Hub
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
                    <span>Offline / Local Developer Mode</span>
                  </div>
                </div>
                <p className="integration-card-desc">
                  To test locally before publishing to web stores:
                </p>
                <ul className="integration-steps">
                  <li>
                    <strong>Chromium / Chrome / Brave / Edge:</strong> Open <code>chrome://extensions</code>, enable <em>Developer mode</em>, click <em>Load unpacked</em>, and select the <code>chromium</code> folder inside the extensions directory.
                  </li>
                  <li>
                    <strong>Firefox:</strong> Open <code>about:debugging#/runtime/this-firefox</code>, click <em>Load Temporary Add-on</em>, and select <code>manifest.json</code> inside the <code>firefox</code> folder.
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

          {tab === "advanced" ? (
            <section className="option-section">
              <h3>About this build</h3>
              <p className="option-note">
                NextDM 0.1.0 · GPL-3.0-or-later · Free and open source. No ads, no telemetry, no account.
              </p>
              <div className="inline-field">
                <button
                  className="secondary-button compact"
                  onClick={() => invoke("open_path", { path: draft.defaultDir }).catch(() => undefined)}
                >
                  <Icon name="folder" size={14} /> Open download folder
                </button>
                <button className="secondary-button compact" onClick={() => setDraft(settings)}>
                  <Icon name="refresh" size={14} /> Revert changes
                </button>
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
