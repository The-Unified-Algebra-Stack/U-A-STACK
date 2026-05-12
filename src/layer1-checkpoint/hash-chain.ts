/**
 * HASH CHAIN: Tamper-Evident Checkpoint Log
 * Spec: Law 13: Hash Chain Integrity (page 11)
 * 
 * Invariants:
 * - hash[i] = SHA256(event[i] with {hash: undefined, prevHash: undefined})
 * - prevHash[i] = hash[i-1]
 * - Any modification to event → hash changes
 * - Chain integrity verifiable in O(n)
 */

import * as crypto from "crypto"

export interface HashChainConfig {
  /**
   * Hash algorithm (default: sha256)
   * Must be available in crypto module
   */
  algorithm: string
}

/**
 * Compute hash of event with hash and prevHash fields removed
 * 
 * Spec: Law 13
 * "hash[i] = SHA256(event[i] with {hash: undefined, prevHash: undefined})"
 * 
 * The event is canonicalized to JSON, removing the hash-related fields,
 * then hashed with SHA256.
 */
export function computeEventHash(
  event: {
    readonly nodeId: string
    readonly timestamp: any
    readonly type: "REDUCE" | "MERGE"
    readonly before: unknown
    readonly after: unknown
    readonly intents: readonly any[]
  },
  algorithm: string = "sha256"
): string {
  // Create hashable representation (without hash and prevHash fields)
  const hashable = {
    nodeId: event.nodeId,
    timestamp: event.timestamp,
    type: event.type,
    before: event.before,
    after: event.after,
    intents: event.intents,
  }

  // Canonical JSON: sorted keys, no whitespace
  const canonical = JSON.stringify(hashable, Object.keys(hashable).sort())

  // Compute hash
  return crypto.createHash(algorithm).update(canonical).digest("hex")
}

/**
 * Verify hash chain integrity
 * 
 * Spec: Law 13 verification
 * "Compute hash for each event; verify prevHash chain unbroken"
 */
export function verifyHashChain(
  events: readonly any[],
  algorithm: string = "sha256"
): { valid: boolean; firstInvalidIndex: number | null; errors: string[] } {
  const errors: string[] = []
  let firstInvalidIndex: number | null = null

  if (events.length === 0) {
    return { valid: true, firstInvalidIndex: null, errors: [] }
  }

  // First event must have prevHash = null or ""
  const firstEvent = events[0]
  const firstHash = computeEventHash(firstEvent, algorithm)

  if (firstEvent.hash !== firstHash) {
    errors.push(`Event 0: hash mismatch. Expected ${firstHash}, got ${firstEvent.hash}`)
    if (firstInvalidIndex === null) firstInvalidIndex = 0
  }

  if (firstEvent.prevHash && firstEvent.prevHash !== "") {
    errors.push(`Event 0: prevHash must be empty or null, got "${firstEvent.prevHash}"`)
    if (firstInvalidIndex === null) firstInvalidIndex = 0
  }

  // Remaining events
  for (let i = 1; i < events.length; i++) {
    const event = events[i]
    const prevEvent = events[i - 1]

    // Verify hash
    const computedHash = computeEventHash(event, algorithm)
    if (event.hash !== computedHash) {
      errors.push(
        `Event ${i}: hash mismatch. Expected ${computedHash}, got ${event.hash}`
      )
      if (firstInvalidIndex === null) firstInvalidIndex = i
    }

    // Verify hash chain link
    if (event.prevHash !== prevEvent.hash) {
      errors.push(
        `Event ${i}: prevHash mismatch. Expected ${prevEvent.hash}, got ${event.prevHash}`
      )
      if (firstInvalidIndex === null) firstInvalidIndex = i
    }
  }

  return {
    valid: errors.length === 0,
    firstInvalidIndex,
    errors,
  }
}

/**
 * Create a new checkpoint event with correct hash and prevHash
 * 
 * Spec: Type 7: CheckpointEvent
 */
export function createCheckpointEvent(
  params: {
    readonly nodeId: string
    readonly timestamp: any
    readonly type: "REDUCE" | "MERGE"
    readonly before: unknown
    readonly after: unknown
    readonly intents: readonly any[]
    readonly prevHash: string
  },
  algorithm: string = "sha256"
): any {
  const hash = computeEventHash(
    {
      nodeId: params.nodeId,
      timestamp: params.timestamp,
      type: params.type,
      before: params.before,
      after: params.after,
      intents: params.intents,
    },
    algorithm
  )

  return Object.freeze({
    nodeId: params.nodeId,
    timestamp: params.timestamp,
    type: params.type,
    before: params.before,
    after: params.after,
    intents: Object.freeze(params.intents),
    prevHash: params.prevHash,
    hash,
  })
}

/**
 * Serialize event for storage/transmission (JSON-safe)
 * 
 * Spec: Law 15: JSON Universality
 */
export function serializeCheckpointEvent(event: any): string {
  return JSON.stringify(event)
}

/**
 * Deserialize checkpoint event
 * 
 * Spec: Law 15: JSON Universality
 */
export function deserializeCheckpointEvent(json: string): any {
  return JSON.parse(json)
}