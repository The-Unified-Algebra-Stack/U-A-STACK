/**
 * Layer 4: Effect Executor — Logging Effect
 *
 * Spec Intent variants:
 *   { type: "LOG";  level: "info" | "warn" | "error"; msg: string }
 *   { type: "EMIT"; channel: string; payload: unknown }
 *
 * Spec Layer 4: Logging (LOG): emit to stdout/file
 *
 * Invariant: Never modifies state Σ. Pure side-effect execution only.
 * Note: log returns void (not Promise<void>) per spec RuntimeConfig.effects.
 */

import type { Intent, EffectResult } from "./types"

export function executeLog(
  intent: Extract<Intent, { type: "LOG" }>,
  log: (level: "info" | "warn" | "error", msg: string) => void
): EffectResult {
  try {
    log(intent.level, intent.msg)
    return { ok: true, intent }
  } catch (error) {
    return { ok: false, intent, error }
  }
}

/**
 * EMIT — channel-based event broadcast.
 * Spec Intent variant: { type: "EMIT"; channel: string; payload: unknown }
 * Executed via the log handler as a structured channel emit.
 */
export function executeEmit(
  intent: Extract<Intent, { type: "EMIT" }>,
  log: (level: "info" | "warn" | "error", msg: string) => void
): EffectResult {
  try {
    log("info", `EMIT channel=${intent.channel} payload=${JSON.stringify(intent.payload)}`)
    return { ok: true, intent }
  } catch (error) {
    return { ok: false, intent, error }
  }
}