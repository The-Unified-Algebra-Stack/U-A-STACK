/**
 * VERIFICATION FRAMEWORK - 4. Merge CMA Testing
 * 
 * Laws 6-9: Merge Algebra (CMA = Commutative, Monotone, Associative)
 * 
 * Law 6: Merge Commutativity - M(a, b) = M(b, a) ∀(a,b) ∈ merge_samples
 * Law 7: Merge Associativity - M(M(a, b), c) = M(a, M(b, c)) ∀(a,b,c) ∈ merge_samples
 * Law 8: Merge Idempotence - M(a, a) = a ∀a ∈ merge_samples
 * Law 9: Merge Monotonicity - a ⊆ M(a, b) (information only grows)
 */

import type { MergeAlgebra } from './types'

export type CMATestResult = {
  commutative: boolean
  associative: boolean
  idempotent: boolean
}

/**
 * Test that a merge function satisfies CMA laws
 * 
 * Verification at build: Test all three laws on provided sample triples.
 * 
 * @param merge - The merge function to test
 * @param eq - Equality function for state comparison
 * @param samples - Array of triples [a, b, c] to test on
 * @returns Object indicating which laws passed
 */
export function testMergeCMA<Σ>(
  merge: (a: Σ, b: Σ) => Σ,
  eq: (a: Σ, b: Σ) => boolean,
  samples: [Σ, Σ, Σ][]
): CMATestResult {
  let commutative = true
  let associative = true
  let idempotent = true

  for (const [a, b, c] of samples) {
    // Law 6: Commutativity
    // M(a, b) = M(b, a)
    const mab = merge(a, b)
    const mba = merge(b, a)
    if (!eq(mab, mba)) {
      commutative = false
    }

    // Law 7: Associativity
    // M(M(a, b), c) = M(a, M(b, c))
    const left = merge(merge(a, b), c)
    const right = merge(a, merge(b, c))
    if (!eq(left, right)) {
      associative = false
    }

    // Law 8: Idempotence
    // M(a, a) = a
    if (!eq(merge(a, a), a)) {
      idempotent = false
    }
  }

  return { commutative, associative, idempotent }
}

/**
 * Test merge algebra with full verification
 */
export function verifyMergeAlgebra<Σ>(
  algebra: MergeAlgebra<Σ>,
  samples: [Σ, Σ, Σ][]
): CMATestResult {
  return testMergeCMA(algebra.merge, algebra.eq, samples)
}

/**
 * Test monotonicity (Law 9)
 * 
 * This is a semantic property that depends on the structure of Σ.
 * For CRDT-backed state, this means information only grows.
 * 
 * For simple testing, we check that merge doesn't lose data
 * by verifying the merge result contains all fields from both inputs.
 */
export function testMonotonicity<Σ extends Record<string, unknown>>(
  merge: (a: Σ, b: Σ) => Σ,
  samples: [Σ, Σ][]
): boolean {
  for (const [a, b] of samples) {
    const result = merge(a, b)
    
    // Check that all keys from a are in result
    for (const key of Object.keys(a)) {
      if (!(key in result)) {
        return false // Lost data from a
      }
    }
    
    // Check that all keys from b are in result
    for (const key of Object.keys(b)) {
      if (!(key in result)) {
        return false // Lost data from b
      }
    }
  }
  
  return true
}