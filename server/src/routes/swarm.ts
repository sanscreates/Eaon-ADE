import { Router } from 'express';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expandHome } from '../projects.js';
import type { SwarmConfig, SwarmMember, SwarmRole } from '../types.js';

export const swarmRouter = Router();

/* The roster lives beside the board, in the repo: who is on the team and what
   each role is briefed to do is a property of the project, and worth committing
   and reviewing like any other convention. (Which CLIs exist on this laptop is
   the opposite, and lives in ~/.eaon/agents.json.) */
function swarmFile(projectPath: string): string {
  return join(resolve(expandHome(projectPath)), '.eaon', 'swarm.json');
}

/**
 * The four roles, and what each is actually told. These are the product's
 * opinion about how a swarm divides work — a coordinator that plans instead of
 * coding, a scout that reads instead of writing, a reviewer that reports
 * instead of fixing — and every word is editable per project.
 */
export const DEFAULT_ROLES: SwarmRole[] = [
  {
    id: 'coordinator',
    name: 'Coordinator',
    charter:
      'You are the coordinator for this workspace. Break the task into concrete, independently workable pieces, decide the order they should happen in, and state plainly which piece each other agent should take. Do not write application code yourself — your output is a plan someone else can execute without asking you a follow-up question.',
  },
  {
    id: 'builder',
    name: 'Builder',
    charter:
      'You are the builder. Implement what you are given: write the code, run the tests, and keep going until it actually works rather than until it looks right. Prefer small verified steps over one large unverified one, and say explicitly what you changed and what you ran to check it.',
  },
  {
    id: 'scout',
    name: 'Scout',
    charter:
      'You are the scout. Explore and report: find the files that matter, trace how the current behaviour actually works, and summarise what you found with file:line references. Do not modify any files — your job is to make the next agent fast, not to make the change yourself.',
  },
  {
    id: 'reviewer',
    name: 'Reviewer',
    charter:
      'You are the reviewer. Read the current diff and look for real defects: wrong behaviour, unhandled cases, broken assumptions. For each one give a concrete failure case and a severity. Do not fix anything unless you are explicitly asked to — report first.',
  },
];

function defaultMembers(): SwarmMember[] {
  return DEFAULT_ROLES.map((role) => ({
    id: randomUUID(),
    roleId: role.id,
    // Left blank on purpose: the client fills it with whatever agent is
    // actually installed, which the server has no business guessing here.
    agentId: '',
    enabled: true,
    notes: '',
  }));
}

export function defaultSwarm(): SwarmConfig {
  return { roles: DEFAULT_ROLES.map((r) => ({ ...r })), members: defaultMembers() };
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/**
 * Sanitised on the way in for the same reason the agents config is: this drives
 * real command lines later, and a bad write should fail here where the cause is
 * obvious rather than at spawn time where it is not.
 */
function sanitize(raw: unknown): SwarmConfig {
  if (!raw || typeof raw !== 'object') return defaultSwarm();
  const o = raw as Record<string, unknown>;

  const roles: SwarmRole[] = [];
  const seenRoles = new Set<string>();
  for (const entry of Array.isArray(o.roles) ? o.roles : []) {
    if (!entry || typeof entry !== 'object') continue;
    const r = entry as Record<string, unknown>;
    const id = str(r.id).trim();
    if (!id || seenRoles.has(id)) continue;
    seenRoles.add(id);
    roles.push({ id, name: str(r.name).trim() || id, charter: str(r.charter) });
  }
  // A config with no roles left could never dispatch anything; fall back rather
  // than persist something the console cannot render.
  if (roles.length === 0) roles.push(...DEFAULT_ROLES.map((r) => ({ ...r })));

  const members: SwarmMember[] = [];
  const seenMembers = new Set<string>();
  for (const entry of Array.isArray(o.members) ? o.members : []) {
    if (!entry || typeof entry !== 'object') continue;
    const m = entry as Record<string, unknown>;
    const id = str(m.id).trim() || randomUUID();
    if (seenMembers.has(id)) continue;
    const roleId = str(m.roleId).trim();
    // Drop members pointing at a role that no longer exists — otherwise they
    // are invisible in the console but still dispatched to.
    if (!roles.some((r) => r.id === roleId)) continue;
    seenMembers.add(id);
    members.push({
      id,
      roleId,
      agentId: str(m.agentId).trim(),
      enabled: typeof m.enabled === 'boolean' ? m.enabled : true,
      notes: str(m.notes),
    });
  }

  return { roles, members };
}

/** The shipped charters, for "reset to defaults" without a second copy client-side. */
swarmRouter.get('/defaults', (_req, res) => {
  res.json({ roles: DEFAULT_ROLES.map((r) => ({ ...r })) });
});

swarmRouter.get('/', (req, res) => {
  const project = String(req.query.project ?? '');
  if (!project) return res.status(400).json({ error: 'project required' });
  const file = swarmFile(project);
  if (!existsSync(file)) return res.json(defaultSwarm());
  try {
    res.json(sanitize(JSON.parse(readFileSync(file, 'utf8'))));
  } catch {
    res.json(defaultSwarm());
  }
});

swarmRouter.put('/', (req, res) => {
  const project = String(req.query.project ?? '');
  if (!project) return res.status(400).json({ error: 'project required' });
  try {
    const config = sanitize(req.body);
    const file = swarmFile(project);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(config, null, 2));
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
