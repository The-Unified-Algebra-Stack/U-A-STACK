/**
 * UNIFIED ALGEBRA STACK - Causal Order Implementation
 * 
 * Implements the CausalOrder interface using HLC timestamps.
 * 
 * Semantics:
 * - a happens-before b iff a.logical < b.logical
 * - or (a.logical = b.logical && a.nodeId < b.nodeId)
 * - concurrent(a,b) := !happensBefore(a,b) && !happensBefore(b,a)
 * 
 * Law 11: Causal Consistency
 * Invariant: event(a) → event(b) implies timestamp(a).logical < timestamp(b).logical
 */

import { HLC, CausalOrder } from './types'

/**
 * Concrete implementation of CausalOrder interface.
 * 
 * Provides happens-before, concurrency, and total ordering comparisons
 * over HLC timestamps.
 */
export class CausalOrderImpl implements CausalOrder {
  /**
   * Check if a happens-before b (a causally precedes b).
   * 
   * Returns true iff:
   * - a.logical < b.logical (primary order), OR
   * - (a.logical = b.logical && a.nodeId < b.nodeId) (tiebreak)
   * 
   * This ensures a total order: for any two distinct timestamps,
   * exactly one of:
   * - happensBefore(a, b)
   * - happensBefore(b, a)
   * - concurrent(a, b) [only if a = b exactly]
   */
  happensBefore(a: HLC, b: HLC): boolean {
    // Primary: compare logical clocks
    if (a.logical < b.logical) {
      return true
    }
    if (a.logical > b.logical) {
      return false
    }

    // Logical clocks equal; tiebreak by nodeId (lexicographic)
    return a.nodeId < b.nodeId
  }

  /**
   * Check if a and b are concurrent.
   * 
   * Returns true iff neither a happens-before b nor b happens-before a.
   * 
   * This can only happen if:
   * - a.logical = b.logical
   * - a.nodeId = b.nodeId
   * 
   * Which means a = b exactly (same timestamp from same node).
   */
  concurrent(a: HLC, b: HLC): boolean {
    return !this.happensBefore(a, b) && !this.happensBefore(b, a)
  }

  /**
   * Total ordering: compare(a, b) for sorting.
   * 
   * Returns:
   * - -1: a < b (a happens-before b)
   * -  0: a = b (same timestamp)
   * -  1: a > b (b happens-before a)
   * 
   * Can be used directly with Array.sort():
   *   events.sort((a, b) => causalOrder.compare(a.timestamp, b.timestamp))
   */
  compare(a: HLC, b: HLC): -1 | 0 | 1 {
    if (this.happensBefore(a, b)) {
      return -1
    }
    if (this.happensBefore(b, a)) {
      return 1
    }
    return 0 // concurrent (a = b)
  }

  /**
   * Check if a <= b (happens-before or concurrent).
   */
  happenBeforeOrEqual(a: HLC, b: HLC): boolean {
    return this.happensBefore(a, b) || this.concurrent(a, b)
  }

  /**
   * Get minimum of two HLC timestamps (earliest in causal order).
   */
  min(a: HLC, b: HLC): HLC {
    return this.happensBefore(a, b) ? a : b
  }

  /**
   * Get maximum of two HLC timestamps (latest in causal order).
   */
  max(a: HLC, b: HLC): HLC {
    return this.happensBefore(a, b) ? b : a
  }

  /**
   * Find the minimum HLC among a list.
   * 
   * Throws if list is empty.
   */
  minOf(timestamps: HLC[]): HLC {
    if (timestamps.length === 0) {
      throw new Error('Cannot find min of empty list')
    }
    return timestamps.reduce((acc, ts) => this.min(acc, ts))
  }

  /**
   * Find the maximum HLC among a list.
   * 
   * Throws if list is empty.
   */
  maxOf(timestamps: HLC[]): HLC {
    if (timestamps.length === 0) {
      throw new Error('Cannot find max of empty list')
    }
    return timestamps.reduce((acc, ts) => this.max(acc, ts))
  }

  /**
   * Sort a list of HLC timestamps in happens-before order.
   * 
   * Returns new sorted array (does not mutate input).
   */
  sort(timestamps: HLC[]): HLC[] {
    return [...timestamps].sort((a, b) => this.compare(a, b))
  }

  /**
   * Check if a list is already sorted in happens-before order.
   */
  isSorted(timestamps: HLC[]): boolean {
    for (let i = 1; i < timestamps.length; i++) {
      if (!this.happenBeforeOrEqual(timestamps[i - 1], timestamps[i])) {
        return false
      }
    }
    return true
  }

  /**
   * Find all events that are concurrent with a given timestamp.
   * 
   * Concurrent events are those where neither happens-before the other.
   * In HLC, this only occurs when timestamps are identical.
   */
  getConcurrentWith(target: HLC, timestamps: HLC[]): HLC[] {
    return timestamps.filter(ts => this.concurrent(target, ts))
  }

