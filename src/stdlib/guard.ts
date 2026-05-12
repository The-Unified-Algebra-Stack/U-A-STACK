/**
 * guard.ts
 *
 * Spec stdlib primitive — directly from the "Stdlib Reducer Library" section:
 *
 *   export function guard<Σ, ι>(
 *     condition: (state: Σ, input: ι) => boolean,
 *     then_reducer: Reducer<Σ, ι>,
 *     else_reducer?: Reducer<Σ, ι>
 *   ): Reducer<Σ, ι>
 *
 * Algebraic properties:
 *   - Pure: condition is a pure predicate (no IO, no side effects)
 *   - Total: always returns [Σ, IntentList] — else branch defaults to [state, []]
 *   - Deterministic: same (state, input) → same branch every time
 *   - Composable: guard(…) is itself a Reducer<Σ, ι>
 *
 * Use as a projection when the condition makes both branches idempotent,
 * or as a constraint when branching is order-dependent.
 */

import type { Reducer, IntentList } from "../schema/schema-types";

const EMPTY_INTENTS: IntentList = Object.freeze([]);

/**
 * Branches on a pure predicate over (state, input).
 * If no else_reducer is provided, the else branch is the identity reducer
 * (returns state unchanged with no intents).
 *
 * @example
 * // Projection: clamp balance to 0 only if negative
 * const floorBalance = guard<AccountState, unknown>(
 *   (s) => s.balance < 0,
 *   set("balance", 0)
 * );
 *
 * // Constraint: cascade freeze → clear reserved
 * const freezeCascade = guard<AccountState, unknown>(
 *   (s) => s.status.value === "frozen",
 *   set("reserved", 0)
 * );
 */
export function guard<Σ, ι = unknown>(
  condition: (state: Σ, input: ι) => boolean,
  thenReducer: Reducer<Σ, ι>,
  elseReducer?: Reducer<Σ, ι>
): Reducer<Σ, ι> {
  return (state: Σ, input: ι): readonly [Σ, IntentList] => {
    if (condition(state, input)) {
      return thenReducer(state, input);
    }
    return elseReducer
      ? elseReducer(state, input)
      : [state, EMPTY_INTENTS];
  };
}

/**
 * `guardState` — convenience variant whose predicate only inspects state,
 * ignoring input.  Covers the common case where branching depends entirely
 * on current Σ (e.g. "if frozen", "if balance < threshold").
 */
export function guardState<Σ, ι = unknown>(
  condition: (state: Σ) => boolean,
  thenReducer: Reducer<Σ, ι>,
  elseReducer?: Reducer<Σ, ι>
): Reducer<Σ, ι> {
  return guard(
    (state: Σ, _input: ι) => condition(state),
    thenReducer,
    elseReducer
  );
}

/**
 * `guardInput` — convenience variant whose predicate only inspects input,
 * ignoring current state.  Useful for input-type dispatch.
 *
 * @example
 * const onDeposit = guardInput<AccountState, { action: string; amount: number }>(
 *   (i) => i.action === "deposit",
 *   increment("balance", /* amount resolved at runtime *\/)
 * );
 */
export function guardInput<Σ, ι = unknown>(
  condition: (input: ι) => boolean,
  thenReducer: Reducer<Σ, ι>,
  elseReducer?: Reducer<Σ, ι>
): Reducer<Σ, ι> {
  return guard(
    (_state: Σ, input: ι) => condition(input),
    thenReducer,
    elseReducer
  );
}