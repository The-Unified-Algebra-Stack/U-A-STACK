/**
 * UNIFIED ALGEBRA STACK - Causal Ordering Types
 * 
 * Type definitions for HLC timestamps, causal ordering, and checkpoint events.
 * All types are immutable and JSON-serializable (Axiom 15: JSON Universality).
 */

/**
 * Hybrid Logical Clock (HLC) timestamp.
 * 
 * Combines logical Lamport clock with physical wall clock for causality tracking
 * in distributed systems while respecting real-world time constraints.
 * 
 * Formal properties:
 * - logical: Monotonically increasing counter (Lamport clock)
 * - physical: Wall clock time in milliseconds (for causality with time awareness)
 * - nodeId: Unique node identifier (tiebreaker for concurrent events)
 * 
 * Semantics: a happens-before b iff:
 *   a.logical < b.logical OR
 *   (a.logical = b.logical AND a.physical < b.physical) OR
 *   (a.logical = b.logical AND a.physical = b.physical AND a.nodeId < b.nodeId)
 */
export interface HLC {
  readonly logical: number
  readonly physical: number
  readonly nodeId: string
}

/**
 * Causal ordering interface.
 * 
 * Defines happens-before and concurrency relations over HLC timestamps.
 * All relations are total orders respecting causality.
 */
export interface CausalOrder {
  /**
   * Check if a happens-before b (a causally precedes b).
   * 
   * Returns true iff:
   * - a.logical < b.logical, OR
   * - (a.logical = b.logical AND a.nodeId < b.nodeId)
   */
  happensBefore(a: HLC, b: HLC): boolean

  /**
   * Check if a and b are concurrent (neither happens before the other).
   * 
   * Returns true iff:
   * - !happensBefore(a, b) AND !happensBefore(b, a)
   */
  concurrent(a: HLC, b: HLC): boolean

  /**
   * Total ordering: compare(a, b) returns -1, 0, or 1.
   * 
   * -1: a < b (a happens-before b)
   *  0: a = b (same timestamp)
   *  1: a > b (b happens-before a)
   */
  compare(a: HLC, b: HLC): -1 | 0 | 1
}

/**
 * Checkpoint event - immutable record of a state transition.
 * 
 * Represents a single reducer application and its effects.
 * Forms a hash-chained append-only log (Layer 1: Immutable Truth).
 * 
 * Law 13: Hash Chain Integrity
 * Formal: ∀i. event[i].prevHash = hash[i-1]
 * 
 * Law 12: Replay Theorem
 * Given log [event₀, event₁, ..., eventₙ] and reducer library R:
 * Replay: σ₁ = R₁(σ₀, input₀); σ₂ = R₂(σ₁, input₁); ...
 * Matches log: σᵢ = event[i].after ∀i
 * ⟹ State can be reconstructed from log + reducer library
 */
export interface CheckpointEvent {
  /**
   * Which node performed this transition (for causality).
   */
  readonly nodeId: string

  /**
   * When this event occurred (HLC timestamp).
   * 
   * Invariant: If event A is recorded before event B,
   * then timestamp(A).logical ≤ timestamp(B).logical
   */
  readonly timestamp: HLC

  /**
   * Event type (semantic label).
   * 
   * "REDUCE": State transitioned via reducer application
   * "MERGE": State transitioned via merge with peer state
   */
  readonly type: 'REDUCE' | 'MERGE'

  /**
   * State before this transition.
   * 
   * Used for:
   * - Validation (can replay from before + input to verify after)
   * - Debugging (audit trail of state at each step)
   * - Rollback (restore to previous state if needed)
   */
  readonly before: unknown

  /**
   * State after this transition.
   * 
   * This is the authoritative state after applying the transition.
   * Must be JSON-serializable (Axiom 15).
   */
  readonly after: unknown

  /**
   * Intent list emitted during this transition (Layer 3).
   * 
   * Formal: Φ(σ, ι) ⟹ (Σ', I*)
   * intents = I* (free monoid of deferred side effects)
   * 
   * These are emitted but NOT executed within the reducer.
   * Layer 4 (Effect Executor) handles their execution.
   */
  readonly intents: readonly Intent[]

