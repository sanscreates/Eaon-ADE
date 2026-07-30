import { create } from 'zustand';
import { api } from '../lib/api';
import { useSettings } from './settings';
import type { GitStatus } from '../lib/types';

interface GitState {
  status: GitStatus | null;
  projectPath: string | null;
  refresh: (path: string) => Promise<void>;
  startAuto: (path: string) => void;
  stopAuto: () => void;
  /** Re-read the settings and rebuild the timer; called after they change. */
  syncWithSettings: () => void;
}

let timer: ReturnType<typeof setInterval> | null = null;

export const useGit = create<GitState>((set, get) => ({
  status: null,
  projectPath: null,

  refresh: async (path) => {
    try {
      const status = await api.get<GitStatus>(`/api/git/status?path=${encodeURIComponent(path)}`);
      set({ status, projectPath: path });
    } catch {
      set({ status: null, projectPath: path });
    }
  },

  startAuto: (path) => {
    get().stopAuto();
    get().refresh(path);
    const { gitAutoRefresh, gitRefreshSeconds } = useSettings.getState();
    if (!gitAutoRefresh) return;
    timer = setInterval(() => get().refresh(path), gitRefreshSeconds * 1000);
  },

  stopAuto: () => {
    if (timer) clearInterval(timer);
    timer = null;
  },

  syncWithSettings: () => {
    const { projectPath } = get();
    if (!projectPath) return;
    // startAuto re-reads the interval and honours the master toggle.
    get().startAuto(projectPath);
  },
}));

// Follow the settings without each call site having to remember to nudge us.
useSettings.subscribe((s, prev) => {
  if (s.gitAutoRefresh !== prev.gitAutoRefresh || s.gitRefreshSeconds !== prev.gitRefreshSeconds) {
    useGit.getState().syncWithSettings();
  }
});
