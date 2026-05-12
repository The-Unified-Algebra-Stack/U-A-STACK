# Runtime Model

The Unified Algebra Stack runtime is a **deterministic execution loop** that ensures every state transition is:
- Pure and reproducible
- Cryptographically logged
- Fully replayable

This document explains how the runtime works and why it guarantees these properties.

## The Execution Loop

### Single-Step Execution

Every input follows this five-phase cycle:

```
┌─────────────────────────────────────────────────────────────┐
│ Phase 1: INPUT ACQUISITION                                  │
│                                                              │
│  input ← dequeue()  // Read from input queue                │
│  before ← state     // Snapshot current state               │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase 2: REDUCTION                                          │
│                                                              │
│  [after, intents] ← Φ(before, input)                        │
│                                                              │
│  Φ = Cₙ ∘ ... ∘ C₁ ∘ Pₘ ∘ ... ∘ P₁                         │
│      └─ constraints  └─ projections                         │
│                                                              │
│  ✓ Pure function — no side effects                          │
│  ✓ Deterministic — same input → same output                 │
│  ✓ Total — handles all inputs                               │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase 3: CHECKPOINT CREATION                                │
│                                                              │
│  timestamp ← HLC.tick()  // Advance logical clock           │
│  event ← {                                                   │
│    nodeId,                                                   │
│    timestamp,                                                │
│    type: "REDUCE",                                           │
│    before,                                                   │
│    after,                                                    │
│    intents,                                                  │
│    prevHash: log.last.hash                                   │
│  }                                                           │
│  event.hash ← SHA256(event)  // Cryptographic seal          │
│  log.append(event)           // Immutable append            │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase 4: INTENT EXECUTION                                   │
│                                                              │
│  await executeIntents(intents)                               │
│                                                              │
│  for each intent:                                            │
│    match intent.type:                                        │
│      LOG      → write to logger                              │
│      STORE    → persist to database                          │
│      SEND     → emit network message                         │
│      LLM      → call language model                          │
│      WEBHOOK  → HTTP POST to URL                             │
│                                                              │
│  ⚠️ Effects NEVER modify state (Layer 4 boundary)           │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase 5: STATE UPDATE                                       │
│                                                              │
│  state ← after   // Commit new state                        │
│  intents ← []    // Clear intent buffer                     │
│  loop            // Back to Phase 1                          │
└─────────────────────────────────────────────────────────────┘
```

### Code Example

```typescript
import { createRuntime } from 'unified-algebra-stack'

const runtime = createRuntime({
  nodeId: "node-1",
  initialState: { balance: 0 },
  reducer: Φ,
  effects: {
    LOG: async (intent) => console.log(intent.msg),
    STORE: async (intent) => await db.set(intent.key, intent.value)
  }
})

// Single step
const { event, state, intents } = await runtime.step({
  action: "deposit",
  amount: 100
})

console.log(event.hash)        // "a3f5..."
console.log(event.prevHash)    // "9c2b..."
console.log(state.balance)     // 100
console.log(intents)           // [{ type: "LOG", ... }]
```

## Checkpoint Events

### Event Structure

Every checkpoint event has this shape:

```typescript
type CheckpointEvent<Σ> = {
  // Identity
  nodeId:    string        // Which node created this
  timestamp: HLC           // Hybrid Logical Clock
  type:      "REDUCE" | "MERGE"
  
  // State transition
  before:  Σ               // State before reduction
  after:   Σ               // State after reduction
  intents: IntentList      // Side effects emitted
  
  // Hash chain
  prevHash: string         // Link to previous event
  hash:     string         // This event's hash (SHA256)
}
```

### Hash Chain Integrity (Law 13)

The hash chain provides **tamper-evident logging**:

```
event[0]               event[1]               event[2]
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│ prevHash: "" │      │ prevHash: h₀ │      │ prevHash: h₁ │
│ hash: h₀     │──────│ hash: h₁     │──────│ hash: h₂     │
└──────────────┘      └──────────────┘      └──────────────┘
```

**Hash Computation:**
```typescript
function hashEvent(event: CheckpointEvent) {
  const payload = JSON.stringify({
    ...event,
    hash: undefined,      // Exclude hash field itself
    prevHash: event.prevHash
  })
  return SHA256(payload)
}
```

**Verification:**
```typescript
function verifyChain(log: CheckpointEvent[]): boolean {
  let prevHash = ""
  
  for (const event of log) {
    // Check link
    if (event.prevHash !== prevHash) return false
    
    // Verify hash
    const expectedHash = hashEvent(event)
    if (event.hash !== expectedHash) return false
    
    prevHash = event.hash
  }
  
  return true
}
```

### Why This Matters

**Tamper Detection:**
```typescript
// Attacker modifies event[5].after.balance
log[5].after.balance = 999_999  // ❌ Tampering

// Verification fails
verifyChain(log)  // false — hash mismatch detected
```

