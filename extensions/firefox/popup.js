const enabled = document.getElementById("enabled");
const status = document.getElementById("status");
const openApp = document.getElementById("open-app");

chrome.storage.local.get({ enabled: true }, (value) => {
  enabled.checked = Boolean(value.enabled);
});

enabled.addEventListener("change", () => {
  chrome.storage.local.set({ enabled: enabled.checked });
  chrome.runtime.sendMessage({ type: "setEnabled", enabled: enabled.checked });
});

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
});

openApp.addEventListener("click", () => {
  chrome.tabs.create({ url: "https://github.com/mahabubaabir/nextdm" });
});
