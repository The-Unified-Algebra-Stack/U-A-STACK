# unified-algebra-stack

A TypeScript library for building deterministic, replayable, and eventually consistent distributed applications. State transitions obey algebraic laws. Side effects are deferred descriptors. Every run is auditable and reproducible.

## Install

```bash
npm install unified-algebra-stack@0.1.0
```

## Core idea

Most application stacks leak side effects everywhere — into reducers, middleware, event handlers. This library makes a hard architectural bet in the opposite direction: **reducers are pure functions, effects are data, and the two never mix**.

Every reducer returns `[newState, intents]`. Intents describe what should happen (send a message, write to storage, call a webhook) but nothing executes them. A separate Layer 4 executor handles that at the boundary. This separation makes the entire state machine testable, replayable, and auditable.

## The four layers

```
┌─────────────────────────────────────────┐
│ Layer 1  Checkpoint log                 │
│          Hash-chained, append-only      │
├─────────────────────────────────────────┤
│ Layer 2  Reducer algebra Φ              │
│          Φ = Cₙ∘⋯∘C₁ ∘ Pₘ∘⋯∘P₁        │
│          Projections (commutative)      │
│          Constraints (ordered)          │
├─────────────────────────────────────────┤
│ Layer 3  Intent stream                  │
│          Free monoid of effect descriptors │
├─────────────────────────────────────────┤
│ Layer 4  Effect executor  ← impure boundary
│          Network · Storage · Scheduling │
└─────────────────────────────────────────┘
```

Layers 1–3 are pure and deterministic. Layer 4 is the single place where the outside world is touched.

## Quick start

```typescript
import { composeReducers, createRuntime } from 'unified-algebra-stack'

// 1. Define state and inputs
type CounterState = { value: number }
type CounterInput = { action: 'increment'; amount: number } | { action: 'reset' }

const initial: CounterState = { value: 0 }

// 2. Write a pure reducer — returns [newState, intents]
const counter = (state: CounterState, input: CounterInput) => {
  switch (input.action) {
    case 'increment':
      return [{ value: state.value + input.amount }, [{ type: 'LOG', msg: `+${input.amount}` }]]
    case 'reset':
      return [{ value: 0 }, [{ type: 'LOG', msg: 'reset' }]]
  }
}

// 3. Add projections (commutative invariants) and constraints (ordered rules)
const floorAtZero = (state: CounterState) => [
  { value: Math.max(0, state.value) }, []
]

// 4. Compose into a single Φ function
const Φ = composeReducers([counter, floorAtZero])

// 5. Run it
const [next, intents] = Φ(initial, { action: 'increment', amount: 10 })
// next  → { value: 10 }
// intents → [{ type: 'LOG', msg: '+10' }]
```

## Using the runtime

For production use, wrap your reducer in the runtime to get checkpoint logging, hash-chain verification, and replay:

```typescript
const runtime = createRuntime({
  nodeId: 'node-1',
  initialState: initial,
  reducer: Φ,
  effects: {
    LOG: async (intent) => console.log(intent.msg),
  }
})

await runtime.step({ action: 'increment', amount: 50 })

// Replay the entire run from the log
const log = runtime.getLog()
const { states } = await runtime.replay(log)
```

## Projections vs constraints

| | Projections | Constraints |
|---|---|---|
| Order | Commutative — any order | Non-commutative — strict order |
| Idempotent | Yes: `P(P(σ)) = P(σ)` | Not required |
| Typical use | Invariant enforcement | Alert emission, sequential rules |

Canonical composition order: projections first (any order), constraints after (specific order).

## Distributed / CRDT

Each node runs the same Φ independently. Nodes periodically gossip state snapshots and merge using a CMA-verified algebra (commutativity, associativity, idempotence, monotonicity). Regardless of sync order or timing, all nodes converge.

Built-in CRDT field types: `EscrowCounter`, `PNCounter`, `LWWRegister<T>`, `ORSet<T>`.

```typescript
const nodeA = createRuntime({ nodeId: 'A', ..., merge: myMerge })
const nodeB = createRuntime({ nodeId: 'B', ..., merge: myMerge })

await nodeA.step({ action: 'increment', amount: 10 })
await nodeB.step({ action: 'increment', amount: 20 })

// Gossip sync → both nodes converge to the same state
await nodeA.merge(nodeB.getState())
await nodeB.merge(nodeA.getState())
```

## Testing

```bash
npm test                          # full suite
npm run test:coverage             # with coverage
npm run test:purity               # reducer purity checks
npm run test:merge                # CRDT merge law verification
npm run test:causal               # causal consistency
```

Property-based tests run via [fast-check](https://github.com/dubzzz/fast-check) to verify algebraic laws (idempotence, commutativity, determinism) across arbitrary inputs.

## Guarantees

| Guarantee | Mechanism |
|---|---|
| Determinism | Pure reducers — no IO inside Φ |
| Convergence | CMA-verified merge algebra + gossip |
| Fault tolerance | Replay from checkpoint log after crash |
| Auditability | Hash-chained log of every transition |
| Causal consistency | HLC timestamps; events queued until dependencies applied |
| No effect leakage | Intents are data; Layer 4 is the only executor |
| Composability | Monoid laws verified at registration |

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — four-layer deep dive and axioms
- [`docs/api-reference.md`](docs/api-reference.md) — full API surface
- [`getting-started.md`](getting-started.md) — step-by-step walkthrough
- [`docs/crdt-guide.md`](docs/crdt-guide.md) — CRDT field types and merge algebra
- [`docs/verification.md`](docs/verification.md) — how algebraic laws are verified

## License

SEE LICENSE
