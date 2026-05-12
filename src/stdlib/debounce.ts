/**
 * debounce.ts
 *
 * Stdlib reducer combinator — built on the SCHEDULE intent type.
 *
 * Spec Type 2 — Intent:
 *   { type: "SCHEDULE"; reducerId: string; delayMs: number }
 *
 * Spec Layer 4 — Effect Executor:
 *   schedule: (reducerId: string, delayMs: number) => void
 *   "Never modifies state; only executes intents."
 *
 * Debounce in the algebra stack works through deferred scheduling:
 *   1. The reducer marks state as "pending" and emits a SCHEDULE intent.
 *   2. Layer 4 executes SCHEDULE by calling setTimeout (or equivalent).
 *   3. If the same input arrives before the delay expires, state is reset
 *      and a new SCHEDULE intent is emitted (cancelling the previous one
 *      by overwriting the pending flag).
 *   4. When the scheduled reducer fires, it checks the pending flag and
 *      only proceeds if the debounce window has passed.
 *
 * This approach keeps the reducer pure (Law 1) and deterministic (no timers
 * inside Φ), delegating all temporal side-effects to Layer 4.
 *
 * The SCHEDULE intent is deferred, not executed inside the reducer (Law 14).
 *
 * NOTE: debounce state must be tracked inside Σ. The helpers below require
 * the state type to include a `_debounce` sub-object. Use `withDebounceState`
 * to add that field to your existing state type.
 */

import type { Reducer, Intent, IntentList } from "../schema/schema-types";

// ---------------------------------------------------------------------------
// DebounceState — slice of Σ required by debounce reducers
// ---------------------------------------------------------------------------

export interface DebounceSlice {
  /** Monotonically incrementing counter; each new call increments this. */
  _debounceSeq: number;
}

// ---------------------------------------------------------------------------
// debounce — wraps a reducer with SCHEDULE-based debouncing
// ---------------------------------------------------------------------------

/**
 * Returns a debounced reducer.
 *
 * On every invocation:
 *   1. Increments `_debounceSeq` in state (marks this as the "current" call).
 *   2. Emits a SCHEDULE intent: `{ type: "SCHEDULE", reducerId, delayMs }`.
 *   3. Does NOT apply the inner reducer yet.
 *
 * The scheduled reducer (identified by `scheduledReducerId`) must be
 * registered in the Substrate.  When it fires (Layer 4), it should call
 * `debounceFlush` to check whether the seq still matches.
 *
 * @param inner              - The reducer to debounce.
 * @param scheduledReducerId - Reducer id to pass to the SCHEDULE intent.
 * @param delayMs            - Debounce window in milliseconds.
 *
 * @example
 * // 1. Register the debounced entry-point:
 * const debouncedSearch = debounce(searchReducer, "search-flush", 300);
 *
 * // 2. Register the flush reducer in the runtime config:
 * //    { id: "search-flush", fn: debounceFlush(searchReducer, capturedSeq) }
 */
export function debounce<Σ extends DebounceSlice, ι = unknown>(
  inner: Reducer<Σ, ι>,
  scheduledReducerId: string,
  delayMs: number
): Reducer<Σ, ι> {
  return (state: Σ, _input: ι): readonly [Σ, IntentList] => {
    const nextSeq = state._debounceSeq + 1;
    const nextState: Σ = { ...state, _debounceSeq: nextSeq };

    const scheduleIntent: Intent = {
      type: "SCHEDULE",
      reducerId: scheduledReducerId,
      delayMs,
    };

    return [nextState, Object.freeze([scheduleIntent])];
  };
}

/**
 * Returns the flush reducer that fires after the debounce window expires.
 * It applies the inner reducer only if `_debounceSeq` still equals the
 * sequence captured at scheduling time (i.e. no newer call arrived).
 *
 * @param inner           - The reducer to apply on flush.
 * @param capturedSeq     - The `_debounceSeq` value at the time of scheduling.
 * @param lastInput       - The input to replay on flush.
 */
export function debounceFlush<Σ extends DebounceSlice, ι = unknown>(
  inner: Reducer<Σ, ι>,
  capturedSeq: number,
  lastInput: ι
): Reducer<Σ, unknown> {
  const empty: IntentList = Object.freeze([]);
  return (state: Σ): readonly [Σ, IntentList] => {
    // If a newer call has arrived, the seq will have advanced — skip.
    if (state._debounceSeq !== capturedSeq) {
      return [state, empty];
    }
    return inner(state, lastInput);
  };
}

// ---------------------------------------------------------------------------
// withDebounceState — adds the required _debounceSeq field to a state type
// ---------------------------------------------------------------------------

/**
 * Adds `_debounceSeq: 0` to an initial state value, satisfying DebounceSlice.
 *
 * @example
 * const initial = withDebounceState({ balance: 500, reserved: 0 });
 * // { balance: 500, reserved: 0, _debounceSeq: 0 }
 */
export function withDebounceState<Σ>(state: Σ): Σ & DebounceSlice {
  return { ...state, _debounceSeq: 0 };
}