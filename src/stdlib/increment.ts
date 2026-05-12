/**
 * increment.ts
 *
 * Spec stdlib primitive — directly from the "Stdlib Reducer Library" section:
 *
 *   export function increment<Σ extends Record<string, number>>(
 *     field: keyof Σ,
 *     amount: number = 1
 *   ): Reducer<Σ>
 *
 * Algebraic properties:
 *   - Pure: no IO, no clock, no randomness (Spec Type 1 / Law 1)
 *   - Total: defined for all (state, input) pairs
 *   - Deterministic: same (state, amount) → same output always
 *   - Emits no intents (I* = [])
 *
 * Composable:  compose(increment("balance", 100), increment("balance", -50))
 *              is itself a valid Reducer<Σ> (Spec Axiom 2).
 */

import type { Reducer, IntentList } from "../schema/schema-types";

const EMPTY_INTENTS: IntentList = Object.freeze([]);

/**
 * Returns a reducer that increments a single numeric field in the state.
 *
 * @param field  - Key of the numeric field to increment.
 * @param amount - Amount to add (default 1; use negative to decrement).
 *
 * @example
 * const addFunds = increment<AccountState>("balance", 50);
 * const [next] = addFunds({ balance: 100, reserved: 0 }, undefined);
 * // next.balance === 150
 */
export function increment<Σ extends Record<string, number>>(
  field: keyof Σ,
  amount: number = 1
): Reducer<Σ> {
  return (state: Σ): readonly [Σ, IntentList] => [
    { ...state, [field]: (state[field] as number) + amount },
    EMPTY_INTENTS,
  ];
}

/**
 * Returns a reducer that sets a numeric field to a fixed absolute value.
 * Useful as a projection primitive: set("reserved", 0) clears reserved funds.
 *
 * Idempotent when the value is constant:
 *   set("reserved", 0)(set("reserved", 0)(σ)) === set("reserved", 0)(σ) ∀σ
 */
export function set<Σ extends Record<string, unknown>>(
  field: keyof Σ,
  value: Σ[keyof Σ]
): Reducer<Σ> {
  return (state: Σ): readonly [Σ, IntentList] => [
    { ...state, [field]: value },
    EMPTY_INTENTS,
  ];
}