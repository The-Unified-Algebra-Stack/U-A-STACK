/**
 * PROJECTION REDUCER
 * Spec: Type 4, Law 3, Law 4 (Pages 5, 9, 29-30)
 * 
 * Properties:
 * - Commutative: Pᵢ ∘ Pⱼ = Pⱼ ∘ Pᵢ
 * - Idempotent: P(P(σ)) = P(σ)
 * - Order-independent
 * 
 * Verification:
 * - Idempotence: Apply projection twice; assert second application changes nothing
 * - Commutativity: Try all permutations of projections; verify final state is identical
 */

import { ProjectionReducer, Reducer, Intent, ProjectionTestResult } from "./layer2-types"

/**
 * Create a projection reducer
 * 
 * Spec: Type 4 (Page 5)
 * Proof obligation: apply(apply(σ)) = apply(σ) ∀σ
 */
export function createProjection<Σ>(
  id: string,
  apply: Reducer<Σ>,
  testStates?: readonly Σ[]
): ProjectionReducer<Σ> {
  return Object.freeze({
    kind: "projection" as const,
    id,
    apply,
    testStates,
  })
}

/**
 * Test projection for idempotence
 * 
 * Spec: Law 3 (Page 9)
 * P(P(σ)) = P(σ) ∀σ ∈ test_states
 */
export function testIdempotence<Σ>(
  projection: ProjectionReducer<Σ>,
  testStates: readonly Σ[],
  eq: (a: Σ, b: Σ) => boolean
): ProjectionTestResult {
  const errors: string[] = []

  for (let i = 0; i < testStates.length; i++) {
    const state = testStates[i]

    // Apply projection once
    const [s1] = projection.apply(state, undefined)

    // Apply projection twice
    const [s2] = projection.apply(s1, undefined)

    // Check idempotence
    if (!eq(s1, s2)) {
      errors.push(
        `State ${i}: P(P(σ)) ≠ P(σ). First: ${JSON.stringify(s1)}, Second: ${JSON.stringify(s2)}`
      )
    }
  }

  return {
    valid: errors.length === 0,
    idempotent: errors.length === 0,
    commutative: false, // Set by commutativity test
    errors,
  }
}

/**
 * Test projections for commutativity
 * 
 * Spec: Law 4 (Page 9)
 * Pᵢ(Pⱼ(σ)) = Pⱼ(Pᵢ(σ)) ∀σ ∈ test_states
 */
export function testCommutativity<Σ>(
  projections: readonly ProjectionReducer<Σ>[],
  testStates: readonly Σ[],
  eq: (a: Σ, b: Σ) => boolean
): ProjectionTestResult {
  const errors: string[] = []

  // Test all pairs
  for (let i = 0; i < projections.length; i++) {
    for (let j = i + 1; j < projections.length; j++) {
      const pi = projections[i]
      const pj = projections[j]

      for (let k = 0; k < testStates.length; k++) {
        const state = testStates[k]

        // Apply pᵢ then pⱼ
        const [s1] = pi.apply(state, undefined)
        const [s2] = pj.apply(s1, undefined)

        // Apply pⱼ then pᵢ
        const [s3] = pj.apply(state, undefined)
        const [s4] = pi.apply(s3, undefined)

        // Check commutativity
        if (!eq(s2, s4)) {
          errors.push(
            `P${i}(P${j}(σ)) ≠ P${j}(P${i}(σ)) at state ${k}`
          )
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    idempotent: true, // Assume tested separately
    commutative: errors.length === 0,
    errors,
  }
}

/**
 * Compose projections (order-independent)
 * Result must be idempotent
 */
export function composeProjections<Σ>(
  projections: readonly ProjectionReducer<Σ>[]
): Reducer<Σ> {
  return (state: Σ): readonly [Σ, readonly Intent[]] => {
    let currentState = state
    const allIntents: Intent[] = []

    for (const projection of projections) {
      const [nextState, intents] = projection.apply(currentState, undefined)
      currentState = nextState
      allIntents.push(...intents)
    }

    return Object.freeze([currentState, Object.freeze(allIntents)])
  }
}

/**
 * Examples of projections
 * (Spec: Page 14)
 */

/**
 * Normalize: quantize to nearest grid point
 */
export function createNormalizeProjection<Σ extends { x: number; y: number }>(
  gridSize: number
): ProjectionReducer<Σ> {
  return createProjection(
    `normalize-grid-${gridSize}`,
    (state: Σ): readonly [Σ, readonly Intent[]] => {
      const quantize = (v: number) => Math.round(v / gridSize) * gridSize
      return Object.freeze([
        {
          ...state,
          x: quantize(state.x),
          y: quantize(state.y),
        } as Σ,
        Object.freeze([]),
      ])
    }
  )
}

/**
 * Clamp: floor negative values to 0
 */
export function createClampProjection<Σ extends { balance: number }>(
): ProjectionReducer<Σ> {
  return createProjection(
    "clamp-balance",
    (state: Σ): readonly [Σ, readonly Intent[]] => {
      return Object.freeze([
        {
          ...state,
          balance: Math.max(0, state.balance),
        } as Σ,
        Object.freeze([]),
      ])
    }
  )
}

/**
 * Canonicalize: convert to canonical form (e.g., lowercase all strings)
 */
export function createCanonicalizeProjection<Σ extends { [key: string]: any }>(
): ProjectionReducer<Σ> {
  return createProjection(
    "canonicalize",
    (state: Σ): readonly [Σ, readonly Intent[]] => {
      const canonical = {} as Σ
      for (const [key, value] of Object.entries(state)) {
        canonical[key as keyof Σ] = typeof value === "string" ? value.toLowerCase() : value
      }
      return Object.freeze([canonical, Object.freeze([])])
    }
  )
}