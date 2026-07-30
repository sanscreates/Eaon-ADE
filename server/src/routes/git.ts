import { Router } from 'express';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expandHome } from '../projects.js';

export const gitRouter = Router();

function git(args: string[], cwd: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile('git', args, { cwd, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr.trim() || err.message));
      else resolvePromise(stdout);
    });
  });
}

function resolvePath(p: string): string {
  return resolve(expandHome(p));
}

gitRouter.get('/status', async (req, res) => {
  const cwd = resolvePath(String(req.query.path ?? ''));
  try {
    await git(['rev-parse', '--is-inside-work-tree'], cwd);
  } catch {
    return res.json({ isRepo: false });
  }
  try {
    const [branchOut, porcelain, upstreamCount] = await Promise.all([
      git(['branch', '--show-current'], cwd).catch(() => ''),
      git(['status', '--porcelain'], cwd),
      git(['rev-list', '--left-right', '--count', 'HEAD...@{u}'], cwd).catch(() => ''),
    ]);

    const files = porcelain
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const x = line[0];
        const y = line[1];
        let filePath = line.slice(3);
        if (filePath.includes(' -> ')) filePath = filePath.split(' -> ')[1];
        return { path: filePath, index: x.trim(), worktree: y.trim() };
      });

    let ahead = 0;
    let behind = 0;
    const parts = upstreamCount.trim().split(/\s+/);
    if (parts.length === 2) {
      ahead = Number(parts[0]) || 0;
      behind = Number(parts[1]) || 0;
    }

    res.json({
      isRepo: true,
      branch: branchOut.trim() || 'HEAD',
      files,
      ahead,
      behind,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

gitRouter.get('/diff', async (req, res) => {
  const cwd = resolvePath(String(req.query.path ?? ''));
  const file = String(req.query.file ?? '');
  if (!file) return res.status(400).json({ error: 'file required' });
  try {
    const original = await git(['show', `HEAD:${file}`], cwd).catch(() => '');
    let modified = '';
    try {
      modified = readFileSync(join(cwd, file), 'utf8');
    } catch {
      modified = '';
    }
    res.json({ file, original, modified });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

gitRouter.get('/branches', async (req, res) => {
  const cwd = resolvePath(String(req.query.path ?? ''));
  try {
    const out = await git(['branch', '--format=%(refname:short)'], cwd);
    const current = (await git(['branch', '--show-current'], cwd)).trim();
    res.json({
      branches: out.split('\n').map((b) => b.trim()).filter(Boolean),
      current,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

gitRouter.get('/worktrees', async (req, res) => {
  const cwd = resolvePath(String(req.query.path ?? ''));
  try {
    const out = await git(['worktree', 'list', '--porcelain'], cwd);
    const worktrees: { path: string; branch: string; head: string }[] = [];
    let current: { path?: string; branch?: string; head?: string } = {};
    for (const line of out.split('\n')) {
      if (line.startsWith('worktree ')) {
        if (current.path) worktrees.push(current as never);
        current = { path: line.slice(9) };
      } else if (line.startsWith('HEAD ')) {
        current.head = line.slice(5);
      } else if (line.startsWith('branch ')) {
        current.branch = line.slice(7).replace('refs/heads/', '');
      } else if (line.trim() === '' && current.path) {
        worktrees.push({ path: current.path, branch: current.branch ?? 'detached', head: current.head ?? '' });
        current = {};
      }
    }
    if (current.path) {
      worktrees.push({ path: current.path, branch: current.branch ?? 'detached', head: current.head ?? '' });
    }
    res.json({ worktrees });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

gitRouter.post('/worktree', async (req, res) => {
  const { repoPath, name, baseRef } = req.body ?? {};
  if (typeof repoPath !== 'string' || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'repoPath and name required' });
  }
  const branch = name.trim().replace(/\s+/g, '-');
  if (!/^[\w.\-/]+$/.test(branch)) {
    return res.status(400).json({ error: 'Invalid branch name' });
  }
  const root = resolvePath(repoPath);
  const target = join(root, '.eaon', 'worktrees', branch.replace(/\//g, '__'));
  try {
    await git(['worktree', 'add', '-b', branch, target, String(baseRef || 'HEAD')], root);
    res.json({ ok: true, path: target, branch });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

gitRouter.post('/commit', async (req, res) => {
  const { path: p, message } = req.body ?? {};
  if (typeof p !== 'string' || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'path and message required' });
  }
  const cwd = resolvePath(p);
  try {
    await git(['add', '-A'], cwd);
    const out = await git(['commit', '-m', message.trim()], cwd);
    res.json({ ok: true, output: out.trim() });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});
