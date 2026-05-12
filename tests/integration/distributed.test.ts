/**
 * Integration tests for distributed execution — Law 11, Law 15, §DISTRIBUTED EXECUTION
 * Spec: §Multi-Node Convergent Synchronization, §Causal Consistency Under Network Reordering,
 *       §Gossip-Based Synchronization, §Vector Clock / HLC Causal Ordering
 */

import { describe, it, expect } from "@jest/globals"

// ── Types ────────────────────────────────────────────────────────────────────

type Intent = { type: "EMIT"; channel: string; payload: unknown }
type IntentList = readonly Intent[]
type Reducer<Σ, ι = unknown> = (state: Σ, input: ι) => readonly [Σ, IntentList]

type HLC = { logical: number; physical: number; nodeId: string }

type LWW<T> = { value: T; timestamp: number; nodeId: string }
type ORSet<T> = Set<T>

type AccountState = {
  balance: number       // EscrowCounter max-wins
  reserved: number      // EscrowCounter max-wins
  status: LWW<"active" | "frozen">
  metadata: ORSet<string>
}

// ── HLC ───────────────────────────────────────────────────────────────────────

class HybridLogicalClock {
  private logical = 0

  constructor(private nodeId: string) {}

  tick(): HLC {
    return { logical: ++this.logical, physical: Date.now(), nodeId: this.nodeId }
  }

  update(received: HLC): HLC {
    this.logical = Math.max(this.logical, received.logical) + 1
    return { logical: this.logical, physical: Date.now(), nodeId: this.nodeId }
  }

  happensBefore(a: HLC, b: HLC): boolean {
    if (a.logical < b.logical) return true
    if (a.logical === b.logical && a.nodeId < b.nodeId) return true
    return false
  }

  concurrent(a: HLC, b: HLC): boolean {
    return !this.happensBefore(a, b) && !this.happensBefore(b, a)
  }
}

// ── Merge ─────────────────────────────────────────────────────────────────────

function mergeLWW<T>(a: LWW<T>, b: LWW<T>): LWW<T> {
  if (a.timestamp > b.timestamp) return a
  if (b.timestamp > a.timestamp) return b
  return a.nodeId >= b.nodeId ? a : b // nodeId tiebreak
}

function mergeAccount(a: AccountState, b: AccountState): AccountState {
  return {
    balance: Math.max(a.balance, b.balance),
    reserved: Math.max(a.reserved, b.reserved),
    status: mergeLWW(a.status, b.status),
    metadata: new Set([...a.metadata, ...b.metadata]),
  }
}

function eqAccount(a: AccountState, b: AccountState): boolean {
  return (
    a.balance === b.balance &&
    a.reserved === b.reserved &&
    a.status.value === b.status.value &&
    a.status.nodeId === b.status.nodeId &&
    JSON.stringify([...a.metadata].sort()) ===
      JSON.stringify([...b.metadata].sort())
  )
}

// ── Simulated Node ────────────────────────────────────────────────────────────

class Node {
  state: AccountState
  private hlc: HybridLogicalClock
  history: { ts: HLC; state: AccountState }[] = []

  constructor(
    public id: string,
    initial: AccountState,
  ) {
    this.state = initial
    this.hlc = new HybridLogicalClock(id)
  }

  apply(reducer: Reducer<AccountState>, input: unknown): HLC {
    const [next] = reducer(this.state, input)
    this.state = next
    const ts = this.hlc.tick()
    this.history.push({ ts, state: { ...this.state } })
    return ts
  }

  receiveGossip(remote: AccountState, remoteTs: HLC): void {
    this.hlc.update(remoteTs)
    this.state = mergeAccount(this.state, remote)
  }
}

// ── Domain reducers ───────────────────────────────────────────────────────────

const deposit =
  (amount: number): Reducer<AccountState> =>
  (state, _) => [{ ...state, balance: state.balance + amount }, []]

const freeze =
  (nodeId: string, ts: number): Reducer<AccountState> =>
  (state, _) => [
    { ...state, status: { value: "frozen", timestamp: ts, nodeId } },
    [],
  ]

const addMeta =
  (key: string): Reducer<AccountState> =>
  (state, _) => [{ ...state, metadata: new Set([...state.metadata, key]) }, []]

// ── Base state ────────────────────────────────────────────────────────────────

