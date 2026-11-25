const enabled = document.getElementById("enabled");
const status = document.getElementById("status");
const openApp = document.getElementById("open-app");
const permBanner = document.getElementById("perm-banner");
const grantAccess = document.getElementById("grant-access");

chrome.storage.local.get({ enabled: true }, (value) => {
  enabled.checked = Boolean(value.enabled);
});

enabled.addEventListener("change", () => {
  chrome.storage.local.set({ enabled: enabled.checked });
  chrome.runtime.sendMessage({ type: "setEnabled", enabled: enabled.checked });
});

function setPermBannerVisible(visible) {
  if (!permBanner) return;
  permBanner.classList.toggle("hidden", !visible);
}

function refreshStatus() {
  chrome.runtime.sendMessage({ type: "getStatus" }, (response) => {
    if (chrome.runtime.lastError || !response) {
      status.textContent = "NextDM is not running";
      status.className = "bad";
      return;
    }
    if (response.ok) {
      status.textContent = `Connected · NextDM ${response.version ?? ""}`.trim();
      status.className = "ok";
    } else {
      status.textContent = response.error || "NextDM is not running";
      status.className = "bad";
    }
    if (typeof response.hasHostPermissions === "boolean") {
      setPermBannerVisible(!response.hasHostPermissions);
    }
  });
}

if (chrome.permissions && chrome.permissions.contains) {
  chrome.permissions.contains({ origins: ["<all_urls>"] }, (granted) => {
    if (!chrome.runtime.lastError) {
      setPermBannerVisible(!granted);
    }
  });
}

refreshStatus();

if (grantAccess) {
  grantAccess.addEventListener("click", () => {
    if (!chrome.permissions || !chrome.permissions.request) return;
    chrome.permissions.request({ origins: ["<all_urls>"] }, (granted) => {
      if (chrome.runtime.lastError) return;
      setPermBannerVisible(!granted);
      chrome.runtime.sendMessage({ type: "refreshPermissions" });
    });
  });
}

openApp.addEventListener("click", () => {
  openApp.disabled = true;
  chrome.runtime.sendMessage({ type: "openApp" }, (response) => {
    openApp.disabled = false;
    if (chrome.runtime.lastError || !response || !response.ok) {
      status.textContent =
        (response && response.error) || "Could not launch NextDM automatically";
      status.className = "bad";
      return;
    }
    setTimeout(refreshStatus, 400);
  });
});
