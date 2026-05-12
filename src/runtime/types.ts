/**
 * Runtime — Types
 *
 * All types sourced directly from spec Core Types sections 1–9.
 * These are the canonical types shared across the runtime module.
 */

import type { IntentList } from "../layer3-intent/types"
import type { EffectHandlers } from "../layer4-effects/types"

export type { IntentList }

// ─── Type 1: Reducer ────────────────────────────────────────────────────────
//
// Spec:
//   type Reducer<Σ, ι = unknown> = (state: Σ, input: ι) => readonly [Σ, IntentList]
//
// Formal properties:
//   1. Pure:          ∀ s, i. R(s, i, t₁) = R(s, i, t₂)
//   2. Total:         defined for all (s, i) pairs
//   3. Deterministic: no random, no clock, no IO
//   4. Composable:    R₁ ∘ R₂ is also a Reducer

export type Reducer<Σ, ι = unknown> =
  (state: Σ, input: ι) => readonly [Σ, IntentList]

// ─── Type 4 / Type 5: Projection and Constraint Reducers ────────────────────
//
// Spec ProjectionReducer:
//   kind: "projection"; proof obligation: apply(apply(σ)) = apply(σ) ∀σ
//
// Spec ConstraintReducer:
//   kind: "constraint"; order: number; proof obligation: Cᵢ ∘ Cⱼ ≠ Cⱼ ∘ Cᵢ

export type ProjectionReducer<Σ> = {
  kind: "projection"
  id: string
  apply: Reducer<Σ>
}

export type ConstraintReducer<Σ> = {
  kind: "constraint"
  id: string
  order: number   // Lower = runs first
  apply: Reducer<Σ>
}

// ─── Type 6: Merge Algebra ───────────────────────────────────────────────────
//
// Spec CMA Laws (verified at construction):
//   1. Commutativity: M(a, b) = M(b, a)
//   2. Associativity: M(M(a,b),c) = M(a,M(b,c))
//   3. Idempotence:   M(a, a) = a
//   4. Monotonicity:  a ⊆ M(a, b)

export type MergeAlgebra<Σ> = {
  merge: (a: Σ, b: Σ) => Σ
  eq:    (a: Σ, b: Σ) => boolean
}

// ─── Type 8: Causal Order (HLC) ──────────────────────────────────────────────
//
// Spec:
//   a happens-before b iff a.logical < b.logical
//   or (a.logical = b.logical && a.nodeId < b.nodeId)
//   concurrent(a,b) := !happensBefore(a,b) && !happensBefore(b,a)

export type HLC = {
  logical:  number  // Lamport clock (logical time)
  physical: number  // Wall clock (milliseconds)
  nodeId:   string  // Originating node (tiebreaker)
}

export type CausalOrder = {
  happensBefore(a: HLC, b: HLC): boolean
  concurrent(a: HLC, b: HLC): boolean
}

// ─── Type 7: Checkpoint Event ────────────────────────────────────────────────
//
// Spec:
//   Hash-chained: prevHash[i] = hash[i-1]
//   Tamper-evident: change any field → hash changes
//   Replay-safe: replay log with same reducers → same sequence of states

export type CheckpointEvent<Σ = unknown> = {
  nodeId:    string
  timestamp: HLC
  type:      "REDUCE" | "MERGE"
  before:    Σ
  after:     Σ
  intents:   IntentList
  prevHash:  string             // SHA256 of previous event
  hash:      string             // SHA256 of this event (with hash: undefined)
}

// ─── Type 3: Substrate ───────────────────────────────────────────────────────
//
// Spec:
//   Σ: State space (CRDT-backed, convergent)
//   Δ: Registered reducers (library of state transitions)
//   M: Merge algebra (convergence function)
//   I: Intent accumulator (free monoid)
//   C: Causal ordering (HLC timestamps + DAG)
//   Φ: Canonical reducer (all projections + constraints composed)

export type Substrate<Σ> = {
  state:    Σ
  reducers: Map<string, Reducer<Σ>>
  merge:    (a: Σ, b: Σ) => Σ
  intents:  IntentList
  causal:   CausalOrder
  phi:      Reducer<Σ>
}

// ─── Type 9: RuntimeConfig ───────────────────────────────────────────────────
//
// Spec: Drives UnifiedRuntime construction and verification.

export type RuntimeConfig<Σ> = {
  nodeId:          string
  initialState:    Σ
  checkpointPath:  string
  mergeFn:         (a: Σ, b: Σ) => Σ
  eqFn:            (a: Σ, b: Σ) => boolean
  mergeSamples:    [Σ, Σ, Σ][]
  projections: {
    id:         string
    fn:         Reducer<Σ>
    testStates: Σ[]
  }[]
  constraints: {
    id:    string
    order: number
    fn:    Reducer<Σ>
  }[]
  effects: EffectHandlers
}