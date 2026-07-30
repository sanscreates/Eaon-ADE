import { Router } from 'express';
import {
  readdirSync,
  statSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { expandHome } from '../projects.js';

export const filesRouter = Router();

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out', 'coverage']);
const MAX_READ_BYTES = 5 * 1024 * 1024;

interface TreeNode {
  name: string;
  path: string;
  kind: 'file' | 'dir';
  children?: TreeNode[];
}

function buildTree(dir: string, depth: number, showHidden: boolean): TreeNode[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const nodes: TreeNode[] = [];
  const sorted = entries
    .filter((e) => (showHidden ? true : !e.name.startsWith('.')) && !SKIP_DIRS.has(e.name))
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
    .slice(0, 300);

  for (const entry of sorted) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        path: full,
        kind: 'dir',
        children: depth > 1 ? buildTree(full, depth - 1, showHidden) : undefined,
      });
    } else if (entry.isFile()) {
      nodes.push({ name: entry.name, path: full, kind: 'file' });
    }
  }
  return nodes;
}

function resolvePath(p: string): string {
  return resolve(expandHome(p));
}

filesRouter.get('/tree', (req, res) => {
  const root = resolvePath(String(req.query.path ?? ''));
  const depth = Math.min(8, Math.max(1, Number(req.query.depth ?? 3)));
  const showHidden = req.query.hidden === '1';
  if (!existsSync(root)) return res.status(404).json({ error: 'Path not found' });
  res.json({ root, tree: buildTree(root, depth, showHidden) });
});

filesRouter.get('/dirs', (req, res) => {
  const root = resolvePath(String(req.query.path ?? '~'));
  try {
    const dirs = readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name))
      .map((e) => ({ name: e.name, path: join(root, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 200);
    res.json({ root, parent: dirname(root), dirs });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

filesRouter.get('/read', (req, res) => {
  const file = resolvePath(String(req.query.path ?? ''));
  try {
    const stat = statSync(file);
    if (!stat.isFile()) return res.status(400).json({ error: 'Not a file' });
    if (stat.size > MAX_READ_BYTES) return res.status(413).json({ error: 'File too large' });
    const buf = readFileSync(file);
    if (buf.includes(0)) return res.status(415).json({ error: 'Binary file' });
    res.json({ path: file, content: buf.toString('utf8'), size: stat.size });
  } catch {
    res.status(404).json({ error: 'File not found' });
  }
});

filesRouter.put('/write', (req, res) => {
  const { path: p, content } = req.body ?? {};
  if (typeof p !== 'string' || typeof content !== 'string') {
    return res.status(400).json({ error: 'path and content required' });
  }
  const file = resolvePath(p);
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content, 'utf8');
    res.json({ ok: true, path: file });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

filesRouter.post('/create', (req, res) => {
  const { path: p, kind } = req.body ?? {};
  if (typeof p !== 'string') return res.status(400).json({ error: 'path required' });
  const target = resolvePath(p);
  try {
    if (kind === 'dir') {
      mkdirSync(target, { recursive: true });
    } else {
      mkdirSync(dirname(target), { recursive: true });
      if (!existsSync(target)) writeFileSync(target, '', 'utf8');
    }
    res.json({ ok: true, path: target });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