**Audit Trail:**
```typescript
// Show complete history
log.forEach((event, i) => {
  console.log(`Step ${i}: ${event.before.balance} → ${event.after.balance}`)
  console.log(`  Hash: ${event.hash.slice(0, 8)}...`)
  console.log(`  Intents: ${event.intents.length}`)
})
```

## Hybrid Logical Clocks (HLC)

### Structure

```typescript
type HLC = {
  logical:  number   // Monotonically increasing counter
  physical: number   // Wall-clock time (milliseconds since epoch)
  nodeId:   string   // Node identifier for tiebreaking
}
```

### Tick Operation

Each step advances the logical clock:

```typescript
function tickHLC(prev: HLC, nodeId: string): HLC {
  const physical = Date.now()
  return {
    logical:  prev.logical + 1,               // Always increment
    physical: Math.max(physical, prev.physical),  // Monotonic
    nodeId
  }
}
```

**Properties:**
- ✅ **Monotonic**: `HLC[i].logical < HLC[i+1].logical` always
- ✅ **Causal**: If `event_a → event_b`, then `HLC_a < HLC_b`
- ✅ **Total Order**: On same node, events are strictly ordered

### Happens-Before Relation

```typescript
function happensBefore(a: HLC, b: HLC): boolean {
  if (a.logical !== b.logical) {
    return a.logical < b.logical
  }
  if (a.physical !== b.physical) {
    return a.physical < b.physical
  }
  return a.nodeId < b.nodeId  // Tiebreak by node ID
}

function concurrent(a: HLC, b: HLC): boolean {
  return !happensBefore(a, b) && !happensBefore(b, a)
}
```

**Example:**
```typescript
const event1 = { logical: 10, physical: 1000, nodeId: "A" }
const event2 = { logical: 11, physical: 1000, nodeId: "A" }
const event3 = { logical: 11, physical: 1050, nodeId: "B" }

happensBefore(event1, event2)  // true  (logical: 10 < 11)
happensBefore(event2, event3)  // false (concurrent)
concurrent(event2, event3)     // true
```

## Replay

### The Replay Theorem (Law 12)

**Given:**
- Checkpoint log `L = [e₀, e₁, ..., eₙ]`
- Initial state `σ₀`
- Reducer `Φ`

**Then:**
```
Replay(L, σ₀, Φ) = [σ₀, σ₁, ..., σₙ]

Where:
  σᵢ = eᵢ.after  for all i
```

**Proof obligation:** Re-executing `Φ` on each event's `before` state produces the same `after` state.

### Implementation

```typescript
async function replayLog<Σ>(
  log:          CheckpointEvent<Σ>[],
  initialState: Σ,
  phi:          Reducer<Σ>,
  equals:       (a: Σ, b: Σ) => boolean
): Promise<{ ok: boolean; states: Σ[] }> {
  let state = initialState
  const states: Σ[] = [state]
  let prevHash = ""
  
  for (let i = 0; i < log.length; i++) {
    const event = log[i]
    
    // Verify hash chain (Law 13)
    if (event.prevHash !== prevHash) {
      return { ok: false, states }
    }
    const expectedHash = hashEvent(event)
    if (event.hash !== expectedHash) {
      return { ok: false, states }
    }
    
    // Re-derive state using Φ
    const [derived, _intents] = phi(event.before, undefined)
    
    // Check: derived state matches logged state
    if (!equals(derived, event.after)) {
      return { ok: false, states }
    }
    
    state = event.after
    prevHash = event.hash
    states.push(state)
  }
  
  return { ok: true, states }
}
```

### Use Cases

#### 1. Crash Recovery

```typescript
// Application crashes
process.on('SIGTERM', async () => {
  await runtime.persistLog()  // Flush log to disk
  process.exit(0)
})

// Application restarts
const log = await loadPersistedLog()
const { states } = await replayLog(log, initialState, Φ, deepEqual)
const currentState = states[states.length - 1]

console.log("State restored:", currentState)
```

#### 2. Time Travel Debugging

```typescript
// Find state at specific timestamp
function stateAt(timestamp: number): Σ {
  const relevantEvents = log.filter(e => e.timestamp.logical <= timestamp)
  const { states } = replayLog(relevantEvents, initialState, Φ, deepEqual)
  return states[states.length - 1]
}

// Debug: What was the balance at step 42?
const debugState = stateAt(42)
console.log("Balance at step 42:", debugState.balance)
```

#### 3. Partial Replay

```typescript
// Reconstruct state from event 10 to 20
const partialLog = log.slice(10, 21)
const stateAtEvent10 = log[10].before
const { states } = await replayLog(partialLog, stateAtEvent10, Φ, deepEqual)

console.log("Reconstructed 10 states")
```

#### 4. Verification & Audit

```typescript
// Prove correctness of entire execution
const { ok } = await replayLog(log, initialState, Φ, deepEqual)

if (ok) {
  console.log("✅ All events verified — log is consistent")
} else {
  console.error("❌ Replay mismatch — possible corruption or non-determinism")
}
```

## Queue Processing

### Batch Execution

Process multiple inputs atomically:

