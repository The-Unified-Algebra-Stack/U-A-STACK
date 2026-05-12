/**
 * Unit tests for ProjectionReducer<Σ> — Laws 3, 4
 * Spec: Type 4 (Projection Reducer), Law 3 (Idempotence), Law 4 (Commutativity)
 */

import { describe, it, expect } from "@jest/globals"

// ── Types ────────────────────────────────────────────────────────────────────

type IntentList = readonly unknown[]

type Reducer<Σ, ι = unknown> = (state: Σ, input: ι) => readonly [Σ, IntentList]

type ProjectionReducer<Σ> = {
  kind: "projection"
  id: string
  apply: Reducer<Σ>
}

// ── Account State fixture (spec example) ────────────────────────────────────

type AccountState = {
  balance: number
  reserved: number
  status: { value: "active" | "frozen"; timestamp: number }
  metadata: Set<string>
}

function eqAccount(a: AccountState, b: AccountState): boolean {
  return (
    a.balance === b.balance &&
    a.reserved === b.reserved &&
    a.status.value === b.status.value &&
    a.status.timestamp === b.status.timestamp &&
    JSON.stringify([...a.metadata].sort()) ===
      JSON.stringify([...b.metadata].sort())
  )
}

// ── Spec projections ──────────────────────────────────────────────────────────

// P1: If frozen, clear reserved (spec page 14)
const freezeClears: ProjectionReducer<AccountState> = {
  kind: "projection",
  id: "freeze-clears",
  apply: (state, _) => [
    state.status.value === "frozen" ? { ...state, reserved: 0 } : state,
    [],
  ],
}

// P2: Floor balance to 0 (spec page 14)
const floorBalance: ProjectionReducer<AccountState> = {
  kind: "projection",
  id: "floor-balance",
  apply: (state, _) => [
    { ...state, balance: Math.max(0, state.balance) },
    [],
  ],
}

// P3: Canonicalize metadata keys (lowercase)
const canonicalizeMetadata: ProjectionReducer<AccountState> = {
  kind: "projection",
  id: "canonicalize-metadata",
  apply: (state, _) => [
    { ...state, metadata: new Set([...state.metadata].map((k) => k.toLowerCase())) },
    [],
  ],
}

// ── Test states ───────────────────────────────────────────────────────────────

const testStates: AccountState[] = [
  {
    balance: 500,
    reserved: 100,
    status: { value: "active", timestamp: 0 },
    metadata: new Set(["KEY_A"]),
  },
  {
    balance: -50,
    reserved: 200,
    status: { value: "active", timestamp: 1 },
    metadata: new Set(["B"]),
  },
  {
    balance: 300,
    reserved: 300,
    status: { value: "frozen", timestamp: 2 },
    metadata: new Set(["C", "KEY_D"]),
  },
  {
    balance: 0,
    reserved: 0,
    status: { value: "frozen", timestamp: 3 },
    metadata: new Set(),
  },
  {
    balance: -100,
    reserved: 50,
    status: { value: "frozen", timestamp: 4 },
    metadata: new Set(["UPPER"]),
  },
]

// ── Idempotence (Law 3) ───────────────────────────────────────────────────────

function assertIdempotent<Σ>(
  projection: ProjectionReducer<Σ>,
  states: Σ[],
  eq: (a: Σ, b: Σ) => boolean,
): void {
  for (const state of states) {
    const [s1] = projection.apply(state, undefined)
    const [s2] = projection.apply(s1, undefined)
    expect(eq(s1, s2)).toBe(true)
  }
}

