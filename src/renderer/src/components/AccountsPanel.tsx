import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Check, Loader, Plus, Trash2, TriangleAlert, UserRound } from 'lucide-react'
import { IDLE_LOGIN, planLabel, type Account, type LoginState } from '@shared/accounts'

/**
 * Claude accounts, in Settings.
 *
 * Signing in is Claude Code's own: this asks it to sign in against a directory
 * of its own, opens the address it prints, and takes back the code the browser
 * shows. No credentials pass through here, and the account already on this
 * machine is listed but never written to — which is why switching cannot sign
 * you out of it.
 */

function initials(account: Account): string {
  const source = account.email || account.plan || '?'
  return source.slice(0, 1).toUpperCase()
}

/**
 * The organisation, when saying it adds anything.
 *
 * A personal account is filed under an organisation named after the address it
 * belongs to, so printing both gives you "Max · someone@example.com's
 * Organization" beside a row already titled someone@example.com. It earns its
 * place only on an account that belongs to a real team.
 */
function orgOf(account: Account): string | null {
  const org = account.org
  if (!org) return null
  const local = account.email?.split('@')[0]
  if (local && org.toLowerCase().includes(local.toLowerCase())) return null
  return org
}

export function AccountsPanel(): React.JSX.Element {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [login, setLogin] = useState<LoginState | null>(null)
  const [code, setCode] = useState('')
  const [confirming, setConfirming] = useState<string | null>(null)
  const codeRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setAccounts(await window.eaon.accounts.list())
  }, [])

  useEffect(() => {
    void refresh()
    const offLogin = window.eaon.accounts.onLogin(setLogin)
    const offChanged = window.eaon.accounts.onChanged(setAccounts)
    return () => {
      offLogin()
      offChanged()
    }
  }, [refresh])

  // The code field is the only thing being waited on, so it takes focus.
  useEffect(() => {
    if (login?.phase === 'code') codeRef.current?.focus()
  }, [login?.phase])

  const add = async (): Promise<void> => {
    setCode('')
    setLogin({ ...IDLE_LOGIN })
    setLogin(await window.eaon.accounts.beginLogin())
  }

  const closeLogin = (): void => {
    window.eaon.accounts.cancelLogin()
    setLogin(null)
    setCode('')
  }

  const switchTo = async (id: string): Promise<void> => {
    setBusy(id)
    try {
      setAccounts(await window.eaon.accounts.setActive(id))
    } finally {
      setBusy(null)
    }
  }

  const remove = async (id: string): Promise<void> => {
    setBusy(id)
    try {
      setAccounts(await window.eaon.accounts.remove(id))
    } finally {
      setBusy(null)
      setConfirming(null)
    }
  }

  const done = login?.phase === 'done'

  return (
    <div className="accounts">
      <div className="section-head">
        <span className="eyebrow">Accounts</span>
        <span className="section-note">{accounts.length} signed in</span>
      </div>
      <p className="settings-lede">
        Panes Eaon opens use the account you pick here, and the usage readout follows it. Agents
        already running keep the account they started with.
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
              {account.signedIn ? initials(account) : <UserRound size={15} />}
            </span>

            <span className="account-body">
              <span className="account-name">
                {account.label}
                {account.isDefault && <span className="account-tag">on this machine</span>}
              </span>
              <span className="account-meta">
                {account.signedIn
                  ? [planLabel(account.plan), orgOf(account)].filter(Boolean).join(' · ')
                  : 'Sign-in did not finish'}
              </span>
            </span>

            {busy === account.id ? (
              <Loader size={14} className="spin" />
            ) : account.active ? (
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
          <span>
            Remove this account? Its sign-in and its transcripts are deleted from this machine.
          </span>
          <button className="btn btn-ghost" onClick={() => setConfirming(null)}>
            Keep
          </button>
          <button className="btn btn-danger" onClick={() => void remove(confirming)}>
            Remove
          </button>
        </div>
      )}

      <button className="btn account-add" onClick={() => void add()} disabled={!!login && !done}>
        <Plus size={14} />
        Add account
      </button>

      {login && (
        <div className="account-login" role="dialog" aria-label="Sign in to Claude">
          {login.phase === 'starting' && (
            <div className="account-step">
              <Loader size={14} className="spin" />
              <span>Starting Claude Code…</span>
            </div>
          )}

          {(login.phase === 'code' || login.phase === 'finishing') && (
            <>
              <div className="account-step">
                <Check size={14} />
                <span>
                  Your browser is open. Approve the account, then paste the code it shows.
                </span>
              </div>
              <div className="account-code">
                <input
                  ref={codeRef}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && code.trim()) {
                      window.eaon.accounts.submitCode(code)
                    }
                  }}
                  placeholder="Paste the code from your browser"
                  spellCheck={false}
                  disabled={login.phase === 'finishing'}
                  aria-label="Authorization code"
                />
                <button
                  className="btn btn-primary"
                  disabled={!code.trim() || login.phase === 'finishing'}
                  onClick={() => window.eaon.accounts.submitCode(code)}
                >
                  {login.phase === 'finishing' ? 'Signing in…' : 'Sign in'}
                </button>
              </div>
              {login.url && (
                <button
                  className="account-link"
                  onClick={() => login.url && window.eaon.sys.openExternal(login.url)}
                >
                  Open the sign-in page again
                  <ArrowUpRight size={11} />
                </button>
              )}
            </>
          )}

          {done && (
            <div className="account-step" data-tone="good">
              <Check size={14} />
              <span>Signed in. Pick it above to start using it.</span>
            </div>
          )}

          {login.phase === 'error' && (
            <div className="account-step" data-tone="bad">
              <TriangleAlert size={14} />
              <span>{login.error}</span>
            </div>
          )}

          {/* Only when the flow was not recognised: a sign-in nobody can see is
              worse than an ugly one, so what it printed is offered instead. */}
          {login.output && <pre className="account-output">{login.output}</pre>}

          <div className="account-login-foot">
            <button className="btn btn-ghost" onClick={closeLogin}>
              {done || login.phase === 'error' ? 'Close' : 'Cancel'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
