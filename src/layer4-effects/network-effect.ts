/**
 * Layer 4: Effect Executor — Network Effect
 *
 * Spec Intent variant: { type: "SEND"; to: string; opcode: number; payload: unknown }
 * Spec Layer 4: Network (SEND): gossip, replication
 *
 * Invariant: Never modifies state Σ. Pure side-effect execution only.
 */

import type { Intent, EffectResult } from "./types"

export async function executeNetwork(
  intent: Extract<Intent, { type: "SEND" }>,
  send: (to: string, opcode: number, payload: unknown) => Promise<void>
): Promise<EffectResult> {
  try {
    await send(intent.to, intent.opcode, intent.payload)
    return { ok: true, intent }
  } catch (error) {
    return { ok: false, intent, error }
  }
}