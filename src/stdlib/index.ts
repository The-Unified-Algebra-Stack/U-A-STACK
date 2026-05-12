/**
 * stdlib/index.ts
 *
 * Public entry point for the Unified Algebra Stack standard reducer library.
 *
 * Spec reference: "SCHEMA & COMPOSABILITY → Stdlib Reducer Library"
 *   "Composable primitives, all algebraically verified"
 *   "20+ proven reducer primitives"
 *
 * All exports are pure, total, deterministic, and composable (Spec Laws 1–3).
 * Every combinator preserves the algebraic invariants of the stack:
 *   - Reducer monoid (Law 1)
 *   - Intent free monoid (Law 2)
 *   - Projection idempotence (Law 3) where applicable
 *   - Intent deferred execution (Law 14)
 *   - JSON universality (Law 15)
 */

// ---------------------------------------------------------------------------
// increment.ts — numeric field mutations
// ---------------------------------------------------------------------------
export { increment, set } from "./increment";

// ---------------------------------------------------------------------------
// emit.ts — intent emission without state mutation
// ---------------------------------------------------------------------------
export { emit, emitAll, emitIf } from "./emit";

// ---------------------------------------------------------------------------
// guard.ts — conditional branching
// ---------------------------------------------------------------------------
export { guard, guardState, guardInput } from "./guard";

// ---------------------------------------------------------------------------
// compose.ts — monoid composition (the core of Φ)
// ---------------------------------------------------------------------------
export { identity, compose, composeTwo, buildPhi } from "./compose";

// ---------------------------------------------------------------------------
// with-metrics.ts — reducer instrumentation
// ---------------------------------------------------------------------------
export { withMetrics, withSlowMetrics, withStoredMetrics } from "./with-metrics";

// ---------------------------------------------------------------------------
// batch.ts — fold multiple inputs through a reducer
// ---------------------------------------------------------------------------
export { batch, batchWithHistory, batchReducer } from "./batch";

// ---------------------------------------------------------------------------
// debounce.ts — SCHEDULE-intent-based debouncing
// ---------------------------------------------------------------------------
export {
  debounce,
  debounceFlush,
  withDebounceState,
} from "./debounce";
export type { DebounceSlice } from "./debounce";

// ---------------------------------------------------------------------------
// retry.ts — SCHEDULE-intent-based retry with backoff
// ---------------------------------------------------------------------------
export { withRetry, withRetryState } from "./retry";
export type { RetrySlice, RetryConfig } from "./retry";

// ---------------------------------------------------------------------------
// Re-export core types for consumers who import only from stdlib
// ---------------------------------------------------------------------------
export type {
  Reducer,
  Intent,
  IntentList,
} from "../schema/schema-types";