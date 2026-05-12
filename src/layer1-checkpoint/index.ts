/**
 * LAYER 1: IMMUTABLE TRUTH
 * Checkpoint log (hash-chained, append-only)
 * Source of all derived state
 * 
 * Spec: Pages 2, 29-30
 * 
 * Exports:
 * - CheckpointEvent: Immutable transaction record
 * - HLC: Hybrid Logical Clock for causal ordering
 * - CausalOrder: Happens-before relation
 * - EventLog: Append-only hash-chained log
 * - CheckpointWriter: Persistent checkpoint storage
 * - Hash chain utilities
 */

export * from "./layer1-types"
export * from "./hlc"
export * from "./hash-chain"
export * from "./event-log"
export * from "./checkpoint-writer"

// Re-export key types for convenience
export type {
  HLC,
  CheckpointEvent,
  Intent,
  CheckpointLog,
  LogEntry,
  VerificationResult,
} from "./layer1-types"

export { CausalOrder, HLCClock, CausalOrderingQueue } from "./hlc"
export { EventLog } from "./event-log"
export { CheckpointWriter } from "./checkpoint-writer"