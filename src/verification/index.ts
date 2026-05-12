/**
 * UNIFIED ALGEBRA STACK - VERIFICATION FRAMEWORK
 * Complete implementation of verification tests from spec
 */

export { assertPure } from './purity-test'
export { testComposition } from './composition-test'
export { testIdempotent } from './idempotence-test'
export { testMergeCMA } from './cma-test'
export { testReplayTheorem } from './replay-test'
export { runPropertyBasedTests } from './property-based-test'

// Re-export types for convenience
export type {
  Reducer,
  Intent,
  IntentList,
  ProjectionReducer,
  ConstraintReducer,
  MergeAlgebra,
  CheckpointEvent,
  HLC,
  Substrate,
  RuntimeConfig
} from './types'