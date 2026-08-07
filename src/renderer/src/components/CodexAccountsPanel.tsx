import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Plus, Trash2, TriangleAlert, UserRound } from 'lucide-react'
import { planLabel, type Account } from '@shared/accounts'
import { useStore } from '../store/useStore'

/**
 * Codex accounts, in Settings.
 *
 * The same directory-per-account mechanism as the Claude switcher above it,
 * with one difference that shows in the UI: there is no sign-in flow for this
 * app to drive. Claude Code prints an address and takes a code back, which is
 * something a dialog can follow; `codex login` just wants a terminal. So the
 * flow here is "make an empty home, run the command in a pane, tell us when
 * you are done" — which is honest about who is doing the work, and needs no
 * credential to pass through this app at any point.
 */

export function CodexAccountsPanel(): React.JSX.Element {
  const notify = useStore((s) => s.notify)
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId)
  const addPane = useStore((s) => s.addPane)

  const [accounts, setAccounts] = useState<Account[]>([])
  const [pending, setPending] = useState<{ id: string; configDir: string } | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setAccounts(await window.eaon.codexAccounts.list())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const loginCommand = pending ? `CODEX_HOME=${JSON.stringify(pending.configDir)} codex login` : ''

  const begin = async (): Promise<void> => {
    const reserved = await window.eaon.codexAccounts.reserve()
    setPending(reserved)
    // Open a pane already pointed at the new home. The variable is set inline
    // rather than by switching the active account, so an unfinished sign-in
    // never changes what your other panes are using.
    if (activeWorkspaceId) {
      addPane(activeWorkspaceId, {
        agentId: 'shell',
        command: `CODEX_HOME=${JSON.stringify(reserved.configDir)} codex login`
      })
    }
  }

  const finish = async (): Promise<void> => {
    if (!pending) return
    const next = await window.eaon.codexAccounts.commit(pending.id)
    setAccounts(next)
    const added = next.some((a) => a.id === pending.id)
    notify(
      added
        ? { kind: 'info', title: 'Codex account added', text: 'New panes can use it now.' }
        : {
            kind: 'attention',
            title: 'No sign-in found',
            text: 'That directory has no credentials in it yet, so it was discarded.'
          }
    )
    setPending(null)
  }

  const switchTo = async (id: string): Promise<void> => {
    setAccounts(await window.eaon.codexAccounts.setActive(id))
  }

  const remove = async (id: string): Promise<void> => {
    setAccounts(await window.eaon.codexAccounts.remove(id))
    setConfirming(null)
  }

  return (
    <div className="accounts" style={{ marginTop: 26 }}>
      <div className="section-head">
        <span className="eyebrow">Codex</span>
        <span className="section-note">{accounts.filter((a) => a.signedIn).length} signed in</span>
      </div>
      <p className="settings-lede">
        Panes get the account you pick here through <code className="mono">CODEX_HOME</code>. The
        one already on this machine is listed but never written to, so switching cannot sign you
        out of it.
      </p>

      <div className="account-list">
        {accounts.map((account) => (
          <div
            key={account.id}
            className="account"
            data-active={account.active}
            role="button"
            tabIndex={0}
            aria-pressed={account.active}
            onClick={() => !account.active && void switchTo(account.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                if (!account.active) void switchTo(account.id)
              }
            }}
          >
            <span className="account-mark" aria-hidden="true">
              {account.signedIn ? (account.email?.slice(0, 1).toUpperCase() ?? 'C') : <UserRound size={15} />}
            </span>

            <span className="account-body">
              <span className="account-name">
                {account.label}
                {account.isDefault && <span className="account-tag">on this machine</span>}
              </span>
              <span className="account-meta">
                {account.signedIn
                  ? account.plan === 'api'
                    ? 'API key'
                    : planLabel(account.plan)
                  : 'Not signed in'}
              </span>
            </span>

            {account.active ? (
              <span className="account-on">
                <Check size={13} />
                Active
              </span>
            ) : (
              <span className="account-switch">Switch</span>
            )}

            {!account.isDefault && (
              <button
                className="icon-btn"
                title="Remove this account from Eaon"
                aria-label={`Remove ${account.label}`}
                onClick={(e) => {
                  e.stopPropagation()
                  setConfirming(confirming === account.id ? null : account.id)
                }}
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        ))}
      </div>

      {confirming && (
        <div className="account-confirm">
          <TriangleAlert size={13} />
          <span>Remove this account? Its sign-in is deleted from Eaon&rsquo;s own folder.</span>
          <button className="btn btn-danger" onClick={() => void remove(confirming)}>
            Remove
          </button>
          <button className="btn btn-ghost" onClick={() => setConfirming(null)}>
            Cancel
          </button>
        </div>
      )}

      {pending ? (
        <div className="cx-pending">
          <p className="settings-lede" style={{ margin: 0 }}>
            A pane was opened running <code className="mono">codex login</code> against a fresh
            home. Finish signing in there, then say so.
          </p>
          <code className="cx-cmd mono">{loginCommand}</code>
          <div className="cx-pending-actions">
            <button
              className="btn btn-ghost"
              onClick={() => void navigator.clipboard.writeText(loginCommand)}
              title="Copy the command"
            >
              <Copy size={13} />
              Copy command
            </button>
            <span style={{ flex: 1 }} />
            <button className="btn btn-ghost" onClick={() => setPending(null)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={() => void finish()}>
              <Check size={13} />
              I&rsquo;ve signed in
            </button>
          </div>
        </div>
      ) : (
        <button className="btn" onClick={() => void begin()}>
          <Plus size={13} />
          Add a Codex account
        </button>
      )}
    </div>
  )
}
