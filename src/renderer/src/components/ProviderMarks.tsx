import { siGithub, siGitlab, siBitbucket, siLinear, siJira } from 'simple-icons'
import type { ProviderId } from '@shared/integrations'

/**
 * Real brand marks for the integrations list, in their own colour rather than
 * `currentColor` — recognising a service by its actual logo is the point.
 *
 * Paths come from `simple-icons` rather than being hand-drawn: a wrong curve
 * in a hand-transcribed brand mark reads as broken, not stylised, and these
 * are exact and already maintained. Azure DevOps has no entry in that
 * package (checked, not assumed) and no other maintained source was worth a
 * second dependency for one icon — `providerMark` returns `null` for it, and
 * the caller falls back to the plain lettered mark every provider used to
 * have.
 */
const MARKS: Partial<Record<ProviderId, { path: string; hex: string }>> = {
  github: siGithub,
  gitlab: siGitlab,
  bitbucket: siBitbucket,
  linear: siLinear,
  jira: siJira
}

export function hasProviderMark(id: ProviderId): boolean {
  return id in MARKS
}

export function ProviderMark({ id, size = 16 }: { id: ProviderId; size?: number }): React.JSX.Element | null {
  const mark = MARKS[id]
  if (!mark) return null
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={mark.path} fill={`#${mark.hex}`} />
    </svg>
  )
}
