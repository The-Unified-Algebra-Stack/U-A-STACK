/**
 * DUAL ALGEBRA COMPOSITION
 * Spec: Axiom 3, Law 10 (Pages 2, 5, 10, 29-30)
 * 
 * Φ = Cₙ ∘ ⋯ ∘ C₁ ∘ Pₘ ∘ ⋯ ∘ P₁
 * 
 * Properties:
 * 1. Projections run first (any order)
 * 2. Constraints run after (strict order)
 * 3. Final result is deterministic, replayable
 */

import {
  Reducer,
  Intent,
  DualAlgebra,
  ProjectionReducer,
  ConstraintReducer,
} from "./layer2-types"
import { composeMany } from "./layer2-reducer"
import { composeProjections } from "./layer2-projection"
import { composeConstraints } from "./layer2-constraint"

/**
 * Build dual algebra
 * 
 * Spec: Axiom 3 (Page 2)
 * Φ = Cₙ ∘ ⋯ ∘ C₁ ∘ Pₘ ∘ ⋯ ∘ P₁
 * 
 * Construction:
 * 1. Compose all projections (order-independent)
 * 2. Compose all constraints (order-dependent)
 * 3. Chain them: Φ = constraints ∘ projections
 */
export function buildDualAlgebra<Σ>(
  projections: readonly ProjectionReducer<Σ>[],
  constraints: readonly ConstraintReducer<Σ>[]
): DualAlgebra<Σ> {
  const projectionsReducer = composeProjections(projections)
  const constraintsReducer = composeConstraints(constraints)

  // Φ = C ∘ P (constraints after projections)
  const phi: Reducer<Σ> = (state: Σ): readonly [Σ, readonly Intent[]] => {
    // Step 1: Apply projections
    const [projectedState, projectionIntents] = projectionsReducer(state)

    // Step 2: Apply constraints
    const [finalState, constraintIntents] = constraintsReducer(projectedState)

    // Combine intents
    const allIntents = [...projectionIntents, ...constraintIntents]

    return Object.freeze([finalState, Object.freeze(allIntents)])
  }

  return Object.freeze({
    projections,
    constraints,
    phi,
  })
}

/**
 * Execute dual algebra
 * 
 * Applies Φ to state and input
 */
export function executeDualAlgebra<Σ>(
  algebra: DualAlgebra<Σ>,
  state: Σ
): readonly [Σ, readonly Intent[]] {
  return algebra.phi(state)
}

/**
 * Test dual algebra composition
 * 
 * Spec: Law 10 (Page 10)
 * Build Φ; run test suite; verify against manually composed version
 */
export function testDualAlgebraComposition<Σ>(
  algebra: DualAlgebra<Σ>,
  testStates: readonly Σ[],
  eq: (a: Σ, b: Σ) => boolean
): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  // Verify Φ matches manual composition
  const manualPhi = buildManualPhi(algebra.projections, algebra.constraints)

  for (let i = 0; i < testStates.length; i++) {
    const state = testStates[i]

    // Execute built Φ
    const [builtResult] = algebra.phi(state)

    // Execute manual Φ
    const [manualResult] = manualPhi(state)

    // Compare
    if (!eq(builtResult, manualResult)) {
      errors.push(
        `State ${i}: Built Φ and manual Φ differ. ` +
        `Built: ${JSON.stringify(builtResult)}, ` +
        `Manual: ${JSON.stringify(manualResult)}`
      )
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Manually compose Φ for verification
 * (Not the public API, only for testing)
 */
function buildManualPhi<Σ>(
  projections: readonly ProjectionReducer<Σ>[],
  constraints: readonly ConstraintReducer<Σ>[]
): Reducer<Σ> {
  return (state: Σ): readonly [Σ, readonly Intent[]] => {
    let currentState = state
    const allIntents: Intent[] = []

    // Apply projections (any order, but let's use registration order)
    for (const proj of projections) {
      const [nextState, intents] = proj.apply(currentState, undefined)
      currentState = nextState
      allIntents.push(...intents)
    }

    // Apply constraints (strict order)
    const sortedConstraints = [...constraints].sort((a, b) => a.order - b.order)
    for (const constraint of sortedConstraints) {
      const [nextState, intents] = constraint.apply(currentState, undefined)
      currentState = nextState
      allIntents.push(...intents)
    }

    return Object.freeze([currentState, Object.freeze(allIntents)])
  }
}

/**
 * Verify dual algebra properties
 * 
 * Combines:
 * - Projection idempotence
 * - Projection commutativity
 * - Constraint ordering semantics
 * - Composition correctness
 */
export function verifyDualAlgebra<Σ>(
  algebra: DualAlgebra<Σ>,
  testStates: readonly Σ[],
  eq: (a: Σ, b: Σ) => boolean
): {
  valid: boolean
  projectionIdempotent: boolean
  projectionCommutative: boolean
  constraintOrdered: boolean
  compositionCorrect: boolean
  errors: string[]
} {
  const errors: string[] = []

  // Test projection idempotence
  let projectionIdempotent = true
  for (const proj of algebra.projections) {
    for (const state of testStates) {
      const [s1] = proj.apply(state, undefined)
      const [s2] = proj.apply(s1, undefined)
      if (!eq(s1, s2)) {
        projectionIdempotent = false
        errors.push(`Projection ${proj.id} not idempotent`)
        break
      }
    }
    if (!projectionIdempotent) break
  }

  // Test projection commutativity
  let projectionCommutative = true
  for (let i = 0; i < algebra.projections.length && projectionCommutative; i++) {
    for (let j = i + 1; j < algebra.projections.length && projectionCommutative; j++) {
      for (const state of testStates) {
        const pi = algebra.projections[i]
        const pj = algebra.projections[j]

        const [s1] = pi.apply(state, undefined)
        const [s2] = pj.apply(s1, undefined)

        const [s3] = pj.apply(state, undefined)
        const [s4] = pi.apply(s3, undefined)

        if (!eq(s2, s4)) {
          projectionCommutative = false
          errors.push(`Projections ${pi.id} and ${pj.id} not commutative`)
          break
        }
      }
    }
  }

  // Test constraint ordering
  let constraintOrdered = true
  const sorted = [...algebra.constraints].sort((a, b) => a.order - b.order)
  for (let i = 0; i < sorted.length && constraintOrdered; i++) {
    for (let j = i + 1; j < sorted.length && constraintOrdered; j++) {
      const ci = sorted[i]
      const cj = sorted[j]

      for (const state of testStates) {
        const [s1] = ci.apply(state, undefined)
        const [s2] = cj.apply(s1, undefined)

        const [s3] = cj.apply(state, undefined)
        const [s4] = ci.apply(s3, undefined)

        if (eq(s2, s4)) {
          constraintOrdered = false
          errors.push(`Constraints ${ci.id} and ${cj.id} order doesn't matter`)
          break
        }
      }
    }
  }

  // Test composition correctness
  const compositionTest = testDualAlgebraComposition(algebra, testStates, eq)
  const compositionCorrect = compositionTest.valid
  if (!compositionCorrect) {
    errors.push(...compositionTest.errors)
  }

  return {
    valid: projectionIdempotent && projectionCommutative && constraintOrdered && compositionCorrect,
    projectionIdempotent,
    projectionCommutative,
    constraintOrdered,
    compositionCorrect,
    errors,
  }
}