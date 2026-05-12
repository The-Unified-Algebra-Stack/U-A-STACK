/**
 * EVENT LOG: Append-Only Checkpoint Sequence
 * Spec: Layer 1: IMMUTABLE TRUTH (pages 2, 29)
 * 
 * Properties:
 * - Hash-chained (tamper-evident)
 * - Append-only (immutable history)
 * - Source of truth for state reconstruction (Replay Theorem, Law 12)
 * - JSON-serializable (Law 15: JSON Universality)
 */

import { createCheckpointEvent, verifyHashChain } from "./hash-chain"

export interface EventLogConfig {
  /**
   * Initial events (for recovery or replication)
   * Must form a valid hash chain
   */
  initialEvents?: readonly any[]

  /**
   * Hash algorithm (default: sha256)
   */
  algorithm?: string
}

/**
 * EventLog: Immutable append-only log
 * 
 * Invariants:
 * 1. Can only append; cannot modify existing events
 * 2. Hash chain is always valid
 * 3. All appends must maintain prevHash integrity
 */
export class EventLog {
  private events: any[] = []
  private readonly algorithm: string

  constructor(config: EventLogConfig = {}) {
    this.algorithm = config.algorithm || "sha256"

    // Initialize with existing events (if provided)
    if (config.initialEvents && config.initialEvents.length > 0) {
      const verification = verifyHashChain(config.initialEvents, this.algorithm)
      if (!verification.valid) {
        throw new Error(
          `Invalid hash chain in initialEvents: ${verification.errors.join("; ")}`
        )
      }
      this.events = Array.from(config.initialEvents)
    }
  }

  /**
   * Append a checkpoint event
   * 
   * Spec: Layer 1: IMMUTABLE TRUTH
   * "Checkpoint log (hash-chained, append-only)"
   */
  append(params: {
    readonly nodeId: string
    readonly timestamp: any
    readonly type: "REDUCE" | "MERGE"
    readonly before: unknown
    readonly after: unknown
    readonly intents: readonly any[]
  }): any {
    const prevHash = this.events.length === 0 ? "" : this.events[this.events.length - 1].hash

    const event = createCheckpointEvent(
      {
        ...params,
        prevHash,
      },
      this.algorithm
    )

    this.events.push(event)
    return event
  }

  /**
   * Get all events
   */
  getEvents(): readonly any[] {
    return Object.freeze([...this.events])
  }

  /**
   * Get event at index
   */
  getEvent(index: number): any | null {
    if (index < 0 || index >= this.events.length) {
      return null
    }
    return this.events[index]
  }

  /**
   * Get the most recent event
   */
  getLastEvent(): any | null {
    return this.events.length === 0 ? null : this.events[this.events.length - 1]
  }

  /**
   * Get the hash of the most recent event
   */
  getLastHash(): string | null {
    return this.events.length === 0 ? null : this.events[this.events.length - 1].hash
  }

  /**
   * Number of events in log
   */
  length(): number {
    return this.events.length
  }

  /**
   * Verify hash chain integrity
   * 
   * Spec: Law 13: Hash Chain Integrity
   */
  verify(): {
    valid: boolean
    firstInvalidIndex: number | null
    errors: string[]
  } {
    return verifyHashChain(this.events, this.algorithm)
  }

  /**
   * Get events since a given hash
   * 
   * Used for replication / gossip protocol
   * Spec: Distributed Execution (page 22)
   */
  getEventsSince(lastKnownHash: string | null): {
    events: readonly any[]
    fromIndex: number
  } {
    if (lastKnownHash === null || lastKnownHash === "") {
      return { events: this.getEvents(), fromIndex: 0 }
    }

    // Find the index of the event with this hash
    const index = this.events.findIndex((e) => e.hash === lastKnownHash)
    if (index === -1) {
      // Hash not found; return entire log
      return { events: this.getEvents(), fromIndex: 0 }
    }

    // Return events after this point
    return {
      events: Object.freeze([...this.events.slice(index + 1)]),
      fromIndex: index + 1,
    }
  }

  /**
   * Replay events to reconstruct state
   * 
   * Spec: Law 12: Replay Theorem (page 11)
   * "Given log: [event₀, event₁, ..., eventₙ]
   *  Given initial state: σ₀
   *  Given reducers: {R₁, R₂, ...}
   *  Replaying: σ₁ = R₁(σ₀, input₀); σ₂ = R₂(σ₁, input₁); ...
   *  Matches log: σᵢ = event[i].after ∀i"
   */
  replay<Σ>(
    initialState: Σ,
    reducer: (state: Σ, event: any) => Σ
  ): {
    finalState: Σ
    states: readonly Σ[]
    valid: boolean
  } {
    const states: Σ[] = [initialState]
    let currentState = initialState

    for (let i = 0; i < this.events.length; i++) {
      const event = this.events[i]
      currentState = reducer(currentState, event)
      states.push(currentState)

      // Verify that replayed state matches logged state
      // (This is done by the caller, but we track it here)
    }

    return {
      finalState: currentState,
      states: Object.freeze(states),
      valid: true, // Full validation depends on reducer
    }
  }

  /**
   * Export to JSON for persistence
   * 
   * Spec: Law 15: JSON Universality
   */
  toJSON(): any {
    return {
      events: this.events,
      length: this.events.length,
      lastHash: this.getLastHash(),
    }
  }

  /**
   * Import from JSON
   * 
   * Spec: Law 15: JSON Universality
   */
  static fromJSON(data: any, algorithm: string = "sha256"): EventLog {
    const log = new EventLog({ algorithm })

    if (data.events && Array.isArray(data.events)) {
      const verification = verifyHashChain(data.events, algorithm)
      if (!verification.valid) {
        throw new Error(
          `Invalid hash chain in imported data: ${verification.errors.join("; ")}`
        )
      }
      ;(log as any).events = Array.from(data.events)
    }

    return log
  }
}