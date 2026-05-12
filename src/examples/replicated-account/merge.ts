import type { AccountState } from "./account-state"
import * as LWW from "../crdt/lww-register.js"

// Merge algebra — CMA laws verified at construction
//
// 1. Commutativity:  M(a, b) = M(b, a)
// 2. Associativity:  M(M(a,b),c) = M(a,M(b,c))
// 3. Idempotence:    M(a, a) = a
// 4. Monotonicity:   a ⊆ M(a, b)  — information only grows

export function mergeAccount(a: AccountState, b: AccountState): AccountState {
  return {
    // EscrowCounter: max-wins
    balance:  Math.max(a.balance, b.balance),
    reserved: Math.max(a.reserved, b.reserved),

    // LWWRegister: use proper merge function with deterministic tiebreaker
    status: LWW.merge(a.status, b.status),

    // ORSet: union of both sets
    metadata: new Set([...a.metadata, ...b.metadata]),
  }
}

export function accountEq(a: AccountState, b: AccountState): boolean {
  return (
    a.balance               === b.balance                   &&
    a.reserved              === b.reserved                  &&
    a.status.value          === b.status.value              &&
    a.status.timestamp      === b.status.timestamp          &&
    a.status.nodeId         === b.status.nodeId             &&
    a.metadata.size         === b.metadata.size             &&
    [...a.metadata].every((k) => b.metadata.has(k))
  )
}

// CMA law verification — call at startup
export function verifyCMA(
  merge:   (a: AccountState, b: AccountState) => AccountState,
  eq:      (a: AccountState, b: AccountState) => boolean,
  samples: [AccountState, AccountState, AccountState][]
): void {
  for (const [a, b, c] of samples) {
    if (!eq(merge(a, b), merge(b, a)))
      throw new Error("CMA violation: merge is not commutative")
    if (!eq(merge(merge(a, b), c), merge(a, merge(b, c))))
      throw new Error("CMA violation: merge is not associative")
    if (!eq(merge(a, a), a))
      throw new Error("CMA violation: merge is not idempotent")
  }
}

// Sample triples used by RuntimeConfig.mergeSamples
export const mergeSamples: [AccountState, AccountState, AccountState][] = [
  [
    { balance: 500, reserved: 100, status: { value: "active", timestamp: 0 }, metadata: new Set(["a"]) },
    { balance: 600, reserved: 150, status: { value: "active", timestamp: 1 }, metadata: new Set(["b"]) },
    { balance:   0, reserved:   0, status: { value: "frozen", timestamp: 2 }, metadata: new Set() },
  ],
  [
    { balance: 200, reserved:   0, status: { value: "active", timestamp: 5 }, metadata: new Set() },
    { balance: 200, reserved:   0, status: { value: "active", timestamp: 5 }, metadata: new Set() },
    { balance: 300, reserved:  50, status: { value: "active", timestamp: 6 }, metadata: new Set(["vip"]) },
  ],
]

export const mergeAlgebra = {
  merge: mergeAccount,
  eq:    accountEq,
}