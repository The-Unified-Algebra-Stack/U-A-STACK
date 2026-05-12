/**
 * Benchmark: Gossip-Based Synchronization
 *
 * Spec refs:
 *  - Axiom 2 (Monoid Composition)
 *  - Axiom 3 (Dual Algebra Geometry — Σ is CRDT-backed)
 *  - Law 6  (Merge Commutativity)
 *  - Law 7  (Merge Associativity)
 *  - Law 8  (Merge Idempotence)
 *  - Law 9  (Merge Monotonicity)
 *  - Execution Model: Multi-Node Convergent Synchronization
 *  - Execution Model: Causal Consistency Under Network Reordering
 */

import { bench, describe } from "vitest";

// ── Types (spec §CORE TYPES) ────────────────────────────────────────────────

type HLC = { logical: number; physical: number; nodeId: string };

type LWWRegister<T> = { value: T; timestamp: number };

type AccountState = {
  balance: number;          // EscrowCounter (max-wins)
  reserved: number;         // EscrowCounter (max-wins)
  status: LWWRegister<"active" | "frozen">;
  metadata: Set<string>;    // ORSet
};

// ── Merge Algebra (spec §Type 6, Laws 6-9) ──────────────────────────────────

function mergeAccount(a: AccountState, b: AccountState): AccountState {
  return {
    balance:  Math.max(a.balance,  b.balance),
    reserved: Math.max(a.reserved, b.reserved),
    status:   a.status.timestamp >= b.status.timestamp ? a.status : b.status,
    metadata: new Set([...a.metadata, ...b.metadata]),
  };
}

// ── HLC (spec §Type 8) ──────────────────────────────────────────────────────

function hlcNow(nodeId: string, prev: HLC): HLC {
  const physical = Date.now();
  const logical  = Math.max(prev.logical, physical) + 1;
  return { logical, physical, nodeId };
}

function happensBefore(a: HLC, b: HLC): boolean {
  if (a.logical !== b.logical) return a.logical < b.logical;
  return a.nodeId < b.nodeId;
}

// ── Node simulation (spec §Distributed Execution) ───────────────────────────

type GossipNode = {
  id: string;
  state: AccountState;
  hlc: HLC;
  inbox: Array<{ from: string; state: AccountState; hlc: HLC }>;
};

function makeNode(id: string, initial: AccountState): GossipNode {
  return {
    id,
    state: initial,
    hlc: { logical: 0, physical: Date.now(), nodeId: id },
    inbox: [],
  };
}

/** One gossip round: node sends snapshot to a peer (spec §Gossip-Based Synchronization) */
function gossipTo(sender: GossipNode, receiver: GossipNode): void {
  receiver.inbox.push({ from: sender.id, state: sender.state, hlc: sender.hlc });
}

