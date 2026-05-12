# Architecture

The Unified Algebra Stack is a four-layer system for building deterministic, replayable, and eventually consistent distributed applications. Every computation is a reduction; every side effect is a deferred descriptor; every state transition is an immutable log entry.

---

## The Four Layers

```
┌─────────────────────────────────────────────────────────────┐
│ LAYER 1: IMMUTABLE TRUTH                                    │
│   Checkpoint log — hash-chained, append-only                │
│   Source of all derived state                               │
├─────────────────────────────────────────────────────────────┤
│ LAYER 2: DETERMINISTIC ALGEBRA                              │
│   Φ = Cₙ ∘ ⋯ ∘ C₁ ∘ Pₘ ∘ ⋯ ∘ P₁                          │
│   Projections (commutative, idempotent)                     │
│   Constraints (non-commutative, ordered)                    │
│   Merge algebra (CMA-verified)                              │
│   Causal order (HLC timestamps)                             │
├─────────────────────────────────────────────────────────────┤
│ LAYER 3: INTENT STREAM                                      │
│   Free monoid of side-effect descriptors                    │
│   Emitted by reducers; never interpreted within Φ           │
├─────────────────────────────────────────────────────────────┤
│ LAYER 4: EFFECT EXECUTOR                                    │
│   Network (SEND), Storage (STORE), Scheduling (SCHEDULE)   │
│   Logging (LOG), LLM queries (LLM)                         │
│   Impure boundary — never modifies Σ                        │
└─────────────────────────────────────────────────────────────┘

ORTHOGONAL: CRDT CONVERGENCE
  Field-typed merge algebra (EscrowCounter, PNCounter, LWW, ORSet)
  Gossip-based synchronization across nodes

ORTHOGONAL: CAUSAL CONSISTENCY
  HLC timestamps thread through all events
  Happens-before ordering enforced before applying events
```

---

## Axioms

**Axiom 1 — Universal Reducer.** Every computation maps to:

```
R : (Σ, ι) → (Σ', I*)
```

UI input, network message, disk read, LLM response — all are inputs `ι` to some reducer.

**Axiom 2 — Composition is Monoid.** Reducers compose associatively with an identity:

```
(R₃ ∘ R₂) ∘ R₁  ≡  R₃ ∘ (R₂ ∘ R₁)
identity ∘ R     ≡  R
R ∘ identity     ≡  R
```

Any pipeline therefore reduces to a single deterministic function Φ.

**Axiom 3 — Dual Algebra Geometry.** Two structurally distinct spaces coexist inside Layer 2:

| Space | Property | Consequence |
|---|---|---|
| Projections P | Commutative, idempotent | Order-independent, stable |
| Constraints C | Non-commutative, ordered | Sequential enforcement |

Their canonical composition is always `Φ = Cₙ ∘ ⋯ ∘ C₁ ∘ Pₘ ∘ ⋯ ∘ P₁` — projections run first in any order, constraints run after in strict order.

**Axiom 4 — Intent as Free Monoid.** Side effects are values, not operations. Reducers can only emit them; nothing within Layer 2 can execute them. Emission and execution are separated by a layer boundary.

**Axiom 5 — Layered Determinism Boundary.** Layers 1–3 are pure and deterministic. Layer 4 is the single impure boundary where execution happens. This separation makes the entire state machine testable, replayable, and auditable.

---

## Data Flow

### Single node

```
input ──► Φ = Cₙ∘⋯∘C₁∘Pₘ∘⋯∘P₁ ──► (new state, intents)
                                          │          │
                                     checkpoint    Layer 4
                                       log       executor
```

The execution loop is:

```
loop:
  input   ← read from queue
  [Σ', I*] ← Φ(Σ, input)
  checkpoint.record({ before: Σ, after: Σ', intents: I* })
  await executeIntents(I*)
  Σ ← Σ'
```

### Multi-node (gossip)

Each node runs the same Φ on its local state. Periodically, nodes exchange state snapshots and merge using the CRDT merge algebra:

```
Node A: σₐ          Node B: σᵦ
        │                    │
        └──── gossip ────────┘
              M(σₐ, σᵦ)
        ┌─────────────────────┐
        σₐ' = σᵦ' = M(σₐ, σᵦ)   ← converged
```

The CMA laws (commutativity, associativity, idempotence, monotonicity) guarantee that regardless of gossip order or timing, all nodes reach the same final state.

---

## Layered Determinism Boundary

The stack has a hard purity boundary:

```
PURE (deterministic, testable, replayable)
  Layer 1: append-only log
  Layer 2: reducer algebra Φ
  Layer 3: intent descriptors
────────────────────────────────────────────
IMPURE (side-effectful, external)
  Layer 4: effect executor
```

This boundary is enforced by type: reducers return `IntentList`, not `Promise<void>`. The executor receives intents and calls the actual `effects` handlers from `RuntimeConfig`. No reducer ever calls the network, clock, or storage directly.

---

## CRDT Field Types

State types are composed of CRDT-typed fields. Each field has its own merge function:

| Field type | Merge rule | Example use |
|---|---|---|
| `EscrowCounter` | `max(a, b)` | balance, reserved |
| `PNCounter` | `sum deltas` | counters with decrements |
| `LWWRegister<T>` | highest timestamp wins | status, labels |
| `ORSet<T>` | union | metadata, tags |

The full state merge is the structural composition of per-field merges. This composition inherits CMA laws from each field's merge function.

---

## Guarantees

| Guarantee | Mechanism |
|---|---|
| Single-node determinism | Pure reducers, no IO in Φ |
| Multi-node convergence | CMA-verified merge algebra + gossip |
| Fault tolerance | Replay from checkpoint log after crash |
| Auditability | Every transition recorded in hash-chained log |
| Causal consistency | HLC ordering; events queued until dependencies applied |
| No side-effect leakage | Intent deferred execution; Layer 4 boundary |
| Composability | Monoid laws verified at registration |
| Sandboxed user code | WASM capability model; clock always trapped |