import type { EscrowCounterData, MergeAlgebra } from "./types.js"

// ─── EscrowCounter ────────────────────────────────────────────────────────────
// Lattice: (ℕ, max).  merge = max, so information only grows (monotone).
// Idempotent:   max(a, a) = a
// Commutative:  max(a, b) = max(b, a)
// Associative:  max(max(a,b), c) = max(a, max(b,c))
// Nonnegative invariant enforced at construction and merge.

export function make(initialMax = 0): EscrowCounterData {
  if (initialMax < 0) throw new RangeError("EscrowCounter: value must be ≥ 0")
  return { max: initialMax }
}

export function value(c: EscrowCounterData): number {
  return c.max
}

/** Raise the counter to at least `amount`.  Returns a new EscrowCounterData. */
export function increment(c: EscrowCounterData, amount: number): EscrowCounterData {
  if (amount < 0) throw new RangeError("EscrowCounter: increment amount must be ≥ 0")
  return { max: Math.max(c.max, c.max + amount) }
}

/** Raw "witness" – merge in an externally observed max (e.g. from a peer). */
export function witness(c: EscrowCounterData, observed: number): EscrowCounterData {
  return { max: Math.max(0, c.max, observed) }
}

// ─── MergeAlgebra instance ───────────────────────────────────────────────────

export function merge(
  a: EscrowCounterData,
  b: EscrowCounterData
): EscrowCounterData {
  return { max: Math.max(0, a.max, b.max) }
}

export function eq(a: EscrowCounterData, b: EscrowCounterData): boolean {
  return a.max === b.max
}

export const algebra: MergeAlgebra<EscrowCounterData> = { merge, eq }