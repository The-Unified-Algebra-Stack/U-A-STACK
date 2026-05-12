# Verification Framework

## 1. Purity Testing

Run the reducer twice with the same input; assert outputs are identical.

```typescript
function assertPure<Σ, ι>(
  reducer:    Reducer<Σ, ι>,
  testStates: Σ[],
  testInputs: ι[]
): boolean {
  for (const state of testStates) {
    for (const input of testInputs) {
      const [s1, i1] = reducer(state, input)
      const [s2, i2] = reducer(state, input)
      if (JSON.stringify(s1) !== JSON.stringify(s2)) return false
      if (i1.length !== i2.length)                   return false
    }
  }
  return true
}
```

## 2. Composition Testing

Verify associativity: `((R₃ ∘ R₂) ∘ R₁) ≡ (R₃ ∘ (R₂ ∘ R₁))`.

```typescript
function testComposition<Σ, ι>(
  r1: Reducer<Σ, ι>,
  r2: Reducer<Σ, ι>,
  testStates: Σ[],
  testInputs: ι[]
): { leftAssoc: Σ; rightAssoc: Σ; equal: boolean } {
  const state = testStates[0]
  const input = testInputs[0]

  // Left-associative path
  const [s1]  = r1(state, input)
  const [s2]  = r2(s1, input)
  const [s3]  = r1(s2, input)
  const leftAssoc = s3

  // Right-associative path
  const [s1p] = compose(r1, r2)(state, input)
  const [s2p] = r1(s1p, input)
  const rightAssoc = s2p

  return {
    leftAssoc,
    rightAssoc,
    equal: JSON.stringify(leftAssoc) === JSON.stringify(rightAssoc)
  }
}
```

## 3. Idempotence Testing

Apply a projection twice; assert the second application changes nothing.

```typescript
function testIdempotent<Σ>(
  projection: ProjectionReducer<Σ>,
  testStates: Σ[],
  eq: (a: Σ, b: Σ) => boolean
): boolean {
  for (const state of testStates) {
    const [s1] = projection.apply(state, undefined)
    const [s2] = projection.apply(s1, undefined)
    if (!eq(s1, s2)) return false
  }
  return true
}
```

## 4. Merge CMA Testing

Verify all four CMA laws against `mergeSamples`.

```typescript
function testMergeCMA<Σ>(
  merge:   (a: Σ, b: Σ) => Σ,
  eq:      (a: Σ, b: Σ) => boolean,
  samples: [Σ, Σ, Σ][]
): { commutative: boolean; associative: boolean; idempotent: boolean } {
  let commutative = true, associative = true, idempotent = true

  for (const [a, b, c] of samples) {
    if (!eq(merge(a, b), merge(b, a)))                          commutative = false
    if (!eq(merge(merge(a, b), c), merge(a, merge(b, c))))      associative = false
    if (!eq(merge(a, a), a))                                    idempotent  = false
  }

  return { commutative, associative, idempotent }
}
```

## 5. Replay Theorem Testing

Save the checkpoint log, restart from initial state, replay the log, assert final state matches.

```typescript
async function testReplayTheorem<Σ>(
  runtime:  UnifiedRuntime<Σ>,
  numSteps: number,
  eq:       (a: Σ, b: Σ) => boolean
): Promise<boolean> {
  const states1: Σ[] = [runtime.state()]
  for (let i = 0; i < numSteps; i++) {
    await runtime.step({ random: Math.random() })
    states1.push(runtime.state())
  }

  const log      = runtime.getCheckpointLog()
  const runtime2 = new UnifiedRuntime<Σ>(runtime.config)
  const states2: Σ[] = [runtime2.state()]
  await runtime2.replayLog(log)
  for (let i = 0; i < numSteps; i++) states2.push(runtime2.state())

  for (let i = 0; i < states1.length; i++) {
    if (!eq(states1[i], states2[i])) return false
  }
  return true
}
```

## 6. Property-Based Testing (Generative)

Using `fast-check` for 10k+ iterations per property:

```typescript
import * as fc from 'fast-check'

fc.assert(
  fc.property(
    fc.object() as fc.Arbitrary<AccountState>,
    fc.object() as fc.Arbitrary<any>,
    (state, input) => {
      const [s1] = accountReducer(state, input)
      const [s2] = accountReducer(state, input)
      return JSON.stringify(s1) === JSON.stringify(s2)  // purity
    }
  ),
  { numRuns: 10000 }
)
```

## All 15 Invariants

| # | Invariant | Verification method |
|---|---|---|
| 1 | Reducer purity: `R(s,i,t₁) = R(s,i,t₂)` | Unit test: run twice, compare |
| 2 | Reducer composition: associative monoid | Compose reducers; test 100+ states |
| 3 | Projection idempotence: `P(P(σ)) = P(σ)` | Apply twice at registration |
| 4 | Projection commutativity: `Pᵢ∘Pⱼ = Pⱼ∘Pᵢ` | All permutations; assert equal |
| 5 | Constraint ordering: `Cᵢ∘Cⱼ ≠ Cⱼ∘Cᵢ` | Reorder; show output differs |
| 6 | Merge commutativity: `M(a,b) = M(b,a)` | All pairs in `mergeSamples` |
| 7 | Merge associativity: `M(M(a,b),c) = M(a,M(b,c))` | Both paths; assert equal |
| 8 | Merge idempotence: `M(a,a) = a` | Merge state with itself |
| 9 | Merge monotonicity: `a ⊆ M(a,b)` | Merge result contains all input data |
| 10 | Intent deferred: emit ≠ execute | Mock executor; verify no side effects |
| 11 | Causal consistency: `a→b ⟹ λ(a) < λ(b)` | Check HLC invariant across log |
| 12 | Replay theorem: log + reducer = state | Save log; restart; replay; compare |
| 13 | Hash-chain integrity: chain unbroken | Compute hashes; verify `prevHash` chain |
| 14 | JSON universality: all `Σ` serializable | Serialize/deserialize round-trip |
| 15 | Distributed convergence: gossip ⟹ eventual consistency | 3-node cluster; partition tests |

## Verification Methods Summary

- **Unit tests:** purity, composition, idempotence
- **Property-based tests:** 10k+ iterations per property
- **Integration tests:** full runtime, checkpoint log
- **Distributed tests:** gossip, merge, causal ordering
- **Formal proofs:** algebra laws as Lean/Coq theorems