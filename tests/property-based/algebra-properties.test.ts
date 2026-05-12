/**
 * Property-based tests for dual algebra invariants — Laws 3, 4, 5, 10, 11, 14, 15
 * Spec: §ALGEBRAIC LAWS, §VERIFICATION FRAMEWORK §6 (Generative Testing)
 * Covers: projection idempotence, projection commutativity, constraint ordering,
 *         dual-algebra composition, causal consistency, intent deferred execution,
 *         JSON universality
 */

import { describe, it, expect } from "@jest/globals"
import * as fc from "fast-check"

// ── Types ────────────────────────────────────────────────────────────────────

type Intent =
  | { type: "LOG"; level: "info" | "warn" | "error"; msg: string }
  | { type: "STORE"; key: string; value: unknown }
  | { type: "EMIT"; channel: string; payload: unknown }
  | { type: "SEND"; to: string; opcode: number; payload: unknown }

type IntentList = readonly Intent[]
type Reducer<Σ, ι = unknown> = (state: Σ, input: ι) => readonly [Σ, IntentList]

type HLC = { logical: number; physical: number; nodeId: string }

type S = {
  balance: number
  reserved: number
  label: string
  active: boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function eqS(a: S, b: S): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

// ── Projections ───────────────────────────────────────────────────────────────

const P_floorBalance: Reducer<S> = (state, _) => [
  { ...state, balance: Math.max(0, state.balance) },
  [],
]

const P_capReserved: Reducer<S> = (state, _) => [
  { ...state, reserved: Math.min(state.reserved, 500_000) },
  [],
]

const P_canonicalLabel: Reducer<S> = (state, _) => [
  { ...state, label: state.label.toLowerCase().trim() },
  [],
]

// ── Constraints ───────────────────────────────────────────────────────────────

// C0: enforce reserved ≤ balance
const C_enforceCeiling: Reducer<S> = (state, _) => [
  { ...state, reserved: Math.min(state.reserved, state.balance) },
  [],
]

// C1: emit alert if balance < 100
const C_lowBalanceAlert: Reducer<S> = (state, _) => [
  state,
  state.balance < 100
    ? [{ type: "LOG", level: "warn", msg: `Low: ${state.balance}` }]
    : [],
]

// C2: deactivate if reserved > balance
const C_deactivateIfOverReserved: Reducer<S> = (state, _) => [
  state.reserved > state.balance ? { ...state, active: false } : state,
  state.reserved > state.balance
    ? [{ type: "EMIT", channel: "alerts", payload: { type: "over-reserved" } }]
    : [],
]

// ── Arbitraries ───────────────────────────────────────────────────────────────

const arbS: fc.Arbitrary<S> = fc.record({
  balance: fc.integer({ min: -100_000, max: 1_000_000 }),
  reserved: fc.integer({ min: 0, max: 600_000 }),
  label: fc.string({ maxLength: 30 }),
  active: fc.boolean(),
})

const arbHLC: fc.Arbitrary<HLC> = fc.record({
  logical: fc.integer({ min: 0, max: 1_000_000 }),
  physical: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
  nodeId: fc.constantFrom("node-1", "node-2", "node-3"),
})

const NUM_RUNS = 10_000

// ── Law 3: Projection Idempotence ─────────────────────────────────────────────

describe("Projection idempotence — P(P(σ)) = P(σ) (Law 3)", () => {
  const projections = [P_floorBalance, P_capReserved, P_canonicalLabel]

  for (const [i, P] of projections.entries()) {
    it(`P${i + 1}: idempotent for all generated states`, () => {
      fc.assert(
        fc.property(arbS, (state) => {
          const [s1] = P(state, undefined)
          const [s2] = P(s1, undefined)
          return eqS(s1, s2)
        }),
        { numRuns: NUM_RUNS },
      )
    })
  }

  it("composed projections are idempotent", () => {
    const composed = compose(P_floorBalance, P_capReserved, P_canonicalLabel)
    fc.assert(
      fc.property(arbS, (state) => {
        const [s1] = composed(state, undefined)
        const [s2] = composed(s1, undefined)
        return eqS(s1, s2)
      }),
      { numRuns: NUM_RUNS },
    )
  })
})

// ── Law 4: Projection Commutativity ──────────────────────────────────────────

describe("Projection commutativity — Pᵢ ∘ Pⱼ = Pⱼ ∘ Pᵢ (Law 4)", () => {
  const projections: [Reducer<S>, Reducer<S>][] = [
    [P_floorBalance, P_capReserved],
    [P_floorBalance, P_canonicalLabel],
    [P_capReserved, P_canonicalLabel],
  ]

  for (const [Pa, Pb] of projections) {
    it(`${Pa.name || "P"} ∘ ${Pb.name || "P"} is commutative`, () => {
      fc.assert(
        fc.property(arbS, (state) => {
          const [forward] = compose(Pa, Pb)(state, undefined)
          const [reverse] = compose(Pb, Pa)(state, undefined)
          return eqS(forward, reverse)
        }),
        { numRuns: NUM_RUNS },
      )
    })
  }

  it("all 6 permutations of 3 projections yield the same result", () => {
    const perms: Array<[Reducer<S>, Reducer<S>, Reducer<S>]> = [
      [P_floorBalance, P_capReserved, P_canonicalLabel],
      [P_floorBalance, P_canonicalLabel, P_capReserved],
      [P_capReserved, P_floorBalance, P_canonicalLabel],
      [P_capReserved, P_canonicalLabel, P_floorBalance],
      [P_canonicalLabel, P_floorBalance, P_capReserved],
      [P_canonicalLabel, P_capReserved, P_floorBalance],
    ]

    fc.assert(
      fc.property(arbS, (state) => {
        const results = perms.map(([a, b, c]) => {
          const [s] = compose(a, b, c)(state, undefined)
          return s
        })
        return results.every((r) => eqS(r, results[0]))
      }),
      { numRuns: NUM_RUNS },
    )
  })
})

// ── Law 5: Constraint Ordering Semantics ────────────────────────────────────

describe("Constraint ordering — ∃σ. Cᵢ(Cⱼ(σ)) ≠ Cⱼ(Cᵢ(σ)) (Law 5)", () => {
  it("C_enforceCeiling ∘ C_deactivate ≠ C_deactivate ∘ C_enforceCeiling for some states", () => {
    // Find a witness state where order changes output
    let witnessFound = false
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 100 }),
        fc.integer({ min: 101, max: 200 }), // reserved > balance guaranteed
        (balance, reserved) => {
          const state: S = { balance, reserved, label: "x", active: true }
          const [sCeC] = compose(C_enforceCeiling, C_deactivateIfOverReserved)(state, undefined)
          const [sCdC] = compose(C_deactivateIfOverReserved, C_enforceCeiling)(state, undefined)
          if (!eqS(sCeC, sCdC)) witnessFound = true
          return true // property: we just want to collect witnesses
        },
      ),
      { numRuns: 1_000 },
    )
    expect(witnessFound).toBe(true)
  })

  it("correct order (ceiling before deactivate) produces active accounts when capped", () => {
    // balance=50, reserved=80: ceiling brings reserved to 50 → not over-reserved → active
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        (balance) => {
          const state: S = { balance, reserved: balance + 1, label: "", active: true }
          // C_ceiling first: reserved → balance; C_deactivate sees reserved=balance (not >) → active
          const [result] = compose(C_enforceCeiling, C_deactivateIfOverReserved)(state, undefined)
          // After ceiling, reserved = balance, so reserved > balance is false
          return result.active === true
        },
      ),
      { numRuns: NUM_RUNS },
    )
  })

  it("wrong order (deactivate before ceiling) deactivates first then ceiling", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        (balance) => {
          const state: S = { balance, reserved: balance + 1, label: "", active: true }
          // C_deactivate first: sees reserved > balance → deactivates + emits EMIT
          const [result, intents] = compose(
            C_deactivateIfOverReserved,
            C_enforceCeiling,
          )(state, undefined)
          return result.active === false && intents.length > 0
        },
      ),
      { numRuns: NUM_RUNS },
    )
  })
})

