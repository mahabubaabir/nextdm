# Changelog

All notable changes to the **NextDM** project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.2.0] — 2026-11-13

### 🎬 Embedded Media Extraction & Engine Guard
- **Deep DOM Video Inspection:** Extended the in-browser video grabber across both Chromium and Firefox extensions to detect embedded players from Wistia (`wistia_async_<id>`), Vimeo (`player.vimeo.com`), Loom, and YouTube iframes.
- **Resource-Timing HLS/DASH Discovery:** Captured active `.m3u8` and `.mpd` streaming manifests dynamically from `performance.getEntriesByType("resource")` and browser `webRequest` network events so protected or blob-backed embedded players (like course platforms, Kajabi, Urban Forex) are immediately identified with their direct playable stream URLs.
- **Engine Guard Against Downloading Webpages as Media:** Prevented servers from serving HTML error/login/player pages as `.mp4`, `.mkv`, etc. The download engine verifies content types on stream headers, immediately halts `text/html` responses when targeting media files, and prompts users with a 1-click transition to the Video Extractor.
- **IPC Protocol Field Deserialization:** Fixed Serde camelCase/snake_case mapping for `isMedia` / `is_media`, `fileName` / `filename`, and `userAgent` / `user_agent` to ensure browser extension flags are never dropped.

### 🐧 Linux Mint Update Manager (mintupdate) & APT Repository
- **Native APT Repository Structure:** Standard Debian repository structure under `packaging/apt/` with `dists/stable/main/binary-amd64/Packages` and `Release` indices.
- **Live Update Detection in Linux Mint Update Manager:** Linux Mint's native Update Manager (`mintupdate`) detects `next-dm` upgrades directly with package name, description, and version comparison.
- **Debian Changelog Tracking:** Added standard Debian changelog integration (`changelog.Debian.gz`) inside the debian package for system package managers.

## [0.1.1] — 2026-11-07

### 🎬 Media Playback & Stream Extraction
- **Fixed Unplayable Video Downloads:** Addressed issue where embedded videos on random websites downloaded unplayable 1KB files or raw transport streams. If an embedded player uses `blob:` URLs or fragmented `.ts` chunk segments, the extension floating grabber now automatically falls back to extracting the high-quality stream directly from the parent webpage URL.
- **Universal MP4 Remuxing:** Configured `yt-dlp` and FFmpeg post-processing with `--remux-video mp4` and `-c:v copy -c:a aac -movflags +faststart` to guarantee all video and audio streams are remuxed into universally playable MP4 containers compatible with all native media players.
- **Streaming Playlist Interception:** Added direct routing for `.m3u8` (HLS), `.mpd` (DASH), `.f4m`, and `.ism/` manifests into the high-speed media extractor rather than downloading raw text playlist files via segmented HTTP.
- **Automated Windows `yt-dlp` Installer:** Integrated automated background detection and silent download of official `yt-dlp.exe` on Windows machines into `%LOCALAPPDATA%\nextdm\bin\yt-dlp.exe` with console window suppression (`CREATE_NO_WINDOW`).

### 🎨 Liquid Glass Design Refinement
- **Removed Trend Labels:** Cleaned up theme selector labels, removing `"(Trend)"` and `"(Modern Trend)"` to present a unified `"Liquid Glass"` theme.
- **True Frosted Glass Controls:** Upgraded all buttons (`.tool-button`, `.primary-button`, `.secondary-button`), text inputs, dropdown menus, and sidebar items under the glass theme with authentic translucent glass styling, `backdrop-filter: blur(14px)`, specular top borders, and soft glowing hover effects.

### 💾 Settings Backup & Restore
- **Portable JSON Backup:** Added native export and import commands (`export_settings_json` and `import_settings_json`).
- **Dedicated Backup Tab:** Added a dedicated **Backup & Restore** tab in the Options dialog allowing users to export their entire configuration to `nextdm-settings-backup-YYYY-MM-DD.json` and restore it onto a new computer with a single click.

### 📁 Category Folder Routing
- **Automatic Subfolder Sorting:** Added automatic routing of incoming downloads into their designated category folders (`Video/`, `Compressed/`, `Documents/`, `Music/`, `Programs/`, `Images/`) within the primary download directory.
- **Dynamic Popup Directory Switching:** In the pre-download inspection popup (`Download File Info`), changing the Category dropdown now dynamically updates the save folder in real time, while still allowing manual folder browsing.
- **Toggle Setting:** Added a user preference toggle under General and Downloads settings to enable or disable automatic category routing.

### 🚀 Auto-Update Checker & GitHub Sync
- **Startup Update Notifications:** NextDM now checks GitHub releases in the background upon launch and alerts users when a newer release is published.
- **Interactive Update Checker:** Added a manual **"Check for Updates"** button in **Options > About** with instant download links.
- **Automated Release Workflow:** Updated GitHub Actions release pipelines to support automated builds on version tags (`v*`).

---

## [0.1.0] — 2026-10-31

### Initial Release
- **Segmented Download Engine:** High-performance multi-connection segmented downloads supporting up to 32 parallel threads with dynamic range splitting and crash-safe partial resumption.
- **Pre-Download File Inspector:** Real-time HTTP HEAD/GET probing detecting file sizes, server resume capabilities, and suggested filenames before downloading.
- **Browser Native Messaging Host:** Standalone local native messaging host (`com.nextdm.host`) for Mozilla Firefox and Chromium-based browsers (Chrome, Brave, Edge, Vivaldi).
- **In-Browser Video Grabber:** Floating download badge for video players across YouTube, Facebook, Twitter, and HTML5 video sites, with Mini Grabber and Full Button modes.
- **Themes & Visuals:** Initial theme collection including Classic Linux Mint, Modern Dark, Liquid Glass, and Material 3 Expressive, with custom transparent monochrome vector iconography.
- **Packaging:** Debian package (`.deb`) for Linux Mint / Ubuntu and Windows Portable / NSIS setup installers.

