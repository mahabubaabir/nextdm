# NextDM

A free, native download manager for Linux with an IDM-style workflow: segmented
transfers, pause/resume, browser takeover, categories and site media downloads.
No ads, no telemetry, no account.

NextDM is an independent open-source project. It is not affiliated with, and
contains no code or assets from, Internet Download Manager or Tonec Inc.

![NextDM](docs/screenshot-main.png)

## Features

- **Segmented HTTP downloads** with up to 32 parallel connections per file.
- **Resume** after pause, network loss, crash or restart. Partial files are
  validated against the remote ETag / Last-Modified value before continuing.
- **Pause, resume, cancel and remove** individually or in bulk.
- **Browser takeover** for Chromium, Chrome, Brave, Edge, Vivaldi and Firefox.
  Cookies and the page referrer are handed to NextDM so authenticated and
  hotlink-protected links work. If NextDM is unreachable, the browser keeps the
  download.
- **Media downloads** from YouTube, Facebook and thousands of other sites via
  `yt-dlp`, with a quality picker and automatic audio/video merging.
- **Categories, search, sorting and filters** for documents, music, video,
  programs, compressed files and images.
- **Global speed limiter** and configurable default connection count.
- **Clipboard monitoring** and drag-and-drop links.
- **Light, dark and system themes** with a compact desktop layout.
- **Everything local.** The database and settings live under
  `~/.local/share/com.nextdm.app`. No data leaves the machine except the
  transfers you start.

## Requirements

Runtime:

- Linux with GTK 3 and WebKitGTK 4.1 (Linux Mint 22+, Ubuntu 24.04+, Debian 13+,
  Fedora 40+ and similar).
- Optional: `yt-dlp` and `ffmpeg` for site media downloads. NextDM uses its own
  engine for direct links; media sites are handled by `yt-dlp` because their
  extraction logic changes constantly.

Build:

- Rust 1.85+ (`rustup`)
- Node.js 20+
- Development packages for Tauri 2:

```bash
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev \
  libayatana-appindicator3-dev patchelf build-essential curl wget file
```

## Build and run

```bash
git clone https://github.com/mahabubaabir/nextdm.git
cd nextdm/apps/desktop
npm install
npm run tauri dev
```

Create release bundles (`.deb`, AppImage and others enabled by your toolchain):

```bash
npm run tauri build
```

Artifacts are written to `apps/desktop/src-tauri/target/release/bundle/`.

## Browser integration

Open **Options → Browser** and click **Install for Chromium and Firefox**.
NextDM writes the native-messaging manifests and unpacks the extensions under
`~/.local/share/nextdm/`.

Then load the extension once per browser:

- **Chromium / Chrome / Brave / Edge / Vivaldi**: open `chrome://extensions`,
  enable **Developer mode**, choose **Load unpacked** and select
  `~/.local/share/nextdm/browser-extension/chromium`.
- **Firefox**: open `about:debugging#/runtime/this-firefox`, choose
  **Load Temporary Add-on** and select
  `~/.local/share/nextdm/browser-extension/firefox/manifest.json`. Firefox
  removes temporary add-ons on restart; re-load it after restarting, or install
  a signed build from AMO once published.

Restart the browser after installing the native host. The extension cancels
browser downloads, forwards the URL, cookies and referrer to NextDM, and falls
back to the normal browser download if NextDM cannot be reached. A
**Download with NextDM** item is also added to the page context menu.

The native host is a small stdio bridge. It talks to the running app over a
private Unix socket in `$XDG_RUNTIME_DIR` (fallback `~/.cache/nextdm/`) and
never opens a network port.

## Media downloads

Install the helper tools:

```bash
sudo apt install yt-dlp ffmpeg
# or a newer yt-dlp:
python3 -m pip install -U yt-dlp
```

Use **Media** in the toolbar (or **File → Download Video…**), paste a link,
press **Analyze**, choose a quality and download. `ffmpeg` is required when a
site serves video and audio as separate streams.

Set `NEXTDM_YTDLP=/path/to/yt-dlp` to use a specific binary.

## Architecture

```
apps/desktop        Tauri 2 shell + React/TypeScript UI
crates/engine       Segmented HTTP engine, SQLite persistence, resume, limits
crates/media        yt-dlp probe/download bridge
crates/browser-host Native-messaging framing, local IPC and host entrypoint
extensions/         Chromium (MV3) and Firefox extensions
```

The engine is UI-independent and has integration tests that run against a local
HTTP server supporting and ignoring range requests. The Tauri layer forwards
engine events to React and exposes commands for downloads, settings, media and
browser integration.

## Tests

```bash
cargo test -p nextdm-engine
cargo check --workspace
cd apps/desktop && npm run build
```

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).

NextDM is provided as-is, without warranty. Downloading media may be subject to
the terms of service of the site you use.
