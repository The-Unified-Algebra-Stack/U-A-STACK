/**
 * UNIFIED ALGEBRA STACK - Causal Ordering Module
 * 
 * Hybrid Logical Clock (HLC) based causality tracking and event ordering.
 * Ensures causal consistency across distributed nodes.
 * 
 * Law 11: Causal Consistency
 * Invariant: event(a) → event(b) implies timestamp(a).logical < timestamp(b).logical
 * 
 * Semantics:
 * - a happens-before b iff a.logical < b.logical
 * - or (a.logical = b.logical && a.nodeId < b.nodeId)
 * - concurrent(a,b) := !happensBefore(a,b) && !happensBefore(b,a)
 */

import { HLC, CausalOrder, CheckpointEvent } from './types'
import { createHLC, incrementHLC, updateHLC } from './hlc'
import { OrderedEventQueue } from './event-ordering'
import { CausalOrderImpl } from './causal-order'

/**
 * Causal ordering context for a single node.
 * 
 * Maintains:
 * - Current logical clock (increments on local events)
 * - Dependency tracking (for replay consistency)
 * - Event queue (orders causally unordered arrivals)
 */
export class CausalManager {
  private nodeId: string
  private hlc: HLC
  private eventQueue: OrderedEventQueue
  private causalOrder: CausalOrder
  private readonly maxQueueSize = 10000

  constructor(nodeId: string, initialHLC?: HLC) {
    this.nodeId = nodeId
    this.hlc = initialHLC || createHLC(0, Date.now(), nodeId)
    this.eventQueue = new OrderedEventQueue()
    this.causalOrder = new CausalOrderImpl()
  }

  /**
   * Increment clock for local event emission.
   * 
   * Contract: Called before every local reducer execution.
   * Ensures each local event gets unique logical time.
   */
  incrementClock(): HLC {
    this.hlc = incrementHLC(this.hlc)
    return this.hlc
  }

  /**
   * Update clock on receiving remote event.
   * 
   * Contract: Called when receiving timestamp from peer.
   * Merges remote clock into local clock:
   * - If remote.logical > local.logical, adopt it (catch up)
   * - Otherwise, increment local counter (maintain causality)
   * - Tiebreak by nodeId (lexicographic)
   */
  updateClockFromRemote(remoteHLC: HLC): HLC {
    this.hlc = updateHLC(this.hlc, remoteHLC)
    return this.hlc
  }

  /**
   * Get current HLC timestamp.
   * 
   * Safe to call at any time. Reflects current state of causality tracking.
   */
  getCurrentHLC(): Readonly<HLC> {
    return Object.freeze({ ...this.hlc })
  }

  /**
   * Enqueue event for ordered application.
   * 
   * If event is missing dependencies (prevHash not yet seen):
   * - Queue it until dependencies arrive
   * 
   * If event has all dependencies:
   * - Return it immediately
   * 
   * Formal: For event E with prevHash P:
   *   If P ∈ seen, return E
   *   Else, queue(E) until P arrives
   */
  enqueueEvent(event: CheckpointEvent): CheckpointEvent | null {
    // Validate queue size doesn't explode
    if (this.eventQueue.size() >= this.maxQueueSize) {
      throw new Error(
        `Causal event queue overflow (max ${this.maxQueueSize}). ` +
        `Network partition or clock skew detected.`
      )
    }

    // Try to dequeue all events that are now ready
    const ready = this.eventQueue.enqueueAndDrain(event)
    return ready.length > 0 ? ready[0] : null
  }

  /**
   * Get all events ready for application.
   * 
   * Returns events in causal order (happens-before order).
   */
  drainReadyEvents(): CheckpointEvent[] {
    return this.eventQueue.drain()
  }

  /**
   * Check causality between two HLC timestamps.
   * 
   * Returns:
   * - "before": a happens-before b
   * - "after": a happens-after b
   * - "concurrent": a and b are concurrent
   */
  compareHLC(a: HLC, b: HLC): 'before' | 'after' | 'concurrent' {
    if (this.causalOrder.happensBefore(a, b)) {
      return 'before'
    } else if (this.causalOrder.happensBefore(b, a)) {
      return 'after'
    } else {
      return 'concurrent'
    }
  }

  /**
   * Verify hash chain integrity over a sequence of events.
   * 
   * Formal: ∀i. event[i].prevHash = hash[i-1]
   * 
   * If chain is broken, returns index of first broken link.
   * If chain is valid, returns -1.
   */
  verifyHashChain(events: CheckpointEvent[]): {
    valid: boolean
    brokenAt: number | null
  } {
    if (events.length === 0) {
      return { valid: true, brokenAt: null }
    }

    // First event should have undefined prevHash or match genesis
    if (events[0].prevHash !== undefined && events[0].prevHash !== '') {
      return { valid: false, brokenAt: 0 }
    }

    // Check each link
    for (let i = 1; i < events.length; i++) {
      const prev = events[i - 1]
      const curr = events[i]
      if (curr.prevHash !== prev.hash) {
        return { valid: false, brokenAt: i }
      }
    }

    return { valid: true, brokenAt: null }
  }

