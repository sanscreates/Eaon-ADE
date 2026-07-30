import { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...rest }: P) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconTerminal = (p: P) => (
  <Svg {...p}><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></Svg>
);

export const IconPlus = (p: P) => (
  <Svg {...p}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></Svg>
);

export const IconX = (p: P) => (
  <Svg {...p}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></Svg>
);

export const IconDownload = (p: P) => (
  <Svg {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></Svg>
);

export const IconCopy = (p: P) => (
  <Svg {...p}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></Svg>
);

export const IconSplitRight = (p: P) => (
  <Svg {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><line x1="12" y1="4" x2="12" y2="20" /></Svg>
);

export const IconSplitDown = (p: P) => (
  <Svg {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><line x1="3" y1="12" x2="21" y2="12" /></Svg>
);

export const IconBoard = (p: P) => (
  <Svg {...p}><rect x="3" y="4" width="5" height="16" rx="1" /><rect x="10" y="4" width="5" height="10" rx="1" /><rect x="17" y="4" width="5" height="13" rx="1" /></Svg>
);

export const IconFolder = (p: P) => (
  <Svg {...p}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></Svg>
);

export const IconFile = (p: P) => (
  <Svg {...p}><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><polyline points="13 2 13 9 20 9" /></Svg>
);

export const IconGitBranch = (p: P) => (
  <Svg {...p}><line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" /></Svg>
);

export const IconGlobe = (p: P) => (
  <Svg {...p}><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></Svg>
);

export const IconRocket = (p: P) => (
  <Svg {...p}><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" /><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" /><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" /><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" /></Svg>
);

export const IconRefresh = (p: P) => (
  <Svg {...p}><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></Svg>
);

export const IconSearch = (p: P) => (
  <Svg {...p}><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></Svg>
);

export const IconChevronRight = (p: P) => (
  <Svg {...p}><polyline points="9 18 15 12 9 6" /></Svg>
);

export const IconChevronDown = (p: P) => (
  <Svg {...p}><polyline points="6 9 12 15 18 9" /></Svg>
);

export const IconTrash = (p: P) => (
  <Svg {...p}><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></Svg>
);

export const IconPlay = (p: P) => (
  <Svg {...p}><polygon points="5 3 19 12 5 21 5 3" /></Svg>
);

export const IconCommand = (p: P) => (
  <Svg {...p}><path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z" /></Svg>
);

export const IconLayout = (p: P) => (
  <Svg {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="3" x2="9" y2="21" /><line x1="15" y1="3" x2="15" y2="21" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" /></Svg>
);

export const IconExternal = (p: P) => (
  <Svg {...p}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></Svg>
);

export const IconSave = (p: P) => (
  <Svg {...p}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></Svg>
);

export const IconEdit = (p: P) => (
  <Svg {...p}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></Svg>
);

export const IconDot = (p: P) => (
  <Svg {...p}><circle cx="12" cy="12" r="6" fill="currentColor" stroke="none" /></Svg>
);

export const IconPanelLeft = (p: P) => (
  <Svg {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="3" x2="9" y2="21" /></Svg>
);

export const IconPanelRight = (p: P) => (
  <Svg {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="15" y1="3" x2="15" y2="21" /></Svg>
);

export const IconMaximize = (p: P) => (
  <Svg {...p}><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></Svg>
);

export const IconChevronsUpDown = (p: P) => (
  <Svg {...p}><polyline points="7 15 12 20 17 15" /><polyline points="7 9 12 4 17 9" /></Svg>
);

export const IconGitPullRequest = (p: P) => (
  <Svg {...p}><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><line x1="6" y1="9" x2="6" y2="15" /><circle cx="18" cy="18" r="3" /><path d="M18 15V9a3 3 0 0 0-3-3h-2" /><polyline points="15 4 13 6 15 8" /></Svg>
);

export const IconListTask = (p: P) => (
  <Svg {...p}><line x1="9" y1="6" x2="20" y2="6" /><line x1="9" y1="12" x2="20" y2="12" /><line x1="9" y1="18" x2="20" y2="18" /><line x1="4" y1="6" x2="5" y2="6" /><line x1="4" y1="12" x2="5" y2="12" /><line x1="4" y1="18" x2="5" y2="18" /></Svg>
);

export const IconSliders = (p: P) => (
  <Svg {...p}><line x1="4" y1="8" x2="20" y2="8" /><line x1="4" y1="16" x2="20" y2="16" /><circle cx="9" cy="8" r="2" /><circle cx="15" cy="16" r="2" /></Svg>
);

export const IconFolderPlus = (p: P) => (
  <Svg {...p}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /><line x1="12" y1="11" x2="12" y2="17" /><line x1="9" y1="14" x2="15" y2="14" /></Svg>
);

export const IconPin = (p: P) => (
  <Svg {...p}><line x1="12" y1="17" x2="12" y2="22" /><path d="M9 2h6l-1 8 3 3v2H7v-2l3-3z" /></Svg>
);

export const IconHelp = (p: P) => (
  <Svg {...p}><circle cx="12" cy="12" r="10" /><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.4-3 4" /><line x1="12" y1="17.5" x2="12.01" y2="17.5" /></Svg>
);

export const IconSettings = (p: P) => (
  <Svg {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></Svg>
);

export const IconPalette = (p: P) => (
  <Svg {...p}><circle cx="13.5" cy="6.5" r=".5" /><circle cx="17.5" cy="10.5" r=".5" /><circle cx="8.5" cy="7.5" r=".5" /><circle cx="6.5" cy="12.5" r=".5" /><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" /></Svg>
);

export const IconCode = (p: P) => (
  <Svg {...p}><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></Svg>
);

export const IconCpu = (p: P) => (
  <Svg {...p}><rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" /><line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" /><line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" /><line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" /><line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" /></Svg>
);

export const IconKeyboard = (p: P) => (
  <Svg {...p}><rect x="2" y="6" width="20" height="12" rx="2" /><line x1="6" y1="10" x2="6" y2="10" /><line x1="10" y1="10" x2="10" y2="10" /><line x1="14" y1="10" x2="14" y2="10" /><line x1="18" y1="10" x2="18" y2="10" /><line x1="6" y1="14" x2="6" y2="14" /><line x1="18" y1="14" x2="18" y2="14" /><line x1="9" y1="14" x2="15" y2="14" /></Svg>
);

export const IconInfo = (p: P) => (
  <Svg {...p}><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></Svg>
);

export const IconCheck = (p: P) => (
  <Svg {...p}><polyline points="20 6 9 17 4 12" /></Svg>
);

export const IconMinus = (p: P) => (
  <Svg {...p}><line x1="5" y1="12" x2="19" y2="12" /></Svg>
);

export const IconBell = (p: P) => (
  <Svg {...p}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></Svg>
);

export const IconVolume = (p: P) => (
  <Svg {...p}><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /></Svg>
);

export const IconStack = (p: P) => (
  <Svg {...p}><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></Svg>
);

export const IconDatabase = (p: P) => (
  <Svg {...p}><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /></Svg>
);

export const IconArrowLeft = (p: P) => (
  <Svg {...p}><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></Svg>
);

export const IconArrowRight = (p: P) => (
  <Svg {...p}><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></Svg>
);

export const IconSmartphone = (p: P) => (
  <Svg {...p}><rect x="7" y="2" width="10" height="20" rx="2" /><line x1="11" y1="18.5" x2="13" y2="18.5" /></Svg>
);

export const IconRotate = (p: P) => (
  <Svg {...p}><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></Svg>
);

/** Four nodes around a hub — a swarm working off one coordinator. */
export const IconSwarm = (p: P) => (
  <Svg {...p}><circle cx="12" cy="12" r="2.6" /><circle cx="12" cy="4" r="2" /><circle cx="20" cy="16" r="2" /><circle cx="4" cy="16" r="2" /><line x1="12" y1="6" x2="12" y2="9.4" /><line x1="14.2" y1="13.4" x2="18.2" y2="15" /><line x1="9.8" y1="13.4" x2="5.8" y2="15" /></Svg>
);

/** Linked nodes — a knowledge graph, not a brain or a floppy disk. */
export const IconMemory = (p: P) => (
  <Svg {...p}><circle cx="6" cy="7" r="2.4" /><circle cx="18" cy="6" r="2.2" /><circle cx="12" cy="14.5" r="2.6" /><circle cx="19" cy="18" r="2.2" /><line x1="8" y1="8.4" x2="10.2" y2="12.6" /><line x1="16.4" y1="7.6" x2="13.4" y2="12.3" /><line x1="14.3" y1="15.7" x2="17.1" y2="17.2" /><line x1="7.6" y1="5.4" x2="15.9" y2="6.2" /></Svg>
);

export const IconStop = (p: P) => (
  <Svg {...p}><rect x="6" y="6" width="12" height="12" rx="1.5" /></Svg>
);

export const IconSend = (p: P) => (
  <Svg {...p}><line x1="21" y1="3" x2="10.5" y2="13.5" /><polygon points="21 3 14.5 21 10.5 13.5 3 9.5 21 3" /></Svg>
);

export const IconBug = (p: P) => (
  <Svg {...p}><rect x="8" y="6" width="8" height="14" rx="4" /><path d="M9 7a3 3 0 0 1 6 0" /><line x1="8" y1="11" x2="4" y2="11" /><line x1="16" y1="11" x2="20" y2="11" /><line x1="8" y1="16" x2="4" y2="18" /><line x1="16" y1="16" x2="20" y2="18" /><line x1="8" y1="8" x2="4.5" y2="6" /><line x1="16" y1="8" x2="19.5" y2="6" /></Svg>
);

/**
 * The app mark — the brand's grid-A: thirteen dots on a 5×5 lattice with the
 * counter in coral. Primary dots take currentColor so the mark adapts to ink
 * or bone surfaces on its own; the coral never moves. Lives here so the
 * topbar, the empty state and the favicon can never drift apart.
 */
const GRID_A: ReadonlyArray<readonly [number, number]> = [
  [0, 2],
  [1, 1], [1, 3],
  [2, 0], [2, 1], [2, 2], [2, 3], [2, 4],
  [3, 0], [3, 4],
  [4, 0], [4, 4],
];

export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 102 102" aria-hidden>
      {GRID_A.map(([r, c]) => (
        <rect key={`${r}-${c}`} x={c * 21} y={r * 21} width="18" height="18" rx="2.2" fill="currentColor" />
      ))}
      <rect x="42" y="21" width="18" height="18" rx="2.2" fill="#f17455" />
    </svg>
  );
}
