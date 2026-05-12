import type { MergeAlgebra } from "../crdt/types.js"

// ─── HLC (Hybrid Logical Clock) ───────────────────────────────────────────────
// From spec Type 8 / Law 11.
// Happens-before: a.logical < b.logical, or equal logical + smaller nodeId.

export interface HLC {
  readonly logical: number   // Lamport clock (logical time)
  readonly physical: number  // Wall-clock milliseconds
  readonly nodeId: string    // Originating node (tiebreaker)
}

// ─── CheckpointEvent ──────────────────────────────────────────────────────────
// From spec Type 7.  Hash-chained, append-only, tamper-evident.

export interface CheckpointEvent<Σ> {
  readonly nodeId:   string
  readonly timestamp: HLC
  readonly type:     "REDUCE" | "MERGE"
  readonly before:   Σ
  readonly after:    Σ
  readonly intents:  ReadonlyArray<unknown>
  readonly prevHash: string            // SHA-256 of previous event
  readonly hash:     string            // SHA-256 of this event (hash field = undefined when computing)
}

// ─── Peer ─────────────────────────────────────────────────────────────────────

export interface Peer<Σ> {
  readonly nodeId:   string
  state:             Σ
  lastSeen:          number            // Date.now() of last successful contact
  lastLogHash:       string            // Hash of last known log entry from this peer
}

// ─── GossipMessage ────────────────────────────────────────────────────────────
// Two message kinds exchanged between nodes.

export type GossipMessage<Σ> =
  | { kind: "STATE_PUSH";  fromNodeId: string; state: Σ;                          hlc: HLC }
  | { kind: "LOG_ENTRIES"; fromNodeId: string; entries: CheckpointEvent<Σ>[];     hlc: HLC }

// ─── ReplicationConfig ────────────────────────────────────────────────────────

export interface ReplicationConfig<Σ> {
  nodeId:          string
  gossipIntervalMs: number            // How often to gossip (spec: every 5 s)
  algebra:         MergeAlgebra<Σ>
  /** Send a message to a peer; implementation is injected (network boundary). */
  send: (toNodeId: string, msg: GossipMessage<Σ>) => Promise<void>
  /** Persist a checkpoint event to durable storage. */
  persistEvent: (event: CheckpointEvent<Σ>) => Promise<void>
  /** SHA-256 implementation injected so the module stays portable (Node / browser / WASM). */
  sha256: (data: string) => Promise<string>
}

// ─── SyncResult ───────────────────────────────────────────────────────────────

export interface SyncResult<Σ> {
  mergedState:    Σ
  newEntries:     CheckpointEvent<Σ>[]  // Entries appended to local log
  hadConflict:    boolean               // True when causal queue was needed
}