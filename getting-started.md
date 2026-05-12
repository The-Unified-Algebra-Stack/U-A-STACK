# Getting Started

This guide will walk you through building your first deterministic, replayable reducer using the Unified Algebra Stack.

## Prerequisites

- Node.js 18+ or TypeScript 5+
- Basic understanding of:
  - Pure functions
  - Immutability
  - Algebraic data types

## Installation

```bash
npm install unified-algebra-stack
```

Or with Yarn:

```bash
yarn add unified-algebra-stack
```

## Your First Reducer

Let's build a simple counter that demonstrates the core concepts.

### Step 1: Define Your State Space

```typescript
// counter-state.ts
export type CounterState = {
  value: number
  history: number[]  // Track all values for replay verification
}

export type CounterInput =
  | { action: "increment"; amount: number }
  | { action: "decrement"; amount: number }
  | { action: "reset" }

export const initialState: CounterState = {
  value: 0,
  history: [0]
}
```

### Step 2: Create a Pure Reducer

```typescript
// counter-reducer.ts
import type { Reducer, IntentList } from 'unified-algebra-stack'
import type { CounterState, CounterInput } from './counter-state'

export const counterReducer: Reducer<CounterState, CounterInput> = (state, input) => {
  switch (input.action) {
    case "increment": {
      const newValue = state.value + input.amount
      return [
        {
          value: newValue,
          history: [...state.history, newValue]
        },
        [{ type: "LOG", level: "info", msg: `Incremented by ${input.amount}` }]
      ]
    }
    
    case "decrement": {
      const newValue = state.value - input.amount
      return [
        {
          value: newValue,
          history: [...state.history, newValue]
        },
        [{ type: "LOG", level: "info", msg: `Decremented by ${input.amount}` }]
      ]
    }
    
    case "reset": {
      return [
        { value: 0, history: [...state.history, 0] },
        [{ type: "LOG", level: "warn", msg: "Counter reset" }]
      ]
    }
    
    default: {
      const _: never = input
      return [state, []]
    }
  }
}
```

**Key Points:**
- ✅ Pure function — no side effects
- ✅ Returns `[newState, intents]` tuple
- ✅ Never mutates input state
- ✅ Exhaustive switch with `never` check

### Step 3: Add a Projection (Optional)

Projections enforce invariants in an idempotent, commutative way:

```typescript
// counter-projections.ts
import type { Reducer } from 'unified-algebra-stack'
import type { CounterState } from './counter-state'

// Ensure value never goes negative
export const floorAtZero: Reducer<CounterState, unknown> = (state) => {
  if (state.value < 0) {
    return [
      { ...state, value: 0 },
      []  // Projections typically emit no intents
    ]
  }
  return [state, []]
}

// Cap at maximum value
export const capAt1000: Reducer<CounterState, unknown> = (state) => {
  if (state.value > 1000) {
    return [
      { ...state, value: 1000 },
      []
    ]
  }
  return [state, []]
}
```

**Projection Properties:**
- **Idempotent**: `P(P(σ)) = P(σ)` — applying twice = applying once
- **Commutative**: `P₁(P₂(σ)) = P₂(P₁(σ))` — order doesn't matter

### Step 4: Add a Constraint (Optional)

Constraints are like projections but **order matters**:

```typescript
// counter-constraints.ts
import type { Reducer } from 'unified-algebra-stack'
import type { CounterState } from './counter-state'

// Emit alert if value exceeds threshold
export const alertOnHigh: Reducer<CounterState, unknown> = (state) => {
  if (state.value > 900) {
    return [
      state,  // Don't modify state
      [{
        type: "WEBHOOK",
        url: "https://alerts.example.com/high-value",
        payload: { value: state.value, timestamp: Date.now() }
      }]
    ]
  }
  return [state, []]
}
```

**Constraint Properties:**
- **Non-commutative**: Order matters! `C₁(C₂(σ)) ≠ C₂(C₁(σ))` in general
- **Controlled ordering**: Specified by composition order

### Step 5: Compose Your Reducer Pipeline

