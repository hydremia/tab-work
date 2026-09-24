/** Small inline SVG icon set (stroke icons, 24x24, currentColor). */
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = ({ size = 20, ...rest }: P) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
  ...rest,
});

export const IconBack = (p: P) => (
  <svg {...base(p)}>
    <path d="M15 18l-6-6 6-6" />
  </svg>
);
export const IconPlus = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const IconDevice = (p: P) => (
  <svg {...base(p)}>
    <rect x="6" y="2" width="12" height="20" rx="2" />
    <path d="M11 18h2" />
  </svg>
);
export const IconCloudCheck = (p: P) => (
  <svg {...base(p)}>
    <path d="M17.5 19H7a5 5 0 1 1 1-9.9A6 6 0 0 1 19.4 11 4 4 0 0 1 17.5 19z" />
    <path d="M9.5 14l2 2 3.5-3.5" />
  </svg>
);
export const IconCloudUp = (p: P) => (
  <svg {...base(p)}>
    <path d="M17.5 19H7a5 5 0 1 1 1-9.9A6 6 0 0 1 19.4 11 4 4 0 0 1 17.5 19z" />
    <path d="M12 16v-5M9.5 13.5L12 11l2.5 2.5" />
  </svg>
);
export const IconCloudOff = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 3l18 18M9 5.3A6 6 0 0 1 19.4 11 4 4 0 0 1 20 18.3M17 19H7a5 5 0 0 1-1.4-9.8" />
  </svg>
);
export const IconDownload = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3v12M7 10l5 5 5-5M4 21h16" />
  </svg>
);
export const IconUpload = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 21V9M7 14l5-5 5 5M4 3h16" />
  </svg>
);
export const IconTrash = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </svg>
);
export const IconCamera = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
    <circle cx="12" cy="13" r="3.5" />
  </svg>
);
export const IconChevron = (p: P & { open?: boolean }) => {
  const { open, ...rest } = p;
  return (
    <svg {...base(rest)} style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
};
export const IconFolder = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 6h6l2 2h10v11H3z" />
  </svg>
);
export const IconFile = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 2h8l5 5v15H6z" />
    <path d="M14 2v5h5M9 13h6M9 17h6" />
  </svg>
);

/* Status icons: a different SHAPE per state, so color is never the only signal. */
export const IconStatusGray = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8" strokeDasharray="3 3" />
  </svg>
);
export const IconStatusAmber = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none" />
  </svg>
);
export const IconStatusGreen = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" fill="currentColor" stroke="none" />
    <path d="M8 12.5l2.7 2.7L16.5 9.5" stroke="#fff" />
  </svg>
);
export const IconStatusRed = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3l10 18H2z" fill="currentColor" stroke="none" />
    <path d="M12 10v4.5M12 17.5v.01" stroke="#fff" strokeWidth={2.4} />
  </svg>
);
/* Reviewed (blue): a filled rounded square with a double check, a shape of its own. */
export const IconStatusBlue = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="3" width="18" height="18" rx="5" fill="currentColor" stroke="none" />
    <path d="M6.5 12.5l2.3 2.3 4.7-5M11.8 14.6l.7.7 4.7-5" stroke="#fff" strokeWidth={1.9} />
  </svg>
);
export const IconLock = (p: P) => (
  <svg {...base(p)}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);
export const IconUnlock = (p: P) => (
  <svg {...base(p)}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 7.5-2" />
  </svg>
);
export const IconHistory = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5M12 7v5l3 2" />
  </svg>
);
/** iOS-style share (box with an up arrow). */
export const IconShare = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3v12M8 7l4-4 4 4" />
    <path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
  </svg>
);
export const IconInstall = (p: P) => (
  <svg {...base(p)}>
    <rect x="6" y="2" width="12" height="20" rx="2" />
    <path d="M12 7v8M9 12l3 3 3-3" />
  </svg>
);
export const IconRefresh = (p: P) => (
  <svg {...base(p)}>
    <path d="M20 11a8 8 0 1 0-2.3 5.7" />
    <path d="M20 4v7h-7" />
  </svg>
);
