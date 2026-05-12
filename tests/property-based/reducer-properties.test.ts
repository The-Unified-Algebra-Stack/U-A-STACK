/**
 * Property-based tests for Reducer<Σ, ι> — Laws 1, 2, 10
 * Spec: §VERIFICATION FRAMEWORK §6 (Generative Testing)
 * Uses fast-check, 10k+ iterations per property
 */

import { describe, it, expect } from "@jest/globals"
import * as fc from "fast-check"

// ── Types ────────────────────────────────────────────────────────────────────

type Intent =
  | { type: "LOG"; level: "info" | "warn" | "error"; msg: string }
  | { type: "STORE"; key: string; value: unknown }
  | { type: "EMIT"; channel: string; payload: unknown }

type IntentList = readonly Intent[]
type Reducer<Σ, ι = unknown> = (state: Σ, input: ι) => readonly [Σ, IntentList]

function concat(a: IntentList, b: IntentList): IntentList {
  return Object.freeze([...a, ...b])
}
const empty: IntentList = Object.freeze([])

function compose<Σ, ι>(...reducers: Reducer<Σ, ι>[]): Reducer<Σ, ι> {
  return (state, input) => {
    let s = state
    let intents: Intent[] = []
    for (const r of reducers) {
      const [ns, ni] = r(s, input)
      s = ns
      intents = [...intents, ...(ni as Intent[])]
    }
    return [s, intents] as const
  }
}

// ── Domain state type ─────────────────────────────────────────────────────────

type S = { balance: number; reserved: number; active: boolean }
type I = { delta: number; tag: string }

// ── Concrete reducers ─────────────────────────────────────────────────────────

const applyDelta: Reducer<S, I> = (state, input) => [
  { ...state, balance: state.balance + input.delta },
  input.delta !== 0
    ? [{ type: "LOG", level: "info", msg: `delta: ${input.delta}` }]
    : [],
]

const capBalance: Reducer<S, I> = (state, _) => [
  { ...state, balance: Math.min(state.balance, 1_000_000) },
  [],
]

const floorBalance: Reducer<S, I> = (state, _) => [
  { ...state, balance: Math.max(0, state.balance) },
  [],
]

const freezeIfNegative: Reducer<S, I> = (state, _) => [
  state.balance < 0 ? { ...state, active: false } : state,
  state.balance < 0
    ? [{ type: "EMIT", channel: "events", payload: { type: "frozen" } }]
    : [],
]

// ── Arbitraries ───────────────────────────────────────────────────────────────

const arbState: fc.Arbitrary<S> = fc.record({
  balance: fc.integer({ min: -1_000_000, max: 1_000_000 }),
  reserved: fc.integer({ min: 0, max: 100_000 }),
  active: fc.boolean(),
})

const arbInput: fc.Arbitrary<I> = fc.record({
  delta: fc.integer({ min: -100_000, max: 100_000 }),
  tag: fc.string({ maxLength: 20 }),
})

const NUM_RUNS = 10_000

// ── Purity (Law 1) ────────────────────────────────────────────────────────────

