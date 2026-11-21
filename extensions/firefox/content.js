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

    // Make badge draggable so user can move it anywhere on player
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let initialBadgeLeft = 0;
    let initialBadgeTop = 0;
    let hasMoved = false;

    badge.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      isDragging = true;
      hasMoved = false;
      dragStartX = e.clientX;
      dragStartY = e.clientY;

      const rect = badge.getBoundingClientRect();
      const parentRect = (badge.offsetParent || document.body).getBoundingClientRect();
      initialBadgeLeft = rect.left - parentRect.left;
      initialBadgeTop = rect.top - parentRect.top;

      const onMouseMove = (moveEvent) => {
        if (!isDragging) return;
        const dx = moveEvent.clientX - dragStartX;
        const dy = moveEvent.clientY - dragStartY;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
          hasMoved = true;
          badge.style.right = "auto";
          badge.style.left = `${Math.max(4, initialBadgeLeft + dx)}px`;
          badge.style.top = `${Math.max(4, initialBadgeTop + dy)}px`;
        }
      };

      const onMouseUp = () => {
        isDragging = false;
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
      };

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    });

    badge.addEventListener("click", (e) => {
      if (hasMoved) {
        hasMoved = false;
        return;
      }
      e.stopPropagation();
      e.preventDefault();

      badge.classList.add("nextdm-video-badge-active");
      const textSpan = badge.querySelector(".nextdm-badge-text");
      if (textSpan) textSpan.textContent = "Opening NextDM...";

      // Determine best media target using deep inspection
      const pageUrl = window.location.href;
      const targetUrl = resolveVideoMediaTarget(targetVideo);

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

  function findFacebookVideoTarget(video) {
    if (
      location.pathname.includes("/watch") ||
      location.pathname.includes("/reel/") ||
      location.pathname.includes("/videos/") ||
      location.search.includes("v=")
    ) {
      return window.location.href;
    }
    const container =
      video.closest('[role="article"]') ||
      video.closest('[data-pagelet*="FeedUnit"]') ||
      video.closest('.userContentWrapper') ||
      video.closest('div[data-visualcompletion]') ||
      video.parentElement;

    if (container) {
      const links = Array.from(container.querySelectorAll("a[href]"));
      for (const a of links) {
        const href = a.getAttribute("href") || "";
        if (
          href.includes("/watch/?v=") ||
          href.includes("/watch?v=") ||
          href.includes("/reel/") ||
          href.includes("/videos/") ||
          href.includes("fb.watch/")
        ) {
          try {
            return new URL(href, window.location.origin).href;
          } catch (e) {
            return href;
          }
        }
      }
    }
    const parentA = video.closest("a[href]");
    if (parentA && parentA.href) {
      return parentA.href;
    }
    return null;
  }

  function findTwitterVideoTarget(video) {
    if (location.pathname.includes("/status/")) {
      return window.location.href;
    }
    const article = video.closest("article");
    if (article) {
      const link = article.querySelector('a[href*="/status/"]');
      if (link) {
        try {
          return new URL(link.getAttribute("href"), window.location.origin).href;
        } catch (e) {
          return link.href;
        }
      }
    }
    return null;
  }

  function findInstagramVideoTarget(video) {
    if (
      location.pathname.includes("/p/") ||
      location.pathname.includes("/reel/") ||
      location.pathname.includes("/tv/")
    ) {
      return window.location.href;
    }
    const article = video.closest("article");
    if (article) {
      const link = article.querySelector('a[href*="/p/"], a[href*="/reel/"], a[href*="/tv/"]');
      if (link) {
        try {
          return new URL(link.getAttribute("href"), window.location.origin).href;
        } catch (e) {
          return link.href;
        }
      }
    }
    return null;
  }

  function findRedditVideoTarget(video) {
    if (location.pathname.includes("/comments/")) {
      return window.location.href;
    }
    const post = video.closest("shreddit-post, [data-testid='post-container'], div[id^='t3_']");
    if (post) {
      const link = post.querySelector('a[href*="/comments/"]');
      if (link) {
        try {
          return new URL(link.getAttribute("href"), window.location.origin).href;
        } catch (e) {
          return link.href;
        }
      }
    }
    return null;
  }

  function resolveVideoMediaTarget(video) {
    const pageUrl = window.location.href;
    const directSrc = video.currentSrc || video.src || "";
    const isBlobOrData = directSrc.startsWith("blob:") || directSrc.startsWith("data:");
    const isChunk =
      directSrc.includes(".ts") ||
      directSrc.includes(".m4s") ||
      directSrc.includes("/segment") ||
      directSrc.includes("range=");

    // 1. Direct clean video URL on video element
    if (directSrc && !isBlobOrData && !isChunk) {
      return directSrc;
    }

    // 2. Facebook feed post or reel permalink detection
    if (location.hostname.includes("facebook.com") || location.hostname.includes("fb.watch")) {
      const fbTarget = findFacebookVideoTarget(video);
      if (fbTarget) return fbTarget;
    }

    // 3. Twitter / X timeline post permalink detection
    if (location.hostname.includes("twitter.com") || location.hostname.includes("x.com")) {
      const twTarget = findTwitterVideoTarget(video);
      if (twTarget) return twTarget;
    }

    // 4. Instagram feed post / reel permalink detection
    if (location.hostname.includes("instagram.com")) {
      const igTarget = findInstagramVideoTarget(video);
      if (igTarget) return igTarget;
    }

    // 5. Reddit feed post permalink detection
    if (location.hostname.includes("reddit.com")) {
      const rdTarget = findRedditVideoTarget(video);
      if (rdTarget) return rdTarget;
    }

    // 6. Check <source> tags inside <video>
    const sources = Array.from(video.querySelectorAll("source"));
    for (const s of sources) {
      const sSrc = s.src || s.getAttribute("data-src") || "";
      if (sSrc && !sSrc.startsWith("blob:") && !sSrc.startsWith("data:") && !sSrc.includes(".ts")) {
        return sSrc;
      }
    }

    // 3. Wistia Video Embed Detection (e.g. Kajabi, Teachable, UrbanForex, course portals)
    try {
      const wistiaElem =
        video.closest(".wistia_embed, [class*='wistia_async_'], [id^='wistia_']") ||
        document.querySelector(".wistia_embed, [class*='wistia_async_'], [id^='wistia_']");
      if (wistiaElem) {
        const classMatch = wistiaElem.className && wistiaElem.className.match(/wistia_async_([a-zA-Z0-9]+)/);
        if (classMatch && classMatch[1]) {
          return `https://fast.wistia.net/embed/iframe/${classMatch[1]}`;
        }
        const idMatch = wistiaElem.id && wistiaElem.id.match(/^wistia_([a-zA-Z0-9]+)$/);
        if (idMatch && idMatch[1]) {
          return `https://fast.wistia.net/embed/iframe/${idMatch[1]}`;
        }
      }
      const htmlMatch =
        document.documentElement.innerHTML.match(/wistia_async_([a-zA-Z0-9]+)/) ||
        document.documentElement.innerHTML.match(/fast\.wistia\.(?:net|com)\/embed\/(?:iframe|medias)\/([a-zA-Z0-9]+)/);
      if (htmlMatch && htmlMatch[1]) {
        return `https://fast.wistia.net/embed/iframe/${htmlMatch[1]}`;
      }
    } catch (e) {}

    // 4. Vimeo Embed Detection
    try {
      const vimeoIframe =
        video.closest("iframe[src*='vimeo.com']") ||
        document.querySelector("iframe[src*='player.vimeo.com/video/'], iframe[src*='vimeo.com']");
      if (vimeoIframe && vimeoIframe.src) {
        return vimeoIframe.src;
      }
      const vimeoElem = video.closest("[data-vimeo-id]") || document.querySelector("[data-vimeo-id]");
      if (vimeoElem && vimeoElem.dataset && vimeoElem.dataset.vimeoId) {
        return `https://player.vimeo.com/video/${vimeoElem.dataset.vimeoId}`;
      }
    } catch (e) {}

    // 5. YouTube Embed Detection
    try {
      const ytIframe =
        video.closest("iframe[src*='youtube.com'], iframe[src*='youtube-nocookie.com']") ||
        document.querySelector("iframe[src*='youtube.com/embed/'], iframe[src*='youtube-nocookie.com/embed/']");
      if (ytIframe && ytIframe.src) {
        const match = ytIframe.src.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
        if (match && match[1]) {
          return `https://www.youtube.com/watch?v=${match[1]}`;
        }
        return ytIframe.src;
      }
    } catch (e) {}

    // 6. Generic Video Iframes (Dailymotion, Loom, Rumble, Streamtape, etc.)
    try {
      const iframes = Array.from(document.querySelectorAll("iframe"));
      for (const f of iframes) {
        const s = f.src || "";
        if (
          s.includes("dailymotion.com/embed") ||
          s.includes("loom.com/embed") ||
          s.includes("rumble.com/embed") ||
          s.includes("streamtape.com/e/") ||
          s.includes("/embed/") ||
          s.includes("/player/")
        ) {
          return s;
        }
      }
    } catch (e) {}

    // 7. Check browser Performance Resource Timing for active .m3u8 or .mpd manifests
    try {
      const resources = window.performance.getEntriesByType("resource");
      for (let i = resources.length - 1; i >= 0; i--) {
        const name = resources[i].name || "";
        if (name.includes(".m3u8") || name.includes(".mpd")) {
          return name;
        }
      }
    } catch (e) {}

    // 8. Known media platform where yt-dlp supports page URL directly
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
      location.hostname.includes("twitch.tv") ||
      location.hostname.includes("rumble.com");
    if (isKnownMediaSite) {
      return pageUrl;
    }

    // 9. Fallback to pageUrl
    return pageUrl;
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
