import { Router } from 'express';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { expandHome } from '../projects.js';

export const pullsRouter = Router();

/**
 * Pull requests come through the `gh` CLI rather than a raw GitHub token.
 * `gh` already holds the user's credentials in the system keyring, so Eaon
 * never sees, stores, or transmits a token of its own — and whatever repos
 * the user can already read are exactly the ones this can read.
 */
function gh(args: string[], cwd: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      'gh',
      args,
      { cwd, maxBuffer: 32 * 1024 * 1024, timeout: 25_000 },
      (err, stdout, stderr) => {
        if (err) reject(new Error(stderr.trim() || err.message));
        else resolvePromise(stdout);
      },
    );
  });
}

function resolvePath(p: string): string {
  return resolve(expandHome(p));
}

/** Distinguish "gh isn't set up" from "this repo has no PRs", so the UI can say which. */
function classify(message: string): { status: number; code: string; error: string } {
  const m = message.toLowerCase();
  if (m.includes('enoent') || m.includes('not found') && m.includes('gh')) {
    return { status: 503, code: 'gh-missing', error: 'The GitHub CLI (gh) is not installed.' };
  }
  if (m.includes('gh auth login') || m.includes('authentication')) {
    return { status: 401, code: 'gh-unauthenticated', error: 'Run `gh auth login` to see pull requests.' };
  }
  if (m.includes('not a git repository')) {
    return { status: 400, code: 'not-a-repo', error: 'This project is not a git repository.' };
  }
  if (m.includes('no git remote') || m.includes('could not determine') || m.includes('none of the git remotes')) {
    return { status: 400, code: 'no-remote', error: 'This repository has no GitHub remote.' };
  }
  return { status: 502, code: 'gh-error', error: message };
}

function fail(res: import('express').Response, err: unknown): void {
  const { status, code, error } = classify(String(err instanceof Error ? err.message : err));
  res.status(status).json({ code, error });
}

const LIST_FIELDS = [
  'number',
  'title',
  'state',
  'isDraft',
  'author',
  'headRefName',
  'baseRefName',
  'updatedAt',
  'url',
  'additions',
  'deletions',
  'changedFiles',
  'reviewDecision',
  'statusCheckRollup',
  'labels',
].join(',');

pullsRouter.get('/', async (req, res) => {
  const cwd = resolvePath(String(req.query.path ?? ''));
  const state = String(req.query.state ?? 'open');
  const allowed = new Set(['open', 'closed', 'merged', 'all']);
  try {
    const raw = await gh(
      ['pr', 'list', '--state', allowed.has(state) ? state : 'open', '--limit', '30', '--json', LIST_FIELDS],
      cwd,
    );
    res.json({ pulls: JSON.parse(raw) });
  } catch (err) {
    fail(res, err);
  }
});

pullsRouter.get('/repo', async (req, res) => {
  const cwd = resolvePath(String(req.query.path ?? ''));
  try {
    const raw = await gh(['repo', 'view', '--json', 'nameWithOwner,defaultBranchRef,url'], cwd);
    res.json(JSON.parse(raw));
  } catch (err) {
    fail(res, err);
  }
});

// `gh pr view` and `gh pr list` do not accept the same field set — there is no
// `merged` on view, for instance; merged state comes from `state`/`mergedAt`.
const DETAIL_FIELDS = [
  'number',
  'title',
  'body',
  'state',
  'isDraft',
  'mergeable',
  'mergeStateStatus',
  'mergedAt',
  'author',
  'headRefName',
  'baseRefName',
  'updatedAt',
  'createdAt',
  'url',
  'additions',
  'deletions',
  'changedFiles',
  'files',
  'assignees',
  'reviewRequests',
  'reviewDecision',
  'latestReviews',
  'statusCheckRollup',
  'labels',
  'comments',
].join(',');

pullsRouter.get('/:number', async (req, res) => {
  const cwd = resolvePath(String(req.query.path ?? ''));
  const number = String(req.params.number);
  if (!/^\d+$/.test(number)) return res.status(400).json({ error: 'bad pr number' });
  try {
    const raw = await gh(['pr', 'view', number, '--json', DETAIL_FIELDS], cwd);
    res.json(JSON.parse(raw));
  } catch (err) {
    fail(res, err);
  }
});

/** Unified diff for one PR, used by the Files changed tab. */
pullsRouter.get('/:number/diff', async (req, res) => {
  const cwd = resolvePath(String(req.query.path ?? ''));
  const number = String(req.params.number);
  if (!/^\d+$/.test(number)) return res.status(400).json({ error: 'bad pr number' });
  try {
    const diff = await gh(['pr', 'diff', number], cwd);
    res.json({ diff });
  } catch (err) {
    fail(res, err);
  }
});