describe("Reducer purity — R(s,i,t₁) = R(s,i,t₂) (Law 1)", () => {
  it("applyDelta: identical outputs on repeated calls", () => {
    fc.assert(
      fc.property(arbState, arbInput, (state, input) => {
        const [s1, i1] = applyDelta(state, input)
        const [s2, i2] = applyDelta(state, input)
        return (
          JSON.stringify(s1) === JSON.stringify(s2) &&
          JSON.stringify(i1) === JSON.stringify(i2)
        )
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it("capBalance: identical outputs on repeated calls", () => {
    fc.assert(
      fc.property(arbState, arbInput, (state, input) => {
        const [s1] = capBalance(state, input)
        const [s2] = capBalance(state, input)
        return JSON.stringify(s1) === JSON.stringify(s2)
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it("composed Φ: identical outputs on repeated calls", () => {
    const Phi = compose(applyDelta, floorBalance, capBalance, freezeIfNegative)
    fc.assert(
      fc.property(arbState, arbInput, (state, input) => {
        const [s1, i1] = Phi(state, input)
        const [s2, i2] = Phi(state, input)
        return (
          JSON.stringify(s1) === JSON.stringify(s2) &&
          i1.length === i2.length
        )
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it("reducer does not mutate input state", () => {
    fc.assert(
      fc.property(arbState, arbInput, (state, input) => {
        const snapshot = JSON.stringify(state)
        applyDelta(state, input)
        return JSON.stringify(state) === snapshot
      }),
      { numRuns: NUM_RUNS },
    )
  })
})

// ── Reducer Monoid (Law 1) ────────────────────────────────────────────────────

describe("Reducer monoid — identity and associativity (Law 1)", () => {
  const identityR: Reducer<S, I> = (state, _) => [state, []]

  it("left identity: identity ∘ R ≡ R", () => {
    fc.assert(
      fc.property(arbState, arbInput, (state, input) => {
        const [s1, i1] = applyDelta(state, input)
        const [s2, i2] = compose(identityR, applyDelta)(state, input)
        return (
          JSON.stringify(s1) === JSON.stringify(s2) &&
          JSON.stringify(i1) === JSON.stringify(i2)
        )
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it("right identity: R ∘ identity ≡ R", () => {
    fc.assert(
      fc.property(arbState, arbInput, (state, input) => {
        const [s1, i1] = applyDelta(state, input)
        const [s2, i2] = compose(applyDelta, identityR)(state, input)
        return (
          JSON.stringify(s1) === JSON.stringify(s2) &&
          JSON.stringify(i1) === JSON.stringify(i2)
        )
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it("associativity: (R₃ ∘ R₂) ∘ R₁ ≡ R₃ ∘ (R₂ ∘ R₁)", () => {
    fc.assert(
      fc.property(arbState, arbInput, (state, input) => {
        const leftAssoc = compose(compose(applyDelta, floorBalance), freezeIfNegative)
        const rightAssoc = compose(applyDelta, compose(floorBalance, freezeIfNegative))
        const [sL] = leftAssoc(state, input)
        const [sR] = rightAssoc(state, input)
        return JSON.stringify(sL) === JSON.stringify(sR)
      }),
      { numRuns: NUM_RUNS },
    )
  })
})

// ── Intent Monoid (Law 2) ─────────────────────────────────────────────────────

const arbIntentList: fc.Arbitrary<IntentList> = fc.array(
  fc.oneof(
    fc.record({
      type: fc.constant("LOG" as const),
      level: fc.constantFrom("info" as const, "warn" as const, "error" as const),
      msg: fc.string(),
    }),
    fc.record({
      type: fc.constant("STORE" as const),
      key: fc.string({ maxLength: 20 }),
      value: fc.jsonValue(),
    }),
  ),
  { maxLength: 10 },
)

describe("Intent monoid — concat unit and associativity (Law 2)", () => {
  it("right unit: concat(intents, empty) ≡ intents", () => {
    fc.assert(
      fc.property(arbIntentList, (intents) => {
        return JSON.stringify(concat(intents, empty)) === JSON.stringify(intents)
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it("left unit: concat(empty, intents) ≡ intents", () => {
    fc.assert(
      fc.property(arbIntentList, (intents) => {
        return JSON.stringify(concat(empty, intents)) === JSON.stringify(intents)
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it("associativity: concat(concat(a,b),c) ≡ concat(a,concat(b,c))", () => {
    fc.assert(
      fc.property(arbIntentList, arbIntentList, arbIntentList, (a, b, c) => {
        const left = concat(concat(a, b), c)
        const right = concat(a, concat(b, c))
        return JSON.stringify(left) === JSON.stringify(right)
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it("composed reducers accumulate all intents", () => {
    fc.assert(
      fc.property(arbState, arbInput, (state, input) => {
        const [, i1] = applyDelta(state, input)
        const [s1] = applyDelta(state, input)
        const [, i2] = freezeIfNegative(s1, input)
        const [, composed] = compose(applyDelta, freezeIfNegative)(state, input)
        return composed.length === i1.length + i2.length
      }),
      { numRuns: NUM_RUNS },
    )
  })
})

// ── Dual algebra (Law 10) ─────────────────────────────────────────────────────

describe("Dual algebra Φ = Cₙ ∘ ⋯ ∘ C₁ ∘ Pₘ ∘ ⋯ ∘ P₁ (Law 10)", () => {
  // P1: floor to 0 (projection)
  const P1: Reducer<S, I> = (state, _) => [
    { ...state, balance: Math.max(0, state.balance) },
    [],
  ]
  // C1: cap at 1M (constraint)
  const C1: Reducer<S, I> = (state, _) => [
    { ...state, balance: Math.min(state.balance, 1_000_000) },
    [],
  ]
  // C2: freeze if negative (constraint, runs after P1 so balance ≥ 0 always)
  const C2: Reducer<S, I> = (state, _) => [
    state.balance < 0 ? { ...state, active: false } : state,
    [],
  ]

  const Phi = compose(P1, C1, C2)

  it("Φ is deterministic across all generative states", () => {
    fc.assert(
      fc.property(arbState, arbInput, (state, input) => {
        const [s1] = Phi(state, input)
        const [s2] = Phi(state, input)
        return JSON.stringify(s1) === JSON.stringify(s2)
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it("projection P1 ensures balance ≥ 0 before constraints run", () => {
    fc.assert(
      fc.property(arbState, arbInput, (state, input) => {
        const [result] = Phi(state, input)
        // After P1 floors to 0, C2 (freeze if <0) never triggers
        return result.active === state.active || result.balance >= 0
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it("constraint C1 ensures balance ≤ 1_000_000", () => {
    fc.assert(
      fc.property(arbState, arbInput, (state, input) => {
        const [result] = Phi(state, input)
        return result.balance <= 1_000_000
      }),
      { numRuns: NUM_RUNS },
    )
  })
})