/**
 * Benchmark: Reducer Composition
 *
 * Spec refs:
 *  - Axiom 1: Universal Reducer R : (Σ, ι) → (Σ', I*)
 *  - Axiom 2: Composition is Monoid — associative, identity
 *  - Axiom 4: Intent as Free Monoid
 *  - Type 1:  Reducer<Σ, ι>
 *  - Type 2:  Intent / IntentList
 *  - Type 4:  ProjectionReducer (idempotent, commutative)
 *  - Type 5:  ConstraintReducer (non-commutative, ordered)
 *  - Law 1:   Reducer Monoid
 *  - Law 2:   Intent Monoid
 *  - Law 3:   Projection Idempotence
 *  - Law 4:   Projection Commutativity
 *  - Law 5:   Constraint Ordering Semantics
 *  - Law 10:  Dual Algebra Composition Φ = Cₙ∘⋯∘C₁∘Pₘ∘⋯∘P₁
 *  - Verification §1 (Purity), §2 (Composition), §3 (Idempotence)
 *  - Stdlib: compose, guard, increment, emit, withMetrics
 */

import { bench, describe } from "vitest";

// ── Core types (spec §CORE TYPES) ─────────────────────────────────────────────

type Intent =
  | { type: "SEND";     to: string; opcode: number; payload: unknown }
  | { type: "STORE";    key: string; value: unknown }
  | { type: "SCHEDULE"; reducerId: string; delayMs: number }
  | { type: "LOG";      level: "info" | "warn" | "error"; msg: string }
  | { type: "EMIT";     channel: string; payload: unknown }
  | { type: "LLM";      model: string; prompt: string; maxTokens: number };

type IntentList = readonly Intent[];

const emptyIntents: IntentList = Object.freeze([]);

function concat(a: IntentList, b: IntentList): IntentList {
  return Object.freeze([...a, ...b]);
}

type Reducer<Σ, ι = unknown> = (state: Σ, input: ι) => readonly [Σ, IntentList];

// ── AccountState (spec §Concrete Example) ────────────────────────────────────

type LWW<T> = { value: T; timestamp: number };

type AccountState = {
  balance:  number;
  reserved: number;
  status:   LWW<"active" | "frozen">;
  metadata: Set<string>;
};

function makeAccount(seed = 0): AccountState {
  return {
    balance:  500 + seed,
    reserved: 100 + seed,
    status:   { value: "active", timestamp: seed },
    metadata: new Set([`k${seed}`]),
  };
}

// ── Stdlib primitives (spec §Stdlib Reducer Library) ─────────────────────────

function identity<Σ>(state: Σ): readonly [Σ, IntentList] {
  return [state, emptyIntents];
}

function compose<Σ, ι>(...reducers: Reducer<Σ, ι>[]): Reducer<Σ, ι> {
  return (state, input) => {
    let next  = state;
    let intents: Intent[] = [];
    for (const r of reducers) {
      const [s, i] = r(next, input);
      next    = s;
      intents = [...intents, ...i];
    }
    return [next, Object.freeze(intents)];
  };
}

function emit<Σ>(intent: Intent): Reducer<Σ> {
  return (state) => [state, Object.freeze([intent])];
}

function guard<Σ, ι>(
  condition: (state: Σ, input: ι) => boolean,
  thenR: Reducer<Σ, ι>,
  elseR?: Reducer<Σ, ι>,
): Reducer<Σ, ι> {
  return (state, input) =>
    condition(state, input)
      ? thenR(state, input)
      : elseR ? elseR(state, input) : [state, emptyIntents];
}

// ── Projection reducers (spec §Type 4, Laws 3-4) ─────────────────────────────

/** P₁: if frozen, clear reserved (spec §Projections) */
const freezeClears: Reducer<AccountState> = (state) => [
  state.status.value === "frozen" ? { ...state, reserved: 0 } : state,
  emptyIntents,
];

/** P₂: floor balance to 0 (spec §Projections) */
const floorBalance: Reducer<AccountState> = (state) => [
  { ...state, balance: Math.max(0, state.balance) },
  emptyIntents,
];

