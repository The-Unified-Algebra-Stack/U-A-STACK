/**
 * batch.ts
 *
 * Stdlib reducer combinator — derived from Spec Axiom 2 (Composition is Monoid)
 * and the execution model loop:
 *
 *   loop:
 *     input ← read from queue
 *     [state, intents] ← Φ(state, input)
 *     checkpoint.record(...)
 *     await executeIntents(intents)
 *
 * `batch` folds a list of inputs through a reducer in a single call,
 * producing the final state and the concatenated intent list.
 *
 * Algebraic foundation:
 *   batch(R, [i₁, i₂, …, iₙ]) ≡ R(R(…R(σ, i₁)…, iₙ₋₁), iₙ)
 *
 * This is the free-monoid fold over inputs, matching the single-node
 * deterministic execution loop from the spec.
 *
 * Intent accumulation follows Spec Law 2:
 *   I* = concat(I₁, I₂, …, Iₙ)   (associative, [] is unit)
 *
 * Composable: batch(R, inputs) returns a [Σ, IntentList] pair —
 * the same shape as a single reducer call.
 */

import type { Reducer, Intent, IntentList } from "../schema/schema-types";

// ---------------------------------------------------------------------------
// batch — fold a list of inputs through a reducer
// ---------------------------------------------------------------------------

/**
 * Runs a reducer over a list of inputs in sequence, threading state
 * through each step and accumulating all emitted intents.
 *
 * @param reducer - The reducer R : (Σ, ι) → (Σ', I*)
 * @param state   - Initial state σ₀
 * @param inputs  - Ordered list of inputs [i₁, …, iₙ]
 * @returns       - [final state σₙ, concatenated intents I₁ ++ … ++ Iₙ]
 *
 * @example
 * const [finalState, allIntents] = batch(phi, initialState, [
 *   { action: "deposit",  amount: 100 },
 *   { action: "reserve",  amount:  50 },
 *   { action: "withdraw", amount:  20 },
 * ]);
 */
export function batch<Σ, ι>(
  reducer: Reducer<Σ, ι>,
  state: Σ,
  inputs: readonly ι[]
): readonly [Σ, IntentList] {
  let currentState = state;
  const allIntents: Intent[] = [];

  for (const input of inputs) {
    const [nextState, intents] = reducer(currentState, input);
    currentState = nextState;
    for (const intent of intents) {
      allIntents.push(intent);
    }
  }

  return [currentState, Object.freeze(allIntents)];
}

// ---------------------------------------------------------------------------
// batchWithHistory — like batch, but also returns the intermediate states.
// Useful for the Replay Theorem (Spec Law 12) and checkpoint log verification.
// ---------------------------------------------------------------------------

/**
 * Runs a reducer over a list of inputs and collects every intermediate state.
 *
 * Returns:
 *   - `states`  — [σ₀, σ₁, …, σₙ]  (initial + one per input)
 *   - `intents` — [I₁, …, Iₙ]       (per-step intent lists, unflattened)
 *   - `final`   — σₙ (convenience alias for states[n])
 *
 * Spec Law 12 (Replay Theorem):
 *   Given log [event₀, …, eventₙ] and initial state σ₀:
 *   Replaying with batchWithHistory must satisfy σᵢ = event[i].after ∀i
 *
 * @example
 * const { states, intents } = batchWithHistory(phi, σ₀, inputs);
 * log.forEach((event, i) => {
 *   assert(eq(states[i + 1], event.after));
 * });
 */
export function batchWithHistory<Σ, ι>(
  reducer: Reducer<Σ, ι>,
  state: Σ,
  inputs: readonly ι[]
): {
  states: readonly Σ[];
  intents: readonly IntentList[];
  final: Σ;
} {
  const states: Σ[] = [state];
  const intents: IntentList[] = [];

  let currentState = state;
  for (const input of inputs) {
    const [nextState, stepIntents] = reducer(currentState, input);
    currentState = nextState;
    states.push(nextState);
    intents.push(stepIntents);
  }

  return {
    states: Object.freeze(states),
    intents: Object.freeze(intents),
    final: currentState,
  };
}

// ---------------------------------------------------------------------------
// batchReducer — lifts batch into a Reducer that accepts ι[] as its input.
// Enables batch processing to participate in compose() pipelines.
// ---------------------------------------------------------------------------

/**
 * Returns a Reducer whose input type is `readonly ι[]` (a list of inputs).
 * The inner reducer is applied to each element in sequence.
 *
 * This allows batch processing to be composed with other reducers via
 * `compose()`, maintaining the monoid structure.
 *
 * @example
 * const batchedPhi = batchReducer(phi);
 * const [state, intents] = batchedPhi(initial, [input1, input2]);
 */
export function batchReducer<Σ, ι>(
  reducer: Reducer<Σ, ι>
): Reducer<Σ, readonly ι[]> {
  return (state: Σ, inputs: readonly ι[]): readonly [Σ, IntentList] =>
    batch(reducer, state, inputs);
}