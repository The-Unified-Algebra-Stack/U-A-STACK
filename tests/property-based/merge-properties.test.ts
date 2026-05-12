/**
 * Property-based tests for MergeAlgebra<Σ> — Laws 6, 7, 8, 9
 * Spec: §VERIFICATION FRAMEWORK §4 (Merge CMA Testing), §6 (Generative)
 * 10k+ iterations per law
 */

import { describe, it, expect } from "@jest/globals"
import * as fc from "fast-check"

// ── Types ────────────────────────────────────────────────────────────────────

type LWW<T> = { value: T; timestamp: number; nodeId: string }
type ORSet<T> = Set<T>
type PNCounter = { pos: number; neg: number }

type AccountState = {
  balance: number        // EscrowCounter (max-wins)
  reserved: number       // EscrowCounter (max-wins)
  status: LWW<"active" | "frozen">
  metadata: ORSet<string>
  txCount: PNCounter     // PNCounter: pos increments, neg decrements
}

// ── Merge functions per CRDT type ─────────────────────────────────────────────

function mergeLWW<T>(a: LWW<T>, b: LWW<T>): LWW<T> {
  if (a.timestamp > b.timestamp) return a
  if (b.timestamp > a.timestamp) return b
  // Equal timestamps: break tie by nodeId (lexicographic > not >=) for commutativity
  if (a.nodeId > b.nodeId) return a
  if (b.nodeId > a.nodeId) return b
  // Both timestamp and nodeId equal: use value as final tiebreaker
  const aJson = JSON.stringify(a.value)
  const bJson = JSON.stringify(b.value)
  return aJson > bJson ? a : b
}

function mergeORSet<T>(a: ORSet<T>, b: ORSet<T>): ORSet<T> {
  return new Set([...a, ...b])
}

function mergePNCounter(a: PNCounter, b: PNCounter): PNCounter {
  return { pos: Math.max(a.pos, b.pos), neg: Math.max(a.neg, b.neg) }
}

function mergeAccount(a: AccountState, b: AccountState): AccountState {
  return {
    balance: Math.max(a.balance, b.balance),
    reserved: Math.max(a.reserved, b.reserved),
    status: mergeLWW(a.status, b.status),
    metadata: mergeORSet(a.metadata, b.metadata),
    txCount: mergePNCounter(a.txCount, b.txCount),
  }
}

function eqAccount(a: AccountState, b: AccountState): boolean {
  return (
    a.balance === b.balance &&
    a.reserved === b.reserved &&
    a.status.value === b.status.value &&
    a.status.timestamp === b.status.timestamp &&
    a.status.nodeId === b.status.nodeId &&
    JSON.stringify([...a.metadata].sort()) ===
      JSON.stringify([...b.metadata].sort()) &&
    a.txCount.pos === b.txCount.pos &&
    a.txCount.neg === b.txCount.neg
  )
}

// ── Arbitraries ───────────────────────────────────────────────────────────────

const arbNodeId = fc.constantFrom("node-1", "node-2", "node-3", "node-4")

const arbLWW: fc.Arbitrary<LWW<"active" | "frozen">> = fc.record({
  value: fc.constantFrom("active" as const, "frozen" as const),
  timestamp: fc.integer({ min: 0, max: 1_000_000 }),
  nodeId: arbNodeId,
})

const arbORSet: fc.Arbitrary<ORSet<string>> = fc
  .array(fc.string({ maxLength: 10 }), { maxLength: 6 })
  .map((arr) => new Set(arr))

const arbPNCounter: fc.Arbitrary<PNCounter> = fc.record({
  pos: fc.integer({ min: 0, max: 100_000 }),
  neg: fc.integer({ min: 0, max: 100_000 }),
})

const arbAccount: fc.Arbitrary<AccountState> = fc.record({
  balance: fc.integer({ min: -1_000, max: 1_000_000 }),
  reserved: fc.integer({ min: 0, max: 500_000 }),
  status: arbLWW,
  metadata: arbORSet,
  txCount: arbPNCounter,
})

const NUM_RUNS = 10_000

// ── Law 6: Commutativity ──────────────────────────────────────────────────────

