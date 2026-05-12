import type { HLC, CheckpointEvent } from "./types.js"

// ─── HLC Operations ──────────────────────────────────────────────────────────
// From spec Type 8 / Law 11.
//
// happens-before:  a.logical < b.logical
//                  | (a.logical === b.logical && a.nodeId < b.nodeId)
// concurrent:      !happensBefore(a,b) && !happensBefore(b,a)

export function makeHLC(nodeId: string, physicalNow: number, prevLogical = 0): HLC {
  // Advance logical to at least max(prevLogical, physicalNow) + 1.
  // Physical is stored for debugging / display; ordering uses logical only.
  const logical = Math.max(prevLogical, physicalNow) + 1
  return { logical, physical: physicalNow, nodeId }
}

/** Receive a remote HLC and advance local clock past it. */
export function receiveHLC(local: HLC, remote: HLC, physicalNow: number): HLC {
  const logical = Math.max(local.logical, remote.logical, physicalNow) + 1
  return { logical, physical: physicalNow, nodeId: local.nodeId }
}

export function happensBefore(a: HLC, b: HLC): boolean {
  if (a.logical !== b.logical) return a.logical < b.logical
  return a.nodeId < b.nodeId
}

export function concurrent(a: HLC, b: HLC): boolean {
  return !happensBefore(a, b) && !happensBefore(b, a)
}

export function hlcEquals(a: HLC, b: HLC): boolean {
  return a.logical === b.logical && a.nodeId === b.nodeId
}

/** Deterministic total order for sorting: happens-before, then nodeId tiebreak. */
export function compareHLC(a: HLC, b: HLC): number {
  if (happensBefore(a, b)) return -1
  if (happensBefore(b, a)) return  1
  return 0
}

// ─── Checkpoint Hashing ───────────────────────────────────────────────────────
// From spec Type 7 / Law 13.
// hash = SHA256(event with { hash: undefined, prevHash: undefined } when computing own hash)

export async function computeHash<Σ>(
  event: Omit<CheckpointEvent<Σ>, "hash">,
  sha256: (data: string) => Promise<string>
): Promise<string> {
  // Spec: hash computed with hash field = undefined
  const payload = { ...event, hash: undefined }
  return sha256(JSON.stringify(payload))
}

export async function buildEvent<Σ>(
  partial: Omit<CheckpointEvent<Σ>, "hash">,
  sha256: (data: string) => Promise<string>
): Promise<CheckpointEvent<Σ>> {
  const hash = await computeHash(partial, sha256)
  return { ...partial, hash }
}

/** Verify the hash of a single event. */
export async function verifyEventHash<Σ>(
  event: CheckpointEvent<Σ>,
  sha256: (data: string) => Promise<string>
): Promise<boolean> {
  const expected = await computeHash(event, sha256)
  return expected === event.hash
}

/** Verify the entire hash chain of an ordered log. Returns index of first breach, or -1. */
export async function verifyHashChain<Σ>(
  events: CheckpointEvent<Σ>[],
  sha256: (data: string) => Promise<string>
): Promise<number> {
  for (let i = 0; i < events.length; i++) {
    const valid = await verifyEventHash(events[i], sha256)
    if (!valid) return i

    if (i > 0 && events[i].prevHash !== events[i - 1].hash) return i
  }
  return -1
}