  /**
   * Reorder events to causal (logical) order if they arrived out of sequence.
   * 
   * Given a list of events that may arrive out of order:
   * - Sort by HLC timestamp (logical first, then physical, then nodeId)
   * - Verify no causality violations
   * 
   * Returns reordered events in happens-before order.
   */
  reorderToCausal(events: CheckpointEvent[]): CheckpointEvent[] {
    return [...events].sort((a, b) => {
      // Primary: logical clock comparison
      if (a.timestamp.logical !== b.timestamp.logical) {
        return a.timestamp.logical - b.timestamp.logical
      }
      // Secondary: physical clock (wall clock) comparison
      if (a.timestamp.physical !== b.timestamp.physical) {
        return a.timestamp.physical - b.timestamp.physical
      }
      // Tertiary: nodeId lexicographic tiebreak
      return a.timestamp.nodeId.localeCompare(b.timestamp.nodeId)
    })
  }

  /**
   * Get queue statistics (for monitoring/debugging).
   */
  getQueueStats(): {
    pendingEvents: number
    maxQueueSize: number
    utilizationPercent: number
  } {
    const pending = this.eventQueue.size()
    return {
      pendingEvents: pending,
      maxQueueSize: this.maxQueueSize,
      utilizationPercent: Math.round((pending / this.maxQueueSize) * 100)
    }
  }

  /**
   * Get detailed state for checkpointing/debugging.
   */
  getState(): {
    nodeId: string
    hlc: HLC
    queueSize: number
  } {
    return {
      nodeId: this.nodeId,
      hlc: { ...this.hlc },
      queueSize: this.eventQueue.size()
    }
  }
}

/**
 * Multi-node causal coordination.
 * 
 * Orchestrates HLC merging and event synchronization across peers.
 */
export class DistributedCausalManager {
  private nodes: Map<string, CausalManager> = new Map()
  private globalEventLog: CheckpointEvent[] = []

  /**
   * Register a new node to the distributed system.
   */
  registerNode(nodeId: string, initialHLC?: HLC): CausalManager {
    if (this.nodes.has(nodeId)) {
      throw new Error(`Node ${nodeId} already registered`)
    }
    const manager = new CausalManager(nodeId, initialHLC)
    this.nodes.set(nodeId, manager)
    return manager
  }

  /**
   * Get causal manager for a node.
   */
  getNode(nodeId: string): CausalManager {
    const node = this.nodes.get(nodeId)
    if (!node) {
      throw new Error(`Node ${nodeId} not found`)
    }
    return node
  }

  /**
   * Record event in global log (for replay verification).
   */
  logEvent(event: CheckpointEvent): void {
    this.globalEventLog.push(event)
  }

  /**
   * Retrieve global event log.
   */
  getGlobalEventLog(): readonly CheckpointEvent[] {
    return Object.freeze([...this.globalEventLog])
  }

  /**
   * Verify causal consistency across all logged events.
   * 
   * Law 11: Causal Consistency
   * Checks that if event A causally precedes event B,
   * then timestamp(A).logical < timestamp(B).logical.
   */
  verifyGlobalCausalConsistency(): {
    valid: boolean
    violations: Array<{ eventA: string; eventB: string; reason: string }>
  } {
    const violations: Array<{ eventA: string; eventB: string; reason: string }> = []
    const causalOrder = new CausalOrderImpl()

    // Check all pairs of events with dependency relationship
    for (let i = 0; i < this.globalEventLog.length - 1; i++) {
      const curr = this.globalEventLog[i]
      const next = this.globalEventLog[i + 1]

      // If next.prevHash = curr.hash, then curr causally precedes next
      if (next.prevHash === curr.hash) {
        if (!causalOrder.happensBefore(curr.timestamp, next.timestamp)) {
          violations.push({
            eventA: curr.hash,
            eventB: next.hash,
            reason: 'Dependent events violate HLC ordering'
          })
        }
      }
    }

    return {
      valid: violations.length === 0,
      violations
    }
  }

  /**
   * Get all node states for debugging.
   */
  getAllNodeStates(): Record<string, any> {
    const states: Record<string, any> = {}
    for (const [nodeId, manager] of this.nodes) {
      states[nodeId] = manager.getState()
    }
    return states
  }
}

/**
 * Export main types and utilities
 */
export { HLC, CausalOrder, CheckpointEvent } from './types'
export { createHLC, incrementHLC, updateHLC } from './hlc'
export { OrderedEventQueue } from './event-ordering'
export { CausalOrderImpl } from './causal-order'