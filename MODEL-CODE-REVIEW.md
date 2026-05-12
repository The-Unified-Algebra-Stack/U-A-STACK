# Unified Algebra Stack — Model Code Structural Review

Author: James Chapman <xhecarpenxer@gmail.com>
Contact: uastack@gmail.com

---

## Summary

The codebase is well-structured overall and faithfully implements the spec's
layer model. The notes below flag specific structural mismatches and
recommendations to bring everything into full alignment.

---

## What Fits the Structure Well

**Layer separation is clean.**
Layer 1 (checkpoint/immutable log), Layer 3 (intent stream), and Layer 4
(effect executor) all have clear boundaries with no cross-layer leakage. Each
has its own `types.ts` and `index.ts` with well-scoped exports.

**`src/runtime/types.ts` is canonical.**
The nine spec Core Types (Reducer, ProjectionReducer, ConstraintReducer,
MergeAlgebra, HLC, CausalOrder, CheckpointEvent, Substrate, RuntimeConfig) are
all present, correctly typed, and annotated with their spec law obligations.
This is the right single source of truth.

**Execution loop is spec-faithful.**
`src/runtime/execution-loop.ts` correctly implements the 5-phase deterministic
loop: input acquisition → reduction (Φ) → checkpoint creation → intent
execution → state commit. The HLC tick is correctly placed *outside* Φ, and
SHA256 hashing is done with the `hash` field removed — both required by spec
Laws 12 and 13.

**CMA verification runs at boot.**
`src/runtime/substrate.ts` verifies Commutativity (Law 6), Associativity
(Law 7), and Idempotence (Law 8) against provided sample triples at
construction time. This is the correct approach.

**Intent list is a proper free monoid.**
`src/layer3-intent/intent-list.ts` exposes `empty`, `singleton`, `concat`, and
`concatAll` — the minimal correct interface for a free monoid. Reducers only
emit; Layer 4 only executes. The boundary is respected everywhere reviewed.

---

## Structural Issues and Recommendations

### 1. `packages/runtime/reducers/types.ts` — Reducer signature mismatch

**Problem:**
```typescript
// packages/runtime/reducers/types.ts
export interface Reducer<TState extends Json, TEvent extends Json> {
  reduce(state: TState, event: TEvent, context: ReducerContext): TState
}
```
This differs from the canonical Reducer in `src/runtime/types.ts`:
```typescript
// src/runtime/types.ts (canonical, spec-correct)
export type Reducer<Σ, ι = unknown> =
  (state: Σ, input: ι) => readonly [Σ, IntentList]
```

Two problems:
- The `packages/` version returns `TState` alone; the canonical version returns
  `readonly [Σ, IntentList]`. A reducer that cannot emit intents cannot express
  side-effect intent — this breaks the Layer 3 contract.
- The `ReducerContext` with a `timestamp` field violates the purity law:
  reducers must not receive clock values (Spec Law 1: deterministic, no clock,
  no IO). The HLC lives in the execution loop only.

**Fix:** Remove or rewrite `packages/runtime/reducers/types.ts` to re-export
from `src/runtime/types.ts`, or delete it if `packages/runtime` is an
exploratory scratch area not yet wired into the main runtime.

---

### 2. `packages/runtime/determinism/clock.ts` — Should not exist near reducers

**Problem:**
`ReplayClock` lives alongside reducer types in `packages/runtime/`. A clock
near reducer code creates the risk that a reducer might consume it — violating
the purity law. The HLC tick belongs exclusively in the execution loop.

**Fix:** Move clock utilities to `src/runtime/execution-loop.ts` or a
dedicated `src/runtime/hlc.ts`. Delete `packages/runtime/determinism/` or
gate it clearly as "loop internals only, never passed to Φ."

---

### 3. `src/layer1-checkpoint/index.ts` exports `layer1-types` — file missing

**Problem:**
```typescript
export * from "./layer1-types"  // referenced in index.ts
export * from "./hlc"           // referenced in index.ts
```
Neither `layer1-types.ts` nor `hlc.ts` appears in the source tree. The actual
types file is `types.ts`, not `layer1-types.ts`. This will cause a compile
error.

**Fix:** Update `src/layer1-checkpoint/index.ts` to:
```typescript
export * from "./types"          // not "./layer1-types"
// Remove "./hlc" export until hlc.ts is created, or create it
```
Or create `layer1-types.ts` as a re-export shim:
```typescript
// src/layer1-checkpoint/layer1-types.ts
export * from "./types"
```

---

### 4. `packages/runtime/replay/replay-equivalence.test.ts` — trivial test

**Observation (not a blocker):**
The replay equivalence test only checks that two identical in-memory objects
hash identically. It does not test that replaying an event log through Φ
produces the same state sequence — which is the actual Spec Law 12 (Replay
Theorem). This test passes vacuously.

**Recommendation:** Replace or augment with a full replay integration test in
`tests/integration/` that:
1. Runs the execution loop for N steps.
2. Replays the recorded log.
3. Asserts `replayLog(log, phi)` produces the same `after` states as the
   original run.
The `replayLog` function already exists in `src/runtime/execution-loop.ts` —
it just needs to be exercised.

---

## File-Level Checklist

| File | Status |
|------|--------|
| `src/runtime/types.ts` | ✅ Canonical, spec-correct |
| `src/runtime/substrate.ts` | ✅ CMA verification correct |
| `src/runtime/execution-loop.ts` | ✅ Spec-faithful loop |
| `src/runtime/unified-runtime.ts` | ✅ Clean entry point |
| `src/layer1-checkpoint/types.ts` | ✅ Good |
| `src/layer1-checkpoint/index.ts` | ⚠️ Exports missing files (see Issue 3) |
| `src/layer3-intent/types.ts` | ✅ Correct free monoid |
| `src/layer4-effects/types.ts` | ✅ Effect boundary respected |
| `packages/runtime/reducers/types.ts` | ❌ Mismatched Reducer signature (see Issue 1) |
| `packages/runtime/determinism/clock.ts` | ⚠️ Clock near reducer code (see Issue 2) |
| `packages/runtime/replay/replay-equivalence.test.ts` | ⚠️ Trivial test (see Issue 4) |
| `packages/runtime/serialization/canonical-json.ts` | ✅ Correct key-sorted canonicalization |
| `packages/runtime/serialization/hash.ts` | ✅ |

---

## Priority Order for Fixes

1. **Critical** — Fix `packages/runtime/reducers/types.ts` Reducer signature
   (breaks Layer 3 contract, violates purity law).
2. **Critical** — Fix `src/layer1-checkpoint/index.ts` missing file exports
   (compile error).
3. **Recommended** — Relocate clock away from reducer space.
4. **Nice to have** — Strengthen replay equivalence test.