  /**
   * SHA256 hash of previous event (hash chain link).
   * 
   * For genesis event: undefined or empty string
   * For subsequent events: prevHash = hash(previous_event)
   * 
   * Invariant: prevHash[i] = hash[i-1]
   * 
   * Purpose: Tamper detection and event continuity verification.
   * If any event is modified, its hash changes, breaking the chain.
   */
  readonly prevHash: string | undefined

  /**
   * SHA256 hash of this event (including state, intents, prevHash).
   * 
   * Computed as: SHA256(event with {hash: undefined, prevHash: undefined})
   * 
   * Never computed by hashing the hash field itself (to avoid circular dependency).
   * Serves as:
   * - Tamper-evident seal
   * - Unique identifier for this event
   * - Link target for next event's prevHash
   */
  readonly hash: string
}

/**
 * Intent - first-class descriptor of a deferred side effect.
 * 
 * Axiom 4: Intent as Free Monoid
 * Properties:
 * - Opaque to reducer algebra (reducers emit, never interpret)
 * - Concatenable: [] is unit, ++ is associative
 * - Replayable: same input + same reducer = same intents
 * - Deferrable: emission ≠ execution
 * 
 * Layer 4 (Effect Executor) interprets and executes intents.
 * Reducers never execute intents; they only emit them.
 * 
 * Formal: Intent = { type: T, payload: P }
 * IntentList = free monoid [I₁, I₂, ..., Iₙ] with concat as operation
 */
export type Intent =
  | {
      /**
       * Send message to another node.
       * 
       * Executed by: Network layer
       * Payload: opcode + data
       * Async: returns Promise when sent
       */
      readonly type: 'SEND'
      readonly to: string
      readonly opcode: number
      readonly payload: unknown
    }
  | {
      /**
       * Store value in KV store (persistence layer).
       * 
       * Executed by: Persistent storage (RocksDB, SQLite, etc.)
       * Payload: key-value pair
       * Async: returns Promise when persisted
       */
      readonly type: 'STORE'
      readonly key: string
      readonly value: unknown
    }
  | {
      /**
       * Schedule a future reducer invocation.
       * 
       * Executed by: Scheduler (setTimeout, cron, etc.)
       * Payload: reducer ID + delay in milliseconds
       * Triggers reducer after delay with null input
       */
      readonly type: 'SCHEDULE'
      readonly reducerId: string
      readonly delayMs: number
    }
  | {
      /**
       * Emit log message (observability).
       * 
       * Executed by: Logger (stdout, file, cloud logging)
       * Payload: log level + message
       */
      readonly type: 'LOG'
      readonly level: 'info' | 'warn' | 'error'
      readonly msg: string
    }
  | {
      /**
       * Emit event on channel (pub/sub, event streaming).
       * 
       * Executed by: Event bus (EventEmitter, Kafka, etc.)
       * Payload: channel name + data
       */
      readonly type: 'EMIT'
      readonly channel: string
      readonly payload: unknown
    }
  | {
      /**
       * Query LLM (Claude, Ollama, etc.).
       * 
       * Executed by: LLM API client
       * Payload: model + prompt + token limit
       * Async: returns Promise with generated text
       * 
       * Note: Result is NOT fed back into state automatically.
       * Reducer must emit SCHEDULE to process result.
       */
      readonly type: 'LLM'
      readonly model: string
      readonly prompt: string
      readonly maxTokens: number
    }

export type IntentList = readonly Intent[]

/**
 * Event ordering configuration (internal to causal module).
 */
export interface EventQueueConfig {
  /**
   * Maximum events to hold while waiting for dependencies.
   * Prevents memory explosion under network partition.
   */
  readonly maxQueueSize: number

  /**
   * Timeout (ms) after which to give up waiting for a dependency.
   * If dependency doesn't arrive within this window,
   * event is dropped or error is raised.
   */
  readonly dependencyTimeoutMs: number
}

/**
 * Causal manager configuration.
 */
export interface CausalManagerConfig {
  /**
   * Unique identifier for this node.
   * Used for:
   * - HLC tiebreaking (nodeId < nodeId' determines order)
   * - Event origin tracking (which node created this event)
   * - Cluster membership
   */
  readonly nodeId: string

  /**
   * Initial HLC state (optional).
   * If not provided, starts at logical=0, physical=now(), nodeId=this.nodeId
   */
  readonly initialHLC?: HLC

  /**
   * Event queue configuration.
   */
  readonly queueConfig?: EventQueueConfig
}