```typescript
async function runQueue(inputs: Input[]) {
  const results = []
  
  for (const input of inputs) {
    const result = await runtime.step(input)
    results.push(result)
  }
  
  return {
    states: results.map(r => r.state),
    events: results.map(r => r.event),
    allIntents: results.flatMap(r => r.intents)
  }
}

// Execute batch
const inputs = [
  { action: "deposit", amount: 100 },
  { action: "withdraw", amount: 50 },
  { action: "freeze" }
]

const { states, events } = await runQueue(inputs)
console.log(`Processed ${events.length} events`)
console.log(`Final state:`, states[states.length - 1])
```

### Deterministic Ordering

The runtime ensures **FIFO ordering**:

```
Input Queue          Checkpoint Log
───────────         ───────────────
[i₁, i₂, i₃]  →     [e₁, e₂, e₃]

Where:
  e₁.before = σ₀
  e₁.after  = σ₁ = Φ(σ₀, i₁)
  
  e₂.before = σ₁
  e₂.after  = σ₂ = Φ(σ₁, i₂)
  
  e₃.before = σ₂
  e₃.after  = σ₃ = Φ(σ₂, i₃)
```

No interleaving, no race conditions.

## Effect Execution (Layer 4 Boundary)

### Intent Descriptors

Reducers emit **intent descriptors** — pure data, not functions:

```typescript
type Intent =
  | { type: "LOG";      level: string; msg: string }
  | { type: "STORE";    key: string; value: unknown }
  | { type: "SEND";     topic: string; payload: unknown }
  | { type: "LLM";      prompt: string; model: string }
  | { type: "WEBHOOK";  url: string; payload: unknown }
  | { type: "USER_PROMPT"; msg: string }
```

### Executor Configuration

Map intent types to effect handlers:

```typescript
const effects = {
  LOG: async (intent) => {
    console.log(`[${intent.level.toUpperCase()}] ${intent.msg}`)
  },
  
  STORE: async (intent) => {
    await database.set(intent.key, JSON.stringify(intent.value))
  },
  
  SEND: async (intent) => {
    await messageBroker.publish(intent.topic, intent.payload)
  },
  
  LLM: async (intent) => {
    const response = await llmClient.complete(intent.prompt, intent.model)
    return response
  },
  
  WEBHOOK: async (intent) => {
    await fetch(intent.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(intent.payload)
    })
  }
}
```

### Isolation Invariant

**Critical:** Effects NEVER modify state.

```typescript
// ❌ WRONG — effect modifies state
const badEffect = async (intent, state) => {
  state.balance += 100  // Violates Layer 4 invariant!
}

// ✅ CORRECT — effect is isolated
const goodEffect = async (intent) => {
  await externalAPI.notify(intent.payload)
  // No state access
}
```

**Why this matters:**
- Replay can skip effect execution (pure state reconstruction)
- Effects can fail without affecting state consistency
- No non-determinism from side effects

## Configuration

### Runtime Options

```typescript
type RuntimeConfig<Σ> = {
  nodeId:       string                    // Node identifier
  initialState: Σ                         // Starting state
  reducer:      Reducer<Σ>                // Composed Φ
  effects:      EffectExecutors           // Intent handlers
  merge?:       (a: Σ, b: Σ) => Σ        // For distributed mode
  equals?:      (a: Σ, b: Σ) => boolean  // Custom equality
}
```

### Example Configuration

```typescript
const config = {
  nodeId: "production-node-1",
  initialState: {
    balance: 0,
    reserved: 0,
    status: { value: "active", timestamp: 0 }
  },
  reducer: Φ,
  effects: {
    LOG: logger.write,
    STORE: database.persist,
    SEND: messageQueue.publish
  },
  merge: mergeAccount,
  equals: deepEqual
}

const runtime = createRuntime(config)
```

## Performance Considerations

### Memory Management

```typescript
// Limit log size to prevent unbounded growth
const MAX_LOG_SIZE = 10_000

if (log.length > MAX_LOG_SIZE) {
  // Take snapshot and truncate
  await runtime.snapshot(currentState)
  log.splice(0, log.length - 1000)  // Keep last 1000 events
}
```

### Async Effects

Effects execute concurrently when possible:

```typescript
async function executeIntents(intents: IntentList) {
  await Promise.all(
    intents.map(intent => effects[intent.type](intent))
  )
}
```

## Next Steps

- **[Distributed Model](./distributed-model.md)** — Multi-node gossip and CRDTs
- **[Replay Guarantees](./replay-guarantees.md)** — Deep dive into replay use cases
- **[Layer 1: Checkpoints](./layer1.md)** — Technical details of the log

---

**Key Takeaways:**
1. Runtime is a deterministic loop: input → reduce → checkpoint → execute → repeat
2. Checkpoint log is hash-chained for tamper-evident auditing
3. Replay reconstructs state from log + reducer (no effect re-execution)
4. Effects are isolated in Layer 4 — never modify state
5. HLC provides causal ordering across distributed nodes