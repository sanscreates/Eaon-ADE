import { useEffect } from 'react';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { WorkspaceContent } from './components/WorkspaceContent';
import { Toasts } from './components/Toasts';
import { CommandPalette } from './components/CommandPalette';
import { NewSessionDialog } from './components/dialogs/NewSessionDialog';
import { NewWorktreeDialog } from './components/dialogs/NewWorktreeDialog';
import { AddProjectDialog } from './components/dialogs/AddProjectDialog';
import { ConfirmDialog } from './components/dialogs/ConfirmDialog';
import { SettingsPage } from './components/SettingsPage';
import { useGlobalShortcuts } from './lib/shortcuts';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useProjects } from './store/projects';
import { useAgents } from './store/agents';
import { useSessions } from './store/sessions';
import { useLayout } from './store/layout';
import { useWorkspaces } from './store/workspaces';
import { WorkspaceTabs } from './components/WorkspaceTabs';
import { useBoard } from './store/board';
import { useGit } from './store/git';
import { useSwarm } from './store/swarm';
import { useMemory } from './store/memory';
import { useUpdates } from './store/updates';
import { UpdateBanner } from './components/UpdateBanner';
import { useUi } from './store/ui';

export default function App() {
  useGlobalShortcuts();

  const activeId = useProjects((s) => s.activeId);
  const active = useProjects((s) => s.projects.find((p) => p.id === s.activeId) ?? null);
  const sidebarOpen = useUi((s) => s.sidebarOpen);
  const sessionsOrder = useSessions((s) => s.order);
  const sessions = useSessions((s) => s.sessions);

  useEffect(() => {
    useAgents.getState().fetch();
    useProjects.getState().fetch();
    useUpdates.getState().init();
  }, []);

  useEffect(() => {
    if (!active) return;
    useLayout.getState().loadFor(active.id);
    useWorkspaces.getState().loadFor(active.id);
    useBoard.getState().load(active.path);
    useSwarm.getState().load(active.path, active.id);
    void useMemory.getState().load(active.path);
    useGit.getState().startAuto(active.path);
    return () => useGit.getState().stopAuto();
  }, [activeId]);

  // Keep the pane grid in sync with the sessions that belong to this project.
  // The workspaces layer filters by tab ownership before the grid reconciles.
  useEffect(() => {
    if (!activeId) return;
    const ids = sessionsOrder.filter((id) => {
      const meta = sessions[id];
      return meta && (!meta.projectId || meta.projectId === activeId);
    });
    useWorkspaces.getState().reconcileActive(ids);
  }, [sessionsOrder, sessions, activeId]);

  return (
    <div className="app">
      <TopBar />
      <div className="app-body">
        {sidebarOpen && <Sidebar />}
        <main className="main">
          <WorkspaceTabs />
          <ErrorBoundary>
            <WorkspaceContent />
          </ErrorBoundary>
        </main>
      </div>
      <CommandPalette />
      <NewSessionDialog />
      <NewWorktreeDialog />
      <AddProjectDialog />
      <ConfirmDialog />
      <SettingsPage />
      <UpdateBanner />
      <Toasts />
    </div>
  );
}