  /**
   * Find all events that causally precede a given timestamp.
   * 
   * Returns timestamps ts where happensBefore(ts, target).
   */
  getPrecedingEvents(target: HLC, timestamps: HLC[]): HLC[] {
    return timestamps.filter(ts => this.happensBefore(ts, target))
  }

  /**
   * Find all events that causally follow a given timestamp.
   * 
   * Returns timestamps ts where happensBefore(target, ts).
   */
  getFollowingEvents(target: HLC, timestamps: HLC[]): HLC[] {
    return timestamps.filter(ts => this.happensBefore(target, ts))
  }

  /**
   * Check if a is strictly between b and c causally.
   * 
   * Returns true iff: happensBefore(b, a) && happensBefore(a, c)
   */
  isBetween(a: HLC, b: HLC, c: HLC): boolean {
    return this.happensBefore(b, a) && this.happensBefore(a, c)
  }

  /**
   * Compute causal distance between a and b.
   * 
   * Returns difference in logical clocks (a measure of causal separation).
   * Positive if a < b, negative if b < a, zero if concurrent.
   */
  logicalDistance(a: HLC, b: HLC): number {
    return b.logical - a.logical
  }

  /**
   * Check if there's a "clock skew" (physical time goes backwards).
   * 
   * Given a sequence of HLC timestamps from a single node,
   * check if physical times ever decrease (indicates clock adjustment or error).
   */
  hasClockSkew(timestamps: HLC[]): boolean {
    if (timestamps.length < 2) return false

    for (let i = 1; i < timestamps.length; i++) {
      const prev = timestamps[i - 1]
      const curr = timestamps[i]

      // If from same node, physical time should not decrease
      if (prev.nodeId === curr.nodeId && prev.physical > curr.physical) {
        return true
      }
    }

    return false
  }

  /**
   * Verify that a sequence of events respects causal consistency.
   * 
   * Given a log of events (each with a timestamp):
   * - Check that if event A causally precedes event B,
   *   then timestamp(A) < timestamp(B)
   * 
   * Returns validation result.
   */
  verifyCausalConsistency(
    events: Array<{ timestamp: HLC; id: string }>
  ): {
    valid: boolean
    violations: Array<{ eventA: string; eventB: string; reason: string }>
  } {
    const violations: Array<{
      eventA: string
      eventB: string
      reason: string
    }> = []

    // Simple check: ensure timestamps are non-decreasing
    for (let i = 1; i < events.length; i++) {
      const prev = events[i - 1]
      const curr = events[i]

      // If curr's timestamp happens-before prev's, we have a violation
      if (this.happensBefore(curr.timestamp, prev.timestamp)) {
        violations.push({
          eventA: curr.id,
          eventB: prev.id,
          reason: 'Event timestamp violates happens-before ordering'
        })
      }
    }

    return {
      valid: violations.length === 0,
      violations
    }
  }

  /**
   * Export current HLC state for debugging.
   * 
   * Returns object representation of HLC semantics.
   */
  explain(hlc: HLC): {
    logical: number
    physical: string
    nodeId: string
    physicalDate: string
  } {
    return {
      logical: hlc.logical,
      physical: hlc.physical.toString(),
      nodeId: hlc.nodeId,
      physicalDate: new Date(hlc.physical).toISOString()
    }
  }
}

/**
 * Utility function for creating a causal order from module.
 * 
 * Singleton pattern (all instances are equivalent).
 */
export function createCausalOrder(): CausalOrder {
  return new CausalOrderImpl()
}

/**
 * Vector clock alternative (for reference, not used in spec but similar semantics).
 * 
 * Some systems use vector clocks instead of HLC.
 * HLC is preferred because it respects physical time.
 */
export interface VectorClock {
  readonly [nodeId: string]: number
}

/**
 * Comparison utilities for vector clocks (not primary in this spec).
 */
export class VectorClockOps {
  /**
   * Check if vector clock a <= b (component-wise).
   */
  static happensBefore(a: VectorClock, b: VectorClock): boolean {
    let hasStrict = false
    for (const nodeId in a) {
      const aVal = a[nodeId] || 0
      const bVal = b[nodeId] || 0
      if (aVal > bVal) {
        return false
      }
      if (aVal < bVal) {
        hasStrict = true
      }
    }
    return hasStrict
  }

  /**
   * Merge two vector clocks (component-wise max).
   */
  static merge(a: VectorClock, b: VectorClock): VectorClock {
    const result: VectorClock = { ...a }
    for (const nodeId in b) {
      const aVal = result[nodeId] || 0
      const bVal = b[nodeId] || 0
      result[nodeId] = Math.max(aVal, bVal)
    }
    return result
  }
}