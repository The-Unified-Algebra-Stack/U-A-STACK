# Unified Algebra Stack Cleanup Checklist

## Phase 1 — Repository Hygiene (Highest ROI)

### Documentation

* [ x] Fix corrupted `README.md`
* [ x] Add:

  * [x ] project overview
  * [ x] architecture diagram
  * [ x] quick start
  * [x ] example runtime flow
  * [ ] distributed sync explanation
  * [ ] verification philosophy
* [ ] Create `/docs/getting-started.md`
* [ ] Create `/docs/runtime-model.md`
* [ ] Create `/docs/distributed-model.md`
* [ ] Create `/docs/replay-guarantees.md`
* [ ] Add sequence diagrams for:

  * [ ] reducer execution
  * [ ] intent emission
  * [ ] gossip sync
  * [ ] replay reconstruction

---

## Phase 2 — Structural Consistency

### Naming Cleanup

* [ ] Standardize all `types` filenames
* [ ] Remove duplicate conceptual names
* [ ] Enforce one naming convention:

  * [ ] `*-types.ts`
  * OR
  * [ ] `types.ts`
* [ ] Rename ambiguous modules
* [ ] Remove dead experimental files
* [ ] Separate:

  * [ ] runtime
  * [ ] distributed
  * [ ] verification
  * [ ] wasm
  * [ ] examples

---

## Phase 3 — Type Safety

### TypeScript Hardening

* [ ] Enable strictest TypeScript settings
* [ ] Enable:

  * [ ] `noImplicitAny`
  * [ ] `exactOptionalPropertyTypes`
  * [ ] `noUncheckedIndexedAccess`
  * [ ] `noImplicitOverride`
* [ ] Eliminate all `any`
* [ ] Replace loose records with branded types
* [ ] Add opaque IDs:

  * [ ] `NodeId`
  * [ ] `EventId`
  * [ ] `SnapshotHash`
* [ ] Add compile-time purity constraints where possible

---

## Phase 4 — Runtime Integrity

### Determinism

* [ ] Centralize serialization
* [ ] Enforce canonical JSON ordering
* [ ] Add deterministic hashing utilities
* [ ] Remove hidden nondeterminism:

  * [ ] `Date.now()`
  * [ ] random UUIDs
  * [ ] mutable globals
* [ ] Introduce deterministic clock abstraction
* [ ] Introduce deterministic RNG abstraction

---

## Phase 5 — Replay Guarantees

### Replay Validation

* [ ] Add replay equivalence tests
* [ ] Verify:

  * [ ] same input log
  * [ ] same hash lineage
  * [ ] same final state
* [ ] Add snapshot compatibility tests
* [ ] Add reducer version migration system
* [ ] Add schema evolution strategy
* [ ] Add deterministic binary serialization option

---

## Phase 6 — Distributed System Hardening

### Network Reality Testing

* [ ] Simulate:

  * [ ] partitions
  * [ ] delayed packets
  * [ ] duplicate messages
  * [ ] out-of-order delivery
  * [ ] Byzantine-ish malformed payloads
* [ ] Add anti-entropy sync
* [ ] Add bounded gossip fanout
* [ ] Add peer expiration
* [ ] Add vector clock conflict inspection
* [ ] Benchmark convergence time

---

## Phase 7 — CRDT Formalization

### Merge Algebra

* [ ] Expand CMA law tests
* [ ] Add fuzz/property generators
* [ ] Add probabilistic convergence testing
* [ ] Add large-scale merge simulation
* [ ] Document CRDT guarantees precisely:

  * [ ] strong eventual consistency
  * [ ] causal consistency
  * [ ] replay assumptions

---

## Phase 8 — Effect System Cleanup

### Intent / Effect Architecture

* [ ] Separate:

  * [ ] intent schema
  * [ ] effect interpreter
  * [ ] transport layer
* [ ] Add retry semantics
* [ ] Add idempotent effect execution
* [ ] Add effect journaling
* [ ] Add compensating transaction model
* [ ] Add timeout/cancellation semantics

---

## Phase 9 — WASM Isolation

### Sandbox Security

* [ ] Add capability permissions
* [ ] Add memory quotas
* [ ] Add execution time limits
* [ ] Add deterministic WASM mode
* [ ] Add host-call audit logging
* [ ] Add sandbox escape tests

---

## Phase 10 — Performance

### Benchmarking

* [ ] Add benchmark dashboard
* [ ] Benchmark:

  * [ ] replay speed
  * [ ] merge speed
  * [ ] snapshot generation
  * [ ] sync convergence
  * [ ] reducer throughput
* [ ] Add flamegraph profiling
* [ ] Add memory profiling
* [ ] Add persistent storage benchmarks

---

# Architecture Cleanup

## Dependency Direction

* [ ] Enforce one-way dependency graph:

  ```text
  algebra
    ↓
  runtime
    ↓
  distributed
    ↓
  effects
    ↓
  adapters
  ```

* [ ] Remove cyclic imports

* [ ] Add dependency graph checker

---

# Developer Experience

## Usability

* [ ] Add single-command startup
* [ ] Add example apps
* [ ] Add live visualizer
* [ ] Add event timeline inspector
* [ ] Add replay debugger
* [ ] Add deterministic diff viewer
* [ ] Add distributed topology viewer

---

# Verification Expansion

## Formal Methods Direction

* [ ] Add state invariant framework
* [ ] Add temporal assertions
* [ ] Add model-check style simulations
* [ ] Add reducer purity verifier
* [ ] Add algebra law auto-checking
* [ ] Add deterministic replay certification tests

---

# Production Readiness

## Operational Layer

* [ ] Structured logging
* [ ] Metrics
* [ ] Tracing
* [ ] Health checks
* [ ] Snapshot persistence
* [ ] Crash recovery
* [ ] Rolling upgrade compatibility
* [ ] Version negotiation between nodes

---

# Most Important Immediate Wins

If prioritizing highest impact:

## Top 10

* [ ] Fix README
* [ ] Standardize naming
* [ ] Eliminate type inconsistencies
* [ ] Centralize deterministic serialization
* [ ] Add replay equivalence tests
* [ ] Add partition simulation tests
* [ ] Add benchmark suite output
* [ ] Build one real demo application
* [ ] Add architecture diagrams
* [ ] Add operational failure semantics

---

# What Would Raise It From A- → A+/Research Grade

## You need:

* mathematically provable replay guarantees
* hardened distributed fault testing
* deterministic serialization proofs
* large-scale convergence benchmarks
* one undeniable real-world workload demo

At that point it stops looking like:

```text
interesting architecture
```

and starts looking like:

```text
new runtime category
```
