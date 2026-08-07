import { GitBranch } from 'lucide-react'
import type { PaneSpec, Workspace } from '@shared/types'
import { SurfacePaneChrome } from './SurfacePaneChrome'
import { GitPanel } from './GitPanel'

/**
 * The workspace's git status and diff, pinned to its own cell in the grid.
 *
 * Reuses `GitPanel` outright rather than a pane-specific rewrite — the
 * research behind this feature found it has no singleton assumptions and no
 * native resource to worry about (unlike the browser panel, which is why
 * this feature does not attempt to grid-ify that one yet).
 */
export function DiffGridPane({
  workspace,
  pane,
  index,
  style,
  carrying,
  over,
  onCarry,
  onOver,
  onSwap
}: {
  workspace: Workspace
  pane: PaneSpec
  index: number
  style?: React.CSSProperties
  carrying?: boolean
  over?: boolean
  onCarry?: (id: string | null) => void
  onOver?: (id: string | null) => void
  onSwap?: (dragId: string) => void
}): React.JSX.Element {
  return (
    <SurfacePaneChrome
      workspace={workspace}
      pane={pane}
      index={index}
      style={style}
      carrying={carrying}
      over={over}
      onCarry={onCarry}
      onOver={onOver}
      onSwap={onSwap}
      icon={<GitBranch size={12} />}
    >
      <div className="pane-surface-fill">
        <GitPanel cwd={workspace.cwd} host={workspace.host} />
      </div>
    </SurfacePaneChrome>
  )
}
