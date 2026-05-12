/**
 * LAYER 1: IMMUTABLE TRUTH
 * Checkpoint log (hash-chained, append-only)
 * Source of all derived state
 * 
 * Spec: https://claude.ai/chat/e1a799ad-946a-48de-8fe7-3a18614f75d5 (pages 2, 7-8)
 */

/**
 * HLC: Hybrid Logical Clock
 * Spec: Type 8: Causal Order (Happens-Before)
 * 
 * Properties:
 * - logical: Lamport clock (logical time)
 * - physical: Wall clock (milliseconds)
 * - nodeId: Originating node (tiebreaker)
 */
export interface HLC {
  readonly logical: number
  readonly physical: number
  readonly nodeId: string
}

/**
 * CheckpointEvent: Immutable transaction record
 * Spec: Type 7: Checkpoint Event (Immutable Truth)
 * 
 * Properties:
 * - nodeId: Which node performed this
 * - timestamp: HLC (causal ordering)
 * - type: "REDUCE" | "MERGE" (what happened)
 * - before: State snapshot before
 * - after: State snapshot after
 * - intents: Emitted intents (free monoid)
 * - prevHash: SHA256 of previous event (hash chain)
 * - hash: SHA256 of this event (tamper-evident)
 * 
 * Hash Invariant:
 * hash[i] = SHA256(event[i] with {hash: undefined, prevHash: undefined})
 * prevHash[i] = hash[i-1]
 */
export interface CheckpointEvent {
  readonly nodeId: string
  readonly timestamp: HLC
  readonly type: "REDUCE" | "MERGE"
  readonly before: unknown
  readonly after: unknown
  readonly intents: readonly Intent[]
  readonly prevHash: string // SHA256 of previous event
  readonly hash: string // SHA256 of this event
}

/**
 * Intent: Side-effect descriptor (free monoid)
 * Spec: Type 2: Intent (Effect Descriptor)
 * 
 * Opaque to reducer algebra (reducers can only emit, never interpret)
 * Concatenable: [] is unit, ++ is associative
 * Replayable: same input + same reducer = same intents
 */
export type Intent =
  | { readonly type: "SEND"; readonly to: string; readonly opcode: number; readonly payload: unknown }
  | { readonly type: "STORE"; readonly key: string; readonly value: unknown }
  | { readonly type: "SCHEDULE"; readonly reducerId: string; readonly delayMs: number }
  | { readonly type: "LOG"; readonly level: "info" | "warn" | "error"; readonly msg: string }
  | { readonly type: "EMIT"; readonly channel: string; readonly payload: unknown }
  | { readonly type: "LLM"; readonly model: string; readonly prompt: string; readonly maxTokens: number }

/**
 * CheckpointLog: Append-only, hash-chained sequence
 * Spec: Layer 1: IMMUTABLE TRUTH
 * 
 * Invariants:
 * 1. Hash-chained: event[i].prevHash = event[i-1].hash
 * 2. Tamper-evident: any change → hash changes
 * 3. Replay-safe: replay log with same reducers → same sequence
 */
export interface CheckpointLog {
  readonly events: readonly CheckpointEvent[]
  readonly length: number
  readonly lastHash: string | null // hash of most recent event
}

/**
 * LogEntry: Minimal record for storage/transmission
 * Spec: Law 13: Hash Chain Integrity
 */
export interface LogEntry {
  readonly nodeId: string
  readonly timestamp: HLC
  readonly type: "REDUCE" | "MERGE"
  readonly before: unknown
  readonly after: unknown
  readonly intents: readonly Intent[]
  readonly prevHash: string
  readonly hash: string
}

/**
 * Verification Result
 */
export interface VerificationResult {
  readonly valid: boolean
  readonly errors: readonly string[]
}