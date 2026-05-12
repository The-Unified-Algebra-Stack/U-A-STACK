import type { Peer, CheckpointEvent } from "./types.js"
import { happensBefore, compareHLC } from "./sync.js"

// ─── PeerManager ─────────────────────────────────────────────────────────────
// Tracks known peers and maintains the causal delivery queue.
//
// From spec – Causal Consistency Under Network Reordering:
//   If B arrives at node X before A, and A happens-before B:
//     X queues B until A is applied, then applies A then B.

export class PeerManager<Σ> {
  private readonly peers = new Map<string, Peer<Σ>>()

  // Causal queue: events held back waiting for their causal dependencies.
  private readonly pending: CheckpointEvent<Σ>[] = []

  // Set of hashes already applied to local state (for dependency checks).
  private readonly appliedHashes = new Set<string>()

  readonly localNodeId: string

  constructor(localNodeId: string) {
    this.localNodeId = localNodeId
  }

  // ── Peer registry ──────────────────────────────────────────────────────────

  addPeer(nodeId: string, initialState: Σ): void {
    if (nodeId === this.localNodeId) return
    if (!this.peers.has(nodeId)) {
      this.peers.set(nodeId, {
        nodeId,
        state: initialState,
        lastSeen: Date.now(),
        lastLogHash: "",
      })
    }
  }

  removePeer(nodeId: string): void {
    this.peers.delete(nodeId)
  }

  updatePeerState(nodeId: string, state: Σ, lastLogHash?: string): void {
    const peer = this.peers.get(nodeId)
    if (!peer) return
    this.peers.set(nodeId, {
      ...peer,
      state,
      lastSeen: Date.now(),
      ...(lastLogHash !== undefined ? { lastLogHash } : {}),
    })
  }

  getPeer(nodeId: string): Peer<Σ> | undefined {
    return this.peers.get(nodeId)
  }

  allPeers(): Peer<Σ>[] {
    return [...this.peers.values()]
  }

  /** Pick a random peer for gossip (spec: "pick random peer"). */
  randomPeer(): Peer<Σ> | undefined {
    const peers = this.allPeers()
    if (peers.length === 0) return undefined
    return peers[Math.floor(Math.random() * peers.length)]
  }

  // ── Causal delivery queue ─────────────────────────────────────────────────

  markApplied(hash: string): void {
    this.appliedHashes.add(hash)
  }

  hasApplied(hash: string): boolean {
    return this.appliedHashes.has(hash)
  }

  /**
   * Enqueue an incoming event if its causal dependency (prevHash) is not yet
   * satisfied.  Returns true if the event was queued (not ready), false if it
   * can be applied immediately.
   */
  enqueueIfNotReady(event: CheckpointEvent<Σ>): boolean {
    // Genesis event: prevHash is empty string → always ready.
    if (!event.prevHash || this.appliedHashes.has(event.prevHash)) {
      return false  // ready now
    }
    // Dependency not yet met; park it.
    if (!this.pending.find((e) => e.hash === event.hash)) {
      this.pending.push(event)
    }
    return true   // queued
  }

  /**
   * After applying an event, drain any pending events whose dependency is now
   * satisfied.  Returns events in causal (happens-before) order, ready to apply.
   */
  drainReady(): CheckpointEvent<Σ>[] {
    const ready: CheckpointEvent<Σ>[] = []
    let changed = true

    while (changed) {
      changed = false
      for (let i = this.pending.length - 1; i >= 0; i--) {
        const e = this.pending[i]
        if (!e.prevHash || this.appliedHashes.has(e.prevHash)) {
          ready.push(e)
          this.pending.splice(i, 1)
          changed = true
        }
      }
    }

    // Sort in causal order before returning.
    return ready.sort((a, b) => compareHLC(a.timestamp, b.timestamp))
  }

  pendingCount(): number {
    return this.pending.length
  }
}