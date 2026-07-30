import { create } from 'zustand';
import { api } from '../lib/api';
import type { ProjectInfo } from '../lib/types';

interface ProjectsState {
  projects: ProjectInfo[];
  activeId: string | null;
  loaded: boolean;
  fetch: () => Promise<void>;
  add: (path: string) => Promise<ProjectInfo>;
  remove: (id: string) => Promise<void>;
  setActive: (id: string | null) => void;
  active: () => ProjectInfo | null;
}

export const useProjects = create<ProjectsState>((set, get) => ({
  projects: [],
  activeId: localStorage.getItem('eaon.activeProject'),
  loaded: false,

  fetch: async () => {
    const { projects } = await api.get<{ projects: ProjectInfo[] }>('/api/projects');
    const activeId = get().activeId;
    set({
      projects,
      loaded: true,
      activeId: projects.some((p) => p.id === activeId)
        ? activeId
        : projects[0]?.id ?? null,
    });
  },

  add: async (path) => {
    const { project } = await api.post<{ project: ProjectInfo }>('/api/projects', { path });
    set((s) => ({
      projects: s.projects.some((p) => p.id === project.id) ? s.projects : [...s.projects, project],
      activeId: project.id,
    }));
    localStorage.setItem('eaon.activeProject', project.id);
    return project;
  },

  remove: async (id) => {
    await api.del(`/api/projects/${id}`);
    set((s) => {
      const projects = s.projects.filter((p) => p.id !== id);
      const activeId = s.activeId === id ? projects[0]?.id ?? null : s.activeId;
      if (activeId) localStorage.setItem('eaon.activeProject', activeId);
      return { projects, activeId };
    });
  },

  setActive: (id) => {
    set({ activeId: id });
    if (id) localStorage.setItem('eaon.activeProject', id);
  },

  active: () => {
    const { projects, activeId } = get();
    return projects.find((p) => p.id === activeId) ?? null;
  },
}));
