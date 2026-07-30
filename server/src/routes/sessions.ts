import { Router } from 'express';
import { sessionManager } from '../sessions.js';

export const sessionsRouter = Router();

/** Snapshot of every session the PTY manager owns, live or exited. */
sessionsRouter.get('/', (_req, res) => {
  res.json({
    sessions: sessionManager.list().map((s) => ({
      id: s.id,
      title: s.title,
      command: s.command,
      cwd: s.cwd,
      pid: s.pid,
      agentId: s.agentId,
      projectId: s.projectId,
      createdAt: s.createdAt,
      exitCode: s.exitCode,
      buffered: sessionManager.replay(s.id)?.length ?? 0,
    })),
  });
});

/** Tear down every session. Clients prune their panes off the 'removed' broadcasts. */
sessionsRouter.post('/close-all', (_req, res) => {
  const ids = sessionManager.list().map((s) => s.id);
  for (const id of ids) sessionManager.remove(id);
  res.json({ ok: true, closed: ids.length });
});
