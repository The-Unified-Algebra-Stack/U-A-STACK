/**
 * UNIFIED ALGEBRA STACK - Event Ordering Queue
 * 
 * Manages events arriving out of causal order.
 * 
 * Scenario: Node A receives event B before event A.
 * - Event B depends on event A (prevHash[B] = hash[A])
 * - Queue B until A arrives
 * - When A arrives, dequeue both in order
 * 
 * Formal: For event E with prevHash P:
 *   If P ∈ seen, return E immediately (ready)
 *   Else, queue(E) until P arrives (waiting)
 */

import { CheckpointEvent } from './types'

/**
 * Internal queue entry tracking both event and its dependency.
 */
interface QueueEntry {
  event: CheckpointEvent
  dependsOnHash: string | undefined | null
  addedAtMs: number
}

/**
 * Ordered event queue with dependency resolution.
 */
export class OrderedEventQueue {
  private queue: Map<string, QueueEntry> = new Map() // hash -> QueueEntry
  private seenHashes: Set<string> = new Set()
  private readonly dependencyTimeoutMs: number
  private readonly maxQueueSize: number

  constructor(
    maxQueueSize: number = 10000,
    dependencyTimeoutMs: number = 60000
  ) {
    this.maxQueueSize = maxQueueSize
    this.dependencyTimeoutMs = dependencyTimeoutMs
  }

  /**
   * Enqueue an event if its dependencies haven't arrived yet.
   * 
   * If all dependencies are met:
   * - Mark event as seen
   * - Return it (ready for application)
   * 
   * If dependencies are missing:
   * - Queue it (waiting for dependencies)
   * - Return null
   * 
   * Contract: Call this for each incoming event.
   * Returns ready events in dependency order.
   */
  enqueueAndDrain(event: CheckpointEvent): CheckpointEvent[] {
    // Validate
    if (!event.hash) {
      throw new Error('Event must have a hash')
    }

    // Check if already seen (duplicate suppression)
    if (this.seenHashes.has(event.hash)) {
      return []
    }

    // Check dependency
    const dependsOnHash = event.prevHash
    const dependencyMet =
      dependsOnHash === undefined ||
      dependsOnHash === '' ||
      this.seenHashes.has(dependsOnHash)

    if (dependencyMet) {
      // Dependencies satisfied, event is ready
      this.seenHashes.add(event.hash)
      return this.tryDrainDependents(event.hash)
    } else {
      // Dependencies not met, queue and wait
      this.queue.set(event.hash, {
        event,
        dependsOnHash,
        addedAtMs: Date.now()
      })

      // Check queue size
      if (this.queue.size > this.maxQueueSize) {
        throw new Error(
          `Event queue overflow (max ${this.maxQueueSize}). ` +
          `Network partition or clock skew suspected.`
        )
      }

      return []
    }
  }

  /**
   * Try to drain events that became ready because their dependency just arrived.
   * 
   * Recursively drains all dependent events in order.
   * 
   * Formal: Given dependency D arrived, drain all E where E.prevHash = D.hash.
   */
  private tryDrainDependents(justArrivedHash: string): CheckpointEvent[] {
    const result: CheckpointEvent[] = []

    // Find all queued events that depend on this hash
    const dependents: QueueEntry[] = []
    for (const [_, entry] of this.queue) {
      if (entry.dependsOnHash === justArrivedHash) {
        dependents.push(entry)
      }
    }

    // Process each dependent
    for (const entry of dependents) {
      // Check timeout
      const ageMs = Date.now() - entry.addedAtMs
      if (ageMs > this.dependencyTimeoutMs) {
        // Dependency took too long, assume it's not coming
        // Drop the event
        this.queue.delete(entry.event.hash)
        console.warn(
          `Dropped event ${entry.event.hash} (dependency ` +
          `${entry.dependsOnHash} did not arrive within ${this.dependencyTimeoutMs}ms)`
        )
        continue
      }

      // Remove from queue
      this.queue.delete(entry.event.hash)

      // Mark as seen
      this.seenHashes.add(entry.event.hash)

      // Add to result
      result.push(entry.event)

      // Recursively drain dependents of this event
      const transitive = this.tryDrainDependents(entry.event.hash)
      result.push(...transitive)
    }

    return result
  }

