/**
 * NextDM In-Browser Floating Video & Media Grabber
 * Detects playing video / media elements on YouTube, Facebook, and web pages,
 * rendering a floating "Download Video" button over the player.
 */

(function () {
  if (window.__nextdm_grabber_loaded__) return;
  window.__nextdm_grabber_loaded__ = true;

  const BADGE_CLASS = "nextdm-video-badge";
  let currentBadgeStyle = "full"; // "full" or "icon"

  chrome.storage.local.get({ badgeStyle: "full" }, (res) => {
    currentBadgeStyle = res.badgeStyle || "full";
    updateAllBadges();
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.badgeStyle) {
      currentBadgeStyle = changes.badgeStyle.newValue || "full";
      updateAllBadges();
    }
  });

  function updateBadgeStyle(badge) {
    if (currentBadgeStyle === "icon" || currentBadgeStyle === "compact") {
      badge.classList.add("nextdm-badge-icon-only");
      badge.classList.remove("nextdm-badge-full");
      badge.title = "Download Video with NextDM (Click to download, Right-click to switch style)";
    } else {
      badge.classList.add("nextdm-badge-full");
      badge.classList.remove("nextdm-badge-icon-only");
      badge.title = "Download with NextDM (Right-click to switch to icon-only)";
    }
  }

  function updateAllBadges() {
    document.querySelectorAll(`.${BADGE_CLASS}`).forEach(updateBadgeStyle);
  }

  function createBadge(targetVideo) {
    const badge = document.createElement("div");
    badge.className = BADGE_CLASS;
    updateBadgeStyle(badge);

    badge.innerHTML = `
      <div class="nextdm-badge-icon">
        <svg viewBox="0 0 24 24">
          <path d="M12 3v13m-4-4 4 4 4-4M4 20h16" />
        </svg>
      </div>
      <span class="nextdm-badge-text">Download Video</span>
      <button type="button" class="nextdm-badge-toggle" title="Switch between Full panel and Icon-only mini grabber">
        <svg viewBox="0 0 16 16" width="10" height="10">
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>
    `;

    // Right-click on badge toggles between Full and Icon-Only!
    badge.addEventListener("contextmenu", (e) => {
      e.stopPropagation();
      e.preventDefault();
      const nextStyle = currentBadgeStyle === "icon" ? "full" : "icon";
      chrome.storage.local.set({ badgeStyle: nextStyle });
    });

    const toggleBtn = badge.querySelector(".nextdm-badge-toggle");
    if (toggleBtn) {
      toggleBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        const nextStyle = currentBadgeStyle === "icon" ? "full" : "icon";
        chrome.storage.local.set({ badgeStyle: nextStyle });
      });
    }

    badge.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();

      badge.classList.add("nextdm-video-badge-active");
      const textSpan = badge.querySelector(".nextdm-badge-text");
      if (textSpan) textSpan.textContent = "Opening NextDM...";

      // Determine best media target
      const pageUrl = window.location.href;
      const directSrc = targetVideo.currentSrc || targetVideo.src || "";

      // Check if directSrc is unusable directly (blob:, data:, or fragmented transport stream chunk)
      const isBlobOrData = directSrc.startsWith("blob:") || directSrc.startsWith("data:");
      const isChunk =
        directSrc.includes(".ts") ||
        directSrc.includes(".m4s") ||
        directSrc.includes("/segment") ||
        directSrc.includes("range=");

      const isKnownMediaSite =
        location.hostname.includes("youtube.com") ||
        location.hostname.includes("youtu.be") ||
        location.hostname.includes("facebook.com") ||
        location.hostname.includes("fb.watch") ||
        location.hostname.includes("instagram.com") ||
        location.hostname.includes("twitter.com") ||
        location.hostname.includes("x.com") ||
        location.hostname.includes("tiktok.com") ||
        location.hostname.includes("vimeo.com") ||
        location.hostname.includes("dailymotion.com") ||
        location.hostname.includes("bilibili.com") ||
        location.hostname.includes("reddit.com") ||
        location.hostname.includes("twitch.tv");

      // If it's a known media site, or if directSrc is a blob or chunk,
      // we pass pageUrl so yt-dlp's extractors can discover the complete high-res stream!
      let targetUrl = pageUrl;
      if (!isKnownMediaSite && directSrc && !isBlobOrData && !isChunk) {
        targetUrl = directSrc;
      }

      chrome.runtime.sendMessage({
        type: "nextdm_grab_media",
        url: targetUrl,
        pageUrl: pageUrl,
        title: document.title,
      });

      setTimeout(() => {
        badge.classList.remove("nextdm-video-badge-active");
        if (textSpan) textSpan.textContent = "Download Video";
      }, 3000);
    });

    return badge;
  }

  function attachToVideo(video) {
    if (video.dataset.nextdmAttached) return;
    video.dataset.nextdmAttached = "true";

    // Find parent container or place relatively
    let parent = video.parentElement;
    if (!parent) return;

    // Check if parent has relative/absolute positioning
    const style = window.getComputedStyle(parent);
    if (style.position === "static") {
      parent.style.position = "relative";
    }

    const badge = createBadge(video);
    parent.appendChild(badge);

    // Auto-hide if video is tiny (e.g. tracking pixel or preview icon < 160px)
    function checkSize() {
      const rect = video.getBoundingClientRect();
      if (rect.width < 180 || rect.height < 120) {
        badge.style.display = "none";
      } else {
        badge.style.display = "flex";
      }
    }
    checkSize();
    video.addEventListener("loadedmetadata", checkSize);
    video.addEventListener("play", checkSize);
  }

  function scanMedia() {
    const videos = document.querySelectorAll("video");
    videos.forEach((v) => {
      // Don't attach to zero-size or hidden videos
      if (v.offsetWidth > 0 || v.offsetHeight > 0 || v.src || v.currentSrc) {
        attachToVideo(v);
      }
    });
  }

  // Initial scan and mutation observer
  scanMedia();
  const observer = new MutationObserver(() => scanMedia());
  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
