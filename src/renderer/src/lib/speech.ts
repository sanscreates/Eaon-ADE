/**
 * Deciding what gets said, and how often.
 *
 * The synthesiser itself lives in the main process; everything here is about
 * restraint. A tool that talks to you is one bad heuristic away from being a
 * tool you mute, so an announcement has to earn its way past a per-pane
 * cooldown and, optionally, past the question of whether you were looking.
 */

import { finishedLine, type SystemVoice } from '@shared/speech'
import type { Settings } from '@shared/types'

/**
 * Shortest gap between two announcements about the same pane.
 *
 * An agent that answers, pauses and answers again inside a few seconds is one
 * exchange as far as anyone listening is concerned.
 */
const COOLDOWN_MS = 20000

const lastSpokenAt = new Map<string, number>()

/** Whether this machine can speak at all. Resolved once, on first use. */
let supported: boolean | null = null

export async function speechSupported(): Promise<boolean> {
  if (supported === null) supported = (await window.eaon.speech.support()).ok
  return supported
}

export async function listVoices(refresh = false): Promise<SystemVoice[]> {
  if (!(await speechSupported())) return []
  return refresh ? window.eaon.speech.refresh() : window.eaon.speech.voices()
}

function options(settings: Settings): { voice: string; rate: number; volume: number } {
  return {
    voice: settings.speakVoice,
    rate: settings.speakRate,
    volume: settings.speakVolume
  }
}

/**
 * Says a line right now, ignoring every filter.
 *
 * This is what the Preview button in Settings calls: you asked to hear it, so
 * cooldowns and "only when I'm away" have no business getting in the way.
 */
export async function preview(settings: Settings, paneName = 'Ada'): Promise<void> {
  if (!(await speechSupported())) return
  window.eaon.speech.speak(finishedLine(paneName), options(settings))
}

export interface FinishedContext {
  paneId: string
  paneName: string
  /** False when the pane is a bare shell — those finish constantly. */
  isAgent: boolean
  /** True when this pane is the focused one in the workspace on screen. */
  watching: boolean
}

/**
 * Announces a finished run, if it should be announced at all.
 *
 * Returns whether anything was said, which is what the tests read.
 */
export async function announceFinished(
  ctx: FinishedContext,
  settings: Settings,
  now = Date.now()
): Promise<boolean> {
  if (!shouldAnnounce(ctx, settings, now)) return false
  if (!(await speechSupported())) return false

  lastSpokenAt.set(ctx.paneId, now)
  window.eaon.speech.speak(finishedLine(ctx.paneName), options(settings))
  return true
}

/**
 * The whole decision, with no side effects and nothing to await — kept apart
 * from the speaking so it can be exercised directly.
 */
export function shouldAnnounce(
  ctx: FinishedContext,
  settings: Settings,
  now = Date.now()
): boolean {
  if (!settings.speakOnFinish) return false
  if (!ctx.isAgent) return false
  if (settings.speakOnlyWhenAway && ctx.watching) return false

  const last = lastSpokenAt.get(ctx.paneId) ?? 0
  return now - last >= COOLDOWN_MS
}

/** Called when a pane goes away, so its cooldown does not outlive it. */
export function forgetPane(paneId: string): void {
  lastSpokenAt.delete(paneId)
}

/** Silences anything queued or being said. */
export function hushSpeech(): void {
  window.eaon.speech.stop()
}
