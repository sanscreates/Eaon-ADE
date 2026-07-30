import { Router } from 'express';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { expandHome } from '../projects.js';
import type { Board } from '../types.js';

export const boardRouter = Router();

function boardFile(projectPath: string): string {
  return join(resolve(expandHome(projectPath)), '.eaon', 'board.json');
}

function defaultBoard(): Board {
  return {
    columns: [
      { id: 'backlog', title: 'Backlog' },
      { id: 'todo', title: 'Todo' },
      { id: 'in-progress', title: 'In Progress' },
      { id: 'in-review', title: 'In Review' },
      { id: 'done', title: 'Done' },
    ],
    cards: [],
  };
}

boardRouter.get('/', (req, res) => {
  const project = String(req.query.project ?? '');
  if (!project) return res.status(400).json({ error: 'project required' });
  const file = boardFile(project);
  if (!existsSync(file)) return res.json(defaultBoard());
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Board;
    if (!Array.isArray(parsed.columns) || !Array.isArray(parsed.cards)) {
      return res.json(defaultBoard());
    }
    res.json(parsed);
  } catch {
    res.json(defaultBoard());
  }
});

boardRouter.put('/', (req, res) => {
  const project = String(req.query.project ?? '');
  const board = req.body as Board;
  if (!project) return res.status(400).json({ error: 'project required' });
  if (!board || !Array.isArray(board.columns) || !Array.isArray(board.cards)) {
    return res.status(400).json({ error: 'Invalid board' });
  }
  try {
    const file = boardFile(project);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(board, null, 2));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
