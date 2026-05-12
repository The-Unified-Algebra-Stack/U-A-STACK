/**
 * Unit tests for Reducer<Σ, ι> — Laws 1, 2, 10
 * Spec: Axiom 1 (Universal Reducer), Law 1 (Reducer Monoid), Law 2 (Intent Monoid)
 */

import { describe, it, expect } from "@jest/globals"

// ── Types ────────────────────────────────────────────────────────────────────

type Intent =
  | { type: "SEND"; to: string; opcode: number; payload: unknown }
  | { type: "STORE"; key: string; value: unknown }
  | { type: "SCHEDULE"; reducerId: string; delayMs: number }
  | { type: "LOG"; level: "info" | "warn" | "error"; msg: string }
  | { type: "EMIT"; channel: string; payload: unknown }
  | { type: "LLM"; model: string; prompt: string; maxTokens: number }

type IntentList = readonly Intent[]

type Reducer<Σ, ι = unknown> = (state: Σ, input: ι) => readonly [Σ, IntentList]

// ── Helpers ──────────────────────────────────────────────────────────────────

function identity<Σ>(state: Σ): readonly [Σ, IntentList] {
  return [state, []] as const
}

function compose<Σ, ι>(...reducers: Reducer<Σ, ι>[]): Reducer<Σ, ι> {
  return (state: Σ, input: ι) => {
    let s = state
    let intents: Intent[] = []
    for (const r of reducers) {
      const [ns, ni] = r(s, input)
      s = ns
      intents = [...intents, ...ni]
    }
    return [s, intents] as const
  }
}

function concat(a: IntentList, b: IntentList): IntentList {
  return Object.freeze([...a, ...b])
}

const emptyIntents: IntentList = Object.freeze([])

// ── Fixtures ─────────────────────────────────────────────────────────────────

type SimpleState = { count: number; label: string }

const increment: Reducer<SimpleState, { by: number }> = (state, input) => [
  { ...state, count: state.count + input.by },
  [],
]

const addLabel: Reducer<SimpleState, { suffix: string }> = (state, input) => [
  { ...state, label: state.label + input.suffix },
  [{ type: "LOG", level: "info", msg: `label updated: ${state.label}${input.suffix}` }],
]

const warnIfNegative: Reducer<SimpleState, unknown> = (state, _) => [
  state,
  state.count < 0
    ? [{ type: "LOG", level: "warn", msg: `Negative count: ${state.count}` }]
    : [],
]

const testStates: SimpleState[] = [
  { count: 0, label: "" },
  { count: 42, label: "hello" },
  { count: -10, label: "neg" },
  { count: 1000, label: "large" },
]

const testInputs = [{ by: 1 }, { by: -5 }, { by: 100 }, { by: 0 }]

// ── Purity ───────────────────────────────────────────────────────────────────

describe("Reducer purity (Law 1 / Axiom 1)", () => {
  it("produces identical output on repeated calls with same input", () => {
    for (const state of testStates) {
      for (const input of testInputs) {
        const [s1, i1] = increment(state, input)
        const [s2, i2] = increment(state, input)
        expect(JSON.stringify(s1)).toBe(JSON.stringify(s2))
        expect(i1.length).toBe(i2.length)
      }
    }
  })

  it("does not mutate the original state", () => {
    const original = { count: 5, label: "x" }
    const frozen = Object.freeze({ ...original })
    const [next] = increment(frozen as SimpleState, { by: 10 })
    expect(next.count).toBe(15)
    expect(frozen.count).toBe(5)
  })
})

// ── Reducer Monoid ───────────────────────────────────────────────────────────

describe("Reducer Monoid (Law 1)", () => {
  it("identity is left unit: identity ∘ R ≡ R", () => {
    for (const state of testStates) {
      for (const input of testInputs) {
        const [s1, i1] = increment(state, input)
        const composed = compose((s, _) => identity(s), increment)
        const [s2, i2] = composed(state, input)
        expect(JSON.stringify(s1)).toBe(JSON.stringify(s2))
        expect(i1.length).toBe(i2.length)
      }
    }
  })

  it("identity is right unit: R ∘ identity ≡ R", () => {
    for (const state of testStates) {
      for (const input of testInputs) {
        const [s1, i1] = increment(state, input)
        const composed = compose(increment, (s, _) => identity(s))
        const [s2, i2] = composed(state, input)
        expect(JSON.stringify(s1)).toBe(JSON.stringify(s2))
        expect(i1.length).toBe(i2.length)
      }
    }
  })

  it("associativity: (R₃ ∘ R₂) ∘ R₁ ≡ R₃ ∘ (R₂ ∘ R₁)", () => {
    const R1 = increment as Reducer<SimpleState, unknown>
    const R2 = warnIfNegative
    const R3 = (s: SimpleState, _: unknown): readonly [SimpleState, IntentList] => [
      { ...s, count: s.count * 2 },
      [],
    ]

    for (const state of testStates) {
      const input = { by: 1 }
      const leftAssoc = compose(compose(R1, R2), R3)
      const rightAssoc = compose(R1, compose(R2, R3))
      const [sL] = leftAssoc(state, input)
      const [sR] = rightAssoc(state, input)
      expect(JSON.stringify(sL)).toBe(JSON.stringify(sR))
    }
  })
})

