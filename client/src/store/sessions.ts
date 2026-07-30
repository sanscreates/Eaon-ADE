import { create } from 'zustand';
import type { SessionMeta, SessionStatus } from '../lib/types';

interface SessionsState {
  sessions: Record<string, SessionMeta>;
  status: Record<string, SessionStatus>;
  order: string[];
  upsert: (meta: SessionMeta) => void;
  upsertMany: (metas: SessionMeta[]) => void;
  setStatus: (id: string, status: SessionStatus) => void;
  setExit: (id: string, code: number) => void;
  rename: (id: string, title: string) => void;
  setAgent: (id: string, agentId: string, title?: string) => void;
  removeLocal: (id: string) => void;
}

export const useSessions = create<SessionsState>((set) => ({
  sessions: {},
  status: {},
  order: [],

  upsert: (meta) =>
    set((s) => ({
      sessions: { ...s.sessions, [meta.id]: meta },
      order: s.order.includes(meta.id) ? s.order : [...s.order, meta.id],
      status: s.status[meta.id]
        ? s.status
        : { ...s.status, [meta.id]: meta.exitCode !== undefined ? 'exited' : 'spawning' },
    })),

  upsertMany: (metas) =>
    set((s) => {
      const sessions = { ...s.sessions };
      const status = { ...s.status };
      const order = [...s.order];
      for (const meta of metas) {
        sessions[meta.id] = meta;
        if (!order.includes(meta.id)) order.push(meta.id);
        if (!status[meta.id]) status[meta.id] = meta.exitCode !== undefined ? 'exited' : 'idle';
      }
      return { sessions, status, order };
    }),

  setStatus: (id, status) =>
    set((s) => (s.status[id] === status ? s : { status: { ...s.status, [id]: status } })),

  setExit: (id, code) =>
    set((s) => ({
      status: { ...s.status, [id]: 'exited' },
      sessions: s.sessions[id]
        ? { ...s.sessions, [id]: { ...s.sessions[id], exitCode: code } }
        : s.sessions,
    })),

  rename: (id, title) =>
    set((s) => ({
      sessions: s.sessions[id] ? { ...s.sessions, [id]: { ...s.sessions[id], title } } : s.sessions,
    })),

  setAgent: (id, agentId, title) =>
    set((s) => ({
      sessions: s.sessions[id]
        ? { ...s.sessions, [id]: { ...s.sessions[id], agentId, ...(title !== undefined ? { title } : {}) } }
        : s.sessions,
    })),

  removeLocal: (id) =>
    set((s) => {
      const sessions = { ...s.sessions };
      const status = { ...s.status };
      delete sessions[id];
      delete status[id];
      return { sessions, status, order: s.order.filter((x) => x !== id) };
    }),
}));

// --- Live status detection -------------------------------------------------

const ANSI_RE = /[\u001b\u009b][[\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
const WAITING_RE = /(\(y\/n\)|\[Y\/n\]|\[y\/N\]|do you want to proceed|allow\?|❯\s*$|press enter to continue)/im;

const idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
const tails = new Map<string, string>();

export function noteSessionOutput(id: string, rawData: string): void {
  const store = useSessions.getState();
  if (store.status[id] === 'exited') return;
  store.setStatus(id, 'working');

  const tail = ((tails.get(id) ?? '') + rawData.replace(ANSI_RE, '')).slice(-600);
  tails.set(id, tail);

  const existing = idleTimers.get(id);
  if (existing) clearTimeout(existing);
  idleTimers.set(
    id,
    setTimeout(() => {
      const state = useSessions.getState();
      if (state.status[id] === 'exited') return;
      state.setStatus(id, WAITING_RE.test(tails.get(id) ?? '') ? 'waiting' : 'idle');
    }, 1400),
  );
}

export function noteSessionInput(id: string): void {
  const store = useSessions.getState();
  if (store.status[id] === 'exited') return;
  if (store.status[id] === 'waiting' || store.status[id] === 'idle') store.setStatus(id, 'working');
}

export function clearSessionTracking(id: string): void {
  const timer = idleTimers.get(id);
  if (timer) clearTimeout(timer);
  idleTimers.delete(id);
  tails.delete(id);
}
