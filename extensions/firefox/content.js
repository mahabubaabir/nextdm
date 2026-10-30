/**
 * NextDM In-Browser Floating Video & Media Grabber
 * Detects playing video / media elements on YouTube, Facebook, and web pages,
 * rendering a floating "Download Video" button over the player.
 */

(function () {
  if (window.__nextdm_grabber_loaded__) return;
  window.__nextdm_grabber_loaded__ = true;

  const BADGE_CLASS = "nextdm-video-badge";

  function createBadge(targetVideo) {
    const badge = document.createElement("div");
    badge.className = BADGE_CLASS;
    badge.title = "Download with NextDM";
    badge.innerHTML = `
      <svg viewBox="0 0 24 24">
        <path d="M12 4v12m-4-4 4 4 4-4M5 20h14" />
      </svg>
      <span>Download Video</span>
    `;

    badge.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();

      badge.classList.add("nextdm-video-badge-active");
      badge.querySelector("span").textContent = "Opening NextDM...";

      // Determine best media target
      let targetUrl = window.location.href;
      let directSrc = targetVideo.currentSrc || targetVideo.src;

      // If YouTube or Facebook, pass page URL so yt-dlp parses high-res streams
      const isMediaSite =
        location.hostname.includes("youtube.com") ||
        location.hostname.includes("youtu.be") ||
        location.hostname.includes("facebook.com") ||
        location.hostname.includes("twitter.com") ||
        location.hostname.includes("x.com") ||
        location.hostname.includes("tiktok.com") ||
        location.hostname.includes("vimeo.com");

      chrome.runtime.sendMessage({
        type: "nextdm_grab_media",
        url: isMediaSite ? targetUrl : directSrc || targetUrl,
        pageUrl: targetUrl,
        title: document.title,
      });

      setTimeout(() => {
        badge.classList.remove("nextdm-video-badge-active");
        badge.querySelector("span").textContent = "Download Video";
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
