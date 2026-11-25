# Changelog

All notable changes to the **NextDM** project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.2.4] — 2026-11-25

### 🛠 Fixed

- **Fixed Browser Extension Handoff Rejection (`duplicate field`):** Both Chromium and Firefox extensions previously sent duplicate camelCase and snake_case keys (`filename` + `fileName` and `isMedia` + `is_media`), causing `serde` deserialization in `HostRequest::AddDownload` to reject every browser handoff before reaching NextDM. `protocol.rs` now accepts legacy duplicate fields cleanly (immediately unblocking installed `0.2.1`–`0.2.3` extensions too), and both extensions now send canonical camelCase payloads.
- **Non-Destructive Browser Fallback:** `chrome.downloads.onCreated` now pauses the browser download while handing off to NextDM, cancelling it only after NextDM confirms and resuming the original browser download cleanly on handoff failure instead of cancelling prematurely or losing filenames.
- **Range-Rejected Origin Probe Fallback & Browser User-Agent:** `download::probe()` now falls back to a plain `GET` when servers return `400`/`403`/`405`/`416`/`501` on `Range: bytes=0-0`, and `EngineConfig` uses a standard Chrome `User-Agent` without a custom `NextDM/` token.
- **Release Asset Cleanup:** Updated `build-linux.yml` to upload only the current release's `.deb` and binary artifacts rather than historical `dist-linux/*.deb` packages.

### 🧪 Tests

- Added regression tests covering legacy duplicate camelCase/snake_case `HostRequest::AddDownload` deserialization and range-rejected `403` origin fallback probing.

## [0.2.3] — 2026-11-25

### 🛠 Fixed

- **Fixed `yt-dlp` + `ffmpeg` Merge Crash:** Split `--postprocessor-args` into separate `Merger+ffmpeg_o` and `VideoRemuxer+ffmpeg_o` arguments so `yt-dlp` never passes a raw directive to `ffmpeg` (`Error opening output files: Invalid argument`), added proper `audio_only` handling without forced MP4 remuxing, replaced shell-quoted `--exec` with `--print after_move`, and made stderr/error tailing UTF-8 char-boundary safe.
- **Category Routing & Media Lifecycle Guards:** `media_download` now honors `category_routing` (`Video/` vs `Music/`) and selected audio container extensions, while `complete_media_download`, `update_media_progress`, and `fail_media_download` prevent removed or cancelled media jobs from resurrecting or reverting to `Error`.
- **Firefox XDG Native Host & MV3 Site Permissions:** Registered Firefox native messaging manifests in both `~/.mozilla/native-messaging-hosts` and Firefox 160+ XDG `~/.config/mozilla/native-messaging-hosts`, fixed Firefox `OWN_EXTENSION_ID`, stopped classifying normal file downloads triggered on media pages as media streams, forwarded `userAgent` on handoff, allowed popup `Open NextDM` to launch the app via `nextdm-host`, and added an in-popup **Enable Site Access** prompt when MV3 `<all_urls>` host permission is missing.
- **Settings Backup Restore & Error Toasts:** Fixed `OptionsDialog` passing `{ jsonStr }` instead of `{ json }` to `import_settings_json` and reloaded normalized settings from `get_settings` instead of overwriting UI keys, and surfaced `media://status` errors and `browser://download_error` notifications in `App.tsx`.
- **Media Downloads No Longer Resume as HTTP:** Downloads started from the Video Extractor (`yt-dlp`) are tagged as media jobs in the database and fail cleanly after restart/update with an explanation instead of being replayed through the HTTP engine.
- **Sanitized Media File Names:** Illegal path characters (`/`, `\`, `:`, etc.) and control characters are stripped before temporary or output paths are constructed.
- **HTML Guard Now Covers `.nextdm` Temp Files:** Rejects `text/html` responses for media filenames regardless of `.nextdm` / `.part` suffix.
- **Accurate Update Checker & Hardened Installer:** Compares releases against the real running engine version, validates exact `.deb` filenames across `~/Downloads` and `~/Downloads/Programs`, uses `curl -fL --retry 2`, and checks archive magic before launch.

### 🧪 Tests

- Added live merged YouTube Shorts download integration coverage (`crates/media`) plus regression tests for interrupted, removed, and cancelled media jobs and `.nextdm` HTML protection (`crates/engine`).

## [0.2.2] — 2026-11-21

### 🛠 Fixed

- **React Error #310 in Settings:** Moved backup and restore hooks to the top level of the component so opening the Settings dialog no longer crashes with a hook-order error.
- Refreshed the Chromium and Firefox extension bundles and the APT repository for the v0.2.2 release.

## [0.2.1] — 2026-11-21

### 🛠 Fixed

- **YouTube Cookie Conflict:** Resolved a cookie-argument conflict in the yt-dlp media bridge that could break YouTube extraction when browser cookies were supplied.
- **Video Badge Positioning:** Moved the floating in-browser video badge away from the player's information button and added drag support so it can be repositioned freely.
- Refreshed the Chromium and Firefox extension bundles and the APT repository for the v0.2.1 release.

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

