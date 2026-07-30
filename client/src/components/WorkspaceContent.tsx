import { useWorkspaces, kindOf } from '../store/workspaces';
import { TerminalGrid } from './TerminalGrid';
import { BoardPanel } from './panels/BoardPanel';
import { FilesPanel } from './panels/FilesPanel';
import { EditorPanel } from './panels/EditorPanel';
import { GitPanel } from './panels/GitPanel';
import { PullsPanel } from './panels/PullsPanel';
import { BrowserPanel } from './panels/BrowserPanel';
import { SwarmPanel } from './panels/SwarmPanel';
import { MemoryPanel } from './panels/MemoryPanel';

/**
 * Whatever the active tab actually is. There is no side dock any more — Board,
 * Files, Editor, Git, Pull requests and the browser are all just tabs now,
 * the same as a grid of terminal sessions is. One tab is visible at a time,
 * full-bleed, which is what a tab means everywhere else this pattern shows up.
 */
export function WorkspaceContent() {
  const tabs = useWorkspaces((s) => s.tabs);
  const activeId = useWorkspaces((s) => s.activeId);
  const active = tabs.find((t) => t.id === activeId);
  const kind = kindOf(active);

  switch (kind) {
    case 'browser':
      return active?.browserTabId ? <BrowserPanel tabId={active.browserTabId} /> : null;
    case 'files':
      return <FilesPanel />;
    case 'editor':
      return <EditorPanel />;
    case 'git':
      return <GitPanel />;
    case 'board':
      return <BoardPanel />;
    case 'pulls':
      return <PullsPanel />;
    case 'swarm':
      return <SwarmPanel />;
    case 'memory':
      return <MemoryPanel />;
    case 'grid':
    default:
      return <TerminalGrid />;
  }
}
