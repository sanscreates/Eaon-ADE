import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ProjectInfo } from './types.js';

const CONFIG_DIR = join(homedir(), '.eaon');
const PROJECTS_FILE = join(CONFIG_DIR, 'projects.json');

export function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

function load(): ProjectInfo[] {
  try {
    const raw = readFileSync(PROJECTS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(projects: ProjectInfo[]): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2));
}

export function listProjects(): ProjectInfo[] {
  return load().filter((p) => existsSync(p.path));
}

export function addProject(rawPath: string): ProjectInfo {
  const path = resolve(expandHome(rawPath.trim()));
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    throw new Error(`Not a directory: ${path}`);
  }
  const projects = load();
  const existing = projects.find((p) => p.path === path);
  if (existing) return existing;
  const project: ProjectInfo = {
    id: randomUUID(),
    name: basename(path) || path,
    path,
    addedAt: Date.now(),
  };
  projects.push(project);
  save(projects);
  return project;
}

export function removeProject(id: string): boolean {
  const projects = load();
  const next = projects.filter((p) => p.id !== id);
  if (next.length === projects.length) return false;
  save(next);
  return true;
}