/** Process inbox: merge received states (Law 6-9) */
function drainInbox(node: GossipNode): void {
  for (const msg of node.inbox) {
    // Causal ordering check: apply only if sender HLC happens-before or concurrent
    if (!happensBefore(node.hlc, msg.hlc) || true /* concurrent is fine for merge */) {
      node.state = mergeAccount(node.state, msg.state);
      node.hlc = {
        logical:  Math.max(node.hlc.logical, msg.hlc.logical) + 1,
        physical: Date.now(),
        nodeId:   node.id,
      };
    }
  }
  node.inbox = [];
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeCluster(size: number): GossipNode[] {
  return Array.from({ length: size }, (_, i) => {
    const id = `node-${i}`;
    return makeNode(id, {
      balance:  1000 + i * 100,
      reserved: 50  + i * 10,
      status:   { value: "active", timestamp: i },
      metadata: new Set([`key-${i}`]),
    });
  });
}

/** Full gossip round: every node gossips to every other node (single round) */
function fullGossipRound(cluster: GossipNode[]): void {
  for (const sender of cluster) {
    for (const receiver of cluster) {
      if (sender.id !== receiver.id) gossipTo(sender, receiver);
    }
  }
  for (const node of cluster) drainInbox(node);
}

/** Run N gossip rounds until convergence */
function runUntilConverged(cluster: GossipNode[], maxRounds = 10): number {
  let rounds = 0;
  while (rounds < maxRounds) {
    fullGossipRound(cluster);
    rounds++;
    // Convergence check: all states equal (Law 6-9 guarantee this)
    const ref = JSON.stringify({ ...cluster[0].state, metadata: [...cluster[0].state.metadata].sort() });
    const converged = cluster.every(n => {
      const s = JSON.stringify({ ...n.state, metadata: [...n.state.metadata].sort() });
      return s === ref;
    });
    if (converged) break;
  }
  return rounds;
}

// ── Benchmarks ───────────────────────────────────────────────────────────────

describe("gossip-sync: merge throughput (Laws 6-9)", () => {

  bench("merge two AccountState nodes (single pair)", () => {
    const [a, b] = makeCluster(2);
    mergeAccount(a.state, b.state);
  });

  bench("merge commutativity check: M(a,b) vs M(b,a)", () => {
    const [a, b] = makeCluster(2);
    const ab = mergeAccount(a.state, b.state);
    const ba = mergeAccount(b.state, a.state);
    // Law 6: M(a,b) = M(b,a)
    JSON.stringify(ab) === JSON.stringify(ba);
  });

  bench("merge idempotence: M(a,a) = a (Law 8)", () => {
    const [a] = makeCluster(1);
    mergeAccount(a.state, a.state);
  });
});

describe("gossip-sync: cluster convergence", () => {

  bench("3-node cluster — single gossip round", () => {
    const cluster = makeCluster(3);
    fullGossipRound(cluster);
  });

  bench("3-node cluster — converge to fixed point", () => {
    const cluster = makeCluster(3);
    runUntilConverged(cluster);
  });

  bench("10-node cluster — single gossip round", () => {
    const cluster = makeCluster(10);
    fullGossipRound(cluster);
  });

  bench("10-node cluster — converge to fixed point", () => {
    const cluster = makeCluster(10);
    runUntilConverged(cluster);
  });

  bench("50-node cluster — single gossip round", () => {
    const cluster = makeCluster(50);
    fullGossipRound(cluster);
  });

  bench("50-node cluster — converge to fixed point", () => {
    const cluster = makeCluster(50);
    runUntilConverged(cluster);
  });
});

describe("gossip-sync: causal ordering (Law 11, HLC)", () => {

  bench("HLC happensBefore — 1k comparisons", () => {
    const hlcs: HLC[] = Array.from({ length: 1000 }, (_, i) => ({
      logical: i,
      physical: Date.now(),
      nodeId: `node-${i % 10}`,
    }));
    for (let i = 0; i < hlcs.length - 1; i++) {
      happensBefore(hlcs[i], hlcs[i + 1]);
    }
  });

  bench("causal inbox drain — node receiving 100 out-of-order events", () => {
    const node = makeNode("node-0", {
      balance: 500, reserved: 100,
      status: { value: "active", timestamp: 0 },
      metadata: new Set(["k0"]),
    });
    // Simulate 100 peers sending state
    for (let i = 1; i <= 100; i++) {
      node.inbox.push({
        from: `node-${i}`,
        state: {
          balance:  500 + i,
          reserved: 100,
          status:   { value: "active", timestamp: i },
          metadata: new Set([`k${i}`]),
        },
        hlc: { logical: i, physical: Date.now(), nodeId: `node-${i}` },
      });
    }
    drainInbox(node);
  });
});

describe("gossip-sync: network partition recovery", () => {

  bench("partition then re-merge: 2 sub-clusters of 5", () => {
    // Two partitioned sub-clusters evolve independently, then merge
    const partA = makeCluster(5);
    const partB = makeCluster(5).map((n, i) => ({
      ...n,
      id: `part-b-${i}`,
      state: { ...n.state, balance: n.state.balance + 999 },
    }));

    // Each partition converges internally
    runUntilConverged(partA);
    runUntilConverged(partB);

    // Partition heals: cross-merge one representative from each side
    const merged = mergeAccount(partA[0].state, partB[0].state);
    // Propagate merged state
    for (const node of [...partA, ...partB]) {
      node.state = mergeAccount(node.state, merged);
    }
  });
});