import type { CSSProperties } from "react";

export type IconName =
  | "add"
  | "start"
  | "pause"
  | "stop"
  | "remove"
  | "options"
  | "media"
  | "search"
  | "folder"
  | "all"
  | "unfinished"
  | "finished"
  | "documents"
  | "music"
  | "video"
  | "programs"
  | "compressed"
  | "images"
  | "other"
  | "download"
  | "close"
  | "check"
  | "chevron-down"
  | "external"
  | "info"
  | "warning"
  | "refresh"
  | "clipboard"
  | "globe"
  | "speed"
  | "connections"
  | "monitor"
  | "file"
  | "trash";

export function Icon({
  name,
  size = 16,
  className,
  style,
}: {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: className ? `icon ${className}` : "icon",
    style,
    "aria-hidden": true,
  };

  switch (name) {
    case "add":
      return (
        <svg {...common}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case "start":
      return (
        <svg {...common}>
          <path d="M7 4.5 19 12 7 19.5Z" fill="currentColor" stroke="none" />
        </svg>
      );
    case "pause":
      return (
        <svg {...common}>
          <rect x="7" y="5" width="3.4" height="14" rx="1" fill="currentColor" stroke="none" />
          <rect x="13.6" y="5" width="3.4" height="14" rx="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case "stop":
      return (
        <svg {...common}>
          <rect x="6.5" y="6.5" width="11" height="11" rx="1.2" fill="currentColor" stroke="none" />
        </svg>
      );
    case "remove":
      return (
        <svg {...common}>
          <path d="M5 7h14M9.5 7V5h5v2M7 7l.8 12h8.4L17 7" />
          <path d="M10.5 10.5v5.5M13.5 10.5v5.5" />
        </svg>
      );
    case "trash":
      return (
        <svg {...common}>
          <path d="M5 7h14M9.5 7V5h5v2M7 7l.8 12h8.4L17 7" />
        </svg>
      );
    case "options":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M18 6l-1.4 1.4M7.4 16.6 6 18" />
        </svg>
      );
    case "media":
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M10 9.2v5.6l5-2.8Z" fill="currentColor" stroke="none" />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          <circle cx="10.5" cy="10.5" r="6" />
          <path d="m15 15 4.5 4.5" />
        </svg>
      );
    case "folder":
      return (
        <svg {...common}>
          <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2h9A1.5 1.5 0 0 1 21 9.5v8A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5Z" />
        </svg>
      );
    case "all":
      return (
        <svg {...common}>
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      );
    case "unfinished":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v4.4l2.8 1.7" />
        </svg>
      );
    case "finished":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <path d="m8.3 12.2 2.4 2.4 5-5" />
        </svg>
      );
    case "documents":
      return (
        <svg {...common}>
          <path d="M6 3.5h7l5 5v12H6Z" />
          <path d="M13 3.5v5h5M9 13h6M9 16.5h6" />
        </svg>
      );
    case "music":
      return (
        <svg {...common}>
          <path d="M9 18V6l10-2v12" />
          <circle cx="6.5" cy="18" r="2.5" />
          <circle cx="16.5" cy="16" r="2.5" />
        </svg>
      );
    case "video":
      return (
        <svg {...common}>
          <rect x="3" y="6" width="13" height="12" rx="2" />
          <path d="m16 10 5-3v10l-5-3Z" />
        </svg>
      );
    case "programs":
      return (
        <svg {...common}>
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <path d="m9 9 3 3-3 3M13 15h3" />
        </svg>
      );
    case "compressed":
      return (
        <svg {...common}>
          <path d="M4 5h16v14H4Z" />
          <path d="M10 5v2.5h3V5M10 7.5v2.5h3V7.5M10 10v2.5h3V10M10 12.5V15h3v-2.5" />
        </svg>
      );
    case "images":
      return (
        <svg {...common}>
          <rect x="3.5" y="5" width="17" height="14" rx="2" />
          <circle cx="9" cy="10" r="1.6" />
          <path d="m5 17 4.5-4.5 3 3 2.5-2.5L20 18" />
        </svg>
      );
    case "other":
      return (
        <svg {...common}>
          <path d="M6 3.5h7l5 5v12H6Z" />
          <path d="M13 3.5v5h5" />
        </svg>
      );
    case "download":
      return (
        <svg {...common}>
          <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14" />
        </svg>
      );
    case "close":
      return (
        <svg {...common}>
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      );
    case "check":
      return (
        <svg {...common}>
          <path d="m5 12.5 4.5 4.5L19 7" />
        </svg>
      );
    case "chevron-down":
      return (
        <svg {...common}>
          <path d="m7 10 5 5 5-5" />
        </svg>
      );
    case "external":
      return (
        <svg {...common}>
          <path d="M14 4h6v6M20 4l-9 9" />
          <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
        </svg>
      );
    case "info":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 11v5M12 8h.01" />
        </svg>
      );
    case "warning":
      return (
        <svg {...common}>
          <path d="M12 4 21 19H3Z" />
          <path d="M12 9v4.5M12 16.5h.01" />
        </svg>
      );
    case "refresh":
      return (
        <svg {...common}>
          <path d="M20 12a8 8 0 1 1-2.4-5.7L20 8.5M20 4v4.5h-4.5" />
        </svg>
      );
    case "clipboard":
      return (
        <svg {...common}>
          <rect x="6" y="4.5" width="12" height="16" rx="2" />
          <path d="M9.5 4.5V3h5v1.5M9.5 9h5M9.5 12.5h5M9.5 16h3" />
        </svg>
      );
    case "globe":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M3.5 12h17M12 3.5c2.3 2.3 3.5 5.2 3.5 8.5S14.3 18.2 12 20.5c-2.3-2.3-3.5-5.2-3.5-8.5S9.7 5.8 12 3.5Z" />
        </svg>
      );
    case "speed":
      return (
        <svg {...common}>
          <path d="M4 17a8 8 0 1 1 16 0" />
          <path d="m12 13 4-3M7 17h10" />
        </svg>
      );
    case "connections":
      return (
        <svg {...common}>
          <circle cx="6" cy="7" r="2.5" />
          <circle cx="18" cy="7" r="2.5" />
          <circle cx="6" cy="17" r="2.5" />
          <circle cx="18" cy="17" r="2.5" />
          <path d="M8.5 7h7M6 9.5v5M18 9.5v5M8.5 17h7" />
        </svg>
      );
    case "monitor":
      return (
        <svg {...common}>
          <rect x="3" y="4.5" width="18" height="12" rx="1.5" />
          <path d="M9 20h6M12 16.5V20" />
        </svg>
      );
    case "file":
      return (
        <svg {...common}>
          <path d="M6 3.5h7l5 5v12H6Z" />
          <path d="M13 3.5v5h5" />
        </svg>
      );
    default:
      return null;
  }
}

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label="NextDM logo"
      className="nextdm-logo"
    >
      <defs>
        <linearGradient id="nextdm-gradient" x1="4" y1="3" x2="27" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2f8cff" />
          <stop offset="0.55" stopColor="#1f6fdd" />
          <stop offset="1" stopColor="#124ea8" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="28" height="28" rx="7" fill="url(#nextdm-gradient)" />
      <path
        d="M16 8.2v10.4M10.8 13.8 16 19l5.2-5.2"
        fill="none"
        stroke="#ffffff"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M9.5 23.4h13" stroke="#9cc8ff" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
