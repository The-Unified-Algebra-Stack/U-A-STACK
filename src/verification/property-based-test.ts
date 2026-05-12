/**
 * VERIFICATION FRAMEWORK - 6. Property-Based Testing (Generative)
 * 
 * Using fast-check style property-based testing to verify laws
 * across large input spaces.
 * 
 * From spec page 22:
 * fc.assert(
 *   fc.property(arbitraryState, arbitraryInput, (state, input) => {
 *     const [s1] = accountReducer(state, input)
 *     const [s2] = accountReducer(state, input)
 *     return JSON.stringify(s1) === JSON.stringify(s2) // Purity
 *   }),
 *   { numRuns: 10000 }
 * )
 */

import type { Reducer } from './types'

/**
 * Simple arbitrary generator interface
 * (Simplified version of fast-check's Arbitrary)
 */
export interface Arbitrary<T> {
  generate(): T
}

/**
 * Property test configuration
 */
export interface PropertyConfig {
  numRuns: number
}

/**
 * Run a property test
 * 
 * @param property - Function that should return true for all generated inputs
 * @param config - Configuration (number of runs, etc.)
 * @returns true if all runs passed
 */
export function assert(
  property: () => boolean,
  config: PropertyConfig = { numRuns: 100 }
): boolean {
  for (let i = 0; i < config.numRuns; i++) {
    if (!property()) {
      return false
    }
  }
  return true
}

/**
 * Test reducer purity with property-based testing
 * 
 * Generates random states and inputs, verifies reducer is deterministic
 */
export function testReducerPurityProperty<Σ, ι>(
  reducer: Reducer<Σ, ι>,
  stateGen: Arbitrary<Σ>,
  inputGen: Arbitrary<ι>,
  numRuns: number = 10000
): boolean {
  return assert(
    () => {
      const state = stateGen.generate()
      const input = inputGen.generate()
      
      const [s1] = reducer(state, input)
      const [s2] = reducer(state, input)
      
      return JSON.stringify(s1) === JSON.stringify(s2)
    },
    { numRuns }
  )
}

/**
 * Test merge commutativity with property-based testing
 */
export function testMergeCommutativityProperty<Σ>(
  merge: (a: Σ, b: Σ) => Σ,
  eq: (a: Σ, b: Σ) => boolean,
  stateGen: Arbitrary<Σ>,
  numRuns: number = 10000
): boolean {
  return assert(
    () => {
      const a = stateGen.generate()
      const b = stateGen.generate()
      
      const mab = merge(a, b)
      const mba = merge(b, a)
      
      return eq(mab, mba)
    },
    { numRuns }
  )
}

/**
 * Test projection idempotence with property-based testing
 */
export function testProjectionIdempotenceProperty<Σ>(
  projection: Reducer<Σ>,
  eq: (a: Σ, b: Σ) => boolean,
  stateGen: Arbitrary<Σ>,
  numRuns: number = 10000
): boolean {
  return assert(
    () => {
      const state = stateGen.generate()
      
      const [s1] = projection(state, undefined)
      const [s2] = projection(s1, undefined)
      
      return eq(s1, s2)
    },
    { numRuns }
  )
}

/**
 * Simple random number generator for testing
 */
export class RandomGen {
  private seed: number

  constructor(seed: number = Date.now()) {
    this.seed = seed
  }

  next(): number {
    // Simple LCG for reproducibility
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff
    return this.seed / 0x7fffffff
  }

  integer(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min
  }

  boolean(): boolean {
    return this.next() > 0.5
  }

  element<T>(arr: T[]): T {
    return arr[this.integer(0, arr.length - 1)]
  }
}

/**
 * Create a simple object arbitrary generator
 */
export function objectArbitrary<T extends Record<string, unknown>>(
  template: Record<string, (rng: RandomGen) => unknown>
): Arbitrary<T> {
  return {
    generate() {
      const rng = new RandomGen()
      const result: Record<string, unknown> = {}
      
      for (const [key, generator] of Object.entries(template)) {
        result[key] = generator(rng)
      }
      
      return result as T
    }
  }
}

/**
 * Run all property-based tests
 * 
 * Comprehensive test suite as specified in verification framework
 */
export function runPropertyBasedTests<Σ, ι>(
  reducer: Reducer<Σ, ι>,
  merge: (a: Σ, b: Σ) => Σ,
  eq: (a: Σ, b: Σ) => boolean,
  stateGen: Arbitrary<Σ>,
  inputGen: Arbitrary<ι>,
  numRuns: number = 10000
): {
  purity: boolean
  commutativity: boolean
} {
  const purity = testReducerPurityProperty(
    reducer,
    stateGen,
    inputGen,
    numRuns
  )
  
  const commutativity = testMergeCommutativityProperty(
    merge,
    eq,
    stateGen,
    numRuns
  )
  
  return {
    purity,
    commutativity
  }
}