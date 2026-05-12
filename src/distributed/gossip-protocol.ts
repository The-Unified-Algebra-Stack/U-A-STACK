import type { GossipMessage, ReplicationConfig } from "./types.js"
import { makeHLC, receiveHLC } from "./sync.js"
import { PeerManager } from "./peer-manager.js"
import { Replication } from "./replication.js"

// ─── GossipProtocol ───────────────────────────────────────────────────────────
// Periodic gossip-based synchronisation.
//
// From spec – Gossip-Based Synchronization:
//   All nodes run same Φ on local state.
//   Periodically (every 5s):
//     1. Pick random peer
//     2. Exchange state snapshots
//     3. Merge received state into local state
//     4. Continue with converged state
//   Guarantee: Eventually all nodes reach M(σ_A, σ_B, σ_C, …)
//
// Two gossip modes are combined:
//   STATE_PUSH  – fast convergence for state (CRDT merge on receipt)
//   LOG_ENTRIES – authoritative log replication (hash-chain verified)

export class GossipProtocol<Σ> {
  private hlc = makeHLC(this.config.nodeId, Date.now())
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly config: ReplicationConfig<Σ>,
    private readonly peers: PeerManager<Σ>,
    private readonly replication: Replication<Σ>
  ) {}

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  start(): void {
    if (this.timer !== null) return
    this.timer = setInterval(
      () => void this.tick(),
      this.config.gossipIntervalMs
    )
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  // ── Inbound message handler ───────────────────────────────────────────────

  /**
   * Call this when a GossipMessage arrives from the network.
   * Returns true if local state was updated.
   */
  async receive(msg: GossipMessage<Σ>): Promise<boolean> {
    // Advance local HLC on every receive (causal clock discipline).
    this.hlc = receiveHLC(this.hlc, msg.hlc, Date.now())

    switch (msg.kind) {
      case "STATE_PUSH": {
        return this.handleStatePush(msg.fromNodeId, msg.state)
      }
      case "LOG_ENTRIES": {
        const result = await this.replication.receiveEntries(
          msg.fromNodeId,
          msg.entries
        )
        return result.newEntries.length > 0
      }
    }
  }

  // ── Manual / test gossip trigger ──────────────────────────────────────────

  /** Force an immediate gossip round with a specific peer (or a random one). */
  async gossipWith(nodeId?: string): Promise<void> {
    const peer = nodeId
      ? this.peers.getPeer(nodeId)
      : this.peers.randomPeer()

    if (!peer) return

    this.hlc = makeHLC(this.config.nodeId, Date.now(), this.hlc.logical)

    // Send local state snapshot to peer.
    const statePush: GossipMessage<Σ> = {
      kind: "STATE_PUSH",
      fromNodeId: this.config.nodeId,
      state: this.replication.getState(),
      hlc: this.hlc,
    }
    await this.config.send(peer.nodeId, statePush)

    // Also send any log entries the peer hasn't seen.
    const unseenEntries = this.replication
      .getLog()
      .filter((e) => !peer.lastLogHash || e.hash !== peer.lastLogHash)

    if (unseenEntries.length > 0) {
      const logPush: GossipMessage<Σ> = {
        kind: "LOG_ENTRIES",
        fromNodeId: this.config.nodeId,
        entries: unseenEntries,
        hlc: this.hlc,
      }
      await this.config.send(peer.nodeId, logPush)
    }
  }

  currentHLC() {
    return this.hlc
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private async tick(): Promise<void> {
    try {
      await this.gossipWith()
    } catch (err) {
      // Gossip failures are non-fatal; the protocol retries next interval.
      this.config.log?.("warn", `[gossip] tick error: ${String(err)}`)
    }
  }

  private handleStatePush(fromNodeId: string, remoteState: Σ): boolean {
    const peer = this.peers.getPeer(fromNodeId)
    const before = this.replication.getState()

    // Merge remote state into local (CRDT convergence).
    const merged = this.config.algebra.merge(before, remoteState)

    // Update peer's known state for future log diffing.
    this.peers.updatePeerState(fromNodeId, remoteState)

    const changed = !this.config.algebra.eq(before, merged)
    if (changed) {
      // State has grown; replication layer will pick this up on next checkpoint.
      // We don't write a checkpoint here — that is Φ's job in Layer 2.
      ;(this.replication as unknown as { localState: Σ }).localState = merged
    }
    return changed
  }
}