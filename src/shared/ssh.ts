/**
 * Remote boxes a workspace can run against.
 *
 * Everything here is a *connection descriptor* — where to connect and which
 * key file to offer — never a credential. There is no passphrase field on this
 * type, on purpose: Eaon never asks for one, never stores one, and never sees
 * one. A pane on a remote workspace runs the real `ssh` binary in a real pty,
 * exactly like Terminal.app would, and whatever `ssh-agent` or Keychain
 * already has cached is what authenticates it. If a key genuinely needs
 * unlocking, the prompt appears in that pty and the user types into it
 * directly — the same as any other terminal program on this machine.
 */

export interface SshHost {
  id: string
  /** What the picker shows. Defaults to the config alias or user@hostname. */
  label: string
  hostname: string
  user: string | null
  port: number | null
  /** Path to a private key file, or null to let ssh's own rules decide. */
  identityFile: string | null
  /**
   * 'config' means this was read from `~/.ssh/config` and its `alias` is a
   * real `Host` entry there — connecting can go through `ssh <alias>` and pick
   * up everything else the user already has configured (ProxyJump, multiple
   * IdentityFile lines, Include, all of it) for free. 'manual' means Eaon
   * built the connection itself from typed-in fields, so every flag has to be
   * passed explicitly.
   */
  source: 'config' | 'manual'
  /** The `Host` alias in ~/.ssh/config, when source is 'config'. */
  alias: string | null
}

/** Bare essentials for the "connect to a new host" form. */
export interface ManualHostInput {
  label?: string
  hostname: string
  user?: string
  port?: number
  identityFile?: string
}

export function hostLabel(h: Pick<SshHost, 'alias' | 'user' | 'hostname' | 'label'>): string {
  if (h.label) return h.label
  if (h.alias) return h.alias
  return h.user ? `${h.user}@${h.hostname}` : h.hostname
}

/**
 * A host id that survives round-tripping through JSON and a decade of typing.
 * Not cryptographic — collisions only matter within one machine's saved list.
 */
export function hostKeyOf(h: Pick<SshHost, 'hostname' | 'user' | 'port'>): string {
  return `${h.user ?? ''}@${h.hostname}:${h.port ?? 22}`
}