describe("Projection idempotence — P(P(σ)) = P(σ) (Law 3)", () => {
  it("freezeClears is idempotent", () => {
    assertIdempotent(freezeClears, testStates, eqAccount)
  })

  it("floorBalance is idempotent", () => {
    assertIdempotent(floorBalance, testStates, eqAccount)
  })

  it("canonicalizeMetadata is idempotent", () => {
    assertIdempotent(canonicalizeMetadata, testStates, eqAccount)
  })

  it("idempotent on active account: frozen check does not change active accounts twice", () => {
    const state: AccountState = {
      balance: 100,
      reserved: 50,
      status: { value: "active", timestamp: 0 },
      metadata: new Set(),
    }
    const [s1] = freezeClears.apply(state, undefined)
    const [s2] = freezeClears.apply(s1, undefined)
    expect(eqAccount(s1, s2)).toBe(true)
    expect(s1.reserved).toBe(50) // active: reserved unchanged
  })

  it("idempotent on frozen account: reserved cleared to 0 and stays 0", () => {
    const state: AccountState = {
      balance: 500,
      reserved: 200,
      status: { value: "frozen", timestamp: 1 },
      metadata: new Set(),
    }
    const [s1] = freezeClears.apply(state, undefined)
    expect(s1.reserved).toBe(0)
    const [s2] = freezeClears.apply(s1, undefined)
    expect(s2.reserved).toBe(0)
    expect(eqAccount(s1, s2)).toBe(true)
  })

  it("idempotent on already-non-negative balance", () => {
    const state: AccountState = {
      balance: 0,
      reserved: 0,
      status: { value: "active", timestamp: 0 },
      metadata: new Set(),
    }
    const [s1] = floorBalance.apply(state, undefined)
    const [s2] = floorBalance.apply(s1, undefined)
    expect(eqAccount(s1, s2)).toBe(true)
  })

  it("idempotent on negative balance: floored to 0 and stays 0", () => {
    const state: AccountState = {
      balance: -999,
      reserved: 0,
      status: { value: "active", timestamp: 0 },
      metadata: new Set(),
    }
    const [s1] = floorBalance.apply(state, undefined)
    expect(s1.balance).toBe(0)
    const [s2] = floorBalance.apply(s1, undefined)
    expect(s2.balance).toBe(0)
    expect(eqAccount(s1, s2)).toBe(true)
  })
})

// ── Commutativity (Law 4) ─────────────────────────────────────────────────────

function applySequence<Σ>(
  state: Σ,
  projections: ProjectionReducer<Σ>[],
): Σ {
  let s = state
  for (const p of projections) {
    ;[s] = p.apply(s, undefined) as [Σ, IntentList]
  }
  return s
}

function permutations<T>(arr: T[]): T[][] {
  if (arr.length <= 1) return [arr]
  return arr.flatMap((item, i) =>
    permutations([...arr.slice(0, i), ...arr.slice(i + 1)]).map((p) => [item, ...p]),
  )
}

describe("Projection commutativity — Pᵢ ∘ Pⱼ = Pⱼ ∘ Pᵢ (Law 4)", () => {
  const projections = [freezeClears, floorBalance, canonicalizeMetadata]

  it("all permutations of [P1, P2] yield same result", () => {
    for (const state of testStates) {
      const perms = permutations([freezeClears, floorBalance])
      const results = perms.map((perm) => applySequence(state, perm))
      for (let i = 1; i < results.length; i++) {
        expect(eqAccount(results[0], results[i])).toBe(true)
      }
    }
  })

  it("all permutations of [P1, P2, P3] yield same result", () => {
    for (const state of testStates) {
      const perms = permutations(projections)
      const results = perms.map((perm) => applySequence(state, perm))
      for (let i = 1; i < results.length; i++) {
        expect(eqAccount(results[0], results[i])).toBe(true)
      }
    }
  })

  it("spec example: P₁(P₂(σ)) = P₂(P₁(σ)) — freeze+floor", () => {
    for (const state of testStates) {
      const forward = applySequence(state, [freezeClears, floorBalance])
      const reverse = applySequence(state, [floorBalance, freezeClears])
      expect(eqAccount(forward, reverse)).toBe(true)
    }
  })
})

// ── Projections emit no intents ───────────────────────────────────────────────

describe("Projections emit no intents", () => {
  it("freezeClears emits empty intent list", () => {
    for (const state of testStates) {
      const [, intents] = freezeClears.apply(state, undefined)
      expect(intents).toHaveLength(0)
    }
  })

  it("floorBalance emits empty intent list", () => {
    for (const state of testStates) {
      const [, intents] = floorBalance.apply(state, undefined)
      expect(intents).toHaveLength(0)
    }
  })
})