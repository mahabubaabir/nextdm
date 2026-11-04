========================================================================
NextDM — Browser Integration Guide for Windows (Firefox & Chrome/Edge)
========================================================================

If your browser extension shows:
"No such native application com.nextdm.host"

This happens when Windows does not yet have the native messaging manifest
and registry keys registered for Firefox or Chromium.

NextDM 0.1.0+ handles this in 3 easy ways:

------------------------------------------------------------------------
METHOD 1 (Automatic — Recommended)
------------------------------------------------------------------------
1. Simply start NextDM.
2. NextDM automatically registers the native messaging host manifests
   and Windows Registry keys in the background on startup.
3. Restart Firefox or Chrome/Edge.

------------------------------------------------------------------------
METHOD 2 (One-Click Setup Script)
------------------------------------------------------------------------
1. Double-click "setup-host-windows.bat".
2. It detects your NextDM installation, creates the JSON manifest files,
   and registers them for Firefox, Chrome, Edge, Brave, and Vivaldi.
3. Restart your browser.

------------------------------------------------------------------------
METHOD 3 (Inside NextDM Settings)
------------------------------------------------------------------------
1. Open NextDM.
2. Click "Options" (gear icon) -> "Browser Integration".
3. Click "Install Integration".
4. Restart your browser.

Official Browser Extensions:
- Firefox AMO: https://addons.mozilla.org/en-US/firefox/addon/nextdm-integration/
- Chrome/Edge: extensions/chromium (or load unpacked from AppData\Roaming\nextdm\browser-extension\chromium)
========================================================================