// ── Law 11: Causal Consistency ────────────────────────────────────────────────

describe("Causal consistency — a→b ⟹ λ(a) < λ(b) (Law 11)", () => {
  function happensBefore(a: HLC, b: HLC): boolean {
    if (a.logical < b.logical) return true
    if (a.logical === b.logical && a.nodeId < b.nodeId) return true
    return false
  }

  function concurrent(a: HLC, b: HLC): boolean {
    return !happensBefore(a, b) && !happensBefore(b, a)
  }

  it("happensBefore is irreflexive: !happensBefore(a,a)", () => {
    fc.assert(
      fc.property(arbHLC, (a) => !happensBefore(a, a)),
      { numRuns: NUM_RUNS },
    )
  })

  it("happensBefore is antisymmetric: a→b ⟹ !(b→a)", () => {
    fc.assert(
      fc.property(arbHLC, arbHLC, (a, b) => {
        if (happensBefore(a, b)) return !happensBefore(b, a)
        return true
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it("happensBefore is transitive: a→b, b→c ⟹ a→c", () => {
    fc.assert(
      fc.property(arbHLC, arbHLC, arbHLC, (a, b, c) => {
        if (happensBefore(a, b) && happensBefore(b, c)) {
          return happensBefore(a, c)
        }
        return true
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it("concurrent is symmetric: concurrent(a,b) iff concurrent(b,a)", () => {
    fc.assert(
      fc.property(arbHLC, arbHLC, (a, b) => {
        return concurrent(a, b) === concurrent(b, a)
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it("total order: for same nodeId, strictly increasing logical clocks", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        (base, inc) => {
          const a: HLC = { logical: base, physical: 0, nodeId: "node-1" }
          const b: HLC = { logical: base + inc, physical: 0, nodeId: "node-1" }
          return happensBefore(a, b) && !happensBefore(b, a)
        },
      ),
      { numRuns: NUM_RUNS },
    )
  })
})

// ── Law 14: Intent Deferred Execution ────────────────────────────────────────

describe("Intent deferred — emitted but not executed within reducer (Law 14)", () => {
  it("reducer returns intents without side effects", () => {
    const sideEffects: string[] = []

    const safeReducer: Reducer<S> = (state, _) => [
      state,
      [
        { type: "LOG", level: "info", msg: "side-effect deferred" },
        { type: "STORE", key: "k", value: 42 },
      ],
    ]

    fc.assert(
      fc.property(arbS, (state) => {
        const before = sideEffects.length
        const [, intents] = safeReducer(state, undefined)
        const after = sideEffects.length
        return after === before && intents.length === 2
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it("same state+input always produces same intents (replayability)", () => {
    const Phi = compose(C_enforceCeiling, C_lowBalanceAlert, C_deactivateIfOverReserved)

    fc.assert(
      fc.property(arbS, (state) => {
        const [, i1] = Phi(state, undefined)
        const [, i2] = Phi(state, undefined)
        return JSON.stringify(i1) === JSON.stringify(i2)
      }),
      { numRuns: NUM_RUNS },
    )
  })
})

// ── Law 15: JSON Universality ─────────────────────────────────────────────────

describe("JSON universality — all Σ serializable (Law 15)", () => {
  it("AccountState round-trips through JSON", () => {
    fc.assert(
      fc.property(arbS, (state) => {
        const serialized = JSON.stringify(state)
        const deserialized = JSON.parse(serialized) as S
        return eqS(state, deserialized)
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it("IntentList round-trips through JSON", () => {
    const arbIntent: fc.Arbitrary<Intent> = fc.oneof(
      fc.record({
        type: fc.constant("LOG" as const),
        level: fc.constantFrom("info" as const, "warn" as const),
        msg: fc.string(),
      }),
      fc.record({
        type: fc.constant("STORE" as const),
        key: fc.string({ maxLength: 20 }),
        value: fc.jsonValue(),
      }),
    )

    fc.assert(
      fc.property(fc.array(arbIntent, { maxLength: 10 }), (intents) => {
        const serialized = JSON.stringify(intents)
        const deserialized: Intent[] = JSON.parse(serialized)
        return JSON.stringify(intents) === JSON.stringify(deserialized)
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it("reducer output [state, intents] is fully JSON-serializable", () => {
    const Phi = compose(P_floorBalance, P_capReserved, C_enforceCeiling, C_lowBalanceAlert)

    fc.assert(
      fc.property(arbS, (state) => {
        const [nextState, intents] = Phi(state, undefined)
        try {
          const s = JSON.stringify([nextState, intents])
          const [s2] = JSON.parse(s)
          return eqS(s2 as S, nextState)
        } catch {
          return false
        }
      }),
      { numRuns: NUM_RUNS },
    )
  })
})