/**
 * Services a pane can reach on your behalf.
 *
 * The point of this file is the shape of what crosses the bridge. A provider is
 * described by which binary proves it and which environment variables carry its
 * credentials — never by the credentials themselves. `ProviderState.env` is a
 * list of names and booleans, so a token cannot reach the renderer even by
 * accident, and the panel can still tell you exactly which variable is missing.
 */

export type ProviderId = 'github' | 'gitlab' | 'bitbucket' | 'azure' | 'linear' | 'jira'

export type ProviderStatus =
  /** Usable right now — a pane spawned this second could push. */
  | 'connected'
  /** The tool is installed but nobody is signed in. */
  | 'needs-auth'
  /** The CLI this provider works through is not on PATH. */
  | 'not-installed'
  /** Token-based, and none of its variables are set. */
  | 'not-configured'

export interface ProviderDef {
  id: ProviderId
  name: string
  /** One line, lowercase-after-the-first-word, shown under the name. */
  blurb: string
  /** The CLI that both proves the connection and does the work, when there is one. */
  bin?: string
  /** How to get the CLI, shown only when it is missing. */
  installHint?: string
  docs: string
  /**
   * Credential variables, grouped by what constitutes a complete set.
   *
   * A provider counts as configured when every name in *any one* group is
   * present. Jira needs a site URL, an account and a token together, so a flat
   * list would call it ready when it is only a third of the way there.
   */
  envSets?: string[][]
}

/** A single credential variable, reported by name and presence only. */
export interface EnvFlag {
  name: string
  set: boolean
}

export interface ProviderState {
  id: ProviderId
  status: ProviderStatus
  /** Who the CLI says you are, when it will say. Never a token. */
  account: string | null
  /** Short human explanation of the status, safe to display verbatim. */
  detail: string
  env: EnvFlag[]
}

/**
 * The registry.
 *
 * GitHub and GitLab go through their own CLIs because those already hold a
 * refreshable OAuth token and know how to push; asking for a PAT as well would
 * be a second, worse copy of something the user has already done. The rest have
 * no such tool, so they are plain environment variables that agents read.
 */
export const PROVIDERS: ProviderDef[] = [
  {
    id: 'github',
    name: 'GitHub',
    blurb: 'Push, open pull requests and read issues as you.',
    bin: 'gh',
    installHint: 'brew install gh',
    docs: 'https://cli.github.com',
    envSets: [['GITHUB_TOKEN'], ['GH_TOKEN']]
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    blurb: 'Merge requests and pipelines from the pane.',
    bin: 'glab',
    installHint: 'brew install glab',
    docs: 'https://gitlab.com/gitlab-org/cli',
    envSets: [['GITLAB_TOKEN']]
  },
  {
    id: 'bitbucket',
    name: 'Bitbucket',
    blurb: 'Repository access with an app password.',
    docs: 'https://support.atlassian.com/bitbucket-cloud/docs/app-passwords/',
    envSets: [['BITBUCKET_USERNAME', 'BITBUCKET_APP_PASSWORD']]
  },
  {
    id: 'azure',
    name: 'Azure DevOps',
    blurb: 'Repos and work items via a personal access token.',
    docs: 'https://learn.microsoft.com/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate',
    envSets: [['AZURE_DEVOPS_EXT_PAT']]
  },
  {
    id: 'linear',
    name: 'Linear',
    blurb: 'Read and move issues while it works.',
    docs: 'https://linear.app/docs/api-and-webhooks',
    envSets: [['LINEAR_API_KEY']]
  },
  {
    id: 'jira',
    name: 'Jira',
    blurb: 'Issue lookup and transitions.',
    docs: 'https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/',
    envSets: [['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN']]
  }
]

export function providerById(id: ProviderId): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.id === id)
}

/** Every variable name this app will ever look for. Order is stable, no duplicates. */
export function allEnvNames(): string[] {
  const seen = new Set<string>()
  for (const p of PROVIDERS) {
    for (const set of p.envSets ?? []) for (const name of set) seen.add(name)
  }
  return [...seen]
}
