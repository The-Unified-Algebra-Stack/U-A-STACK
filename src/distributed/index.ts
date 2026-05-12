// ─── Distributed Module ───────────────────────────────────────────────────────
// Gossip-based synchronisation, causal ordering, and log replication for the
// Unified Algebra Stack.

export type {
  HLC,
  CheckpointEvent,
  Peer,
  GossipMessage,
  ReplicationConfig,
  SyncResult,
} from "./types.js"

// HLC / causal ordering utilities (spec Type 8, Law 11)
export {
  makeHLC,
  receiveHLC,
  happensBefore,
  concurrent,
  hlcEquals,
  compareHLC,
  computeHash,
  buildEvent,
  verifyEventHash,
  verifyHashChain,
} from "./sync.js"

// Peer registry + causal delivery queue
export { PeerManager } from "./peer-manager.js"

// Append-only log replication (spec Law 12, 13)
export { Replication } from "./replication.js"

// Gossip protocol (spec Gossip-Based Synchronization section)
export { GossipProtocol } from "./gossip-protocol.js"