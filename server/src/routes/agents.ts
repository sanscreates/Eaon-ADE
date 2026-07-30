import { Router } from 'express';
import { detectAgents, invalidateAgentCache, probeCommand } from '../agents.js';
import { readAgentsConfig, writeAgentsConfig } from '../agentConfig.js';

export const agentsRouter = Router();

agentsRouter.get('/', async (_req, res) => {
  res.json({ agents: await detectAgents() });
});

/** The raw config, so the editor can round-trip exactly what it saved. */
agentsRouter.get('/config', (_req, res) => {
  res.json(readAgentsConfig());
});

agentsRouter.put('/config', async (req, res) => {
  try {
    const config = writeAgentsConfig(req.body);
    // What resolves changes with the config, so the cached answer is now wrong.
    invalidateAgentCache();
    // Return the freshly detected list alongside: every save changes what is
    // installed or how it launches, and the client would only have to ask.
    res.json({ config, agents: await detectAgents() });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/** Does this command resolve? Powers the "not found" hint while typing. */
agentsRouter.get('/probe', async (req, res) => {
  const command = String(req.query.command ?? '');
  if (!command.trim()) return res.json({ resolved: null });
  res.json({ resolved: probeCommand(command) });
});
