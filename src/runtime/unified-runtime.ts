/**
 * Runtime
 *
 * The unified execution environment for the algebra stack.
 *
 * Entry point: UnifiedRuntime<Σ>
 *   - Constructed from RuntimeConfig<Σ>
 *   - Verifies CMA laws and projection idempotence at boot
 *   - Composes Φ = Cₙ ∘ ⋯ ∘ C₁ ∘ Pₘ ∘ ⋯ ∘ P₁
 *   - Runs the deterministic execution loop
 *   - Maintains hash-chained checkpoint log
 *   - Supports merge (gossip) and replay (crash recovery)
 */

export type {
  Reducer,
  ProjectionReducer,
  ConstraintReducer,
  MergeAlgebra,
  HLC,
  CausalOrder,
  CheckpointEvent,
  Substrate,
  RuntimeConfig,
} from "./types"

export { UnifiedRuntime }  from "./unified-runtime"
export { buildSubstrate, makeCausalOrder } from "./substrate"
export { step, replayLog, tickHLC, hashEvent } from "./execution-loop"