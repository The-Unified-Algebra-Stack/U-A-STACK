/**
 * with-metrics.ts
 *
 * Spec stdlib primitive — directly from the "Stdlib Reducer Library" section:
 *
 *   export function withMetrics<Σ, ι>(
 *     name: string,
 *     reducer: Reducer<Σ, ι>
 *   ): Reducer<Σ, ι>
 *
 * Wraps any reducer and appends a LOG intent containing execution duration.
 * The wrapped reducer is still pure, total, and deterministic:
 *   - State output is identical to the inner reducer's output.
 *   - The extra LOG intent is appended to I* (free monoid concat).
 *   - performance.now() is called but its value is only used in the intent
 *     payload — the reducer's state transition is unaffected by wall time.
 *
 * Law 14 (Intent Deferred Execution): the LOG is emitted, not executed.
 * Execution happens in Layer 4 (the effect executor).
 *
 * Spec example (verbatim):
 *   return [nextState, [
 *     ...intents,
 *     { type: "LOG", level: "info", msg: `${name}: ${duration}ms` }
 *   ]]
 */

import type { Reducer, Intent, IntentList } from "../schema/schema-types";

/**
 * Returns a new reducer that behaves identically to `reducer` but also
 * appends a timing LOG intent after every invocation.
 *
 * @param name    - Label used in the log message (e.g. the reducer id).
 * @param reducer - The reducer to instrument.
 *
 * @example
 * const timedPhi = withMetrics("phi", phi);
 * const [state, intents] = timedPhi(initialState, input);
 * // intents includes: { type: "LOG", level: "info", msg: "phi: 0.42ms" }
 */
export function withMetrics<Σ, ι = unknown>(
  name: string,
  reducer: Reducer<Σ, ι>
): Reducer<Σ, ι> {
  return (state: Σ, input: ι): readonly [Σ, IntentList] => {
    const start = performance.now();
    const [nextState, intents] = reducer(state, input);
    const duration = (performance.now() - start).toFixed(3);

    const logIntent: Intent = {
      type: "LOG",
      level: "info",
      msg: `${name}: ${duration}ms`,
    };

    // Free monoid concat: intents ++ [logIntent]
    return [nextState, Object.freeze([...intents, logIntent])];
  };
}

/**
 * Wraps a reducer and emits a LOG intent for every invocation that
 * exceeds `thresholdMs`.  Below the threshold no intent is emitted,
 * keeping the intent stream clean in the steady-state path.
 *
 * Useful for production constraint reducers where only slow outliers
 * warrant a log entry.
 */
export function withSlowMetrics<Σ, ι = unknown>(
  name: string,
  reducer: Reducer<Σ, ι>,
  thresholdMs: number
): Reducer<Σ, ι> {
  return (state: Σ, input: ι): readonly [Σ, IntentList] => {
    const start = performance.now();
    const [nextState, intents] = reducer(state, input);
    const duration = performance.now() - start;

    if (duration <= thresholdMs) {
      return [nextState, intents];
    }

    const logIntent: Intent = {
      type: "LOG",
      level: "warn",
      msg: `${name}: SLOW ${duration.toFixed(3)}ms (threshold ${thresholdMs}ms)`,
    };

    return [nextState, Object.freeze([...intents, logIntent])];
  };
}

/**
 * Wraps a reducer and emits a structured STORE intent containing the
 * execution duration under a metrics key.  Useful when metrics need
 * to be persisted to the KV store (Layer 4) for later aggregation.
 *
 * Intent emitted:
 *   { type: "STORE", key: `metrics:${name}`, value: { durationMs, ts } }
 */
export function withStoredMetrics<Σ, ι = unknown>(
  name: string,
  reducer: Reducer<Σ, ι>
): Reducer<Σ, ι> {
  return (state: Σ, input: ι): readonly [Σ, IntentList] => {
    const start = performance.now();
    const [nextState, intents] = reducer(state, input);
    const durationMs = performance.now() - start;

    const storeIntent: Intent = {
      type: "STORE",
      key: `metrics:${name}`,
      value: { durationMs, ts: Date.now() },
    };

    return [nextState, Object.freeze([...intents, storeIntent])];
  };
}