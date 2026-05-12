/**
 * Benchmark: Merge Performance
 *
 * Spec refs:
 *  - Type 6: MergeAlgebra<Σ> (commutative, monotone)
 *  - Law 6:  Merge Commutativity — M(a,b) = M(b,a)
 *  - Law 7:  Merge Associativity — M(M(a,b),c) = M(a,M(b,c))
 *  - Law 8:  Merge Idempotence  — M(a,a) = a
 *  - Law 9:  Merge Monotonicity — a ⊆ M(a,b)
 *  - Concrete Example: mergeAccount field-typed composition
 *    (EscrowCounter max-wins, LWWRegister, ORSet)
 */

import { bench, describe } from "vitest";

// ── Field-typed CRDT primitives (spec §Type 6, Concrete Example) ─────────────

/** EscrowCounter: max-wins (spec §AccountState) */
function mergeEscrow(a: number, b: number): number {
  return Math.max(a, b);
}

/** LWWRegister: last-write-wins by timestamp */
type LWW<T> = { value: T; timestamp: number };
function mergeLWW<T>(a: LWW<T>, b: LWW<T>): LWW<T> {
  return a.timestamp >= b.timestamp ? a : b;
}

/** ORSet: observed-remove set union */
function mergeORSet(a: Set<string>, b: Set<string>): Set<string> {
  return new Set([...a, ...b]);
}

// ── AccountState (spec §Concrete Example) ────────────────────────────────────

type AccountState = {
  balance:  number;
  reserved: number;
  status:   LWW<"active" | "frozen">;
  metadata: Set<string>;
};

/** Merge function from spec §Concrete Example — field-typed composition */
function mergeAccount(a: AccountState, b: AccountState): AccountState {
  return {
    balance:  mergeEscrow(a.balance,  b.balance),
    reserved: mergeEscrow(a.reserved, b.reserved),
    status:   mergeLWW(a.status, b.status),
    metadata: mergeORSet(a.metadata, b.metadata),
  };
}

// ── CMA law verifier (spec §Type 6, Verification §4) ─────────────────────────

type MergeAlgebra<Σ> = {
  merge: (a: Σ, b: Σ) => Σ;
  eq:    (a: Σ, b: Σ) => boolean;
};

function testMergeCMA<Σ>(
  algebra: MergeAlgebra<Σ>,
  samples: [Σ, Σ, Σ][],
): { commutative: boolean; associative: boolean; idempotent: boolean } {
  let commutative = true, associative = true, idempotent = true;
  for (const [a, b, c] of samples) {
    if (!algebra.eq(algebra.merge(a, b), algebra.merge(b, a)))           commutative = false;
    if (!algebra.eq(algebra.merge(algebra.merge(a, b), c),
                    algebra.merge(a, algebra.merge(b, c))))               associative = false;
    if (!algebra.eq(algebra.merge(a, a), a))                             idempotent  = false;
  }
  return { commutative, associative, idempotent };
}

// ── Equality helpers ──────────────────────────────────────────────────────────

function accountEq(a: AccountState, b: AccountState): boolean {
  return (
    a.balance  === b.balance  &&
    a.reserved === b.reserved &&
    a.status.value     === b.status.value &&
    a.status.timestamp === b.status.timestamp &&
    a.metadata.size === b.metadata.size &&
    [...a.metadata].every(k => b.metadata.has(k))
  );
}

const accountAlgebra: MergeAlgebra<AccountState> = {
  merge: mergeAccount,
  eq:    accountEq,
};

// ── Fixture factories ─────────────────────────────────────────────────────────

function makeAccount(seed: number): AccountState {
  return {
    balance:  100 + seed * 37,
    reserved: 10  + seed * 7,
    status:   { value: seed % 5 === 0 ? "frozen" : "active", timestamp: seed },
    metadata: new Set([`tag-${seed}`, `region-${seed % 4}`]),
  };
}

function makeSamples(n: number): [AccountState, AccountState, AccountState][] {
  return Array.from({ length: n }, (_, i) => [
    makeAccount(i),
    makeAccount(i + 1),
    makeAccount(i + 2),
  ]);
}

// ── Benchmarks ────────────────────────────────────────────────────────────────

