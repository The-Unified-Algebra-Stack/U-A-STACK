/**
 * compose.ts
 *
 * Spec stdlib primitive — directly from the "Stdlib Reducer Library" section:
 *
 *   export function compose<Σ, ι>(...reducers: Reducer<Σ, ι>[]): Reducer<Σ, ι>
 *
 * Implements the Reducer Monoid (Spec Axiom 2 + Laws 1–2):
 *
 *   Axiom 2 — Composition is Monoid:
 *     (R₃ ∘ R₂) ∘ R₁ ≡ R₃ ∘ (R₂ ∘ R₁)   [associativity]
 *     R ∘ identity   ≡ R                   [right identity]
 *     identity ∘ R   ≡ R                   [left identity]
 *
 *   Law 2 — Intent Monoid:
 *     Intents from all reducers are concatenated (free monoid ++).
 *     concat(intents, []) ≡ intents         [right unit]
 *     concat([], intents) ≡ intents         [left unit]
 *
 *   Law 10 — Dual Algebra Composition:
 *     Φ = Cₙ ∘ ⋯ ∘ C₁ ∘ Pₘ ∘ ⋯ ∘ P₁
 *     (Projections run first; constraints run after in strict order.)
 *
 * The composed reducer feeds each reducer's output state as the next
 * reducer's input state, accumulating intents via concat.
 */

import type { Reducer, Intent, IntentList } from "../schema/schema-types";

// ---------------------------------------------------------------------------
// identity — the monoid unit for Reducers
// ---------------------------------------------------------------------------

/**
 * The identity reducer.
 * Spec: Unit: identity(σ) = [σ, []]
 *
 * Satisfies:
 *   compose(identity, R) ≡ R
 *   compose(R, identity) ≡ R
 */
export function identity<Σ, ι = unknown>(): Reducer<Σ, ι> {
  const empty: IntentList = Object.freeze([]);
  return (state: Σ): readonly [Σ, IntentList] => [state, empty];
}

// ---------------------------------------------------------------------------
// compose — variadic left-to-right monoid composition
// ---------------------------------------------------------------------------

/**
 * Composes an ordered sequence of reducers into a single reducer.
 *
 * Execution is left-to-right: the first reducer in the list runs first.
 * This matches the spec's Φ pipeline:
 *   Φ = Cₙ ∘ ⋯ ∘ C₁ ∘ Pₘ ∘ ⋯ ∘ P₁
 * which, when expressed as compose(...), reads:
 *   compose(P₁, …, Pₘ, C₁, …, Cₙ)
 *
 * Intent accumulation (Spec Law 2):
 *   All intents emitted by each reducer are concatenated in order.
 *   The resulting list is the free monoid product I₁ ++ I₂ ++ … ++ Iₙ.
 *
 * @example
 * const phi = compose(
 *   freezeClears,   // P₁ — projection
 *   floorBalance,   // P₂ — projection
 *   enforceCeiling, // C₀ — constraint (order 0)
 *   lowBalanceAlert // C₁ — constraint (order 1)
 * );
 */
export function compose<Σ, ι = unknown>(
  ...reducers: Reducer<Σ, ι>[]
): Reducer<Σ, ι> {
  if (reducers.length === 0) return identity<Σ, ι>();

  return (state: Σ, input: ι): readonly [Σ, IntentList] => {
    let currentState = state;
    const allIntents: Intent[] = [];

    for (const reducer of reducers) {
      const [nextState, intents] = reducer(currentState, input);
      currentState = nextState;
      // Free monoid concat: allIntents ++ intents
      for (const intent of intents) {
        allIntents.push(intent);
      }
    }

    return [currentState, Object.freeze(allIntents)];
  };
}

// ---------------------------------------------------------------------------
// composeTwo — binary composition (the monoid operation itself)
// Used internally and exposed for completeness / law verification.
// ---------------------------------------------------------------------------

/**
 * Binary composition: R₂ ∘ R₁ (R₁ runs first, then R₂).
 *
 * Satisfies associativity:
 *   composeTwo(composeTwo(R₃, R₂), R₁) ≡ composeTwo(R₃, composeTwo(R₂, R₁))
 */
export function composeTwo<Σ, ι = unknown>(
  first: Reducer<Σ, ι>,
  second: Reducer<Σ, ι>
): Reducer<Σ, ι> {
  return (state: Σ, input: ι): readonly [Σ, IntentList] => {
    const [s1, i1] = first(state, input);
    const [s2, i2] = second(s1, input);
    // Free monoid concat
    return [s2, Object.freeze([...i1, ...i2])];
  };
}

// ---------------------------------------------------------------------------
// buildPhi — constructs the canonical Φ reducer from separated lists.
// Enforces the dual-algebra ordering rule from Spec Law 10.
// ---------------------------------------------------------------------------

/**
 * Builds the canonical Φ = Cₙ ∘ ⋯ ∘ C₁ ∘ Pₘ ∘ ⋯ ∘ P₁ reducer.
 *
 * Projections are applied first (any order — they commute, Spec Law 4).
 * Constraints are applied after, sorted by ascending `order` field
 * (Spec Law 5: Cᵢ ∘ Cⱼ ≠ Cⱼ ∘ Cᵢ — order is semantic).
 *
 * @param projections - Array of { fn: Reducer<Σ, ι> } projection entries.
 * @param constraints - Array of { order: number; fn: Reducer<Σ, ι> } entries.
 */
export function buildPhi<Σ, ι = unknown>(
  projections: Array<{ fn: Reducer<Σ, ι> }>,
  constraints: Array<{ order: number; fn: Reducer<Σ, ι> }>
): Reducer<Σ, ι> {
  // Constraints must run in strict ascending order (Law 5 / Law 10)
  const sortedConstraints = [...constraints].sort((a, b) => a.order - b.order);

  return compose(
    ...projections.map((p) => p.fn),
    ...sortedConstraints.map((c) => c.fn)
  );
}