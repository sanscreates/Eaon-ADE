/* Watches a project's memory folder so the UI can react to notes written by
   somebody else — which, for a shared memory, is the normal case rather than
   the exception. An agent calling create_memory through MCP writes a file this
   server never hears about over HTTP; without this the graph would only update
   when the user happened to click something. */

import { EventEmitter } from 'node:events';
import { mkdirSync, watch, type FSWatcher } from 'node:fs';
import { resolve } from 'node:path';
import { expandHome, memoryDir } from './store.js';

export const memoryEvents = new EventEmitter();

interface Entry {
  watcher: FSWatcher;
  timer: NodeJS.Timeout | null;
  lastUsed: number;
}

const watchers = new Map<string, Entry>();

/** One project's memory folder is small; a handful of open watchers is plenty. */
const MAX_WATCHERS = 8;

/** Coalesce the burst of events a single atomic write produces (temp + rename). */
const DEBOUNCE_MS = 150;

function evictOldest(): void {
  let oldest: [string, Entry] | null = null;
  for (const entry of watchers.entries()) {
    if (!oldest || entry[1].lastUsed < oldest[1].lastUsed) oldest = entry;
  }
  if (!oldest) return;
  stopWatching(oldest[0]);
}

export function ensureWatching(projectPath: string): void {
  const project = resolve(expandHome(String(projectPath ?? '').trim()));
  if (!project) return;

  const existing = watchers.get(project);
  if (existing) {
    existing.lastUsed = Date.now();
    return;
  }

  const dir = memoryDir(project);
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    return;
  }

  let watcher: FSWatcher;
  try {
    watcher = watch(dir, { persistent: false });
  } catch {
    return;
  }

  const entry: Entry = { watcher, timer: null, lastUsed: Date.now() };

  // One 'change' event covers both kinds — fs.watch reports creates, renames
  // and edits through the same channel, with the kind as its first argument.
  watcher.on('change', () => {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.timer = null;
      memoryEvents.emit('changed', project);
    }, DEBOUNCE_MS);
  });
  watcher.on('error', () => stopWatching(project));

  watchers.set(project, entry);
  if (watchers.size > MAX_WATCHERS) evictOldest();
}

export function stopWatching(projectPath: string): void {
  const project = resolve(expandHome(projectPath));
  const entry = watchers.get(project);
  if (!entry) return;
  if (entry.timer) clearTimeout(entry.timer);
  try {
    entry.watcher.close();
  } catch {
    // already gone
  }
  watchers.delete(project);
}

export function stopAllWatching(): void {
  for (const key of [...watchers.keys()]) stopWatching(key);
}
