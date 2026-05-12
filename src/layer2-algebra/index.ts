/**
 * LAYER 2: DETERMINISTIC ALGEBRA
 * Reducer, Projection, Constraint, Composition
 * 
 * Spec: Pages 3-6, 29-30
 * 
 * Exports:
 * - Reducer type and composition
 * - ProjectionReducer (commutative, idempotent)
 * - ConstraintReducer (non-commutative, ordered)
 * - DualAlgebra composition (Φ = C ∘ P)
 */

export * from "./layer2-types"
export * from "./layer2-reducer"
export * from "./layer2-projection"
export * from "./layer2-constraint"
export * from "./layer2-composition"

export type {
  Reducer,
  Intent,
  ProjectionReducer,
  ConstraintReducer,
  MergeAlgebra,
  DualAlgebra,
  ReducerMonoid,
  VerificationResult,
  CompositionTestResult,
  ProjectionTestResult,
  ConstraintTestResult,
  MergeTestResult,
} from "./layer2-types"

export {
  identity,
  compose,
  composeMany,
  createReducerMonoid,
  lift,
  emitIntents,
  chain,
} from "./layer2-reducer"

export {
  createProjection,
  testIdempotence,
  testCommutativity,
  composeProjections,
  createNormalizeProjection,
  createClampProjection,
  createCanonicalizeProjection,
} from "./layer2-projection"

export {
  createConstraint,
  testOrderingSemantics,
  composeConstraints,
  createEnforceCeilingConstraint,
  createBalanceFloorConstraint,
  createCascadeConstraint,
  createLowBalanceAlertConstraint,
} from "./layer2-constraint"

export {
  buildDualAlgebra,
  executeDualAlgebra,
  testDualAlgebraComposition,
  verifyDualAlgebra,
} from "./layer2-composition"