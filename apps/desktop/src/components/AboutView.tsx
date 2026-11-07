import React, { useState, useRef } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Logo } from "./Icons";

export interface SparkleParticle {
  id: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  color: string;
  char: string;
  scale: number;
  rotate: number;
}

function isNewerVersion(current: string, latest: string): boolean {
  const cleanCurr = current.replace(/^v/, "").split(".").map(Number);
  const cleanLat = latest.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < Math.max(cleanCurr.length, cleanLat.length); i++) {
    const c = cleanCurr[i] || 0;
    const l = cleanLat[i] || 0;
    if (l > c) return true;
    if (l < c) return false;
  }
  return false;
}

export function AboutView({
  engineVersion,
  onOpenUpdateManager,
}: {
  engineVersion: string;
  onOpenUpdateManager?: () => void;
}) {
  const [sparkles, setSparkles] = useState<SparkleParticle[]>([]);
  const [showCredits, setShowCredits] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<"idle" | "checking" | "latest" | "available" | "error">("idle");
  const [latestVersion, setLatestVersion] = useState<string>("");
  const [releaseUrl, setReleaseUrl] = useState<string>("");
  const sparkleIdCounter = useRef(0);

  const checkForUpdates = async () => {
    setUpdateStatus("checking");
    try {
      const res = await fetch("https://api.github.com/repos/mahabubaabir/nextdm/releases/latest", {
        headers: { Accept: "application/vnd.github.v3+json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const tag = data.tag_name || "";
      const isNewer = isNewerVersion(engineVersion, tag);
      setLatestVersion(tag);
      setReleaseUrl(data.html_url || "https://github.com/mahabubaabir/nextdm/releases");
      setUpdateStatus(isNewer ? "available" : "latest");
    } catch {
      setUpdateStatus("error");
    }
  };

  const triggerSparkle = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const originX = event.clientX - rect.left;
    const originY = event.clientY - rect.top;
    const chars = ["✨", "⭐", "🌟", "💫", "✦", "✧"];
    const colors = ["#ffd700", "#00f5ff", "#ff007f", "#bd00ff", "#00ff88", "#ff9900", "#ffffff"];
    const count = 22;
    const newSparkles: SparkleParticle[] = [];

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * 2 * Math.PI + (Math.random() - 0.5) * 0.4;
      const distance = 45 + Math.random() * 85;
      const dx = Math.cos(angle) * distance;
      const dy = Math.sin(angle) * distance;
      newSparkles.push({
        id: ++sparkleIdCounter.current,
        x: originX,
        y: originY,
        dx,
        dy,
        color: colors[Math.floor(Math.random() * colors.length)],
        char: chars[Math.floor(Math.random() * chars.length)],
        scale: 0.8 + Math.random() * 0.9,
        rotate: Math.random() * 360 - 180,
      });
    }

    setSparkles((cur) => [...cur, ...newSparkles]);
    window.setTimeout(() => {
      setSparkles((cur) => cur.filter((s) => !newSparkles.some((ns) => ns.id === s.id)));
    }, 1100);
  };

  return (
    <div className="about-ulauncher-container">
      {/* Left Column: Big Logo + App Name + Subtitle */}
      <div className="about-branding-column">
        <div className="about-branding-logo-wrap">
          <Logo size={88} />
        </div>
        <h2 className="about-app-title">NextDM v{engineVersion}</h2>
        <p className="about-app-subtitle">Download Engine v{engineVersion}</p>
      </div>

      {/* Right Column: Inset License & Copyright Box */}
      <div className="about-card-column">
        <div className="about-details-card">
          <div
            className="about-copyright-interactive"
            onClick={triggerSparkle}
            role="button"
            tabIndex={0}
            title="Click for sparkles ✨"
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                triggerSparkle(e as unknown as React.MouseEvent<HTMLDivElement>);
              }
            }}
          >
            <span>Copyright (C) </span>
            <strong className="about-creator-glow">Marbor Tech by Mahabub H. Aabir</strong>
            <span className="about-creator-email"> &lt;mahabub.aabir@yahoo.com&gt;</span>
            {sparkles.map((sp) => (
              <span
                key={sp.id}
                className="sparkle-particle"
                style={
                  {
                    left: `${sp.x}px`,
                    top: `${sp.y}px`,
                    color: sp.color,
                    "--dx": `${sp.dx}px`,
                    "--dy": `${sp.dy}px`,
                    "--scale": sp.scale,
                    "--rot": `${sp.rotate}deg`,
                  } as React.CSSProperties
                }
              >
                {sp.char}
              </span>
            ))}
          </div>

          <p className="about-legal-paragraph">
            NextDM is free software: you can redistribute it and/or modify it under the terms of the
            GNU General Public License version 3, as published by the Free Software Foundation.
          </p>

          <p className="about-legal-paragraph">
            This program is distributed in the hope that it will be useful, but WITHOUT ANY
            WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
            PARTICULAR PURPOSE. See the GNU General Public License for more details.
          </p>

          <div className="about-credits-row" style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <button
              type="button"
              className="about-credits-btn"
              onClick={() => setShowCredits((prev) => !prev)}
            >
              {showCredits ? "Hide Credits" : "Credits"}
            </button>
            <button
              type="button"
              className="about-credits-btn"
              onClick={() => {
                if (onOpenUpdateManager) {
                  onOpenUpdateManager();
                } else {
                  checkForUpdates();
                }
              }}
              disabled={updateStatus === "checking"}
            >
              Update Manager…
            </button>
          </div>

          {updateStatus === "latest" && (
            <div style={{ marginTop: "10px", fontSize: "12px", color: "var(--success)" }}>
              ✓ NextDM is up to date (v{engineVersion}).
            </div>
          )}

          {updateStatus === "available" && (
            <div
              style={{
                marginTop: "10px",
                padding: "8px 12px",
                background: "rgba(56, 189, 248, 0.12)",
                border: "1px solid rgba(56, 189, 248, 0.3)",
                borderRadius: "6px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "8px",
              }}
            >
              <span style={{ fontSize: "12px", color: "var(--text)" }}>
                🚀 <strong>New update available:</strong> {latestVersion}
              </span>
              <button
                type="button"
                className="about-credits-btn"
                style={{
                  background: "rgba(56, 189, 248, 0.25)",
                  color: "#38bdf8",
                  border: "1px solid rgba(56, 189, 248, 0.5)",
                  cursor: "pointer",
                }}
                onClick={() => openUrl(releaseUrl)}
              >
                Download Update
              </button>
            </div>
          )}

          {updateStatus === "error" && (
            <div style={{ marginTop: "10px", fontSize: "12px", color: "var(--muted)" }}>
              Could not check for updates. You can check the repository directly on GitHub.
            </div>
          )}

          {showCredits && (
            <div className="about-credits-popover">
              <div className="credits-section">
                <strong>Created by:</strong> Mahabub H. Aabir (Marbor Tech)
              </div>
              <div className="credits-section">
                <strong>Core Stack:</strong> Rust 2021, Tauri 2, React 19, TypeScript
              </div>
              <div className="credits-section">
                <strong>Media Extraction:</strong> yt-dlp & FFmpeg
              </div>
              <div className="credits-section">
                <strong>Firefox Extension:</strong>{" "}
                <a
                  href="https://addons.mozilla.org/en-US/firefox/addon/nextdm-integration/"
                  target="_blank"
                  rel="noreferrer"
                  className="credits-link"
                >
                  addons.mozilla.org/addon/nextdm-integration
                </a>
              </div>
              <div className="credits-section">
                <strong>Repository:</strong>{" "}
                <a
                  href="https://github.com/mahabubaabir/nextdm"
                  target="_blank"
                  rel="noreferrer"
                  className="credits-link"
                >
                  github.com/mahabubaabir/nextdm
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

