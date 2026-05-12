/**
 * VERIFICATION FRAMEWORK - 1. Purity Testing
 * Law 1: Reducer Monoid
 * Verification: Compose reducers; test against 100+ random states and inputs.
 */

import type { Reducer } from './types'

/**
 * Assert that a reducer is pure (deterministic)
 * 
 * A reducer R is pure if:
 * ∀ s, i. R(s, i, t₁) = R(s, i, t₂)
 * 
 * Verification: Run reducer twice with same input; assert outputs are identical.
 */
export function assertPure<Σ, ι>(
  reducer: Reducer<Σ, ι>,
  testStates: Σ[],
  testInputs: ι[]
): boolean {
  for (const state of testStates) {
    for (const input of testInputs) {
      // Run reducer twice with identical inputs
      const [s1, i1] = reducer(state, input)
      const [s2, i2] = reducer(state, input)
      
      // Assert states are identical
      if (JSON.stringify(s1) !== JSON.stringify(s2)) {
        return false // Not pure - state differs
      }
      
      // Assert intent lists are identical
      if (i1.length !== i2.length) {
        return false // Intent count changed
      }
      
      // Deep equality check on intents
      if (JSON.stringify(i1) !== JSON.stringify(i2)) {
        return false // Intent content differs
      }
    }
  }
  
  return true
}