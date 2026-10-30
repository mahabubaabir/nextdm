import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { readText } from "@tauri-apps/plugin-clipboard-manager";

import { MenuBar, type MenuDefinition } from "./components/MenuBar";
import { Toolbar } from "./components/Toolbar";
import { Sidebar } from "./components/Sidebar";
import { DownloadTable } from "./components/DownloadTable";
import { StatusBar } from "./components/StatusBar";
import { ContextMenu, type ContextEntry } from "./components/ContextMenu";
import { Toasts, type ToastMessage } from "./components/Toasts";
import { AddDownloadDialog } from "./components/AddDownloadDialog";
import { OptionsDialog } from "./components/OptionsDialog";
import { MediaDialog } from "./components/MediaDialog";
import { Modal } from "./components/Modal";
import { Icon, Logo } from "./components/Icons";
import { DEFAULT_SETTINGS, categoryLabel, isProbablyUrl } from "./lib";
import type {
  DownloadInfo,
  EngineEvent,
  Filter,
  Settings,
  SortColumn,
  SortState,
} from "./types";
import "./App.css";

const STATUS_ORDER: Record<string, number> = {
  downloading: 0,
  connecting: 1,
  queued: 2,
  paused: 3,
  error: 4,
  scheduled: 5,
  cancelled: 6,
  completed: 7,
};

function upsert(list: DownloadInfo[], download: DownloadInfo): DownloadInfo[] {
  const index = list.findIndex((item) => item.id === download.id);
  if (index === -1) return [download, ...list];
  const copy = list.slice();
  copy[index] = { ...copy[index], ...download };
  return copy;
}

function readSettings(raw: Record<string, unknown>, defaultDir: string): Settings {
  const theme = raw.theme === "dark" || raw.theme === "system" ? raw.theme : "classic";
  return {
    theme,
    defaultDir: typeof raw.default_dir === "string" ? raw.default_dir : defaultDir,
    maxConnections: Number(raw.max_connections) || DEFAULT_SETTINGS.maxConnections,
    speedLimit: Number(raw.speed_limit) || 0,
    clipboardMonitor: Boolean(raw.clipboard_monitor),
    notifications: raw.notifications === undefined ? true : Boolean(raw.notifications),
    confirmRemove: raw.confirm_remove === undefined ? true : Boolean(raw.confirm_remove),
    autoResume: raw.auto_resume === undefined ? true : Boolean(raw.auto_resume),
    closeToTray: Boolean(raw.close_to_tray),
  };
}

function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand("copy");
      resolve();
    } catch (error) {
      reject(error);
    } finally {
      document.body.removeChild(area);
    }
  });
}