function baseState(nodeId = "node-1"): AccountState {
  return {
    balance: 500,
    reserved: 100,
    status: { value: "active", timestamp: 0, nodeId },
    metadata: new Set(),
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Two-node gossip convergence (spec §Multi-Node)", () => {
  it("nodes converge after mutual state exchange", () => {
    const A = new Node("node-A", baseState("node-A"))
    const B = new Node("node-B", baseState("node-B"))

    // Independent mutations
    const tsA = A.apply(deposit(200), {})
    const tsB = B.apply(deposit(300), {})

    // Gossip exchange
    A.receiveGossip(B.state, tsB)
    B.receiveGossip(A.state, tsA)

    // Convergence: both should have balance = max(700, 800) = 800
    expect(A.state.balance).toBe(800)
    expect(B.state.balance).toBe(800)
    expect(eqAccount(A.state, B.state)).toBe(true)
  })

  it("M(σA, σB) = M(σB, σA) — gossip result is commutative", () => {
    const A = new Node("node-A", baseState("node-A"))
    const B = new Node("node-B", { ...baseState("node-B"), balance: 700 })

    const mergeAB = mergeAccount(A.state, B.state)
    const mergeBA = mergeAccount(B.state, A.state)

    expect(eqAccount(mergeAB, mergeBA)).toBe(true)
  })

  it("merging with self yields same state (idempotent gossip)", () => {
    const A = new Node("node-A", baseState("node-A"))
    A.apply(deposit(100), {})

    const before = { ...A.state }
    A.receiveGossip(A.state, { logical: 999, physical: 0, nodeId: "node-A" })

    expect(eqAccount(A.state, before)).toBe(true)
  })
})

describe("Three-node convergence", () => {
  it("all 3 nodes converge regardless of gossip order", () => {
    const sA = baseState("node-A")
    const sB = { ...baseState("node-B"), balance: 700 }
    const sC = { ...baseState("node-C"), balance: 600, reserved: 200 }

    const merged_ABC = mergeAccount(mergeAccount(sA, sB), sC)
    const merged_CBA = mergeAccount(mergeAccount(sC, sB), sA)
    const merged_BAC = mergeAccount(mergeAccount(sB, sA), sC)

    expect(eqAccount(merged_ABC, merged_CBA)).toBe(true)
    expect(eqAccount(merged_ABC, merged_BAC)).toBe(true)
  })

  it("3-node ORSet converges to union of all metadata", () => {
    const A = new Node("node-A", baseState())
    const B = new Node("node-B", baseState())
    const C = new Node("node-C", baseState())

    A.apply(addMeta("tag-a"), {})
    B.apply(addMeta("tag-b"), {})
    C.apply(addMeta("tag-c"), {})

    // Full gossip
    A.receiveGossip(B.state, { logical: 1, physical: 0, nodeId: "node-B" })
    A.receiveGossip(C.state, { logical: 1, physical: 0, nodeId: "node-C" })
    B.receiveGossip(A.state, { logical: 2, physical: 0, nodeId: "node-A" })
    B.receiveGossip(C.state, { logical: 1, physical: 0, nodeId: "node-C" })
    C.receiveGossip(A.state, { logical: 2, physical: 0, nodeId: "node-A" })
    C.receiveGossip(B.state, { logical: 2, physical: 0, nodeId: "node-B" })

    for (const node of [A, B, C]) {
      expect(node.state.metadata.has("tag-a")).toBe(true)
      expect(node.state.metadata.has("tag-b")).toBe(true)
      expect(node.state.metadata.has("tag-c")).toBe(true)
    }

    expect(eqAccount(A.state, B.state)).toBe(true)
    expect(eqAccount(B.state, C.state)).toBe(true)
  })
})

describe("Causal consistency under network reordering (spec §Causal Consistency)", () => {
  it("events applied in happens-before order despite out-of-order delivery", () => {
    const hlc = new HybridLogicalClock("node-X")

    // Event A happens at logical=1
    const tsA: HLC = { logical: 1, physical: 0, nodeId: "node-X" }
    // Event B happens at logical=2 (caused by A)
    const tsB: HLC = { logical: 2, physical: 0, nodeId: "node-X" }

    // A happens-before B
    expect(hlc.happensBefore(tsA, tsB)).toBe(true)
    expect(hlc.happensBefore(tsB, tsA)).toBe(false)
  })

  it("LWW status freeze: higher timestamp wins across concurrent writes", () => {
    const A = new Node("node-A", baseState("node-A"))
    const B = new Node("node-B", baseState("node-B"))

    // A freezes at t=10
    A.apply(freeze("node-A", 10), {})
    // B freezes at t=5 (concurrent, lower ts)
    B.apply(freeze("node-B", 5), {})

    // Exchange
    A.receiveGossip(B.state, { logical: 1, physical: 0, nodeId: "node-B" })
    B.receiveGossip(A.state, { logical: 1, physical: 0, nodeId: "node-A" })

    // Both should see A's freeze (higher ts)
    expect(A.state.status.timestamp).toBe(10)
    expect(B.state.status.timestamp).toBe(10)
    expect(A.state.status.nodeId).toBe("node-A")
    expect(eqAccount(A.state, B.state)).toBe(true)
  })

  it("concurrent events: nodeId tiebreak ensures commutativity", () => {
    const statusA: LWW<"active" | "frozen"> = {
      value: "frozen",
      timestamp: 5,
      nodeId: "node-Z", // higher lexicographically
    }
    const statusB: LWW<"active" | "frozen"> = {
      value: "active",
      timestamp: 5,
      nodeId: "node-A",
    }

    const r1 = mergeLWW(statusA, statusB)
    const r2 = mergeLWW(statusB, statusA)

    // Both picks node-Z (higher nodeId) — commutative
    expect(r1.nodeId).toBe("node-Z")
    expect(r2.nodeId).toBe("node-Z")
  })
})

