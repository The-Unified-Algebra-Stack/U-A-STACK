import type { MergeAlgebra } from "./types.js"

// ─── MergeAlgebra ─────────────────────────────────────────────────────────────
// Factory + runtime law verification as specified in the spec (Laws 6-9).
//
// Verified laws:
//   6. Commutativity:  M(a,b) = M(b,a)
//   7. Associativity:  M(M(a,b),c) = M(a,M(b,c))
//   8. Idempotence:    M(a,a) = a
//   9. Monotonicity:   a ⊆ M(a,b)  [implemented as user-supplied check]

export interface CMAViolation {
  law: "commutativity" | "associativity" | "idempotence"
  sampleIndex: number
  detail: string
}

export interface CMAResult {
  passed: boolean
  violations: CMAViolation[]
}

/**
 * Verify all CMA laws against the provided samples.
 * samples: array of [a, b, c] triples.
 */
export function verifyCMA<T>(
  algebra: MergeAlgebra<T>,
  samples: readonly [T, T, T][]
): CMAResult {
  const violations: CMAViolation[] = []

  samples.forEach(([a, b, c], i) => {
    // Law 6: Commutativity
    if (!algebra.eq(algebra.merge(a, b), algebra.merge(b, a))) {
      violations.push({
        law: "commutativity",
        sampleIndex: i,
        detail: `M(a,b) ≠ M(b,a) at sample ${i}`,
      })
    }

    // Law 7: Associativity
    if (
      !algebra.eq(
        algebra.merge(algebra.merge(a, b), c),
        algebra.merge(a, algebra.merge(b, c))
      )
    ) {
      violations.push({
        law: "associativity",
        sampleIndex: i,
        detail: `M(M(a,b),c) ≠ M(a,M(b,c)) at sample ${i}`,
      })
    }

    // Law 8: Idempotence
    if (!algebra.eq(algebra.merge(a, a), a)) {
      violations.push({
        law: "idempotence",
        sampleIndex: i,
        detail: `M(a,a) ≠ a at sample ${i}`,
      })
    }
  })

  return { passed: violations.length === 0, violations }
}

/**
 * Build a verified MergeAlgebra; throws if any CMA law is violated on samples.
 * Pass an empty samples array to skip verification (not recommended in production).
 */
export function buildVerified<T>(
  merge: (a: T, b: T) => T,
  eq: (a: T, b: T) => boolean,
  samples: readonly [T, T, T][]
): MergeAlgebra<T> {
  const algebra: MergeAlgebra<T> = { merge, eq }

  if (samples.length > 0) {
    const result = verifyCMA(algebra, samples)
    if (!result.passed) {
      const details = result.violations.map((v) => v.detail).join("; ")
      throw new Error(`MergeAlgebra CMA law violations: ${details}`)
    }
  }

  return algebra
}

/**
 * Compose two verified MergeAlgebras over independent state fields.
 * Resulting algebra merges each field independently, which preserves CMA laws.
 */
export function composeAlgebras<A, B>(
  algA: MergeAlgebra<A>,
  algB: MergeAlgebra<B>
): MergeAlgebra<[A, B]> {
  return {
    merge: ([a1, b1], [a2, b2]) => [algA.merge(a1, a2), algB.merge(b1, b2)],
    eq:    ([a1, b1], [a2, b2]) => algA.eq(a1, a2) && algB.eq(b1, b2),
  }
}