describe("Merge commutativity — M(a,b) = M(b,a) (Law 6)", () => {
  it("mergeAccount is commutative for all generated pairs", () => {
    fc.assert(
      fc.property(arbAccount, arbAccount, (a, b) => {
        return eqAccount(mergeAccount(a, b), mergeAccount(b, a))
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it("max-wins balance is commutative", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        (a, b) => Math.max(a, b) === Math.max(b, a),
      ),
      { numRuns: NUM_RUNS },
    )
  })

  it("LWW (with nodeId tiebreak) is commutative", () => {
    fc.assert(
      fc.property(arbLWW, arbLWW, (a, b) => {
        const r1 = mergeLWW(a, b)
        const r2 = mergeLWW(b, a)
        return r1.value === r2.value && r1.nodeId === r2.nodeId
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it("ORSet union is commutative", () => {
    fc.assert(
      fc.property(arbORSet, arbORSet, (a, b) => {
        const r1 = mergeORSet(a, b)
        const r2 = mergeORSet(b, a)
        return (
          JSON.stringify([...r1].sort()) === JSON.stringify([...r2].sort())
        )
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it("PNCounter merge is commutative", () => {
    fc.assert(
      fc.property(arbPNCounter, arbPNCounter, (a, b) => {
        const r1 = mergePNCounter(a, b)
        const r2 = mergePNCounter(b, a)
        return r1.pos === r2.pos && r1.neg === r2.neg
      }),
      { numRuns: NUM_RUNS },
    )
  })
})

// ── Law 7: Associativity ──────────────────────────────────────────────────────

describe("Merge associativity — M(M(a,b),c) = M(a,M(b,c)) (Law 7)", () => {
  it("mergeAccount is associative for all generated triples", () => {
    fc.assert(
      fc.property(arbAccount, arbAccount, arbAccount, (a, b, c) => {
        const leftAssoc = mergeAccount(mergeAccount(a, b), c)
        const rightAssoc = mergeAccount(a, mergeAccount(b, c))
        return eqAccount(leftAssoc, rightAssoc)
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it("ORSet union is associative", () => {
    fc.assert(
      fc.property(arbORSet, arbORSet, arbORSet, (a, b, c) => {
        const left = mergeORSet(mergeORSet(a, b), c)
        const right = mergeORSet(a, mergeORSet(b, c))
        return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort())
      }),
      { numRuns: NUM_RUNS },
    )
  })
})

// ── Law 8: Idempotence ────────────────────────────────────────────────────────

describe("Merge idempotence — M(a,a) = a (Law 8)", () => {
  it("mergeAccount(a,a) = a for all generated states", () => {
    fc.assert(
      fc.property(arbAccount, (a) => {
        return eqAccount(mergeAccount(a, a), a)
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it("max(x,x) = x", () => {
    fc.assert(
      fc.property(fc.integer(), (x) => Math.max(x, x) === x),
      { numRuns: NUM_RUNS },
    )
  })

  it("ORSet union with itself is idempotent", () => {
    fc.assert(
      fc.property(arbORSet, (s) => {
        const merged = mergeORSet(s, s)
        return JSON.stringify([...merged].sort()) === JSON.stringify([...s].sort())
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it("LWW merge with itself is idempotent", () => {
    fc.assert(
      fc.property(arbLWW, (lww) => {
        const merged = mergeLWW(lww, lww)
        return merged.value === lww.value && merged.nodeId === lww.nodeId
      }),
      { numRuns: NUM_RUNS },
    )
  })
})

// ── Law 9: Monotonicity ───────────────────────────────────────────────────────

describe("Merge monotonicity — a ⊆ M(a,b) (Law 9)", () => {
  it("merged balance ≥ both inputs", () => {
    fc.assert(
      fc.property(arbAccount, arbAccount, (a, b) => {
        const m = mergeAccount(a, b)
        return m.balance >= a.balance && m.balance >= b.balance
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it("merged reserved ≥ both inputs", () => {
    fc.assert(
      fc.property(arbAccount, arbAccount, (a, b) => {
        const m = mergeAccount(a, b)
        return m.reserved >= a.reserved && m.reserved >= b.reserved
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it("merged metadata contains all elements from both inputs", () => {
    fc.assert(
      fc.property(arbAccount, arbAccount, (a, b) => {
        const m = mergeAccount(a, b)
        for (const k of a.metadata) {
          if (!m.metadata.has(k)) return false
        }
        for (const k of b.metadata) {
          if (!m.metadata.has(k)) return false
        }
        return true
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it("merged status timestamp ≥ both inputs", () => {
    fc.assert(
      fc.property(arbAccount, arbAccount, (a, b) => {
        const m = mergeAccount(a, b)
        return (
          m.status.timestamp >= a.status.timestamp &&
          m.status.timestamp >= b.status.timestamp
        )
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it("PNCounter pos and neg are monotone", () => {
    fc.assert(
      fc.property(arbAccount, arbAccount, (a, b) => {
        const m = mergeAccount(a, b)
        return (
          m.txCount.pos >= a.txCount.pos &&
          m.txCount.pos >= b.txCount.pos &&
          m.txCount.neg >= a.txCount.neg &&
          m.txCount.neg >= b.txCount.neg
        )
      }),
      { numRuns: NUM_RUNS },
    )
  })
})

// ── Gossip convergence property ───────────────────────────────────────────────

describe("Gossip convergence: M(σA, σB) = M(σB, σA) after exchange", () => {
  it("two nodes converge after mutual merge", () => {
    fc.assert(
      fc.property(arbAccount, arbAccount, (sA, sB) => {
        const sAp = mergeAccount(sA, sB)
        const sBp = mergeAccount(sB, sA)
        return eqAccount(sAp, sBp)
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it("three-node gossip: all nodes converge", () => {
    fc.assert(
      fc.property(arbAccount, arbAccount, arbAccount, (sA, sB, sC) => {
        const merged = mergeAccount(mergeAccount(sA, sB), sC)
        const all = [
          mergeAccount(mergeAccount(sA, sB), sC),
          mergeAccount(mergeAccount(sA, sC), sB),
          mergeAccount(mergeAccount(sB, sC), sA),
          mergeAccount(mergeAccount(sB, sA), sC),
          mergeAccount(mergeAccount(sC, sA), sB),
          mergeAccount(mergeAccount(sC, sB), sA),
        ]
        return all.every((s) => eqAccount(s, merged))
      }),
      { numRuns: NUM_RUNS },
    )
  })
})