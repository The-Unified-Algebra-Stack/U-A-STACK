/**
 * Runtime — Execution Loop
 *
 * Spec (Single-Node Deterministic Execution):
 *   loop:
 *     input ← read from queue
 *     [state, intents] ← Φ(state, input)
 *     checkpoint.record({ before, after: state, intents })
 *     await executeIntents(intents)
 *     intents ← []
 *
 * Property: Deterministic. No race conditions, no nondeterminism.
 *
 * Spec Law 12 (Replay Theorem):
 *   Replaying log + reducers → same sequence of states
 *   σᵢ = event[i].after ∀i
 *
 * Spec Law 13 (Hash Chain Integrity):
 *   hash[i]      = SHA256(event[i] with {hash: undefined, prevHash: undefined})
 *   event[i].prevHash = hash[i-1]
 */

import { createHash } from "crypto"
import type { Reducer, CheckpointEvent, HLC, RuntimeConfig } from "./types"
import type { IntentList } from "../layer3-intent/types"
import { executeIntents } from "../layer4-effects/effect-executor"

// ─── HLC tick ────────────────────────────────────────────────────────────────
//
// Spec Type 8: HLC = { logical, physical, nodeId }
// Advances logical clock; physical = Date.now() at tick time.
// Time access is isolated here — reducers (Φ) never see the clock.

export function tickHLC(prev: HLC, nodeId: string): HLC {
  const physical = Date.now()
  return {
    logical:  prev.logical + 1,
    physical: Math.max(physical, prev.physical),
    nodeId,
  }
}

// ─── Hash chain ───────────────────────────────────────────────────────────────
//
// Spec Law 13: SHA256(event with {hash: undefined, prevHash: undefined})

export function hashEvent<Σ>(
  event: Omit<CheckpointEvent<Σ>, "hash" | "prevHash"> & { prevHash: string }
): string {
  const payload = JSON.stringify({ ...event, hash: undefined })
  return createHash("sha256").update(payload).digest("hex")
}

// ─── Single execution step ───────────────────────────────────────────────────

export type StepResult<Σ> = {
  state:   Σ
  intents: IntentList
  event:   CheckpointEvent<Σ>
}

export async function step<Σ>(
  state:    Σ,
  input:    unknown,
  phi:      Reducer<Σ>,
  hlc:      HLC,
  nodeId:   string,
  prevHash: string,
  effects:  RuntimeConfig<Σ>["effects"]
): Promise<StepResult<Σ>> {
  const before = state

  // Spec: [state, intents] ← Φ(state, input)
  const [after, intents] = phi(state, input)

  // Advance HLC — outside Φ, never inside reducer
  const timestamp = tickHLC(hlc, nodeId)

  // Build checkpoint event (hash: undefined during hashing per spec)
  const partial = {
    nodeId,
    timestamp,
    type: "REDUCE" as const,
    before,
    after,
    intents,
    prevHash,
  }
  const hash = hashEvent(partial)
  const event: CheckpointEvent<Σ> = { ...partial, hash }

  // Spec: await executeIntents(intents) — Layer 4 boundary
  await executeIntents(intents, effects)

  return { state: after, intents, event }
}

// ─── Replay ──────────────────────────────────────────────────────────────────
//
// Spec Law 12: Given log + initial state + reducers → reconstruct state.
// Re-executes Φ for each event; asserts reconstructed state matches event.after.
// Does NOT re-execute intents (replay is read-only re-derivation).

export async function replayLog<Σ>(
  log:          CheckpointEvent<Σ>[],
  initialState: Σ,
  phi:          Reducer<Σ>,
  eq:           (a: Σ, b: Σ) => boolean
): Promise<{ ok: boolean; failIndex: number | null; states: Σ[] }> {
  let state = initialState
  const states: Σ[] = [state]
  let prevHash = ""

  for (let i = 0; i < log.length; i++) {
    const event = log[i]

    // Verify hash chain (Law 13)
    if (event.prevHash !== prevHash) {
      return { ok: false, failIndex: i, states }
    }
    const expectedHash = hashEvent({
      nodeId:    event.nodeId,
      timestamp: event.timestamp,
      type:      event.type,
      before:    event.before,
      after:     event.after,
      intents:   event.intents,
      prevHash:  event.prevHash,
    })
    if (expectedHash !== event.hash) {
      return { ok: false, failIndex: i, states }
    }

    // Re-derive state via Φ (not re-executing intents — replay is pure)
    const [derived] = phi(state, undefined)
    if (!eq(derived, event.after as Σ)) {
      return { ok: false, failIndex: i, states }
    }

    state = event.after as Σ
    prevHash = event.hash
    states.push(state)
  }

  return { ok: true, failIndex: null, states }
}