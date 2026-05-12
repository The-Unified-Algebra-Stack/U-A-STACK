# Layer 1: Immutable Truth

## Purpose

Layer 1 is the source of all derived state. Every state transition is recorded here. The log is append-only and hash-chained, making it tamper-evident and replay-safe.

## Checkpoint Event Type

```typescript
type CheckpointEvent = {
  nodeId:    string      // Which node performed this
  timestamp: HLC         // Hybrid logical clock
  type:      "REDUCE" | "MERGE"  // What happened
  before:    unknown     // State snapshot before
  after:     unknown     // State snapshot after
  intents:   IntentList  // Emitted intents
  prevHash:  string      // SHA256 of previous event
  hash:      string      // SHA256 of this event (with hash: undefined)
}
```

## Hash Chain

Each event's hash is computed as:

```
hash[i] = SHA256(event[i] with { hash: undefined, prevHash: undefined })
event[i].prevHash = hash[i-1]
```

**Properties:**
- **Hash-chained:** `prevHash[i] = hash[i-1]`
- **Tamper-evident:** changing any field causes the hash to change
- **Replay-safe:** replaying the log with the same reducers produces the same sequence of states

## Law 12: Replay Theorem

```
Given log:           [event₀, event₁, ..., eventₙ]
Given initial state: σ₀
Given reducers:      {R₁, R₂, ...}

Replaying: σ₁ = R₁(σ₀, input₀); σ₂ = R₂(σ₁, input₁); ...
Matches log: σᵢ = event[i].after  ∀i

⟹ State can be reconstructed from log + reducer library
```

## Law 13: Hash Chain Integrity

```
∀i. hash[i] = SHA256(event[i] with { hash: undefined, prevHash: undefined })
∀i. event[i].prevHash = hash[i-1]
```

**Verification:** Compute the hash for each event; verify the `prevHash` chain is unbroken.

## Single-Node Execution Loop

```
loop:
  input    ← read from queue
  [state, intents] ← Φ(state, input)
  checkpoint.record({ before, after: state, intents })
  await executeIntents(intents)
  intents  ← []
```

**Property:** Deterministic. No race conditions, no nondeterminism.