```typescript
// counter-phi.ts
import { composeReducers } from 'unified-algebra-stack'
import { counterReducer } from './counter-reducer'
import { floorAtZero, capAt1000 } from './counter-projections'
import { alertOnHigh } from './counter-constraints'

// Φ = Cₙ ∘ ... ∘ C₁ ∘ Pₘ ∘ ... ∘ P₁
//     └─ constraints  └─ projections
export const Φ = composeReducers([
  counterReducer,  // Domain logic
  floorAtZero,     // Projection 1
  capAt1000,       // Projection 2
  alertOnHigh      // Constraint
])
```

**Composition Order:**
1. Domain reducer (business logic)
2. Projections (in any order — they commute!)
3. Constraints (in specific order — they don't commute!)

### Step 6: Execute Your Reducer

```typescript
// main.ts
import { Φ } from './counter-phi'
import { initialState } from './counter-state'

// Execute a single input
let state = initialState
const [newState, intents] = Φ(state, { action: "increment", amount: 50 })

console.log(newState.value)     // 50
console.log(intents)             // [{ type: "LOG", ... }]

// Execute multiple inputs
const inputs = [
  { action: "increment", amount: 100 },
  { action: "increment", amount: 200 },
  { action: "decrement", amount: 50 }
]

for (const input of inputs) {
  const [next, emittedIntents] = Φ(state, input)
  state = next
  console.log(`Value: ${state.value}, Intents: ${emittedIntents.length}`)
}
```

## Using the Runtime

For production use, wrap your reducer in the runtime for:
- Checkpoint logging
- Hash chain verification
- Intent execution
- Replay capability

```typescript
// runtime-example.ts
import { createRuntime } from 'unified-algebra-stack'
import { Φ } from './counter-phi'
import { initialState } from './counter-state'

// Create runtime configuration
const runtime = createRuntime({
  nodeId: "counter-node-1",
  initialState,
  reducer: Φ,
  effects: {
    LOG: async (intent) => {
      console.log(`[${intent.level}] ${intent.msg}`)
    },
    WEBHOOK: async (intent) => {
      await fetch(intent.url, {
        method: 'POST',
        body: JSON.stringify(intent.payload)
      })
    }
  }
})

// Process inputs
await runtime.step({ action: "increment", amount: 100 })
await runtime.step({ action: "increment", amount: 200 })

// Access checkpoint log
const log = runtime.getLog()
console.log(`Checkpoint events: ${log.length}`)

// Replay from log
const { states } = await runtime.replay(log)
console.log(`Replayed ${states.length} states`)
```

## Testing Your Reducer

### Unit Tests

```typescript
// counter-reducer.test.ts
import { describe, it, expect } from '@jest/globals'
import { counterReducer } from './counter-reducer'
import { initialState } from './counter-state'

describe('Counter Reducer', () => {
  it('increments correctly', () => {
    const [state, intents] = counterReducer(initialState, {
      action: "increment",
      amount: 5
    })
    expect(state.value).toBe(5)
    expect(intents).toHaveLength(1)
    expect(intents[0].type).toBe("LOG")
  })
  
  it('is pure — same input produces same output', () => {
    const input = { action: "increment", amount: 10 }
    const [state1] = counterReducer(initialState, input)
    const [state2] = counterReducer(initialState, input)
    expect(state1).toEqual(state2)
  })
  
  it('does not mutate input state', () => {
    const stateBefore = { ...initialState }
    counterReducer(initialState, { action: "increment", amount: 1 })
    expect(initialState).toEqual(stateBefore)
  })
})
```

### Property-Based Tests

```typescript
// counter-properties.test.ts
import { fc, it } from 'fast-check'
import { counterReducer } from './counter-reducer'
import { floorAtZero } from './counter-projections'

describe('Counter Properties', () => {
  it('projection is idempotent', () => {
    fc.assert(fc.property(
      fc.integer({ min: -1000, max: 1000 }),
      (value) => {
        const state = { value, history: [value] }
        const [once] = floorAtZero(state)
        const [twice] = floorAtZero(once)
        expect(once).toEqual(twice)  // P(P(σ)) = P(σ)
      }
    ))
  })
  
  it('reducer is deterministic', () => {
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 100 }),
      fc.oneof(
        fc.record({ action: fc.constant("increment"), amount: fc.nat(100) }),
        fc.record({ action: fc.constant("decrement"), amount: fc.nat(100) })
      ),
      (value, input) => {
        const state = { value, history: [value] }
        const [state1, intents1] = counterReducer(state, input)
        const [state2, intents2] = counterReducer(state, input)
        expect(state1).toEqual(state2)
        expect(intents1).toEqual(intents2)
      }
    ))
  })
})
```

## Distributed Deployment

To deploy across multiple nodes with eventual consistency:

```typescript
// distributed-counter.ts
import { createRuntime, mergeStates } from 'unified-algebra-stack'
import { Φ } from './counter-phi'
import { initialState } from './counter-state'

// Define merge function (CRDT semantics)
const mergeCounter = (a: CounterState, b: CounterState) => ({
  value: Math.max(a.value, b.value),  // max-wins
  history: Array.from(new Set([...a.history, ...b.history])).sort((x, y) => x - y)
})

// Node A
const nodeA = createRuntime({
  nodeId: "counter-A",
  initialState,
  reducer: Φ,
  merge: mergeCounter
})

// Node B
const nodeB = createRuntime({
  nodeId: "counter-B",
  initialState,
  reducer: Φ,
  merge: mergeCounter
})

// Process events independently
await nodeA.step({ action: "increment", amount: 10 })
await nodeB.step({ action: "increment", amount: 20 })

// Gossip sync
const stateA = nodeA.getState()
const stateB = nodeB.getState()

const merged = mergeCounter(stateA, stateB)
console.log(merged.value)  // 20 (max-wins)

// Both nodes converge
await nodeA.merge(stateB)
await nodeB.merge(stateA)

expect(nodeA.getState()).toEqual(nodeB.getState())  // ✅ Convergence
```

## Next Steps

Now that you have the basics:

1. **[Runtime Model](./runtime-model.md)** — Understand checkpoints and replay
2. **[Distributed Model](./distributed-model.md)** — Learn about CRDTs and gossip
3. **[Replay Guarantees](./replay-guarantees.md)** — Time travel and crash recovery
4. **[Architecture](./architecture.md)** — Deep dive into the four layers

## Common Patterns

### Pattern 1: Deferred Validation

```typescript
// Don't validate in the reducer — use projections!
const badReducer = (state, input) => {
  if (input.amount < 0) throw new Error("Negative amount!")  // ❌ Not pure!
  return [{ ...state, value: state.value + input.amount }, []]
}

// ✅ Use a projection instead
const ensurePositive = (state) => [
  { ...state, value: Math.max(0, state.value) },
  []
]
```

### Pattern 2: Intent Accumulation

```typescript
// Emit multiple intents
const complexReducer = (state, input) => {
  const newState = { ...state, value: state.value + input.amount }
  return [
    newState,
    [
      { type: "LOG", level: "info", msg: "Value updated" },
      { type: "STORE", key: "counter", value: newState },
      { type: "SEND", topic: "counter-events", payload: newState }
    ]
  ]
}
```

### Pattern 3: Conditional Constraints

```typescript
// Only emit alert on specific conditions
const conditionalAlert = (state) => {
  if (state.value > 500 && state.value % 100 === 0) {
    return [
      state,
      [{ type: "WEBHOOK", url: "...", payload: { value: state.value } }]
    ]
  }
  return [state, []]
}
```

## Troubleshooting

### "My reducer isn't deterministic"

**Problem:** Tests fail randomly
**Solution:** Ensure no:
- `Date.now()`, `Math.random()`, or other non-deterministic functions
- External API calls or I/O
- Mutation of input state

### "Projections don't commute"

**Problem:** `P₁(P₂(σ)) ≠ P₂(P₁(σ))`
**Solution:** Projections must be independent — if they conflict, one should be a constraint

### "Replay doesn't match original run"

**Problem:** `replayLog()` produces different states
**Solution:** Check for:
- Non-deterministic code in reducer
- Missing events in log
- Corrupted hash chain

## Resources

- **Examples**: See [`src/examples/`](../src/examples/)
- **Tests**: See [`tests/`](../tests/) for comprehensive examples
- **API Reference**: See [api-reference.md](./api-reference.md)

---

**Ready to build?** Check out the [Runtime Model](./runtime-model.md) next!