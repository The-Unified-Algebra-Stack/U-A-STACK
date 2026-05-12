import type { CheckpointEvent, ReplicationConfig, SyncResult } from "./types.js"
import { verifyHashChain, verifyEventHash, buildEvent } from "./sync.js"
import { PeerManager } from "./peer-manager.js"

// ─── Replication ──────────────────────────────────────────────────────────────
// Append-only log replication across peers.
//
// From spec – Append-Only Log as Source of Truth:
//   Nodes gossip log entries (not full snapshots).
//   When entry E arrives from peer:
//     1. Verify hash chain (E.prevHash = our last hash)
//     2. If valid, append to local log
//     3. Re-execute from previous state with this entry
//     4. Update local state
//
// From spec Law 12 (Replay Theorem) and Law 13 (Hash Chain Integrity).

export class Replication<Σ> {
  private log: CheckpointEvent<Σ>[] = []
  private localState: Σ

  constructor(
    private readonly config: ReplicationConfig<Σ>,
    private readonly peers: PeerManager<Σ>,
    initialState: Σ
  ) {
    this.localState = initialState
  }

  // ── Local log access ───────────────────────────────────────────────────────

  getLog(): Readonly<CheckpointEvent<Σ>[]> {
    return this.log
  }

  lastHash(): string {
    return this.log.length > 0 ? this.log[this.log.length - 1].hash : ""
  }

  getState(): Σ {
    return this.localState
  }

  // ── Append a locally produced event ───────────────────────────────────────

  async appendLocal(
    partial: Omit<CheckpointEvent<Σ>, "hash" | "prevHash">
  ): Promise<CheckpointEvent<Σ>> {
    const withPrev = { ...partial, prevHash: this.lastHash() }
    const event = await buildEvent(withPrev, this.config.sha256)

    this.log.push(event)
    this.localState = event.after
    this.peers.markApplied(event.hash)

    await this.config.persistEvent(event)
    return event
  }

  // ── Receive remote log entries ─────────────────────────────────────────────

  /**
   * Process incoming log entries from a peer.
   * Verifies each entry's hash, checks causal ordering via the PeerManager
   * queue, appends valid entries, and drains any unblocked pending entries.
   *
   * Returns a SyncResult with every entry that was actually applied.
   */
  async receiveEntries(
    fromNodeId: string,
    entries: CheckpointEvent<Σ>[]
  ): Promise<SyncResult<Σ>> {
    const applied: CheckpointEvent<Σ>[] = []
    let hadConflict = false

    for (const entry of entries) {
      // Skip already-applied entries (idempotent receive).
      if (this.peers.hasApplied(entry.hash)) continue

      // Verify individual event hash (Law 13).
      const hashOk = await verifyEventHash(entry, this.config.sha256)
      if (!hashOk) {
        console.warn(
          `[replication] Hash mismatch for entry ${entry.hash} from ${fromNodeId}; dropping.`
        )
        continue
      }

      // Causal queue: hold back if dependency not yet satisfied.
      const queued = this.peers.enqueueIfNotReady(entry)
      if (queued) {
        hadConflict = true
        continue
      }

      const wasApplied = await this.applyEntry(entry)
      if (wasApplied) applied.push(entry)

      // Drain any events unblocked by the one we just applied.
      const nowReady = this.peers.drainReady()
      for (const ready of nowReady) {
        const ok = await this.applyEntry(ready)
        if (ok) applied.push(ready)
      }
    }

    const mergedState = this.config.algebra.merge(
      this.localState,
      this.peers.getPeer(fromNodeId)?.state ?? this.localState
    )
    this.localState = mergedState

    this.peers.updatePeerState(fromNodeId, mergedState, this.lastHash())

    return { mergedState, newEntries: applied, hadConflict }
  }

  // ── Full log replay (Law 12: Replay Theorem) ───────────────────────────────

  /**
   * Replay an external log from scratch and return the final reconstructed state.
   * Verifies hash-chain integrity first; throws on breach.
   */
  async replayLog(
    externalLog: CheckpointEvent<Σ>[],
    fromInitial: Σ
  ): Promise<Σ> {
    const breach = await verifyHashChain(externalLog, this.config.sha256)
    if (breach !== -1) {
      throw new Error(
        `[replication] Hash chain breach at index ${breach} during replay`
      )
    }

    let state = fromInitial
    for (const event of externalLog) {
      // Replay: after field is the authoritative post-reduction state.
      state = event.after
    }
    return state
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async applyEntry(entry: CheckpointEvent<Σ>): Promise<boolean> {
    // Merge the entry's after-state into local state (convergent).
    this.localState = this.config.algebra.merge(this.localState, entry.after)
    this.log.push(entry)
    this.peers.markApplied(entry.hash)
    await this.config.persistEvent(entry)
    return true
  }
}