function App() {
  const [downloads, setDownloads] = useState<DownloadInfo[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [filter, setFilter] = useState<Filter>({ kind: "all" });
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortState>({ column: "date", direction: "desc" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<"add" | "options" | "media" | "about" | null>(null);
  const [initialUrls, setInitialUrls] = useState("");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; download: DownloadInfo } | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [engineVersion, setEngineVersion] = useState("0.1.0");

  const lastSelected = useRef<string | null>(null);
  const settingsRef = useRef(settings);
  const themeBackup = useRef<Settings["theme"]>("classic");
  const dialogRef = useRef<string | null>(null);
  const clipboardSeen = useRef("");
  const toastCounter = useRef(0);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    dialogRef.current = dialog;
  }, [dialog]);

  const notify = useCallback((kind: ToastMessage["kind"], message: string) => {
    const id = ++toastCounter.current;
    setToasts((current) => [...current.slice(-4), { id, kind, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 5200);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const list = await invoke<DownloadInfo[]>("list_downloads");
      setDownloads(list);
    } catch (error) {
      notify("error", `Could not load downloads: ${String(error)}`);
    }
  }, [notify]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    (async () => {
      try {
        const [list, raw, directory, version] = await Promise.all([
          invoke<DownloadInfo[]>("list_downloads"),
          invoke<Record<string, unknown>>("get_settings"),
          invoke<string>("default_download_dir"),
          invoke<string>("engine_version"),
        ]);
        if (disposed) return;
        setDownloads(list);
        setEngineVersion(version);
        setSettings((current) => ({ ...current, ...readSettings(raw, directory) }));
      } catch (error) {
        if (!disposed) notify("error", `Engine unavailable: ${String(error)}`);
      }

      try {
        unlisten = await listen<EngineEvent>("engine://event", (event) => {
          const payload = event.payload;
          setDownloads((current) => {
            switch (payload.type) {
              case "added":
              case "updated":
              case "completed":
                return upsert(current, payload.download);
              case "removed":
                return current.filter((item) => item.id !== payload.id);
              case "progress":
                return current.map((item) =>
                  item.id === payload.id
                    ? {
                        ...item,
                        downloaded: payload.downloaded,
                        totalSize: payload.totalSize ?? item.totalSize,
                        speed: payload.speed,
                        eta: payload.eta,
                      }
                    : item,
                );
              default:
                return current;
            }
          });

          if (payload.type === "removed") {
            setSelected((current) => {
              if (!current.has(payload.id)) return current;
              const next = new Set(current);
              next.delete(payload.id);
              return next;
            });
          }
          if (payload.type === "completed" && settingsRef.current.notifications) {
            notify("success", `Completed: ${payload.download.fileName}`);
          }
        });
      } catch {
        /* event bridge unavailable outside Tauri */
      }
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [notify]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const theme =
        settings.theme === "system" ? (media.matches ? "dark" : "classic") : settings.theme;
      document.documentElement.dataset.theme = theme;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [settings.theme]);

  useEffect(() => {
    if (!settings.clipboardMonitor) return;
    const timer = window.setInterval(async () => {
      if (dialogRef.current) return;
      try {
        const text = (await readText())?.trim();
        if (
          !text ||
          text === clipboardSeen.current ||
          text.length > 2048 ||
          !isProbablyUrl(text)
        ) {
          return;
        }
        clipboardSeen.current = text;
        setInitialUrls(text);
        setDialog("add");
      } catch {
        /* clipboard permission not granted */
      }
    }, 1600);
    return () => window.clearInterval(timer);
  }, [settings.clipboardMonitor]);

  const changeTheme = useCallback(
    (theme: Settings["theme"]) => {
      setSettings((current) => ({ ...current, theme }));
      invoke("set_setting", { key: "theme", value: theme }).catch(() => undefined);
    },
    [],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const list = downloads.filter((download) => {
      if (filter.kind === "finished" && download.status !== "completed") return false;
      if (filter.kind === "unfinished" && download.status === "completed") return false;
      if (filter.kind === "category" && download.category !== filter.value) return false;
      if (!query) return true;
      return (
        download.fileName.toLowerCase().includes(query) ||
        download.url.toLowerCase().includes(query) ||
        categoryLabel(download.category).toLowerCase().includes(query)
      );
    });

    const direction = sort.direction === "asc" ? 1 : -1;
    list.sort((a, b) => {
      switch (sort.column) {
        case "fileName":
          return a.fileName.localeCompare(b.fileName, undefined, { sensitivity: "base" }) * direction;
        case "size":
          return ((a.totalSize ?? a.downloaded) - (b.totalSize ?? b.downloaded)) * direction;
        case "status":
          return ((STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99)) * direction;
        case "speed":
          return (a.speed - b.speed) * direction;
        case "eta":
          return ((a.eta ?? Number.MAX_SAFE_INTEGER) - (b.eta ?? Number.MAX_SAFE_INTEGER)) * direction;
        case "date":
        default:
          return (Date.parse(a.createdAt) - Date.parse(b.createdAt)) * direction;
      }
    });
    return list;
  }, [downloads, filter, search, sort]);

  const selectedDownloads = useMemo(
    () => downloads.filter((download) => selected.has(download.id)),
    [downloads, selected],
  );

  const filterLabel = useMemo(() => {
    switch (filter.kind) {
      case "all":
        return "All downloads";
      case "unfinished":
        return "Unfinished";
      case "finished":
        return "Finished";
      case "category":
        return categoryLabel(filter.value);
    }
  }, [filter]);

  const canStart = selectedDownloads.some((download) =>
    ["paused", "error", "cancelled", "queued"].includes(download.status),
  );
  const canPause = selectedDownloads.some((download) =>
    ["queued", "connecting", "downloading"].includes(download.status),
  );
  const canRemove = selectedDownloads.length > 0;

  const openAdd = (urls = "") => {
    setInitialUrls(urls);
    setDialog("add");
  };

  const openOptions = () => {
    themeBackup.current = settings.theme;
    setDialog("options");
  };

  const closeOptions = () => {
    setSettings((current) => ({ ...current, theme: themeBackup.current }));
    setDialog(null);
  };

  const startSelected = async () => {
    for (const download of selectedDownloads) {
      if (["paused", "error", "cancelled", "queued"].includes(download.status)) {
        invoke("resume_download", { id: download.id }).catch((error) =>
          notify("error", String(error)),
        );
      }
    }
  };

  const pauseSelected = async () => {
    for (const download of selectedDownloads) {
      if (["queued", "connecting", "downloading"].includes(download.status)) {
        invoke("pause_download", { id: download.id }).catch((error) =>
          notify("error", String(error)),
        );
      }
    }
  };

  const removeSelected = async (deleteFile: boolean) => {
    if (selectedDownloads.length === 0) return;
    if (
      settings.confirmRemove &&
      !window.confirm(
        `Remove ${selectedDownloads.length} download${selectedDownloads.length === 1 ? "" : "s"}${
          deleteFile ? " and delete the downloaded files" : ""
        }?`,
      )
    ) {
      return;
    }
    for (const download of selectedDownloads) {
      try {
        await invoke("remove_download", { id: download.id, deleteFile });
      } catch (error) {
        notify("error", String(error));
      }
    }
    setSelected(new Set());
  };

  const openDownload = (download: DownloadInfo) => {
    if (download.status === "completed") {
      invoke("open_path", { path: download.path }).catch((error) => notify("error", String(error)));
      return;
    }
    if (["queued", "connecting", "downloading"].includes(download.status)) {
      invoke("pause_download", { id: download.id }).catch((error) => notify("error", String(error)));
    } else {
      invoke("resume_download", { id: download.id }).catch((error) => notify("error", String(error)));
    }
  };

  const startAll = () => {
    for (const download of downloads) {
      if (["paused", "error", "cancelled"].includes(download.status)) {
        invoke("resume_download", { id: download.id }).catch((error) => notify("error", String(error)));
      }
    }
  };

  const pauseAll = () => {
    for (const download of downloads) {
      if (["queued", "connecting", "downloading"].includes(download.status)) {
        invoke("pause_download", { id: download.id }).catch((error) => notify("error", String(error)));
      }
    }
  };

  const saveOptions = async (next: Settings) => {
    setSettings(next);
    setDialog(null);
    try {
      await Promise.all([
        invoke("set_setting", { key: "theme", value: next.theme }),
        invoke("set_setting", { key: "clipboard_monitor", value: next.clipboardMonitor }),
        invoke("set_setting", { key: "notifications", value: next.notifications }),
        invoke("set_setting", { key: "confirm_remove", value: next.confirmRemove }),
        invoke("set_setting", { key: "auto_resume", value: next.autoResume }),
        invoke("set_setting", { key: "close_to_tray", value: next.closeToTray }),
        invoke("set_max_connections", { connections: next.maxConnections }),
        invoke("set_speed_limit", { bytesPerSecond: next.speedLimit }),
        invoke("set_default_dir", { path: next.defaultDir }),
      ]);
      notify("success", "Options saved.");
    } catch (error) {
      notify("error", String(error));
    }
  };

  const startMediaDownload = (url: string, formatId: string | null, fileStem: string) => {
    notify("info", "Media download started. It will appear here when yt-dlp finishes.");
    invoke<DownloadInfo>("media_download", {
      url,
      formatId,
      fileStem,
      directory: settings.defaultDir || null,
    })
      .then((info) => notify("success", `Media saved: ${info.fileName}`))
      .catch((error) => notify("error", String(error)));
  };

  const onSelect = (id: string, event: ReactMouseEvent) => {
    if (event.shiftKey && lastSelected.current) {
      const ids = filtered.map((download) => download.id);
      const from = ids.indexOf(lastSelected.current);
      const to = ids.indexOf(id);
      if (from >= 0 && to >= 0) {
        const [start, end] = from < to ? [from, to] : [to, from];
        setSelected(new Set(ids.slice(start, end + 1)));
        return;
      }
    }
    if (event.ctrlKey || event.metaKey) {
      setSelected((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    } else {
      setSelected(new Set([id]));
    }
    lastSelected.current = id;
  };

  const onSort = (column: SortColumn) => {
    setSort((current) =>
      current.column === column
        ? { column, direction: current.direction === "asc" ? "desc" : "asc" }
        : { column, direction: column === "fileName" ? "asc" : "desc" },
    );
  };

  const downloadFolder = async () => {
    try {
      const list = await invoke<DownloadInfo[]>("list_downloads");
      const completed = list.find((download) => download.status === "completed");
      if (completed) {
        invoke("reveal_path", { path: completed.path }).catch((error) => notify("error", String(error)));
      }
    } catch (error) {
      notify("error", String(error));
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable);

      if (event.ctrlKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        openAdd();
      } else if (event.ctrlKey && event.key.toLowerCase() === "o") {
        event.preventDefault();
        openOptions();
      } else if (event.ctrlKey && event.key.toLowerCase() === "a" && !typing) {
        event.preventDefault();
        setSelected(new Set(filtered.map((download) => download.id)));
      } else if (event.key === "Delete" && !typing && selectedDownloads.length > 0) {
        event.preventDefault();
        removeSelected(false);
      } else if (event.key === " " && !typing && selectedDownloads.length > 0) {
        event.preventDefault();
        if (canPause) pauseSelected();
        else startSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    const active = downloads.filter((download) => download.status === "downloading").length;
    document.title = active > 0 ? `NextDM — ${active} active` : "NextDM";
  }, [downloads]);

  const menus: MenuDefinition[] = [
    {
      label: "File",
      items: [
        { label: "Add URL…", shortcut: "Ctrl+N", onClick: () => openAdd() },
        { label: "Download Video…", onClick: () => setDialog("media") },
        { separator: true },
        { label: "Open Download Folder", onClick: downloadFolder },
        { separator: true },
        { label: "Exit", onClick: () => getCurrentWindow().close() },
      ],
    },
    {
      label: "Downloads",
      items: [
        { label: "Start / Resume", shortcut: "Space", disabled: !canStart, onClick: startSelected },
        { label: "Pause", shortcut: "Space", disabled: !canPause, onClick: pauseSelected },
        { label: "Remove from List", shortcut: "Del", disabled: !canRemove, onClick: () => removeSelected(false) },
        {
          label: "Remove and Delete File",
          disabled: !canRemove,
          danger: true,
          onClick: () => removeSelected(true),
        },
        { separator: true },
        { label: "Start All", onClick: startAll },
        { label: "Pause All", onClick: pauseAll },
      ],
    },
    {
      label: "View",
      items: [
        { label: "All Downloads", checked: filter.kind === "all", onClick: () => setFilter({ kind: "all" }) },
        { label: "Unfinished", checked: filter.kind === "unfinished", onClick: () => setFilter({ kind: "unfinished" }) },
        { label: "Finished", checked: filter.kind === "finished", onClick: () => setFilter({ kind: "finished" }) },
        { separator: true },
        {
          label: "Classic theme",
          checked: settings.theme === "classic",
          onClick: () => changeTheme("classic"),
        },
        { label: "Dark theme", checked: settings.theme === "dark", onClick: () => changeTheme("dark") },
        {
          label: "Follow system theme",
          checked: settings.theme === "system",
          onClick: () => changeTheme("system"),
        },
        { separator: true },
        { label: "Refresh", onClick: refresh },
      ],
    },
    {
      label: "Options",
      items: [
        { label: "Options…", shortcut: "Ctrl+O", onClick: openOptions },
        { label: "Speed Limiter…", onClick: openOptions },
        { label: "Browser Integration…", onClick: openOptions },
      ],
    },
    {
      label: "Help",
      items: [
        { label: "About NextDM", onClick: () => setDialog("about") },
        {
          label: "Project on GitHub",
          onClick: () =>
            openUrl("https://github.com/mahabubaabir/nextdm").catch(() => undefined),
        },
      ],
    },
  ];

  const contextEntries: ContextEntry[] = contextMenu
    ? [
        {
          label: "Open File",
          icon: "external",
          disabled: contextMenu.download.status !== "completed",
          onClick: () => openDownload(contextMenu.download),
        },
        {
          label: "Open Folder",
          icon: "folder",
          onClick: () =>
            invoke("reveal_path", { path: contextMenu.download.path }).catch((error) =>
              notify("error", String(error)),
            ),
        },
        { separator: true },
        {
          label: ["queued", "connecting", "downloading"].includes(contextMenu.download.status)
            ? "Pause"
            : "Resume",
          icon: ["queued", "connecting", "downloading"].includes(contextMenu.download.status)
            ? "pause"
            : "start",
          disabled: contextMenu.download.status === "completed",
          onClick: () =>
            ["queued", "connecting", "downloading"].includes(contextMenu.download.status)
              ? invoke("pause_download", { id: contextMenu.download.id }).catch((error) =>
                  notify("error", String(error)),
                )
              : invoke("resume_download", { id: contextMenu.download.id }).catch((error) =>
                  notify("error", String(error)),
                ),
        },
        {
          label: "Remove from List",
          icon: "remove",
          onClick: async () => {
            await invoke("remove_download", { id: contextMenu.download.id, deleteFile: false }).catch(
              (error) => notify("error", String(error)),
            );
            setSelected(new Set());
          },
        },
        {
          label: "Remove and Delete File",
          icon: "trash",
          danger: true,
          onClick: async () => {
            if (
              !window.confirm(
                `Delete "${contextMenu.download.fileName}" from disk and remove it from the list?`,
              )
            ) {
              return;
            }
            await invoke("remove_download", { id: contextMenu.download.id, deleteFile: true }).catch(
              (error) => notify("error", String(error)),
            );
            setSelected(new Set());
          },
        },
        { separator: true },
        {
          label: "Copy Source URL",
          icon: "clipboard",
          onClick: () =>
            copyText(contextMenu.download.url)
              .then(() => notify("info", "Source URL copied."))
              .catch(() => notify("error", "Could not copy the URL.")),
        },
      ]
    : [];

  return (
    <div
      className="app"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const text =
          event.dataTransfer.getData("text/uri-list") || event.dataTransfer.getData("text/plain");
        const urls = text
          .split(/\r?\n/)
          .map((value) => value.trim())
          .filter(isProbablyUrl);
        if (urls.length > 0) openAdd(urls.join("\n"));
      }}
    >
      <MenuBar menus={menus} />
      <Toolbar
        onAdd={() => openAdd()}
        onStart={startSelected}
        onPause={pauseSelected}
        onRemove={() => removeSelected(false)}
        onOptions={openOptions}
        onMedia={() => setDialog("media")}
        onRefresh={refresh}
        search={search}
        onSearch={setSearch}
        canStart={canStart}
        canPause={canPause}
        canRemove={canRemove}
        theme={settings.theme}
        onToggleTheme={() => changeTheme(settings.theme === "dark" ? "classic" : "dark")}
      />

      <div className="workspace">
        <Sidebar downloads={downloads} filter={filter} onFilter={setFilter} />
        <main className="content">
          <DownloadTable
            downloads={filtered}
            total={downloads.length}
            selected={selected}
            sort={sort}
            onSort={onSort}
            onSelect={onSelect}
            onOpen={openDownload}
            onContextMenu={(download, event) => {
              event.preventDefault();
              if (!selected.has(download.id)) setSelected(new Set([download.id]));
              setContextMenu({ x: event.clientX, y: event.clientY, download });
            }}
            onAdd={() => openAdd()}
            onMedia={() => setDialog("media")}
          />
        </main>
      </div>

      <StatusBar
        downloads={downloads}
        selectedCount={selected.size}
        filterLabel={filterLabel}
        speedLimit={settings.speedLimit}
      />

      {contextMenu ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          entries={contextEntries}
          onClose={() => setContextMenu(null)}
        />
      ) : null}

      <AddDownloadDialog
        open={dialog === "add"}
        defaultDir={settings.defaultDir}
        maxConnections={settings.maxConnections}
        initialUrls={initialUrls}
        onClose={() => setDialog(null)}
        onAdded={(count) => notify("success", `${count} download${count === 1 ? "" : "s"} added.`)}
      />

      <OptionsDialog
        open={dialog === "options"}
        settings={settings}
        onClose={closeOptions}
        onSave={saveOptions}
        onPreviewTheme={(theme) => setSettings((current) => ({ ...current, theme }))}
      />

      <MediaDialog
        open={dialog === "media"}
        defaultDir={settings.defaultDir}
        onClose={() => setDialog(null)}
        onDownload={startMediaDownload}
      />

      {dialog === "about" ? (
        <Modal
          title="About NextDM"
          icon={<Logo size={20} />}
          width={460}
          onClose={() => setDialog(null)}
          footer={
            <div className="modal-actions">
              <button
                className="secondary-button"
                onClick={() => openUrl("https://github.com/mahabubaabir/nextdm").catch(() => undefined)}
              >
                <Icon name="external" size={14} /> GitHub
              </button>
              <button className="primary-button" onClick={() => setDialog(null)}>
                Close
              </button>
            </div>
          }
        >
          <div className="about">
            <Logo size={64} />
            <h2>NextDM {engineVersion}</h2>
            <p className="about-tagline">A free, native download manager for Linux.</p>
            <p>
              Segmented downloads, resume, browser handoff and site media downloads. No ads, no
              telemetry, no account.
            </p>
            <p className="muted">
              Licensed under GPL-3.0-or-later. NextDM is an independent project and is not affiliated
              with Internet Download Manager or Tonec Inc.
            </p>
          </div>
        </Modal>
      ) : null}

      <Toasts toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    </div>
  );
}

export default App;
