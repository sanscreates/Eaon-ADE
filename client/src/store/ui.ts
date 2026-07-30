import { create } from 'zustand';
import { uid } from '../lib/utils';

export interface OpenFile {
  path: string;
  content: string;
  diff?: { original: string; modified: string };
}

export interface Toast {
  id: string;
  text: string;
  kind: 'info' | 'error' | 'success';
}

export interface SessionPrefill {
  agentId?: string;
  cwd?: string;
  prompt?: string;
}

export interface ConfirmRequest {
  title: string;
  body?: string;
  confirmLabel?: string;
  /** Red confirm button for destructive actions. */
  danger?: boolean;
  onConfirm: () => void;
}

interface UiState {
  sidebarOpen: boolean;
  paletteOpen: boolean;
  newSessionOpen: boolean;
  sessionPrefill: SessionPrefill | null;
  newWorktreeOpen: boolean;
  addProjectOpen: boolean;
  openFile: OpenFile | null;
  fileDirty: boolean;
  toasts: Toast[];
  confirm: ConfirmRequest | null;
  worktreesVersion: number;
  bumpWorktrees: () => void;
  askConfirm: (req: ConfirmRequest) => void;
  closeConfirm: () => void;

  toggleSidebar: () => void;
  setPaletteOpen: (open: boolean) => void;
  openNewSession: (prefill?: SessionPrefill) => void;
  closeNewSession: () => void;
  setNewWorktreeOpen: (open: boolean) => void;
  setAddProjectOpen: (open: boolean) => void;
  openInEditor: (file: OpenFile) => void;
  closeEditorFile: () => void;
  setFileDirty: (dirty: boolean) => void;
  toast: (text: string, kind?: Toast['kind']) => void;
  dismissToast: (id: string) => void;
}

export const useUi = create<UiState>((set, get) => ({
  sidebarOpen: localStorage.getItem('eaon.sidebar') !== '0',
  paletteOpen: false,
  newSessionOpen: false,
  sessionPrefill: null,
  newWorktreeOpen: false,
  addProjectOpen: false,
  openFile: null,
  fileDirty: false,
  toasts: [],
  confirm: null,
  worktreesVersion: 0,
  bumpWorktrees: () => set((s) => ({ worktreesVersion: s.worktreesVersion + 1 })),
  askConfirm: (req) => set({ confirm: req }),
  closeConfirm: () => set({ confirm: null }),

  toggleSidebar: () =>
    set((s) => {
      localStorage.setItem('eaon.sidebar', s.sidebarOpen ? '0' : '1');
      return { sidebarOpen: !s.sidebarOpen };
    }),

  setPaletteOpen: (open) => set({ paletteOpen: open }),

  openNewSession: (prefill) =>
    set({ newSessionOpen: true, sessionPrefill: prefill ?? null }),

  closeNewSession: () => set({ newSessionOpen: false, sessionPrefill: null }),

  setNewWorktreeOpen: (open) => set({ newWorktreeOpen: open }),

  setAddProjectOpen: (open) => set({ addProjectOpen: open }),

  openInEditor: (file) => {
    set({ openFile: file, fileDirty: false });
  },

  closeEditorFile: () => set({ openFile: null, fileDirty: false }),

  setFileDirty: (dirty) => set({ fileDirty: dirty }),

  toast: (text, kind = 'info') => {
    const id = uid();
    set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
    setTimeout(() => get().dismissToast(id), 4500);
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
