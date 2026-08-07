import { FileText } from 'lucide-react'
import type { PaneSpec, Workspace } from '@shared/types'
import { SurfacePaneChrome } from './SurfacePaneChrome'
import { FilePreviewBody } from './FilePreviewBody'
import { basename } from '../lib/util'

/**
 * A markdown/image/PDF preview, pinned to its own cell in the grid — split
 * anything's first real case: a README rendered beside the terminal that is
 * about to edit it, resized and arranged exactly like any other pane.
 */
export function PreviewGridPane({
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
  const path = pane.previewPath ?? ''

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
      icon={<FileText size={12} />}
      subtitle={path ? basename(path) : undefined}
    >
      {path ? (
        <div className="fp-scroll">
          <FilePreviewBody path={path} />
        </div>
      ) : (
        <div className="fp-empty">Nothing to preview.</div>
      )}
    </SurfacePaneChrome>
  )
}
