import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sessionManager } from './sessions.js';
import { listProjects, addProject, removeProject, expandHome } from './projects.js';
import { filesRouter } from './routes/files.js';
import { gitRouter } from './routes/git.js';
import { boardRouter } from './routes/board.js';
import { pullsRouter } from './routes/pulls.js';
import { claudeRouter } from './routes/claude.js';
import { sessionsRouter } from './routes/sessions.js';
import { previewRouter } from './routes/preview.js';
import { agentsRouter } from './routes/agents.js';
import { swarmRouter } from './routes/swarm.js';
import { memoryRouter } from './routes/memory.js';
import { memoryEvents, stopAllWatching } from './memory/watch.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);

const app = express();
app.use(express.json({ limit: '25mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true, name: 'eaon-ade' }));

// /api/agents is a router now — it grew a config editor and a PATH probe.

app.get('/api/projects', (_req, res) => {
  res.json({ projects: listProjects() });
});

app.post('/api/projects', (req, res) => {
  try {
    res.json({ project: addProject(String(req.body?.path ?? '')) });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

app.delete('/api/projects/:id', (req, res) => {
  res.json({ ok: removeProject(req.params.id) });
});

app.use('/api/files', filesRouter);
app.use('/api/git', gitRouter);
app.use('/api/board', boardRouter);
app.use('/api/pulls', pullsRouter);
app.use('/api/claude', claudeRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/preview', previewRouter);
app.use('/api/agents', agentsRouter);
app.use('/api/swarm', swarmRouter);
app.use('/api/memory', memoryRouter);

// Production: serve the built client
const clientDist = resolve(__dirname, '../../client/dist');
if (process.env.NODE_ENV === 'production' && existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
    res.sendFile(join(clientDist, 'index.html'));
  });
}

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const clients = new Set<WebSocket>();

function broadcast(payload: unknown): void {
  const msg = JSON.stringify(payload);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}

sessionManager.on('output', (id: string, data: string) => {
  broadcast({ t: 'output', id, data });
});

sessionManager.on('exit', (id: string, code: number) => {
  broadcast({ t: 'exit', id, code });
});

sessionManager.on('removed', (id: string) => {
  broadcast({ t: 'removed', id });
});

sessionManager.on('agent-detected', (id: string, agentId: string, title: string) => {
  broadcast({ t: 'agent-detected', id, agentId, title });
});

// An agent writing a note through MCP is a different process entirely, so the
// only way the UI learns about it is the folder changing underneath us.
memoryEvents.on('changed', (project: string) => {
  broadcast({ t: 'memory-changed', project });
});

interface ClientMessage {
  t: string;
  id?: string;
  command?: string;
  args?: string[];
  cwd?: string;
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
  title?: string;
  projectId?: string;
  agentId?: string;
  data?: string;
}

wss.on('connection', (ws) => {
  clients.add(ws);

  ws.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }

    switch (msg.t) {
      case 'list': {
        ws.send(JSON.stringify({ t: 'sessions', sessions: sessionManager.list() }));
        break;
      }
      case 'spawn': {
        if (!msg.id || !msg.command || !msg.cwd) {
          ws.send(JSON.stringify({ t: 'error', id: msg.id, message: 'id, command and cwd are required' }));
          return;
        }
        const cwd = resolve(expandHome(msg.cwd));
        if (!existsSync(cwd)) {
          ws.send(JSON.stringify({ t: 'error', id: msg.id, message: `Directory not found: ${cwd}` }));
          return;
        }
        try {
          const meta = sessionManager.spawn({ ...msg, id: msg.id, command: msg.command, cwd } as never);
          broadcast({ t: 'spawned', session: meta });
        } catch (err) {
          ws.send(JSON.stringify({ t: 'error', id: msg.id, message: `Failed to spawn "${msg.command}": ${String(err)}` }));
        }
        break;
      }
      case 'attach': {
        if (!msg.id) return;
        const meta = sessionManager.get(msg.id);
        if (!meta) {
          ws.send(JSON.stringify({ t: 'error', id: msg.id, message: 'Session not found' }));
          return;
        }
        ws.send(JSON.stringify({ t: 'replay', id: msg.id, session: meta, data: sessionManager.replay(msg.id) ?? '' }));
        break;
      }
      case 'input': {
        if (msg.id && typeof msg.data === 'string') sessionManager.write(msg.id, msg.data);
        break;
      }
      case 'resize': {
        if (msg.id && msg.cols && msg.rows) sessionManager.resize(msg.id, msg.cols, msg.rows);
        break;
      }
      case 'rename': {
        if (msg.id && msg.title) {
          sessionManager.rename(msg.id, msg.title);
          broadcast({ t: 'renamed', id: msg.id, title: msg.title });
        }
        break;
      }
      case 'kill': {
        if (msg.id) sessionManager.kill(msg.id);
        break;
      }
      case 'remove': {
        if (msg.id) sessionManager.remove(msg.id);
        break;
      }
    }
  });

  ws.on('close', () => clients.delete(ws));
});

process.on('SIGINT', () => {
  stopAllWatching();
  sessionManager.shutdown();
  process.exit(0);
});
process.on('SIGTERM', () => {
  stopAllWatching();
  sessionManager.shutdown();
  process.exit(0);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Eaon ADE server listening on http://127.0.0.1:${PORT}`);
});
