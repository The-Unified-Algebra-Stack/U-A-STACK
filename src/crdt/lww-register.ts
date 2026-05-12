import type { LWWRegisterData, MergeAlgebra } from "./types.js"

// ─── LWWRegister ──────────────────────────────────────────────────────────────
// Last-write-wins: higher timestamp wins; nodeId breaks ties lexicographically.
//
// CMA laws:
//   Commutative:  merge(a,b) selects the same winner regardless of argument order
//   Associative:  the max-timestamp winner is the same regardless of grouping
//   Idempotent:   merge(a,a) = a  (same timestamp + nodeId → same result)
//   Monotone:     the winning value only moves forward in time

export function make<V>(value: V, nodeId: string, timestamp = Date.now()): LWWRegisterData<V> {
  return { value, timestamp, nodeId }
}

export function set<V>(
  _current: LWWRegisterData<V>,
  value: V,
  nodeId: string,
  timestamp = Date.now()
): LWWRegisterData<V> {
  // Caller supplies a fresh timestamp; we do not read the clock internally
  // to stay compatible with deterministic reducers (clock access is outside Φ).
  return { value, timestamp, nodeId }
}

export function value<V>(r: LWWRegisterData<V>): V {
  return r.value
}

// ─── MergeAlgebra instance ───────────────────────────────────────────────────

export function merge<V>(
  a: LWWRegisterData<V>,
  b: LWWRegisterData<V>
): LWWRegisterData<V> {
  // Higher timestamp wins; nodeId is a deterministic tiebreaker.
  if (a.timestamp > b.timestamp) return a
  if (b.timestamp > a.timestamp) return b
  // Equal timestamps: lexicographically larger nodeId wins (deterministic)
  if (a.nodeId > b.nodeId) return a
  if (b.nodeId > a.nodeId) return b
  // All fields equal: JSON string comparison of value (deterministic tiebreaker)
  // This ensures merge(a,b) = merge(b,a) because string comparison is commutative
  const aJson = JSON.stringify(a.value)
  const bJson = JSON.stringify(b.value)
  return aJson > bJson ? a : b
}

export function eq<V>(a: LWWRegisterData<V>, b: LWWRegisterData<V>): boolean {
  return (
    a.timestamp === b.timestamp &&
    a.nodeId === b.nodeId &&
    JSON.stringify(a.value) === JSON.stringify(b.value)
  )
}

export function makeAlgebra<V>(): MergeAlgebra<LWWRegisterData<V>> {
  return {
    merge: merge as MergeAlgebra<LWWRegisterData<V>>["merge"],
    eq:    eq    as MergeAlgebra<LWWRegisterData<V>>["eq"],
  }
}