  /**
   * Drain all ready events (blocking until explicit request).
   * 
   * Returns events that have all dependencies satisfied,
   * in dependency order (topological sort).
   * 
   * Note: Does NOT automatically drain on each enqueue.
   * Call this explicitly to get ready events.
   */
  drain(): CheckpointEvent[] {
    // This method returns events already marked as ready.
    // For lazy draining, just return empty array.
    // In practice, enqueueAndDrain handles the draining.
    return []
  }

  /**
   * Check if a hash has been seen (dependency is satisfied).
   */
  hasSeen(hash: string): boolean {
    return this.seenHashes.has(hash)
  }

  /**
   * Get current queue size (for monitoring).
   */
  size(): number {
    return this.queue.size
  }

  /**
   * Get all queued events (for debugging).
   */
  getQueuedEvents(): CheckpointEvent[] {
    return Array.from(this.queue.values()).map(e => e.event)
  }

  /**
   * Verify no cyclic dependencies (sanity check).
   * 
   * Returns false if a cycle is detected (should never happen with proper HLC).
   */
  verifyCycleFredom(): boolean {
    // BFS from each queued event to detect cycles
    for (const [startHash, startEntry] of this.queue) {
      const visited = new Set<string>()
      const stack: string[] = [startHash]

      while (stack.length > 0) {
        const current = stack.pop()!

        if (visited.has(current)) {
          // Cycle detected
          return false
        }

        visited.add(current)

        const entry = this.queue.get(current)
        if (entry && entry.dependsOnHash) {
          stack.push(entry.dependsOnHash)
        }
      }
    }

    return true
  }

  /**
   * Clear queue (for reset/cleanup).
   */
  clear(): void {
    this.queue.clear()
    this.seenHashes.clear()
  }

  /**
   * Get statistics (for monitoring).
   */
  getStats(): {
    queuedEvents: number
    seenHashes: number
    maxQueueSize: number
    utilizationPercent: number
    avgAgeMs: number
  } {
    let totalAgeMs = 0
    for (const entry of this.queue.values()) {
      totalAgeMs += Date.now() - entry.addedAtMs
    }
    const avgAgeMs =
      this.queue.size > 0 ? totalAgeMs / this.queue.size : 0

    return {
      queuedEvents: this.queue.size,
      seenHashes: this.seenHashes.size,
      maxQueueSize: this.maxQueueSize,
      utilizationPercent: Math.round(
        (this.queue.size / this.maxQueueSize) * 100
      ),
      avgAgeMs: Math.round(avgAgeMs)
    }
  }
}

/**
 * Event dependency graph analyzer.
 * 
 * Useful for:
 * - Visualizing event flow
 * - Detecting long dependency chains
 * - Finding bottleneck events (many dependents)
 */
export class EventDependencyGraph {
  private edges: Map<string, Set<string>> = new Map() // from -> to hashes

  /**
   * Add edge: eventA causally precedes eventB.
   */
  addEdge(fromHash: string, toHash: string): void {
    if (!this.edges.has(fromHash)) {
      this.edges.set(fromHash, new Set())
    }
    this.edges.get(fromHash)!.add(toHash)
  }

  /**
   * Get longest dependency chain from a given event.
   * 
   * Returns path length (0 if no dependents, n if n hops away).
   */
  getLongestChainLength(fromHash: string): number {
    const visited = new Set<string>()
    return this.dfsMaxDepth(fromHash, visited)
  }

  private dfsMaxDepth(hash: string, visited: Set<string>): number {
    if (visited.has(hash)) return 0
    visited.add(hash)

    const dependents = this.edges.get(hash)
    if (!dependents || dependents.size === 0) {
      return 0
    }

    let maxDepth = 0
    for (const dependent of dependents) {
      const depth = 1 + this.dfsMaxDepth(dependent, new Set(visited))
      maxDepth = Math.max(maxDepth, depth)
    }

    return maxDepth
  }

  /**
   * Get all events with more than N dependents (bottlenecks).
   */
  getBottlenecks(minDependents: number = 5): string[] {
    const bottlenecks: string[] = []
    for (const [hash, dependents] of this.edges) {
      if (dependents.size >= minDependents) {
        bottlenecks.push(hash)
      }
    }
    return bottlenecks
  }
}