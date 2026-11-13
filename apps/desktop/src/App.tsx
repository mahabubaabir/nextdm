import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { readText } from "@tauri-apps/plugin-clipboard-manager";

import { MenuBar, type MenuDefinition } from "./components/MenuBar";
import { Toolbar } from "./components/Toolbar";
import { Sidebar } from "./components/Sidebar";
import { DownloadTable } from "./components/DownloadTable";
import { StatusBar } from "./components/StatusBar";
import { ContextMenu, type ContextEntry } from "./components/ContextMenu";
import { Toasts, type ToastMessage } from "./components/Toasts";
import { AddDownloadDialog } from "./components/AddDownloadDialog";
import { DownloadFileInfoDialog } from "./components/DownloadFileInfoDialog";
import { DownloadProgressDialog } from "./components/DownloadProgressDialog";
import { DownloadCompleteDialog } from "./components/DownloadCompleteDialog";
import { OptionsDialog } from "./components/OptionsDialog";
import { MediaDialog } from "./components/MediaDialog";
import { AboutView } from "./components/AboutView";
import { UpdateManagerDialog } from "./components/UpdateManagerDialog";
import { Modal } from "./components/Modal";
import { Logo } from "./components/Icons";
import { DEFAULT_SETTINGS, categoryLabel, cx, isDownloadableUrl, isMediaSiteUrl, isProbablyUrl } from "./lib";
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
  const theme =
    raw.theme === "dark" || raw.theme === "glass" || raw.theme === "material3" || raw.theme === "system"
      ? (raw.theme as Settings["theme"])
      : "classic";
  return {
    theme,
    defaultDir: typeof raw.default_dir === "string" ? raw.default_dir : defaultDir,
    categoryRouting: raw.category_routing === undefined ? true : Boolean(raw.category_routing),
    maxConnections: Number(raw.max_connections) || DEFAULT_SETTINGS.maxConnections,
    speedLimit: Number(raw.speed_limit) || 0,
    clipboardMonitor: Boolean(raw.clipboard_monitor),
    notifications: raw.notifications === undefined ? true : Boolean(raw.notifications),
    confirmRemove: raw.confirm_remove === undefined ? true : Boolean(raw.confirm_remove),
    autoResume: raw.auto_resume === undefined ? true : Boolean(raw.auto_resume),
    closeToTray: raw.close_to_tray === undefined ? true : Boolean(raw.close_to_tray),
    videoBadgeStyle: raw.video_badge_style === "full" ? "full" : "compact",
    compactView: Boolean(raw.compact_view),
    autostart: true,
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
  const [updateManagerOpen, setUpdateManagerOpen] = useState(false);
  const [initialUrls, setInitialUrls] = useState("");
  const [mediaDialogUrl, setMediaDialogUrl] = useState<string>("");
  const [fileInfoUrl, setFileInfoUrl] = useState<string | null>(null);
  const [activeProgressId, setActiveProgressId] = useState<string | null>(null);
  const [completedDownload, setCompletedDownload] = useState<DownloadInfo | null>(null);
  const [clipboardDetectedUrl, setClipboardDetectedUrl] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; download: DownloadInfo } | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [engineVersion, setEngineVersion] = useState("0.2.0");

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
    let unlistenBrowser: (() => void) | undefined;
    let unlistenMediaGrab: (() => void) | undefined;

    (async () => {
      try {
        const [list, raw, directory, version, autostart] = await Promise.all([
          invoke<DownloadInfo[]>("list_downloads"),
          invoke<Record<string, unknown>>("get_settings"),
          invoke<string>("default_download_dir"),
          invoke<string>("engine_version"),
          invoke<boolean>("get_autostart").catch(() => false),
        ]);
        if (disposed) return;
        setDownloads(list);
        setEngineVersion(version);
        const parsed = readSettings(raw, directory);
        parsed.autostart = Boolean(autostart);
        setSettings((current) => ({ ...current, ...parsed }));
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
          if (payload.type === "completed") {
            if (settingsRef.current.notifications) {
              notify("success", `Completed: ${payload.download.fileName}`);
            }
            setActiveProgressId((current) => (current === payload.download.id ? null : current));
            setCompletedDownload(payload.download);
          }
        });

        unlistenBrowser = await listen<DownloadInfo>("browser://download_added", (event) => {
          setActiveProgressId(event.payload.id);
        });

        unlistenMediaGrab = await listen<{ url: string; title?: string }>("browser://media_grab", (event) => {
          const { url } = event.payload;
          if (url) {
            setMediaDialogUrl(url);
            setDialog("media");
          }
        });
      } catch {
        /* event bridge unavailable outside Tauri */
      }
    })();

    return () => {
      disposed = true;
      unlisten?.();
      unlistenBrowser?.();
      unlistenMediaGrab?.();
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
      if (dialogRef.current || fileInfoUrl) return;
      try {
        const text = (await readText())?.trim();
        if (
          !text ||
          text === clipboardSeen.current ||
          text.length > 2048 ||
          !isDownloadableUrl(text)
        ) {
          return;
        }
        clipboardSeen.current = text;
        setClipboardDetectedUrl(text);
      } catch {
        /* clipboard permission not granted */
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [settings.clipboardMonitor, fileInfoUrl]);

  useEffect(() => {
    // Check for updates on startup
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch("https://api.github.com/repos/mahabubaabir/nextdm/releases/latest", {
          headers: { Accept: "application/vnd.github.v3+json" },
        });
        if (!res.ok) return;
        const data = await res.json();
        const tag = (data.tag_name || "").replace(/^v/, "");
        const current = "0.2.0";
        const tagParts = tag.split(".").map(Number);
        const curParts = current.split(".").map(Number);
        let isNewer = false;
        for (let i = 0; i < Math.max(tagParts.length, curParts.length); i++) {
          const t = tagParts[i] || 0;
          const c = curParts[i] || 0;
          if (t > c) {
            isNewer = true;
            break;
          }
          if (t < c) break;
        }
        if (isNewer) {
          notify("info", `Update available: NextDM v${tag}. Open Options > About to download.`);
        }
      } catch {
        /* offline or network error */
      }
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [notify]);

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

  const activeProgressDownload = useMemo(() => {
    if (!activeProgressId) return null;
    return downloads.find((d) => d.id === activeProgressId) ?? null;
  }, [downloads, activeProgressId]);

  const openAdd = (urls = "") => {
    setFileInfoUrl(urls);
  };

  const openBatchAdd = (urls = "") => {
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
      setCompletedDownload(download);
      return;
    }
    setActiveProgressId(download.id);
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
        invoke("set_setting", { key: "video_badge_style", value: next.videoBadgeStyle }),
        invoke("set_setting", { key: "compact_view", value: next.compactView }),
        invoke("set_autostart", { enabled: next.autostart }).catch(() => undefined),
        invoke("set_max_connections", { connections: next.maxConnections }),
        invoke("set_speed_limit", { bytesPerSecond: next.speedLimit }),
        invoke("set_default_dir", { path: next.defaultDir }),
      ]);
      notify("success", "Options saved.");
    } catch (error) {
      notify("error", String(error));
    }
  };

  const startMediaDownload = (
    url: string,
    formatId: string | null,
    fileStem: string,
    expectedSize?: number | null,
  ) => {
    notify("info", `Downloading media: ${fileStem || "video"}...`);
    invoke<DownloadInfo>("media_download", {
      url,
      formatId,
      fileStem,
      directory: settings.defaultDir || null,
      expectedSize: expectedSize ?? null,
    })
      .then((info) => {
        setDownloads((current) => upsert(current, info));
        setActiveProgressId(info.id);
      })
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
        { label: "Add URL (Download File Info)…", shortcut: "Ctrl+N", onClick: () => openAdd() },
        { label: "Batch Add URLs…", onClick: () => openBatchAdd() },
        { label: "Download Video…", onClick: () => { setMediaDialogUrl(""); setDialog("media"); } },
        { separator: true },
        { label: "Open Download Folder", onClick: downloadFolder },
        { separator: true },
        { label: "Exit", onClick: () => invoke("quit_app_cmd") },
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
        { label: "Liquid Glass", checked: settings.theme === "glass", onClick: () => changeTheme("glass") },
        { label: "Material 3 Expressive theme", checked: settings.theme === "material3", onClick: () => changeTheme("material3") },
        {
          label: "Follow system theme",
          checked: settings.theme === "system",
          onClick: () => changeTheme("system"),
        },
        { separator: true },
        {
          label: "Compact view (compact icons)",
          checked: settings.compactView,
          onClick: () => {
            const nextCompact = !settings.compactView;
            setSettings((cur) => ({ ...cur, compactView: nextCompact }));
            invoke("set_setting", { key: "compact_view", value: nextCompact }).catch(() => undefined);
          },
        },
        {
          label: "In-Browser Video Grabber: Compact Icon",
          checked: settings.videoBadgeStyle === "compact",
          onClick: () => {
            setSettings((cur) => ({ ...cur, videoBadgeStyle: "compact" }));
            invoke("set_setting", { key: "video_badge_style", value: "compact" }).catch(() => undefined);
            notify("info", "Browser video grabber set to Compact Icon.");
          },
        },
        {
          label: "In-Browser Video Grabber: Full Button",
          checked: settings.videoBadgeStyle === "full",
          onClick: () => {
            setSettings((cur) => ({ ...cur, videoBadgeStyle: "full" }));
            invoke("set_setting", { key: "video_badge_style", value: "full" }).catch(() => undefined);
            notify("info", "Browser video grabber set to Full Button.");
          },
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
        { label: "Update Manager…", onClick: () => setUpdateManagerOpen(true) },
        { label: "About NextDM", onClick: () => setDialog("about") },
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
        {
          label: "Download Progress & Segments…",
          icon: "download",
          onClick: () => setActiveProgressId(contextMenu.download.id),
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
      className={cx("app", settings.compactView && "compact-mode")}
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

      <DownloadFileInfoDialog
        open={fileInfoUrl !== null}
        initialUrl={fileInfoUrl ?? ""}
        defaultDir={settings.defaultDir}
        categoryRouting={settings.categoryRouting ?? true}
        maxConnections={settings.maxConnections}
        onClose={() => setFileInfoUrl(null)}
        onOpenMediaExtractor={(url) => {
          setFileInfoUrl(null);
          setMediaDialogUrl(url);
          setDialog("media");
        }}
        onStart={(download) => {
          setFileInfoUrl(null);
          setActiveProgressId(download.id);
        }}
        onLater={(download) => {
          setFileInfoUrl(null);
          notify("info", `Queued: ${download.fileName}`);
        }}
      />

      <DownloadProgressDialog
        open={activeProgressDownload !== null}
        download={activeProgressDownload}
        onClose={() => setActiveProgressId(null)}
        onPause={(id) => {
          invoke("pause_download", { id }).catch((err) => notify("error", String(err)));
        }}
        onResume={(id) => {
          invoke("resume_download", { id }).catch((err) => notify("error", String(err)));
        }}
        onCancel={(id) => {
          invoke("cancel_download", { id }).catch((err) => notify("error", String(err)));
          setActiveProgressId(null);
        }}
      />

      <DownloadCompleteDialog
        open={completedDownload !== null}
        download={completedDownload}
        onClose={() => setCompletedDownload(null)}
      />

      {clipboardDetectedUrl && (
        <div
          style={{
            position: "fixed",
            bottom: "36px",
            right: "24px",
            background: "var(--bg-elevated, #1f2937)",
            color: "var(--text-color, #ffffff)",
            border: "1px solid var(--border-color, rgba(255, 255, 255, 0.15))",
            borderRadius: "10px",
            padding: "12px 16px",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.35)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            gap: "12px",
            maxWidth: "480px",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "2px", overflow: "hidden" }}>
            <span style={{ fontSize: "11px", color: "var(--text-muted, #9ca3af)", fontWeight: 600 }}>
              📥 Download link detected in clipboard
            </span>
            <span
              style={{
                fontSize: "12px",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: "300px",
              }}
              title={clipboardDetectedUrl}
            >
              {clipboardDetectedUrl}
            </span>
          </div>

          <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
            <button
              type="button"
              className="btn btn-primary"
              style={{ padding: "4px 10px", fontSize: "12px", fontWeight: 600 }}
              onClick={() => {
                const u = clipboardDetectedUrl;
                setClipboardDetectedUrl(null);
                if (isMediaSiteUrl(u)) {
                  setMediaDialogUrl(u);
                  setDialog("media");
                } else {
                  setFileInfoUrl(u);
                }
              }}
            >
              Download
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: "4px 8px", fontSize: "12px" }}
              onClick={() => setClipboardDetectedUrl(null)}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <OptionsDialog
        open={dialog === "options"}
        settings={settings}
        onClose={closeOptions}
        onSave={saveOptions}
        onPreviewTheme={(theme) => setSettings((current) => ({ ...current, theme }))}
        onOpenUpdateManager={() => {
          closeOptions();
          setUpdateManagerOpen(true);
        }}
      />

      <MediaDialog
        open={dialog === "media"}
        initialUrl={mediaDialogUrl}
        defaultDir={settings.defaultDir}
        onClose={() => {
          setMediaDialogUrl("");
          setDialog(null);
        }}
        onDownload={startMediaDownload}
      />

      {dialog === "about" ? (
        <Modal
          title="About NextDM"
          icon={<Logo size={18} />}
          width={680}
          onClose={() => setDialog(null)}
          footer={
            <div className="modal-actions">
              <button className="primary-button" onClick={() => setDialog(null)}>
                Close
              </button>
            </div>
          }
        >
          <AboutView
            engineVersion={engineVersion}
            onOpenUpdateManager={() => {
              setDialog(null);
              setUpdateManagerOpen(true);
            }}
          />
        </Modal>
      ) : null}

      <UpdateManagerDialog
        open={updateManagerOpen}
        currentVersion={engineVersion}
        onClose={() => setUpdateManagerOpen(false)}
        onOpenOptions={openOptions}
      />

      <Toasts toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    </div>
  );
}

export default App;
