import { create } from 'zustand';
import { api } from '../lib/api';
import type { Board, BoardCard } from '../lib/types';
import { uid } from '../lib/utils';

interface BoardState {
  board: Board;
  projectPath: string | null;
  load: (projectPath: string) => Promise<void>;
  persist: () => void;
  addCard: (columnId: string, title: string, description?: string) => BoardCard;
  moveCard: (cardId: string, columnId: string, beforeCardId?: string) => void;
  updateCard: (cardId: string, patch: Partial<BoardCard>) => void;
  removeCard: (cardId: string) => void;
}

const EMPTY: Board = { columns: [], cards: [] };

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export const useBoard = create<BoardState>((set, get) => ({
  board: EMPTY,
  projectPath: null,

  load: async (projectPath) => {
    try {
      const board = await api.get<Board>(`/api/board?project=${encodeURIComponent(projectPath)}`);
      set({ board, projectPath });
    } catch {
      set({ board: EMPTY, projectPath });
    }
  },

  persist: () => {
    const { board, projectPath } = get();
    if (!projectPath) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      api
        .put(`/api/board?project=${encodeURIComponent(projectPath)}`, board)
        .catch(() => undefined);
    }, 350);
  },

  addCard: (columnId, title, description = '') => {
    const card: BoardCard = {
      id: uid(),
      columnId,
      title,
      description,
      createdAt: Date.now(),
    };
    set((s) => ({ board: { ...s.board, cards: [...s.board.cards, card] } }));
    get().persist();
    return card;
  },

  moveCard: (cardId, columnId, beforeCardId) => {
    set((s) => {
      const card = s.board.cards.find((c) => c.id === cardId);
      if (!card) return s;
      const rest = s.board.cards.filter((c) => c.id !== cardId);
      const moved = { ...card, columnId };
      if (beforeCardId) {
        const idx = rest.findIndex((c) => c.id === beforeCardId);
        if (idx >= 0) {
          rest.splice(idx, 0, moved);
          return { board: { ...s.board, cards: rest } };
        }
      }
      return { board: { ...s.board, cards: [...rest, moved] } };
    });
    get().persist();
  },

  updateCard: (cardId, patch) => {
    set((s) => ({
      board: {
        ...s.board,
        cards: s.board.cards.map((c) => (c.id === cardId ? { ...c, ...patch } : c)),
      },
    }));
    get().persist();
  },

  removeCard: (cardId) => {
    set((s) => ({ board: { ...s.board, cards: s.board.cards.filter((c) => c.id !== cardId) } }));
    get().persist();
  },
}));
