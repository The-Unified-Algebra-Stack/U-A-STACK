/**
 * Layer 4: Effect Executor — Types
 *
 * Spec (Layer 4):
 *   - Impure boundary: network, filesystem, LLM, time
 *   - Never modifies state; only executes intents
 *   - Property: Impure, only executes intents, never modifies Σ
 *
 * Spec (RuntimeConfig.effects):
 *   send:     (to, op, payload) => Promise<void>
 *   store:    (key, value)      => Promise<void>
 *   schedule: (reducerId, ms)   => void
 *   log:      (level, msg)      => void
 *   llm:      (model, prompt, maxTokens) => Promise<string>
 */

import type { Intent, IntentList } from "../layer3-intent/types"

export type { Intent, IntentList }

/**
 * The canonical effect handler shape from RuntimeConfig.
 * Each handler corresponds to one Intent variant.
 * All handlers are impure; none return state.
 */
export type EffectHandlers = {
  send: (to: string, opcode: number, payload: unknown) => Promise<void>
  store: (key: string, value: unknown) => Promise<void>
  schedule: (reducerId: string, delayMs: number) => void
  log: (level: "info" | "warn" | "error", msg: string) => void
  llm: (model: string, prompt: string, maxTokens: number) => Promise<string>
}

/**
 * Result of executing a single intent.
 * Captures success/failure without touching state Σ.
 */
export type EffectResult =
  | { ok: true; intent: Intent }
  | { ok: false; intent: Intent; error: unknown }