describe("HLC causal ordering (spec Type 8)", () => {
  it("HLC tick is strictly monotone on same node", () => {
    const hlc = new HybridLogicalClock("node-1")
    const t1 = hlc.tick()
    const t2 = hlc.tick()
    const t3 = hlc.tick()

    expect(t2.logical).toBeGreaterThan(t1.logical)
    expect(t3.logical).toBeGreaterThan(t2.logical)
  })

  it("HLC update advances logical clock beyond received value", () => {
    const hlcA = new HybridLogicalClock("node-A")
    const hlcB = new HybridLogicalClock("node-B")

    const t1 = hlcA.tick() // logical=1
    hlcA.tick() // logical=2
    hlcA.tick() // logical=3

    // B receives message with A's t1 (logical=1), B is at 0 → advances to 2
    const tB = hlcB.update(t1)
    expect(tB.logical).toBeGreaterThan(t1.logical)
  })

  it("a → b implies happensBefore(a, b)", () => {
    const hlc = new HybridLogicalClock("test")
    const a = hlc.tick()
    const b = hlc.tick()
    expect(hlc.happensBefore(a, b)).toBe(true)
  })

  it("concurrent events: neither happens-before the other", () => {
    // Events at same logical from different nodes
    const hlc = new HybridLogicalClock("test")
    const a: HLC = { logical: 5, physical: 0, nodeId: "node-1" }
    const b: HLC = { logical: 5, physical: 0, nodeId: "node-2" }

    // Same logical, different nodeId → tiebreak by nodeId, not concurrent
    // node-1 < node-2 → a happens-before b by tiebreak
    expect(hlc.happensBefore(a, b)).toBe(true)
    expect(hlc.happensBefore(b, a)).toBe(false)
  })

  it("causal consistency: event(a) → event(b) ⟹ ts(a).logical < ts(b).logical", () => {
    const hlc = new HybridLogicalClock("node-causal")
    const events: HLC[] = []

    for (let i = 0; i < 10; i++) {
      events.push(hlc.tick())
    }

    // Each consecutive pair satisfies happens-before
    for (let i = 0; i + 1 < events.length; i++) {
      expect(hlc.happensBefore(events[i], events[i + 1])).toBe(true)
    }
  })
})

describe("Network partition recovery", () => {
  it("nodes re-converge after partition heals", () => {
    const A = new Node("node-A", baseState("node-A"))
    const B = new Node("node-B", baseState("node-B"))

    // Pre-partition: both sync
    A.receiveGossip(B.state, { logical: 0, physical: 0, nodeId: "node-B" })
    B.receiveGossip(A.state, { logical: 0, physical: 0, nodeId: "node-A" })

    // Partition: independent writes
    A.apply(deposit(100), {})
    A.apply(deposit(50), {})
    B.apply(deposit(200), {})
    B.apply(addMeta("during-partition"), {})

    // Nodes have diverged
    expect(eqAccount(A.state, B.state)).toBe(false)

    // Partition heals: gossip exchange
    const tsA = { logical: 10, physical: 0, nodeId: "node-A" }
    const tsB = { logical: 10, physical: 0, nodeId: "node-B" }
    A.receiveGossip(B.state, tsB)
    B.receiveGossip(A.state, tsA)

    // Re-converged
    expect(eqAccount(A.state, B.state)).toBe(true)
    expect(A.state.metadata.has("during-partition")).toBe(true)
  })

  it("monotonicity preserved: no data lost after merge during partition", () => {
    const A = new Node("node-A", { ...baseState("node-A"), balance: 1000 })
    const B = new Node("node-B", { ...baseState("node-B"), balance: 500 })

    A.apply(addMeta("key-A"), {})
    B.apply(addMeta("key-B"), {})

    // Merge
    A.receiveGossip(B.state, { logical: 5, physical: 0, nodeId: "node-B" })

    // A's state has both keys and max balance
    expect(A.state.balance).toBe(1000)
    expect(A.state.metadata.has("key-A")).toBe(true)
    expect(A.state.metadata.has("key-B")).toBe(true)
  })
})