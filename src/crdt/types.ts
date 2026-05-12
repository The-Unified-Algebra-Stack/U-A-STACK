// ─── CRDT Field Types ────────────────────────────────────────────────────────
// All types satisfy CMA laws: commutative, associative, idempotent, monotone.

export interface CRDT<T> {
  value: T
  merge(other: this): this
  equals(other: this): boolean
}

// EscrowCounter: max-wins, nonnegative integer
export interface EscrowCounterData {
  readonly max: number   // highest witnessed value (max-wins lattice)
}

// PNCounter: positive-negative counter (two grow-only counters)
export interface PNCounterData {
  readonly pos: Readonly<Record<string, number>>  // node → increment total
  readonly neg: Readonly<Record<string, number>>  // node → decrement total
}

// LWWRegister: last-write-wins by timestamp
export interface LWWRegisterData<V> {
  readonly value: V
  readonly timestamp: number   // milliseconds; higher wins
  readonly nodeId: string      // tiebreaker when timestamps equal
}

// ORSet: observed-remove set; each element tagged with unique token set
export interface ORSetData<E> {
  // Map from element key (JSON) → set of add-tokens (UUIDs)
  readonly entries: Readonly<Record<string, ReadonlyArray<string>>>
}

// MergeAlgebra wraps any CRDT value with a verified merge function
export interface MergeAlgebra<T> {
  merge(a: T, b: T): T
  eq(a: T, b: T): boolean
}