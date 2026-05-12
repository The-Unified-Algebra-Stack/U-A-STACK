/**
 * VERIFICATION FRAMEWORK - 3. Idempotence Testing
 * Law 3: Projection Idempotence
 * 
 * Verification at registration: Apply projection twice; 
 * assert second application changes nothing.
 * 
 * P(P(σ)) = P(σ) ∀σ ∈ test_states
 */

import type { ProjectionReducer } from './types'

/**
 * Test that a projection reducer is idempotent
 * 
 * Idempotence: Applying the projection twice should yield the same result
 * as applying it once.
 * 
 * Mathematical property: P ∘ P = P
 */
export function testIdempotent<Σ>(
  projection: ProjectionReducer<Σ>,
  testStates: Σ[],
  eq: (a: Σ, b: Σ) => boolean
): boolean {
  for (const state of testStates) {
    // Apply projection once
    const [s1] = projection.apply(state, undefined)
    
    // Apply projection twice (to the result of first application)
    const [s2] = projection.apply(s1, undefined)
    
    // Assert: P(P(σ)) = P(σ)
    if (!eq(s1, s2)) {
      return false // Not idempotent
    }
  }
  
  return true
}

/**
 * Test projection commutativity
 * Law 4: Projection Commutativity
 * 
 * Pᵢ(Pⱼ(σ)) = Pⱼ(Pᵢ(σ)) ∀σ ∈ test_states
 * 
 * Verification: Try all permutations of projections; 
 * verify final state is identical.
 */
export function testProjectionCommutativity<Σ>(
  p1: ProjectionReducer<Σ>,
  p2: ProjectionReducer<Σ>,
  testStates: Σ[],
  eq: (a: Σ, b: Σ) => boolean
): boolean {
  for (const state of testStates) {
    // Apply p1 then p2
    const [s1] = p1.apply(state, undefined)
    const [s12] = p2.apply(s1, undefined)
    
    // Apply p2 then p1
    const [s2] = p2.apply(state, undefined)
    const [s21] = p1.apply(s2, undefined)
    
    // Assert: Pᵢ(Pⱼ(σ)) = Pⱼ(Pᵢ(σ))
    if (!eq(s12, s21)) {
      return false // Not commutative
    }
  }
  
  return true
}

/**
 * Test all projections commute with each other
 */
export function testAllProjectionsCommute<Σ>(
  projections: ProjectionReducer<Σ>[],
  testStates: Σ[],
  eq: (a: Σ, b: Σ) => boolean
): boolean {
  // Test all pairs
  for (let i = 0; i < projections.length; i++) {
    for (let j = i + 1; j < projections.length; j++) {
      if (!testProjectionCommutativity(
        projections[i],
        projections[j],
        testStates,
        eq
      )) {
        return false
      }
    }
  }
  
  return true
}