/**
 * emit.ts
 *
 * Spec stdlib primitive — directly from the "Stdlib Reducer Library" section:
 *
 *   export function emit<Σ>(intent: Intent): Reducer<Σ>
 *
 * Axiom 4 — Intent as Free Monoid:
 *   Side effects are first-class values, not operations.
 *   Reducers can only emit intents, never interpret them.
 *   Emission ≠ execution; execution happens in Layer 4.
 *
 * Algebraic properties:
 *   - State is returned unchanged: Σ' = Σ
 *   - I* = [intent]  (single-element free monoid)
 *   - Pure, total, deterministic
 *   - Composable with any other Reducer via compose()
 *
 * Law 14 (Intent Deferred Execution):
 *   The intent is returned in I* but NOT executed within the reducer.
 */

import type { Reducer, Intent, IntentList } from "../schema/schema-types";

/**
 * Returns a reducer that leaves state unchanged and emits a single intent.
 *
 * @example
 * const alertLowBalance = emit<AccountState>({
 *   type: "LOG",
 *   level: "warn",
 *   msg: "Balance below threshold",
 * });
 * const [nextState, intents] = alertLowBalance(state, undefined);
 * // nextState === state (identity on Σ)
 * // intents  === [{ type: "LOG", ... }]
 */
export function emit<Σ>(intent: Intent): Reducer<Σ> {
  // Freeze the intent list at construction time — the same list object is
  // returned on every call, which is safe because reducers are pure and the
  // list is immutable (free monoid unit: concat([], [i]) = [i]).
  const intents: IntentList = Object.freeze([intent]);
  return (state: Σ): readonly [Σ, IntentList] => [state, intents];
}

/**
 * Returns a reducer that emits multiple intents in one shot.
 * Equivalent to composing N emit() calls but avoids the overhead.
 *
 * Concat of n single-element lists equals an n-element list
 * (free monoid associativity, Spec Law 2).
 */
export function emitAll<Σ>(intents: readonly Intent[]): Reducer<Σ> {
  const frozen: IntentList = Object.freeze([...intents]);
  return (state: Σ): readonly [Σ, IntentList] => [state, frozen];
}

/**
 * Returns a reducer that conditionally emits an intent based on the
 * current state.  State is never mutated.
 *
 * Useful inside constraints where the decision to alert depends on the
 * *post-projection* state (Spec: C₁ — low-balance alert example).
 *
 * @example
 * const lowBalanceAlert = emitIf<AccountState>(
 *   (s) => s.balance < 100,
 *   { type: "LOG", level: "warn", msg: "Low balance" }
 * );
 */
export function emitIf<Σ>(
  predicate: (state: Σ) => boolean,
  intent: Intent
): Reducer<Σ> {
  const intents: IntentList   = Object.freeze([intent]);
  const noIntents: IntentList = Object.freeze([]);
  return (state: Σ): readonly [Σ, IntentList] => [
    state,
    predicate(state) ? intents : noIntents,
  ];
}