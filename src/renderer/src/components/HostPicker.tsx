import { useEffect, useState } from 'react'
import { ChevronDown, Plus, Server } from 'lucide-react'
import { hostKeyOf, hostLabel, type SshHost } from '@shared/ssh'
import { useStore } from '../store/useStore'

/**
 * Choosing a remote box, in the setup wizard.
 *
 * The list comes from `~/.ssh/config` — real `Host` entries the user already
 * has, connected to by alias so every setting they put there (ProxyJump,
 * multiple keys, whatever) keeps working exactly as it does in a real
 * terminal. "Add a host" is for anything not already in that file; it builds
 * a connection descriptor client-side and never touches the network itself —
 * the first real connection attempt is the terminal pane that opens after.
 */

let manualSeq = 0
function manualHost(input: {
  hostname: string
  user: string
  port: string
  identityFile: string
}): SshHost | null {
  const hostname = input.hostname.trim()
  if (!hostname) return null
  manualSeq += 1
  const host: SshHost = {
    id: `manual:${Date.now().toString(36)}${manualSeq}`,
    label: '',
    hostname,
    user: input.user.trim() || null,
    port: input.port.trim() && /^\d+$/.test(input.port.trim()) ? Number(input.port.trim()) : null,
    identityFile: input.identityFile.trim() || null,
    source: 'manual',
    alias: null
  }
  host.label = hostLabel(host)
  return host
}

export function HostPicker({
  host,
  remotePath,
  onHost,
  onPath
}: {
  host: SshHost | null
  remotePath: string
  onHost: (h: SshHost) => void
  onPath: (p: string) => void
}): React.JSX.Element {
  const [configHosts, setConfigHosts] = useState<SshHost[] | null>(null)
  // Boxes saved in Settings, which are not in ~/.ssh/config and would otherwise
  // have to be typed in again every time a remote workspace is opened.
  const savedHosts = useStore((s) => s.settings.sshHosts) ?? []
  const [manualOpen, setManualOpen] = useState(false)
  const [hostname, setHostname] = useState('')
  const [user, setUser] = useState('')
  const [port, setPort] = useState('')
  const [identityFile, setIdentityFile] = useState('')

  useEffect(() => {
    let live = true
    window.eaon.ssh.listConfigHosts().then((hosts) => live && setConfigHosts(hosts))
    return () => {
      live = false
    }
  }, [])

  const addManual = (): void => {
    const made = manualHost({ hostname, user, port, identityFile })
    if (!made) return
    onHost(made)
    setManualOpen(false)
    setHostname('')
    setUser('')
    setPort('')
    setIdentityFile('')
  }

  return (
    <div className="section">
      {configHosts === null ? (
        <p className="section-note">Reading ~/.ssh/config…</p>
      ) : configHosts.length === 0 && savedHosts.length === 0 && !manualOpen ? (
        <p className="section-note">
          Nothing in ~/.ssh/config yet. Add a host below to connect to one directly.
        </p>
      ) : (
        <div className="card-grid">
          {[
            ...configHosts,
            ...savedHosts.filter(
              (saved) => !configHosts.some((c) => hostKeyOf(c) === hostKeyOf(saved))
            )
          ].map((h) => (
            <button
              key={h.id}
              className="folder-card"
              data-on={host?.id === h.id}
              onClick={() => onHost(h)}
            >
              <Server size={16} />
              <span className="folder-text">
                <span className="folder-name">{h.label}</span>
                <span className="folder-path mono">
                  {h.user ? `${h.user}@` : ''}
                  {h.hostname}
                </span>
              </span>
            </button>
          ))}
          {host && host.source === 'manual' && (
            <button className="folder-card" data-on="true">
              <Server size={16} />
              <span className="folder-text">
                <span className="folder-name">{host.label}</span>
                <span className="folder-path mono">
                  {host.user ? `${host.user}@` : ''}
                  {host.hostname}
                </span>
              </span>
            </button>
          )}
        </div>
      )}

      <button className="host-manual-toggle" onClick={() => setManualOpen((v) => !v)}>
        <Plus size={13} />
        Add a host
        <ChevronDown size={13} className="host-manual-chevron" data-open={manualOpen} />
      </button>

      {manualOpen && (
        <div className="host-manual-form">
          <div className="field">
            <input
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              placeholder="hostname or IP"
              spellCheck={false}
            />
          </div>
          <div className="host-manual-row">
            <div className="field">
              <input
                value={user}
                onChange={(e) => setUser(e.target.value)}
                placeholder="user (optional)"
                spellCheck={false}
              />
            </div>
            <div className="field host-manual-port">
              <input
                value={port}
                onChange={(e) => setPort(e.target.value)}
                placeholder="port"
                inputMode="numeric"
              />
            </div>
          </div>
          <div className="field">
            <input
              value={identityFile}
              onChange={(e) => setIdentityFile(e.target.value)}
              placeholder="identity file (optional) — ~/.ssh/id_ed25519"
              spellCheck={false}
            />
          </div>
          <button className="btn" disabled={!hostname.trim()} onClick={addManual}>
            Use this host
          </button>
        </div>
      )}

      {host && (
        <div className="field" style={{ marginTop: 10 }}>
          <Server size={15} color="var(--text-dim)" />
          <input
            value={remotePath}
            onChange={(e) => onPath(e.target.value)}
            placeholder="/home/you/project"
            spellCheck={false}
            aria-label="Working folder on the remote host"
          />
        </div>
      )}
      {host && (
        <p className="section-note" style={{ marginTop: 6 }}>
          A path on {hostLabel(host)}, not on this machine — there is no browser for it yet.
        </p>
      )}
    </div>
  )
}