// ── Constraint reducers (spec §Type 5, Law 5) ────────────────────────────────

/** C₀ (order 0): enforce reserve ceiling reserved ≤ balance (spec §Constraints) */
const enforceCeiling: Reducer<AccountState> = (state) => [
  { ...state, reserved: Math.min(state.reserved, state.balance) },
  emptyIntents,
];

/** C₁ (order 1): emit LOG intent if balance < 100 (spec §Constraints) */
const lowBalanceAlert: Reducer<AccountState> = (state) => {
  const intents: IntentList =
    state.balance < 100
      ? Object.freeze([{ type: "LOG" as const, level: "warn" as const, msg: `Low: ${state.balance}` }])
      : emptyIntents;
  return [state, intents];
};

// ── Canonical Φ (spec §Law 10) ────────────────────────────────────────────────
// Φ = C₁ ∘ C₀ ∘ P₂ ∘ P₁   (projections first, constraints after, strict order)

const Phi = compose(freezeClears, floorBalance, enforceCeiling, lowBalanceAlert);

// ── Purity test helper (spec §Verification §1) ────────────────────────────────

function assertPure<Σ, ι>(
  reducer: Reducer<Σ, ι>,
  states:  Σ[],
  inputs:  ι[],
): boolean {
  for (const s of states) {
    for (const i of inputs) {
      const [s1, i1] = reducer(s, i);
      const [s2, i2] = reducer(s, i);
      if (JSON.stringify(s1) !== JSON.stringify(s2)) return false;
      if (i1.length !== i2.length)                  return false;
    }
  }
  return true;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE_STATE  = makeAccount(0);
const FROZEN_STATE: AccountState = {
  ...makeAccount(1),
  status:   { value: "frozen", timestamp: 99 },
  reserved: 200,
};
const LOW_BAL_STATE: AccountState = { ...makeAccount(2), balance: 50 };

const TEST_STATES  = [BASE_STATE, FROZEN_STATE, LOW_BAL_STATE];
const TEST_INPUTS  = [undefined, {}, { action: "noop" }];

// Build chains of varying depth for composition depth benchmarks
function buildChain(depth: number): Reducer<AccountState> {
  const noOp: Reducer<AccountState> = (s) => [s, emptyIntents];
  return compose(...Array.from({ length: depth }, () => noOp));
}

// ── Benchmarks ────────────────────────────────────────────────────────────────

describe("reducer-composition: single reducer baseline", () => {

  bench("identity reducer — 10k calls", () => {
    for (let i = 0; i < 10_000; i++) identity(BASE_STATE);
  });

  bench("freezeClears projection — 10k calls", () => {
    for (let i = 0; i < 10_000; i++) freezeClears(BASE_STATE, undefined);
  });

  bench("enforceCeiling constraint — 10k calls", () => {
    for (let i = 0; i < 10_000; i++) enforceCeiling(BASE_STATE, undefined);
  });
});

describe("reducer-composition: compose() monoid (Laws 1-2)", () => {

  bench("compose 2 reducers — 10k calls", () => {
    const r = compose(freezeClears, floorBalance);
    for (let i = 0; i < 10_000; i++) r(BASE_STATE, undefined);
  });

  bench("compose 4 reducers (Φ) — 10k calls", () => {
    for (let i = 0; i < 10_000; i++) Phi(BASE_STATE, undefined);
  });

  bench("compose 4 reducers (Φ) — frozen state 10k calls", () => {
    for (let i = 0; i < 10_000; i++) Phi(FROZEN_STATE, undefined);
  });

  bench("compose 4 reducers (Φ) — low-balance alert path 10k calls", () => {
    for (let i = 0; i < 10_000; i++) Phi(LOW_BAL_STATE, undefined);
  });

  bench("compose — build chain depth 10", () => {
    buildChain(10);
  });

  bench("compose — build chain depth 100", () => {
    buildChain(100);
  });

  bench("compose chain depth 10 — 10k calls", () => {
    const r = buildChain(10);
    for (let i = 0; i < 10_000; i++) r(BASE_STATE, undefined);
  });

  bench("compose chain depth 100 — 10k calls", () => {
    const r = buildChain(100);
    for (let i = 0; i < 10_000; i++) r(BASE_STATE, undefined);
  });
});

describe("reducer-composition: projection idempotence (Law 3)", () => {

  bench("P(P(σ)) = P(σ) — freezeClears 10k states", () => {
    for (let i = 0; i < 10_000; i++) {
      const [s1] = freezeClears(FROZEN_STATE, undefined);
      freezeClears(s1, undefined);
    }
  });

  bench("P(P(σ)) = P(σ) — floorBalance 10k states", () => {
    for (let i = 0; i < 10_000; i++) {
      const s = { ...BASE_STATE, balance: -50 };
      const [s1] = floorBalance(s, undefined);
      floorBalance(s1, undefined);
    }
  });
});

describe("reducer-composition: projection commutativity (Law 4)", () => {

  bench("Pᵢ(Pⱼ(σ)) = Pⱼ(Pᵢ(σ)) — 10k states", () => {
    for (let i = 0; i < 10_000; i++) {
      const [ab] = compose(freezeClears, floorBalance)(FROZEN_STATE, undefined);
      const [ba] = compose(floorBalance, freezeClears)(FROZEN_STATE, undefined);
      JSON.stringify(ab) === JSON.stringify(ba);
    }
  });
});

describe("reducer-composition: constraint ordering (Law 5)", () => {

  bench("C₀ then C₁ (correct order) — 10k calls", () => {
    const correct = compose(enforceCeiling, lowBalanceAlert);
    for (let i = 0; i < 10_000; i++) correct(LOW_BAL_STATE, undefined);
  });

  bench("C₁ then C₀ (inverted order) — 10k calls", () => {
    // Spec §Order semantics: alert fires on wrong reserve value
    const inverted = compose(lowBalanceAlert, enforceCeiling);
    for (let i = 0; i < 10_000; i++) inverted(LOW_BAL_STATE, undefined);
  });
});

describe("reducer-composition: intent free monoid (Law 2)", () => {

  bench("concat — 10k two-list joins", () => {
    const a: IntentList = Object.freeze([{ type: "LOG", level: "info", msg: "a" }]);
    const b: IntentList = Object.freeze([{ type: "LOG", level: "warn", msg: "b" }]);
    for (let i = 0; i < 10_000; i++) concat(a, b);
  });

  bench("concat — fold 10 intent lists", () => {
    const lists: IntentList[] = Array.from(
      { length: 10 },
      (_, i) => Object.freeze([{ type: "LOG" as const, level: "info" as const, msg: `m${i}` }]),
    );
    for (let i = 0; i < 10_000; i++) lists.reduce(concat, emptyIntents);
  });

  bench("emit reducer — 10k calls", () => {
    const r = emit<AccountState>({ type: "LOG", level: "info", msg: "ping" });
    for (let i = 0; i < 10_000; i++) r(BASE_STATE, undefined);
  });
});

describe("reducer-composition: purity verification (Verification §1)", () => {

  bench("assertPure — 3 states × 3 inputs", () => {
    assertPure(Phi, TEST_STATES, TEST_INPUTS);
  });

  bench("assertPure — 30 states × 10 inputs", () => {
    const states = Array.from({ length: 30 }, (_, i) => makeAccount(i));
    assertPure(Phi, states, TEST_INPUTS);
  });
});

describe("reducer-composition: guard combinator", () => {

  const isFrozen = (s: AccountState) => s.status.value === "frozen";
  const guardedClear = guard(isFrozen, freezeClears, floorBalance);

  bench("guard — active path 10k", () => {
    for (let i = 0; i < 10_000; i++) guardedClear(BASE_STATE, undefined);
  });

  bench("guard — frozen path 10k", () => {
    for (let i = 0; i < 10_000; i++) guardedClear(FROZEN_STATE, undefined);
  });
});