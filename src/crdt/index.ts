// ─── CRDT Module ──────────────────────────────────────────────────────────────
// All CRDT field types used by the Unified Algebra Stack.
// Each satisfies CMA laws: commutative, associative, idempotent, monotone.

export type {
  CRDT,
  EscrowCounterData,
  PNCounterData,
  LWWRegisterData,
  ORSetData,
  MergeAlgebra,
} from "./types.js"

export * as EscrowCounter  from "./escrow-counter.js"
export * as PNCounter      from "./pn-counter.js"
export * as LWWRegister    from "./lww-register.js"
export * as ORSet          from "./orset.js"

export {
  verifyCMA,
  buildVerified,
  composeAlgebras,
  type CMAViolation,
  type CMAResult,
} from "./merge-algebra.js"

export {
  composeFields,
  scalarAlgebra,
  type FieldAlgebras,
} from "./field-composition.js"