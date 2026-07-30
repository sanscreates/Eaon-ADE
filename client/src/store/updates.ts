import { create } from 'zustand';
import { desktop, type UpdateState } from '../lib/desktop';

/* ═══════════════════════════════════════════════════════════════════════════
   Update state, mirrored from the shell.

   The main process owns the truth here — it is the only side that can reach
   the network on the app's behalf and the only side that survives a window
   reload. This store subscribes and re-renders; it never decides anything.
   ═══════════════════════════════════════════════════════════════════════════ */

interface UpdatesStore {
  state: UpdateState | null;
  /** The banner is dismissed per-sighting; skipping is what persists. */
  bannerHidden: boolean;

  init: () => void;
  check: () => Promise<void>;
  download: () => void;
  openPage: () => void;
  skip: () => void;
  hideBanner: () => void;
  setAutoCheck: (on: boolean) => void;
}

export const useUpdates = create<UpdatesStore>((set, get) => ({
  state: null,
  bannerHidden: false,

  init: () => {
    const updates = desktop?.updates;
    if (!updates) return;
    void updates.state().then((s) => set({ state: s }));
    updates.onState((s) => {
      set((prev) => ({
        state: s,
        // A newly-found version deserves to be seen even if the last banner
        // was waved away; anything else leaves the dismissal alone.
        bannerHidden:
          s.status === 'available' && s.version !== prev.state?.version ? false : prev.bannerHidden,
      }));
    });
  },

  check: async () => {
    const updates = desktop?.updates;
    if (!updates) return;
    set({ bannerHidden: false });
    const s = await updates.check({ silent: false });
    set({ state: s });
  },

  download: () => {
    void desktop?.updates?.download();
  },

  openPage: () => {
    void desktop?.updates?.openPage();
  },

  skip: () => {
    set({ bannerHidden: true });
    void desktop?.updates?.skip();
  },

  hideBanner: () => set({ bannerHidden: true }),

  setAutoCheck: (on) => {
    void desktop?.updates?.setAutoCheck(on).then((s) => set({ state: s }));
    // Optimistic, so the switch does not lag the click.
    const current = get().state;
    if (current) set({ state: { ...current, autoCheck: on } });
  },
}));

/** Bytes → "84.2 MB", for a download the user is deciding whether to start. */
export function formatSize(bytes: number | null | undefined): string | null {
  if (!bytes || bytes <= 0) return null;
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
}