describe("merge-performance: single field merges", () => {

  bench("EscrowCounter (max-wins) — 10k merges", () => {
    for (let i = 0; i < 10_000; i++) mergeEscrow(i, i + 1);
  });

  bench("LWWRegister — 10k merges", () => {
    for (let i = 0; i < 10_000; i++) {
      mergeLWW<"active" | "frozen">(
        { value: "active", timestamp: i },
        { value: "frozen", timestamp: i + 1 },
      );
    }
  });

  bench("ORSet — 10k merges (10 elements each)", () => {
    const a = new Set(Array.from({ length: 10 }, (_, i) => `a-${i}`));
    const b = new Set(Array.from({ length: 10 }, (_, i) => `b-${i}`));
    for (let i = 0; i < 10_000; i++) mergeORSet(a, b);
  });

  bench("ORSet — 10k merges (1k elements each)", () => {
    const a = new Set(Array.from({ length: 1000 }, (_, i) => `a-${i}`));
    const b = new Set(Array.from({ length: 1000 }, (_, i) => `b-${i}`));
    for (let i = 0; i < 10_000; i++) mergeORSet(a, b);
  });
});

describe("merge-performance: AccountState field-typed composition", () => {

  const s1 = makeAccount(1);
  const s2 = makeAccount(2);
  const s3 = makeAccount(3);

  bench("mergeAccount — single merge", () => {
    mergeAccount(s1, s2);
  });

  bench("mergeAccount — 10k merges", () => {
    for (let i = 0; i < 10_000; i++) mergeAccount(s1, s2);
  });

  bench("mergeAccount — associativity path: M(M(a,b),c)", () => {
    for (let i = 0; i < 10_000; i++) mergeAccount(mergeAccount(s1, s2), s3);
  });

  bench("mergeAccount — associativity path: M(a,M(b,c))", () => {
    for (let i = 0; i < 10_000; i++) mergeAccount(s1, mergeAccount(s2, s3));
  });
});

describe("merge-performance: CMA law verification (spec §Type 6)", () => {

  bench("testMergeCMA — 10 samples (spec baseline)", () => {
    testMergeCMA(accountAlgebra, makeSamples(10));
  });

  bench("testMergeCMA — 100 samples", () => {
    testMergeCMA(accountAlgebra, makeSamples(100));
  });

  bench("testMergeCMA — 1k samples", () => {
    testMergeCMA(accountAlgebra, makeSamples(1_000));
  });
});

describe("merge-performance: monotonicity check (Law 9)", () => {

  /** a ⊆ M(a,b): merged balance ≥ a.balance, merged metadata ⊇ a.metadata */
  function checkMonotonicity(a: AccountState, b: AccountState): boolean {
    const m = mergeAccount(a, b);
    const balanceGrows  = m.balance  >= a.balance;
    const reserveGrows  = m.reserved >= a.reserved;
    const metadataGrows = [...a.metadata].every(k => m.metadata.has(k));
    return balanceGrows && reserveGrows && metadataGrows;
  }

  bench("monotonicity check — 10k pairs", () => {
    for (let i = 0; i < 10_000; i++) {
      checkMonotonicity(makeAccount(i), makeAccount(i + 1));
    }
  });
});

describe("merge-performance: large state cardinality", () => {

  function makeAccountWithNTags(n: number, seed: number): AccountState {
    return {
      balance:  500 + seed,
      reserved: 100,
      status:   { value: "active", timestamp: seed },
      metadata: new Set(Array.from({ length: n }, (_, i) => `tag-${seed}-${i}`)),
    };
  }

  bench("mergeAccount — ORSet 100 elements", () => {
    const a = makeAccountWithNTags(100, 1);
    const b = makeAccountWithNTags(100, 2);
    mergeAccount(a, b);
  });

  bench("mergeAccount — ORSet 1k elements", () => {
    const a = makeAccountWithNTags(1_000, 1);
    const b = makeAccountWithNTags(1_000, 2);
    mergeAccount(a, b);
  });

  bench("mergeAccount — ORSet 10k elements", () => {
    const a = makeAccountWithNTags(10_000, 1);
    const b = makeAccountWithNTags(10_000, 2);
    mergeAccount(a, b);
  });
});