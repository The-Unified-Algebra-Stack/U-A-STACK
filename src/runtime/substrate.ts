/**
 * Runtime — Substrate
 *
 * Spec Type 3: Substrate<Σ> — the execution environment.
 *
 * Responsibilities:
 *   1. Verify CMA laws on merge samples at construction (Laws 6–9)
 *   2. Verify projection idempotence at registration (Law 3)
 *   3. Compose Φ = Cₙ ∘ ⋯ ∘ C₁ ∘ Pₘ ∘ ⋯ ∘ P₁  (Law 10)
 *   4. Build the live Substrate<Σ> record
 *
 * Spec Law 10 (Dual Algebra Composition):
 *   Φ = Cₙ ∘ ⋯ ∘ C₁ ∘ Pₘ ∘ ⋯ ∘ P₁
 *   Properties:
 *     1. Projections run first (any order)
 *     2. Constraints run after (strict order by .order field)
 *     3. Final result is deterministic, replayable
 */

import type {
  Reducer,
  Substrate,
  CausalOrder,
  HLC,
  RuntimeConfig,
} from "./types"
import type { IntentList } from "../layer3-intent/types"

// ─── CausalOrder implementation ──────────────────────────────────────────────
//
// Spec Type 8:
//   a happens-before b iff a.logical < b.logical
//   or (a.logical = b.logical && a.nodeId < b.nodeId)

export function makeCausalOrder(): CausalOrder {
  return {
    happensBefore(a: HLC, b: HLC): boolean {
      if (a.logical !== b.logical) return a.logical < b.logical
      return a.nodeId < b.nodeId
    },
    concurrent(a: HLC, b: HLC): boolean {
      return (
        !this.happensBefore(a, b) &&
        !this.happensBefore(b, a)
      )
    },
  }
}

// ─── CMA verification ────────────────────────────────────────────────────────
//
// Spec Laws 6–9. Called at substrate construction; throws if any law fails.

function verifyCMA<Σ>(
  merge: (a: Σ, b: Σ) => Σ,
  eq:    (a: Σ, b: Σ) => boolean,
  samples: [Σ, Σ, Σ][]
): void {
  for (const [a, b, c] of samples) {
    // Law 6: Commutativity — M(a,b) = M(b,a)
    if (!eq(merge(a, b), merge(b, a))) {
      throw new Error("CMA violation: merge is not commutative")
    }
    // Law 7: Associativity — M(M(a,b),c) = M(a,M(b,c))
    if (!eq(merge(merge(a, b), c), merge(a, merge(b, c)))) {
      throw new Error("CMA violation: merge is not associative")
    }
    // Law 8: Idempotence — M(a,a) = a
    if (!eq(merge(a, a), a)) {
      throw new Error("CMA violation: merge is not idempotent")
    }
  }
  // Law 9: Monotonicity — verified structurally by the merge implementation;
  // we document the obligation here but cannot assert a ⊆ M(a,b) generically
  // without a partial-order witness. Runtime implementors must ensure it.
}

// ─── Projection idempotence verification ─────────────────────────────────────
//
// Spec Law 3: P(P(σ)) = P(σ) ∀σ ∈ test_states

function verifyIdempotence<Σ>(
  id: string,
  fn: Reducer<Σ>,
  testStates: Σ[],
  eq: (a: Σ, b: Σ) => boolean
): void {
  for (const state of testStates) {
    const [s1] = fn(state, undefined)
    const [s2] = fn(s1, undefined)
    if (!eq(s1, s2)) {
      throw new Error(`Projection idempotence violation: "${id}"`)
    }
  }
}

// ─── Φ composition ───────────────────────────────────────────────────────────
//
// Spec Law 10: Φ = Cₙ ∘ ⋯ ∘ C₁ ∘ Pₘ ∘ ⋯ ∘ P₁
// Spec Unit:   identity(σ) = [σ, []]
// Spec Op:     [σ₁,i₁] ∘ [σ₂,i₂] = [σ₂, i₁ ++ i₂]

function composePhi<Σ>(reducers: Reducer<Σ>[]): Reducer<Σ> {
  return (state: Σ, input: unknown): readonly [Σ, IntentList] => {
    let current = state
    let allIntents: IntentList = Object.freeze([])
    for (const r of reducers) {
      const [nextState, intents] = r(current, input)
      current = nextState
      allIntents = Object.freeze([...allIntents, ...intents])
    }
    return [current, allIntents] as const
  }
}

// ─── buildSubstrate ──────────────────────────────────────────────────────────

export function buildSubstrate<Σ>(config: RuntimeConfig<Σ>): Substrate<Σ> {
  // 1. Verify CMA laws on provided merge samples
  verifyCMA(config.mergeFn, config.eqFn, config.mergeSamples)

  // 2. Verify projection idempotence; collect ordered projection reducers
  const projectionReducers: Reducer<Σ>[] = []
  for (const p of config.projections) {
    verifyIdempotence(p.id, p.fn, p.testStates, config.eqFn)
    projectionReducers.push(p.fn)
  }

  // 3. Sort constraints by .order (ascending = lower runs first), collect reducers
  const sortedConstraints = [...config.constraints].sort((a, b) => a.order - b.order)
  const constraintReducers: Reducer<Σ>[] = sortedConstraints.map(c => c.fn)

  // 4. Compose Φ = Cₙ ∘ ⋯ ∘ C₁ ∘ Pₘ ∘ ⋯ ∘ P₁
  //    Projections first, then constraints (in order)
  const phi = composePhi([...projectionReducers, ...constraintReducers])

  // 5. Register all reducers by id
  const reducers = new Map<string, Reducer<Σ>>()
  for (const p of config.projections) reducers.set(p.id, p.fn)
  for (const c of config.constraints) reducers.set(c.id, c.fn)

  return {
    state:    config.initialState,
    reducers,
    merge:    config.mergeFn,
    intents:  Object.freeze([]),
    causal:   makeCausalOrder(),
    phi,
  }
}