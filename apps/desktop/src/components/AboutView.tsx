import React, { useState, useRef } from "react";
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

export function AboutView({ engineVersion }: { engineVersion: string }) {
  const [sparkles, setSparkles] = useState<SparkleParticle[]>([]);
  const [showCredits, setShowCredits] = useState(false);
  const sparkleIdCounter = useRef(0);

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

          <div className="about-credits-row">
            <button
              type="button"
              className="about-credits-btn"
              onClick={() => setShowCredits((prev) => !prev)}
            >
              {showCredits ? "Hide Credits" : "Credits"}
            </button>
          </div>

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

