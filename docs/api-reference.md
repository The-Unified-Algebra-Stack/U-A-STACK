# API Reference

Complete type and function reference for the Unified Algebra Stack.

---

## Core Types

### `Reducer<Σ, ι>`

The universal computational unit. Every state transition is a `Reducer`.

```typescript
type Reducer<Σ, ι = unknown> =
  (state: Σ, input: ι) => readonly [Σ, IntentList]
```

**Formal properties**

| Property | Definition |
|---|---|
| Pure | `R(s, i, t₁) = R(s, i, t₂)` — result independent of wall-clock time |
| Total | Defined for all `(s, i)` pairs; never throws |
| Deterministic | No random, no clock, no IO |
| Composable | `R₁ ∘ R₂` is itself a valid `Reducer` |

---

### `Intent`

A first-class descriptor of a side effect. Reducers emit intents; they never execute them.

```typescript
type Intent =
  | { type: "SEND";     to: string; opcode: number; payload: unknown }
  | { type: "STORE";    key: string; value: unknown }
  | { type: "SCHEDULE"; reducerId: string; delayMs: number }
  | { type: "LOG";      level: "info" | "warn" | "error"; msg: string }
  | { type: "EMIT";     channel: string; payload: unknown }
  | { type: "LLM";      model: string; prompt: string; maxTokens: number }
```

---

### `IntentList`

Free monoid over `Intent`. The unit is `[]`; the operation is concatenation.

```typescript
type IntentList = readonly Intent[]

function concat(a: IntentList, b: IntentList): IntentList
const empty: IntentList = Object.freeze([])
```

**Monoid laws**

```
concat(intents, [])           ≡ intents          // right unit
concat([], intents)           ≡ intents          // left unit
concat(concat(i₁, i₂), i₃)   ≡ concat(i₁, concat(i₂, i₃))  // associativity
```

---

### `Substrate<Σ>`

The execution environment for a single node.

```typescript
type Substrate<Σ> = {
  state:    Σ                           // CRDT-backed state
  reducers: Map<string, Reducer<Σ>>     // registered reducer library
  merge:    (a: Σ, b: Σ) => Σ          // convergence function
  intents:  IntentList                  // accumulated intent buffer
  causal:   CausalOrder                 // HLC-based ordering
  phi:      Reducer<Σ>                  // canonical composed reducer
}
```

---

### `ProjectionReducer<Σ>`

A reducer that is idempotent and commutes with all other projections.

```typescript
type ProjectionReducer<Σ> = {
  kind:  "projection"
  id:    string
  apply: Reducer<Σ>
  // Proof obligation: apply(apply(σ)) = apply(σ) ∀σ
}
```

---

### `ConstraintReducer<Σ>`

A reducer with explicit ordering semantics. Constraints are non-commutative.

```typescript
type ConstraintReducer<Σ> = {
  kind:  "constraint"
  id:    string
  apply: Reducer<Σ>
  order: number   // lower = runs first
  // Proof obligation: Cᵢ ∘ Cⱼ ≠ Cⱼ ∘ Cᵢ when i ≠ j
}
```

---

### `MergeAlgebra<Σ>`

Defines convergent merging for a state type. Must satisfy all four CMA laws.

```typescript
type MergeAlgebra<Σ> = {
  merge: (a: Σ, b: Σ) => Σ
  eq:    (a: Σ, b: Σ) => boolean
}
```

**CMA laws**

| Law | Formula |
|---|---|
| Commutativity | `M(a, b) = M(b, a)` |
| Associativity | `M(M(a, b), c) = M(a, M(b, c))` |
| Idempotence | `M(a, a) = a` |
| Monotonicity | `a ⊆ M(a, b)` — information only grows |

---

### `CheckpointEvent`

An immutable record of a single state transition. Forms a hash-chained log.

```typescript
type CheckpointEvent = {
  nodeId:    string
  timestamp: HLC
  type:      "REDUCE" | "MERGE"
  before:    unknown
  after:     unknown
  intents:   IntentList
  prevHash:  string       // SHA256 of previous event
  hash:      string       // SHA256(this event with { hash: undefined, prevHash: undefined })
}
```

---

### `HLC`

Hybrid Logical Clock. Combines physical time with a Lamport counter for causal ordering.

```typescript
type HLC = {
  logical:  number   // Lamport clock
  physical: number   // wall clock in milliseconds
  nodeId:   string   // tiebreaker
}
```

**Happens-before**

```
a happens-before b  iff  a.logical < b.logical
                    or   (a.logical = b.logical && a.nodeId < b.nodeId)

concurrent(a, b)    iff  !happensBefore(a, b) && !happensBefore(b, a)
```

