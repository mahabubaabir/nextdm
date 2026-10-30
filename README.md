# NextDM

<p align="center">
  <strong>The Modern, High-Speed Download Manager for Linux</strong><br>
  <em>Crafted by <strong>Marbor Tech by Mahabub H. Aabir</strong></em>
</p>

<p align="center">
  <a href="https://github.com/mahabubaabir/nextdm/releases/latest"><img src="https://img.shields.io/badge/Release-v0.1.0--amd64-blue.svg?style=flat-square" alt="Release"></a>
  <img src="https://img.shields.io/badge/Platform-Linux%20Mint%20%7C%20Ubuntu%20%7C%20Debian-emerald.svg?style=flat-square" alt="Platform">
  <img src="https://img.shields.io/badge/License-GPL--3.0-orange.svg?style=flat-square" alt="License">
  <img src="https://img.shields.io/badge/Privacy-100%25%20Local-purple.svg?style=flat-square" alt="Privacy">
</p>

---

![NextDM](docs/screenshots/nextdm-window.png)

NextDM is a fast, native download manager built specifically for Linux (Linux Mint, Ubuntu, Debian, and derivatives). It provides segmented multi-connection acceleration, intelligent download interception, in-browser floating video downloader, and seamless background tray integration — without ads, telemetry, or account requirements.

---

## ⚡ Quick Download & Install (For Everyone)

The easiest way to install NextDM on Linux Mint, Ubuntu, or Debian is using the pre-built `.deb` package:

### 1. Download the Debian Package
👉 **[Download NextDM 0.1.0 (.deb)](https://github.com/mahabubaabir/nextdm/releases/download/v0.1.0/NextDM_0.1.0_amd64.deb)**

### 2. Install with One Command
Open your terminal in your download folder and run:
```bash
sudo dpkg -i NextDM_0.1.0_amd64.deb
```
*(Or simply double-click the `.deb` file in your file manager to install via the Software Manager).*

### 3. Launch & Enjoy!
Launch **NextDM** from your application menu or search bar. NextDM automatically registers system tray icons, autostart options, and browser integration.

---

## 🌟 Highlights & Key Features

- ⚡ **Multi-Connection Segmented Downloads**: Accelerate transfers with up to 32 parallel threads per file.
- 🎬 **In-Browser Video Grabber**: Floating download badge above web video players (YouTube, Facebook, Twitter, TikTok, and HTML5 players). Choose between a **Full Panel** or **Compact Icon** (like IDM's mini badge) right from the app.
- 📋 **Pre-Download File Inspector ("Download File Info")**: Detects file sizes, file types, resume support, and suggests download folders before you start.
- 🎨 **Adaptive Theme Engine**:
  - **Liquid Glass**: Trending frosted translucent glassmorphism with dynamic gradients.
  - **Material 3 Expressive**: Modern rounded surface styling.
  - **Classic Linux Mint** & **Modern Dark Mode**.
  - **Monochrome Transparent Iconography**: Clean, minimalist vector icons that adapt seamlessly to light and dark themes.
- 🔄 **Smart Resume & Crash Recovery**: Interrupted transfers automatically resume from the last byte without corrupting files.
- 🚀 **Background System Tray & Autostart**: NextDM stays quietly in your system tray catching downloads and launches automatically on system boot.
- 🌐 **Browser Integration**: Automatic takeover for Chromium, Google Chrome, Brave, Microsoft Edge, Vivaldi, and Mozilla Firefox.
- 🔒 **100% Private & Free**: Zero tracking, zero ads, zero cloud telemetry. All settings and database files stay on your machine.

---

## 🌐 Browser Integration Setup

NextDM integrates with your favorite web browsers using native messaging:

1. In NextDM, open **Options → Browser** and click **Install for Chromium and Firefox**.
2. Load the companion extension once:
   - **Chrome / Chromium / Brave / Edge / Vivaldi**: Go to `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select `~/.local/share/nextdm/browser-extension/chromium`.
   - **Firefox**: Go to `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on**, and choose `~/.local/share/nextdm/browser-extension/firefox/manifest.json`.

---

## 🛠️ System Requirements

- **Supported OS**: Linux Mint 21+, Ubuntu 22.04+, Debian 12+, or any modern GTK3 Linux distribution.
- **Optional Helper**: `yt-dlp` and `ffmpeg` for extracting and muxing high-resolution streams from video sites (`sudo apt install yt-dlp ffmpeg`).

---

<details>
<summary><b>🔧 Building from Source (For Developers)</b></summary>

### Prerequisites
- Rust 1.85+ (`rustup`)
- Node.js 20+
- System libraries:
  ```bash
  sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev \
    libayatana-appindicator3-dev patchelf build-essential curl wget file
  ```

### Development
```bash
git clone https://github.com/mahabubaabir/nextdm.git
cd nextdm/apps/desktop
npm install
npm run tauri dev
```

### Build .deb Package
```bash
npm run tauri build -- --bundles deb
```
</details>

---

## 📄 License & Credits

- Licensed under **GPL-3.0-or-later**.
- NextDM is created and maintained by **Marbor Tech by Mahabub H. Aabir**.
