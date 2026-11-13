/* NextDM browser integration — Chromium and Firefox.
 *
 * Direct download links are cancelled in the browser and handed to the
 * NextDM native messaging host together with cookies and the page referrer.
 */

const HOST_NAME = "com.nextdm.host";
const OWN_EXTENSION_ID = "ciljeaclhfhipchfaocjmoanpbacibli";
const reopening = new Set();
const tabMediaStreams = new Map();

if (typeof chrome !== "undefined" && chrome.webRequest && chrome.webRequest.onBeforeRequest) {
  try {
    chrome.webRequest.onBeforeRequest.addListener(
      (details) => {
        if (!details || !details.url || details.tabId === undefined || details.tabId < 0) return;
        const lower = details.url.toLowerCase();
        if (
          lower.includes(".m3u8") ||
          lower.includes(".mpd") ||
          lower.includes("fast.wistia.net/embed/iframe") ||
          lower.includes("fast.wistia.com/embed/medias")
        ) {
          tabMediaStreams.set(details.tabId, details.url);
        }
      },
      { urls: ["<all_urls>"] }
    );
    if (chrome.tabs && chrome.tabs.onRemoved) {
      chrome.tabs.onRemoved.addListener((tabId) => {
        tabMediaStreams.delete(tabId);
      });
    }
  } catch (e) {
    /* webRequest fallback */
  }
}

function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ enabled: true }, (value) => resolve(value));
  });
}

function nativeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(HOST_NAME, message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      if (!response) {
        reject(new Error("NextDM did not respond"));
        return;
      }
      if (!response.ok) {
        reject(new Error(response.error || "NextDM rejected the request"));
        return;
      }
      resolve(response);
    });
  });
}

function syncHostSettings() {
  nativeMessage({ type: "ping" })
    .then((res) => {
      if (res && res.data && res.data.badgeStyle) {
        chrome.storage.local.set({ badgeStyle: res.data.badgeStyle });
      }
    })
    .catch(() => undefined);
}

syncHostSettings();
setInterval(syncHostSettings, 15000);

function cookiesFor(url) {
  return new Promise((resolve) => {
    chrome.cookies.getAll({ url }, (cookies) => {
      if (chrome.runtime.lastError || !cookies || cookies.length === 0) {
        resolve(null);
        return;
      }
      resolve(cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "));
    });
  });
}

function activeTabUrl() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      resolve(tabs && tabs[0] ? tabs[0].url : null);
    });
  });
}

function flashBadge(text) {
  try {
    chrome.action.setBadgeBackgroundColor({ color: "#1f6fdd" });
    chrome.action.setBadgeText({ text });
    setTimeout(() => chrome.action.setBadgeText({ text: "" }), 2500);
  } catch (error) {
    /* badge is best effort */
  }
}

function isMediaSite(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  return (
    lower.includes("youtube.com") ||
    lower.includes("youtu.be") ||
    lower.includes("facebook.com") ||
    lower.includes("fb.watch") ||
    lower.includes("instagram.com") ||
    lower.includes("tiktok.com") ||
    lower.includes("twitter.com") ||
    lower.includes("x.com") ||
    lower.includes("vimeo.com") ||
    lower.includes("dailymotion.com") ||
    lower.includes("twitch.tv") ||
    lower.includes("bilibili.com") ||
    lower.includes("soundcloud.com") ||
    lower.includes("wistia.com") ||
    lower.includes("wistia.net") ||
    lower.includes("fast.wistia") ||
    lower.includes("loom.com") ||
    lower.includes("rumble.com") ||
    lower.includes("streamtape.com") ||
    lower.includes(".m3u8") ||
    lower.includes(".mpd") ||
    lower.includes(".f4m") ||
    lower.includes(".ism/")
  );
}

async function handoff({ url, filename, referrer, isMedia }) {
  const settings = await loadSettings();
  if (!settings.enabled) return false;
  if (!/^https?:/i.test(url)) return false;

  const cookies = await cookiesFor(url);
  let pageUrl = referrer || null;
  if (!pageUrl) pageUrl = await activeTabUrl();

  const isMediaDownload = Boolean(isMedia) || isMediaSite(url) || (pageUrl && isMediaSite(pageUrl));

  await nativeMessage({
    type: "addDownload",
    url,
    filename: filename || null,
    fileName: filename || null,
    referrer: pageUrl,
    cookies,
    headers: {},
    isMedia: isMediaDownload,
    is_media: isMediaDownload,
  });
  return true;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "nextdm-download",
      title: "Download with NextDM",
      contexts: ["link", "video", "audio", "image"],
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "nextdm-download") return;
  const url = info.linkUrl || info.srcUrl || (tab && tab.url);
  if (!url) return;
  const isMedia = info.mediaType === "video" || info.mediaType === "audio" || isMediaSite(url);
  try {
    const accepted = await handoff({
      url,
      filename: null,
      referrer: info.pageUrl || (tab && tab.url),
      isMedia,
    });
    if (accepted) flashBadge("✓");
  } catch (error) {
    console.warn("NextDM handoff failed:", error);
    flashBadge("!");
  }
});

chrome.downloads.onCreated.addListener(async (item) => {
  if (!item || !item.url) return;
  const url = item.finalUrl || item.url;
  if (!/^https?:/i.test(url)) return;
  if (item.byExtensionId === OWN_EXTENSION_ID) return;
  if (reopening.has(url)) {
    reopening.delete(url);
    return;
  }

  const settings = await loadSettings();
  if (!settings.enabled) return;

  chrome.downloads.cancel(item.id, () => {
    chrome.downloads.erase({ id: item.id }, () => void chrome.runtime.lastError);
  });

  const filename = item.filename ? item.filename.split(/[\\/]/).pop() : null;
  try {
    await handoff({ url, filename, referrer: item.referrer });
    flashBadge("✓");
  } catch (error) {
    console.warn("NextDM handoff failed, retrying in the browser:", error);
    flashBadge("!");
    reopening.add(url);
    chrome.downloads.download(
      { url, conflictAction: "uniquify" },
      () => void chrome.runtime.lastError,
    );
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return undefined;

  if (message.type === "getStatus") {
    nativeMessage({ type: "getVersion" })
      .then((response) => sendResponse({ ok: true, version: response.version }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "setEnabled") {
    chrome.storage.local.set({ enabled: Boolean(message.enabled) }, () =>
      sendResponse({ ok: true }),
    );
    return true;
  }

  if (message.type === "handoff") {
    handoff(message)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "nextdm_grab_media") {
    let finalUrl = message.url;
    if (finalUrl === message.pageUrl && sender && sender.tab && sender.tab.id !== undefined) {
      const captured = tabMediaStreams.get(sender.tab.id);
      if (captured) {
        finalUrl = captured;
      }
    }

    handoff({
      url: finalUrl,
      referrer: message.pageUrl,
      filename: message.title ? `${message.title.replace(/[\\/:*?"<>|]/g, "_")}.mp4` : null,
      isMedia: true,
    })
      .then(() => {
        flashBadge("✓");
        sendResponse({ ok: true });
      })
      .catch((error) => {
        flashBadge("!");
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  }

  return undefined;
});