// ── Intent Monoid ────────────────────────────────────────────────────────────

describe("Intent Monoid (Law 2)", () => {
  it("concat(intents, []) ≡ intents (right unit)", () => {
    const intents: IntentList = [
      { type: "LOG", level: "info", msg: "test" },
      { type: "STORE", key: "k", value: 1 },
    ]
    expect(JSON.stringify(concat(intents, emptyIntents))).toBe(JSON.stringify(intents))
  })

  it("concat([], intents) ≡ intents (left unit)", () => {
    const intents: IntentList = [{ type: "EMIT", channel: "c", payload: {} }]
    expect(JSON.stringify(concat(emptyIntents, intents))).toBe(JSON.stringify(intents))
  })

  it("concat is associative", () => {
    const i1: IntentList = [{ type: "LOG", level: "info", msg: "a" }]
    const i2: IntentList = [{ type: "STORE", key: "k", value: 1 }]
    const i3: IntentList = [{ type: "EMIT", channel: "ch", payload: null }]
    const left = concat(concat(i1, i2), i3)
    const right = concat(i1, concat(i2, i3))
    expect(JSON.stringify(left)).toBe(JSON.stringify(right))
  })

  it("intents accumulate correctly across composed reducers", () => {
    const state: SimpleState = { count: -1, label: "x" }
    const composed = compose(
      warnIfNegative,
      (s: SimpleState, _: unknown) =>
        [s, [{ type: "LOG", level: "info", msg: "second" }]] as const,
    )
    const [, intents] = composed(state, {})
    expect(intents).toHaveLength(2)
    expect(intents[0]).toMatchObject({ type: "LOG", level: "warn" })
    expect(intents[1]).toMatchObject({ type: "LOG", level: "info", msg: "second" })
  })
})

// ── Dual Algebra Composition (Law 10) ────────────────────────────────────────

describe("Dual Algebra: Φ = Cₙ ∘ ⋯ ∘ C₁ ∘ Pₘ ∘ ⋯ ∘ P₁ (Law 10)", () => {
  // P1: floor count to 0
  const P1: Reducer<SimpleState, unknown> = (state, _) => [
    { ...state, count: Math.max(0, state.count) },
    [],
  ]

  // P2: uppercase label
  const P2: Reducer<SimpleState, unknown> = (state, _) => [
    { ...state, label: state.label.toUpperCase() },
    [],
  ]

  // C1: warn if count > 500
  const C1: Reducer<SimpleState, unknown> = (state, _) => [
    state,
    state.count > 500
      ? [{ type: "LOG", level: "warn", msg: "count > 500" }]
      : [],
  ]

  // C2: cap count at 1000
  const C2: Reducer<SimpleState, unknown> = (state, _) => [
    { ...state, count: Math.min(state.count, 1000) },
    [],
  ]

  const Phi = compose(P1, P2, C1, C2)

  it("projections run before constraints", () => {
    const state: SimpleState = { count: -50, label: "hello" }
    const [result] = Phi(state, {})
    // P1 floors -50 → 0, so C1 should not warn (0 ≤ 500)
    // P2 uppercases label
    expect(result.count).toBe(0)
    expect(result.label).toBe("HELLO")
  })

  it("constraint C2 caps at 1000 after projection P1 floors to 0", () => {
    const state: SimpleState = { count: 5000, label: "x" }
    const [result] = Phi(state, {})
    expect(result.count).toBe(1000)
  })

  it("Φ is deterministic across repeated runs", () => {
    for (const state of testStates) {
      const [s1, i1] = Phi(state, {})
      const [s2, i2] = Phi(state, {})
      expect(JSON.stringify(s1)).toBe(JSON.stringify(s2))
      expect(i1.length).toBe(i2.length)
    }
  })
})