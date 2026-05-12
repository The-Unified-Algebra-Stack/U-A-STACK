/**
 * Layer 4: Effect Executor — Schedule Effect
 *
 * Spec Intent variant: { type: "SCHEDULE"; reducerId: string; delayMs: number }
 * Spec Layer 4: Scheduling (SCHEDULE): queue deferred task
 *
 * Invariant: Never modifies state Σ. Pure side-effect execution only.
 * Note: schedule returns void (not Promise<void>) per spec RuntimeConfig.effects.
 */

import type { Intent, EffectResult } from "./types"

export function executeSchedule(
  intent: Extract<Intent, { type: "SCHEDULE" }>,
  schedule: (reducerId: string, delayMs: number) => void
): EffectResult {
  try {
    schedule(intent.reducerId, intent.delayMs)
    return { ok: true, intent }
  } catch (error) {
    return { ok: false, intent, error }
  }
}