---

### `CausalOrder`

```typescript
type CausalOrder = {
  happensBefore(a: HLC, b: HLC): boolean
  concurrent(a: HLC, b: HLC):    boolean
}
```

---

### `RuntimeConfig<Σ>`

Full configuration passed to `UnifiedRuntime` at construction.

```typescript
type RuntimeConfig<Σ> = {
  nodeId:         string
  initialState:   Σ
  checkpointPath: string
  mergeFn:        (a: Σ, b: Σ) => Σ
  eqFn:           (a: Σ, b: Σ) => boolean
  mergeSamples:   [Σ, Σ, Σ][]
  projections: {
    id:         string
    fn:         Reducer<Σ>
    testStates: Σ[]
  }[]
  constraints: {
    id:    string
    order: number
    fn:    Reducer<Σ>
  }[]
  effects: {
    send:     (to: string, op: number, payload: unknown) => Promise<void>
    store:    (key: string, value: unknown) => Promise<void>
    schedule: (reducerId: string, delayMs: number) => void
    log:      (level: string, msg: string) => void
    llm:      (model: string, prompt: string, maxTokens: number) => Promise<string>
  }
}
```

---

## Stdlib Functions

### `compose`

Chains reducers left-to-right. Intents from each step are concatenated.

```typescript
function compose<Σ, ι>(...reducers: Reducer<Σ, ι>[]): Reducer<Σ, ι>
```

Satisfies the monoid laws: `compose(R, identity) ≡ R`, `compose(identity, R) ≡ R`, and associativity.

---

### `guard`

Conditionally routes to one of two reducers based on a predicate over state and input.

```typescript
function guard<Σ, ι>(
  condition: (state: Σ, input: ι) => boolean,
  thenReducer: Reducer<Σ, ι>,
  elseReducer?: Reducer<Σ, ι>
): Reducer<Σ, ι>
```

---

### `emit`

Produces a reducer that leaves state unchanged and emits a single intent.

```typescript
function emit<Σ>(intent: Intent): Reducer<Σ>
```

---

### `increment`

Increments a numeric field by `amount` (default `1`). State change only; no intents emitted.

```typescript
function increment<Σ extends Record<string, number>>(
  field: keyof Σ,
  amount?: number
): Reducer<Σ>
```

---

### `withMetrics`

Wraps a reducer and appends a `LOG` intent recording its wall-clock duration.

```typescript
function withMetrics<Σ, ι>(
  name: string,
  reducer: Reducer<Σ, ι>
): Reducer<Σ, ι>
```

---

## WASM Sandbox

### `SandboxConfig`

```typescript
type SandboxConfig = {
  reducerCode:   string
  capabilities:  Capability[]
  timeoutMs:     number
  maxMemoryMb:   number
}

enum Capability {
  KV_READ,
  KV_WRITE,
  LLM_QUERY,
  SEND_MESSAGE,
  EMIT_INTENT
}
```

### `runInSandbox`

Compiles reducer source to WASM, gates capabilities, enforces a timeout, and returns the reducer result.

```typescript
async function runInSandbox<Σ, ι>(
  config: SandboxConfig,
  state:  Σ,
  input:  ι
): Promise<[Σ, Intent[]]>
```

Clock access (`Date.now`, `performance.now`) is always trapped inside the sandbox regardless of capability grants.

---

## Verification Functions

### `assertPure`

Runs a reducer twice on each `(state, input)` pair and asserts identical output.

```typescript
function assertPure<Σ, ι>(
  reducer:    Reducer<Σ, ι>,
  testStates: Σ[],
  testInputs: ι[]
): boolean
```

### `testIdempotent`

Applies a projection twice and asserts the second application produces no change.

```typescript
function testIdempotent<Σ>(
  projection: ProjectionReducer<Σ>,
  testStates: Σ[],
  eq: (a: Σ, b: Σ) => boolean
): boolean
```

### `testMergeCMA`

Checks commutativity, associativity, and idempotence against all provided sample triples.

```typescript
function testMergeCMA<Σ>(
  merge:   (a: Σ, b: Σ) => Σ,
  eq:      (a: Σ, b: Σ) => boolean,
  samples: [Σ, Σ, Σ][]
): { commutative: boolean; associative: boolean; idempotent: boolean }
```

### `testReplayTheorem`

Runs an execution, captures the checkpoint log, replays it from initial state, and compares state sequences.

```typescript
async function testReplayTheorem<Σ>(
  runtime:  UnifiedRuntime<Σ>,
  numSteps: number,
  eq:       (a: Σ, b: Σ) => boolean
): Promise<boolean>
```