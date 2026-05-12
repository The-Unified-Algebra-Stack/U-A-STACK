/**
 * HYBRID LOGICAL CLOCK (HLC)
 * Spec: Type 8: Causal Order (Happens-Before) (page 7)
 * 
 * Properties:
 * - logical: Lamport clock (logical time)
 * - physical: Wall clock (milliseconds)
 * - nodeId: Originating node (tiebreaker)
 * 
 * Semantics:
 * - a happens-before b iff a.logical < b.logical
 * - or (a.logical = b.logical && a.nodeId < b.nodeId)
 * - concurrent(a,b) := !happensBefore(a,b) && !happensBefore(b,a)
 */

export interface HLC {
  readonly logical: number
  readonly physical: number
  readonly nodeId: string
}

/**
 * CausalOrder: Happens-before relation over HLC timestamps
 * 
 * Spec: Type 8, Law 11: Causal Consistency
 */
export class CausalOrder {
  /**
   * Check if event a happened before event b
   * 
   * Spec: "a happens-before b iff a.logical < b.logical
   *        or (a.logical = b.logical && a.nodeId < b.nodeId)"
   */
  static happensBefore(a: HLC, b: HLC): boolean {
    if (a.logical < b.logical) {
      return true
    }
    if (a.logical === b.logical && a.nodeId < b.nodeId) {
      return true
    }
    return false
  }

  /**
   * Check if events are concurrent (neither happened before the other)
   * 
   * Spec: "concurrent(a,b) := !happensBefore(a,b) && !happensBefore(b,a)"
   */
  static concurrent(a: HLC, b: HLC): boolean {
    return !CausalOrder.happensBefore(a, b) && !CausalOrder.happensBefore(b, a)
  }

  /**
   * Compare two HLC values
   * Returns: -1 if a < b, 0 if equal, 1 if a > b
   */
  static compare(a: HLC, b: HLC): number {
    if (CausalOrder.happensBefore(a, b)) return -1
    if (CausalOrder.happensBefore(b, a)) return 1
    return 0
  }

  /**
   * Sort events by happens-before relation
   */
  static sort(events: readonly HLC[]): HLC[] {
    return [...events].sort((a, b) => CausalOrder.compare(a, b))
  }
}

/**
 * HLCClock: Generates monotonically increasing timestamps
 * 
 * Rules:
 * 1. On local event: logical += 1, physical = now()
 * 2. On receiving remote timestamp:
 *    - logical = max(local.logical, remote.logical) + 1
 *    - physical = max(local.physical, remote.physical, now())
 * 
 * Guarantees causal ordering in distributed systems.
 */
export class HLCClock {
  private logical: number = 0
  private physical: number
  private readonly nodeId: string

  constructor(nodeId: string, initialLogical: number = 0) {
    this.nodeId = nodeId
    this.logical = initialLogical
    this.physical = Date.now()
  }

  /**
   * Get current timestamp
   */
  now(): HLC {
    return Object.freeze({
      logical: this.logical,
      physical: this.physical,
      nodeId: this.nodeId,
    })
  }

  /**
   * Increment local timestamp
   * Called when generating a new local event
   */
  increment(): HLC {
    this.logical += 1
    this.physical = Date.now()
    return this.now()
  }

  /**
   * Receive remote timestamp
   * Called when receiving an event from another node
   * 
   * Updates local clock to maintain happens-before relation:
   * - logical = max(local.logical, remote.logical) + 1
   * - physical = max(local.physical, remote.physical, now())
   */
  receive(remote: HLC): HLC {
    this.logical = Math.max(this.logical, remote.logical) + 1
    this.physical = Math.max(this.physical, remote.physical, Date.now())
    return this.now()
  }

  /**
   * Sync with another clock (for peer gossip)
   * Similar to receive but used when synchronizing state
   */
  sync(remote: HLC): HLC {
    return this.receive(remote)
  }

  /**
   * Get nodeId
   */
  getNodeId(): string {
    return this.nodeId
  }

  /**
   * Reset to initial state (rarely used, mainly for testing)
   */
  reset(initialLogical: number = 0): void {
    this.logical = initialLogical
    this.physical = Date.now()
  }

  /**
   * Export state for serialization
   */
  export(): { logical: number; physical: number; nodeId: string } {
    return {
      logical: this.logical,
      physical: this.physical,
      nodeId: this.nodeId,
    }
  }

  /**
   * Import state (for recovery)
   */
  import(data: { logical: number; physical: number; nodeId: string }): void {
    if (data.nodeId !== this.nodeId) {
      throw new Error(
        `Cannot import state from different node: ${data.nodeId} != ${this.nodeId}`
      )
    }
    this.logical = data.logical
    this.physical = data.physical
  }
}

/**
 * Ordering queue for events received out-of-order
 * 
 * Spec: Distributed Execution, Causal Consistency Under Network Reordering (page 12)
 * "If B arrives at node X before A:
 *  X queues B until A is applied
 *  Then applies A, then B"
 */
export class CausalOrderingQueue<T extends { timestamp: HLC }> {
  private queue: T[] = []
  private applied: Set<string> = new Set()

  /**
   * Enqueue an event
   * Returns the events that should be applied now, in happens-before order
   */
  enqueue(event: T, getDependencies?: (e: T) => readonly HLC[]): T[] {
    this.queue.push(event)
    return this.tryApply(getDependencies)
  }

  /**
   * Try to apply pending events in order
   */
  private tryApply(getDependencies?: (e: T) => readonly HLC[]): T[] {
    const toApply: T[] = []
    let changed = true

    while (changed) {
      changed = false

      // Sort by happens-before
      this.queue.sort((a, b) => CausalOrder.compare(a.timestamp, b.timestamp))

      // Find first event with all dependencies satisfied
      for (let i = 0; i < this.queue.length; i++) {
        const event = this.queue[i]
        const deps = getDependencies ? getDependencies(event) : []

        // Check if all dependencies are applied
        const depsApplied = deps.every((dep) => {
          const depKey = `${dep.nodeId}:${dep.logical}`
          return this.applied.has(depKey)
        })

        if (depsApplied) {
          // Apply this event
          this.queue.splice(i, 1)
          toApply.push(event)

          const key = `${event.timestamp.nodeId}:${event.timestamp.logical}`
          this.applied.add(key)

          changed = true
          break
        }
      }
    }

    return toApply
  }

  /**
   * Get pending events
   */
  getPending(): readonly T[] {
    return Object.freeze([...this.queue])
  }

  /**
   * Clear queue (rarely used)
   */
  clear(): void {
    this.queue = []
    this.applied.clear()
  }
}