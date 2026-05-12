/**
 * Layer 4: Effect Executor — Storage Effect
 *
 * Spec Intent variant: { type: "STORE"; key: string; value: unknown }
 * Spec Layer 4: Storage (STORE): append to KV store
 *
 * Invariant: Never modifies state Σ. Pure side-effect execution only.
 */

import type { Intent, EffectResult } from "./types"

export async function executeStorage(
  intent: Extract<Intent, { type: "STORE" }>,
  store: (key: string, value: unknown) => Promise<void>
): Promise<EffectResult> {
  try {
    await store(intent.key, intent.value)
    return { ok: true, intent }
  } catch (error) {
    return { ok: false, intent, error }
  }
}