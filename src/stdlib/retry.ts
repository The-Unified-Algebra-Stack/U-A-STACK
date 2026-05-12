/**
 * retry.ts
 *
 * Stdlib reducer combinator — built on the SCHEDULE and LOG intent types.
 *
 * Spec intents used:
 *   { type: "SCHEDULE"; reducerId: string; delayMs: number }
 *   { type: "LOG";      level: "warn";    msg: string }
 *
 * Retry in the algebra stack is expressed entirely through state + intents:
 *   1. The inner reducer is attempted on the first call.
 *   2. If the state signals failure (via a pure predicate), a SCHEDULE intent
 *      is emitted to re-run the reducer after `delayMs`.
 *   3. The retry attempt count is tracked in Σ (RetrySlice).
 *   4. Once `maxAttempts` is reached, no further SCHEDULE is emitted and
 *      an optional onExhausted reducer is applied.
 *
 * All timing is delegated to Layer 4 (effect executor).
 * The retry reducer itself remains pure, total, and deterministic (Laws 1–3).
 * No timers, no IO, no side-effects inside Φ (Law 14).
 *
 * Retry state tracked in Σ:
 *   _retryAttempts : number  — how many times the reducer has been attempted
 *   _retryFailed   : boolean — whether the last attempt resulted in failure
 */

import type { Reducer, Intent, IntentList } from "../schema/schema-types";

// ---------------------------------------------------------------------------
// RetrySlice — required fields in Σ for retry reducers
// ---------------------------------------------------------------------------

export interface RetrySlice {
  _retryAttempts: number;
  _retryFailed: boolean;
}

// ---------------------------------------------------------------------------
// RetryConfig
// ---------------------------------------------------------------------------

export interface RetryConfig<Σ, ι> {
  /** The reducer to attempt. */
  inner: Reducer<Σ, ι>;

  /** Reducer id registered in the Substrate for the SCHEDULE intent target. */
  scheduledReducerId: string;

  /**
   * Pure predicate: returns true if the state after applying `inner`
   * indicates a failure that should trigger a retry.
   */
  shouldRetry: (state: Σ, input: ι) => boolean;

  /** Maximum number of attempts (initial + retries). */
  maxAttempts: number;

  /** Delay between attempts in milliseconds. */
  delayMs: number;

  /**
   * Optional backoff multiplier.  Each subsequent retry delay is multiplied
   * by this factor.  Default 1 (constant delay).
   * e.g. 2 → exponential backoff: delayMs, 2×delayMs, 4×delayMs, …
   */
  backoffFactor?: number;

  /**
   * Optional reducer to apply when all attempts are exhausted.
   * Emits its intents alongside the final LOG.
   */
  onExhausted?: Reducer<Σ, ι>;
}

// ---------------------------------------------------------------------------
// withRetry — wraps a reducer with SCHEDULE-based retry logic
// ---------------------------------------------------------------------------

/**
 * Returns a retry-wrapped reducer.
 *
 * On each invocation:
 *   1. Applies the inner reducer to get [candidateState, innerIntents].
 *   2. If `shouldRetry(candidateState, input)` is false → success path:
 *      emits innerIntents, resets retry counters.
 *   3. If shouldRetry is true and attempts < maxAttempts → retry path:
 *      increments _retryAttempts, emits a SCHEDULE + LOG(warn) intent.
 *   4. If shouldRetry is true and attempts >= maxAttempts → exhausted path:
 *      applies onExhausted reducer (if any), emits a LOG(error) intent.
 */
export function withRetry<Σ extends RetrySlice, ι = unknown>(
  config: RetryConfig<Σ, ι>
): Reducer<Σ, ι> {
  const {
    inner,
    scheduledReducerId,
    shouldRetry,
    maxAttempts,
    delayMs,
    backoffFactor = 1,
    onExhausted,
  } = config;

  const emptyIntents: IntentList = Object.freeze([]);

  return (state: Σ, input: ι): readonly [Σ, IntentList] => {
    // Apply inner reducer
    const [candidateState, innerIntents] = inner(state, input);

    // Success — reset retry counters, pass through inner intents
    if (!shouldRetry(candidateState, input)) {
      const successState: Σ = {
        ...candidateState,
        _retryAttempts: 0,
        _retryFailed: false,
      };
      return [successState, innerIntents];
    }

    // Failure path
    const nextAttempts = state._retryAttempts + 1;

    if (nextAttempts < maxAttempts) {
      // Retry: emit SCHEDULE + LOG(warn)
      const backoffDelay = delayMs * Math.pow(backoffFactor, nextAttempts - 1);

      const scheduleIntent: Intent = {
        type: "SCHEDULE",
        reducerId: scheduledReducerId,
        delayMs: Math.round(backoffDelay),
      };
      const warnIntent: Intent = {
        type: "LOG",
        level: "warn",
        msg: `Retry attempt ${nextAttempts}/${maxAttempts} for "${scheduledReducerId}" in ${Math.round(backoffDelay)}ms`,
      };

      const retryState: Σ = {
        ...candidateState,
        _retryAttempts: nextAttempts,
        _retryFailed: true,
      };

      return [
        retryState,
        Object.freeze([...innerIntents, scheduleIntent, warnIntent]),
      ];
    }

    // Exhausted: apply onExhausted reducer, emit LOG(error)
    const errorIntent: Intent = {
      type: "LOG",
      level: "error",
      msg: `All ${maxAttempts} attempts exhausted for "${scheduledReducerId}"`,
    };

    const exhaustedState: Σ = {
      ...candidateState,
      _retryAttempts: nextAttempts,
      _retryFailed: true,
    };

    if (onExhausted) {
      const [finalState, exhaustedIntents] = onExhausted(exhaustedState, input);
      return [
        finalState,
        Object.freeze([...innerIntents, ...exhaustedIntents, errorIntent]),
      ];
    }

    return [exhaustedState, Object.freeze([...innerIntents, errorIntent])];
  };
}

// ---------------------------------------------------------------------------
// withRetryState — adds required RetrySlice fields to an initial state
// ---------------------------------------------------------------------------

/**
 * Augments an initial state value with the required RetrySlice fields.
 *
 * @example
 * const initial = withRetryState({ balance: 500, reserved: 0 });
 * // { balance: 500, reserved: 0, _retryAttempts: 0, _retryFailed: false }
 */
export function withRetryState<Σ>(state: Σ): Σ & RetrySlice {
  return { ...state, _retryAttempts: 0, _retryFailed: false };
}