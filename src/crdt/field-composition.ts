import type { MergeAlgebra } from "./types.js"
import { buildVerified } from "./merge-algebra.js"

// ─── Field Composition ────────────────────────────────────────────────────────
// Compose per-field MergeAlgebras into a single MergeAlgebra over a record.
//
// Each field in the state schema is a CRDT with its own algebra.
// The composed algebra merges each field independently.
// This inherits CMA laws from each field algebra (proven by field-level tests).
//
// From the spec, Type 6 / Law 6-9:
//   "Field-typed composition – Each field in Σ is a CRDT: EscrowCounter,
//    PNCounter, LWW, ORSet. Merge composes per-field merge functions."

// A FieldAlgebras<Σ> maps every key of Σ to the MergeAlgebra for that field's type.
export type FieldAlgebras<Σ> = {
  [K in keyof Σ]: MergeAlgebra<Σ[K]>
}

/**
 * Build a MergeAlgebra<Σ> from a map of per-field algebras.
 * Optionally pass CMA samples to verify the composed algebra at construction.
 */
export function composeFields<Σ extends object>(
  fieldAlgebras: FieldAlgebras<Σ>,
  samples: readonly [Σ, Σ, Σ][] = []
): MergeAlgebra<Σ> {
  const keys = Object.keys(fieldAlgebras) as (keyof Σ)[]

  function merge(a: Σ, b: Σ): Σ {
    const result = {} as Σ
    for (const k of keys) {
      result[k] = fieldAlgebras[k].merge(a[k], b[k])
    }
    return result
  }

  function eq(a: Σ, b: Σ): boolean {
    return keys.every((k) => fieldAlgebras[k].eq(a[k], b[k]))
  }

  return buildVerified(merge, eq, samples)
}

/**
 * Convenience: derive a simple JSON-equality-based MergeAlgebra for a scalar
 * field with a custom merge function (e.g. a plain number field using Math.max).
 */
export function scalarAlgebra<V>(
  merge: (a: V, b: V) => V
): MergeAlgebra<V> {
  return {
    merge,
    eq: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  }
}