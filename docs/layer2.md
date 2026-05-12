# Layer 2: Deterministic Algebra

## Universal Reducer (Axiom 1)

Every computation is a reduction:

```
R : (Σ, ι) → (Σ', I*)
```

- `Σ` = state (CRDT-backed, convergent)
- `ι` = input (event, query, mutation)
- `Σ'` = new state
- `I*` = free monoid of intents (side effects deferred)

No exceptions. UI input, network message, disk read, LLM query — all map to this form.

## Reducer Type

```typescript
type Reducer<Σ, ι = unknown> =
  (state: Σ, input: ι) => readonly [Σ, IntentList]

// Formal properties:
// 1. Pure:         ∀ s, i. R(s, i, t₁) = R(s, i, t₂)
// 2. Total:        defined for all (s, i) pairs
// 3. Deterministic: no random, no clock, no IO
// 4. Composable:   R₁ ∘ R₂ is also a Reducer
```

## Reducer Monoid (Axiom 2, Law 1)

Reducers compose associatively:

```
(R ∘ identity) ≡ R                          [left identity]
(identity ∘ R) ≡ R                          [right identity]
((R₃ ∘ R₂) ∘ R₁) ≡ (R₃ ∘ (R₂ ∘ R₁))      [associativity]

Unit:  identity(σ) = [σ, []]
Op:    [σ₁, i₁] ∘ [σ₂, i₂] = [σ₂, i₁ ++ i₂]  (concat intents)
```

Any pipeline reduces to a single deterministic function Φ.

## Dual Algebra (Axiom 3)

Two reducer spaces coexist with distinct algebraic properties.

### Space A: Projections (Commutative)

```typescript
type ProjectionReducer<Σ> = {
  kind:  "projection"
  id:    string
  apply: Reducer<Σ>
  // Proof obligation: apply(apply(σ)) = apply(σ)  ∀σ
}
```

- `P ∘ P = P` — idempotent
- `Pᵢ ∘ Pⱼ = Pⱼ ∘ Pᵢ` — commutative
- Order-independent, stable convergence

**Examples:** normalize to grid, clamp negatives to 0, canonicalize strings to lowercase.

### Space B: Constraints (Non-Commutative)

```typescript
type ConstraintReducer<Σ> = {
  kind:  "constraint"
  id:    string
  apply: Reducer<Σ>
  order: number  // Lower = runs first
  // Proof obligation: Cᵢ ∘ Cⱼ ≠ Cⱼ ∘ Cᵢ when i ≠ j
}
```

- `Cᵢ ∘ Cⱼ ≠ Cⱼ ∘ Cᵢ` — order is semantic
- `C ∘ C ≠ C` — not idempotent
- Order-dependent, sequential enforcement

**Examples:** enforce reserve ceiling (`reserved ≤ balance`), balance floor, cascade dependencies.

## Canonical Composition (Law 10)

```
Φ = Cₙ ∘ ⋯ ∘ C₁ ∘ Pₘ ∘ ⋯ ∘ P₁
```

1. Projections run first (any order among themselves)
2. Constraints run after (strict order by `order` field)
3. Final result is deterministic and replayable

## Substrate Type

```typescript
type Substrate<Σ> = {
  state:    Σ                          // State space (CRDT-backed, convergent)
  reducers: Map<string, Reducer<Σ>>   // Library of state transitions
  merge:    (a: Σ, b: Σ) => Σ        // Merge algebra (convergence function)
  intents:  IntentList                 // Intent accumulator (free monoid)
  causal:   CausalOrder               // HLC timestamps + DAG
  phi:      Reducer<Σ>                // Canonical reducer (all P + C composed)
}
```

## Runtime Configuration

```typescript
type RuntimeConfig<Σ> = {
  nodeId:        string
  initialState:  Σ
  checkpointPath: string
  mergeFn:       (a: Σ, b: Σ) => Σ
  eqFn:          (a: Σ, b: Σ) => boolean
  mergeSamples:  [Σ, Σ, Σ][]
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

## Algebraic Laws

| Law | Statement |
|---|---|
| Law 3 | `P(P(σ)) = P(σ)` — projection idempotence |
| Law 4 | `Pᵢ(Pⱼ(σ)) = Pⱼ(Pᵢ(σ))` — projection commutativity |
| Law 5 | `∃ σ. Cᵢ(Cⱼ(σ)) ≠ Cⱼ(Cᵢ(σ))` — constraint ordering |
| Law 10 | `Φ = Cₙ∘⋯∘C₁∘Pₘ∘⋯∘P₁` — dual algebra composition |
| Law 15 | Any `Σ` is serializable to JSON |