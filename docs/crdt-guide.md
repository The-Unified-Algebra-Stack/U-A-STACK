# CRDT Guide

## Overview

CRDT convergence is orthogonal to the layered stack. Each field in the state type `Σ` is a CRDT. Merge composes per-field merge functions.

**Field types:**

| CRDT | Semantics |
|---|---|
| `EscrowCounter` | max-wins, nonnegative |
| `PNCounter` | increment and decrement |
| `LWWRegister<T>` | last-write-wins by timestamp |
| `ORSet<T>` | observed-remove set |

## Merge Algebra Type

```typescript
type MergeAlgebra<Σ> = {
  merge: (a: Σ, b: Σ) => Σ
  eq:    (a: Σ, b: Σ) => boolean
}
```

## CMA Laws

All four laws are verified at construction against `mergeSamples`:

**1. Commutativity:** `M(a, b) = M(b, a)`

**2. Associativity:** `M(M(a, b), c) = M(a, M(b, c))`

**3. Idempotence:** `M(a, a) = a`

**4. Monotonicity:** `a ⊆ M(a, b)` — information only grows

## Example: Account State Merge

```typescript
type AccountState = {
  balance:  EscrowCounter            // max-wins, nonnegative
  reserved: EscrowCounter            // max-wins
  status:   LWWRegister<"active" | "frozen">  // last-write-wins
  metadata: ORSet<string>            // set of metadata keys
}

function mergeAccount(a: AccountState, b: AccountState): AccountState {
  return {
    balance:  Math.max(a.balance, b.balance),
    reserved: Math.max(a.reserved, b.reserved),
    status:   a.status.timestamp > b.status.timestamp ? a.status : b.status,
    metadata: new Set([...a.metadata, ...b.metadata])
  }
}
```

## Gossip-Based Synchronization

```
All nodes run the same Φ on local state.

Periodically (every 5s):
  1. Pick a random peer
  2. Exchange state snapshots
  3. Merge received state into local state
  4. Continue with converged state

Guarantee: Eventually all nodes reach M(σ_A, σ_B, σ_C, ...)
```

Nodes also gossip log entries (not only full snapshots). When a log entry `E` arrives from a peer:

1. Verify hash chain: `E.prevHash` matches our last hash
2. If valid, append to local log
3. Re-execute from previous state with this entry
4. Update local state

**Guarantee:** Replayed state matches peers' final state (modulo merge).