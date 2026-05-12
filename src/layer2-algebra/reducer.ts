/**
 * REDUCER TYPE
 * Spec: Type 1, Axiom 2 (Pages 2-3, 29)
 * 
 * R : (Σ, ι) → (Σ', I*)
 * 
 * Properties:
 * 1. Pure: ∀ s, i. R(s, i, t₁) = R(s, i, t₂)
 * 2. Total: defined for all (s, i) pairs
 * 3. Deterministic: no random, no clock, no IO
 * 4. Composable: R₁ ∘ R₂ is also a Reducer
 */

import { Reducer, Intent, ReducerMonoid } from "./layer2-types"

/**
 * Identity reducer
 * [σ, []]
 */
export function identity<Σ>(state: Σ): readonly [Σ, readonly Intent[]] {
  return Object.freeze([state, Object.freeze([])])
}

/**
 * Compose two reducers
 * 
 * Spec: Axiom 2 (Page 2)
 * [σ₁, i₁] ∘ [σ₂, i₂] = [σ₂, i₁ + i₂]
 */
export function compose<Σ, ι>(
  r1: Reducer<Σ, ι>,
  r2: Reducer<Σ, ι>
): Reducer<Σ, ι> {
  return (state: Σ, input: ι): readonly [Σ, readonly Intent[]] => {
    const [s1, i1] = r1(state, input)
    const [s2, i2] = r2(s1, input)
    return Object.freeze([s2, Object.freeze([...i1, ...i2])])
  }
}

/**
 * Compose many reducers left-to-right
 * 
 * composeMany([r1, r2, r3])(σ, ι)
 * = ((r1 ∘ r2) ∘ r3)(σ, ι)
 * = r3(r2(r1(σ, ι), ι), ι)
 */
export function composeMany<Σ, ι>(reducers: readonly Reducer<Σ, ι>[]): Reducer<Σ, ι> {
  if (reducers.length === 0) {
    return identity as Reducer<Σ, ι>
  }

  return (state: Σ, input: ι): readonly [Σ, readonly Intent[]] => {
    let currentState = state
    const allIntents: Intent[] = []

    for (const reducer of reducers) {
      const [nextState, intents] = reducer(currentState, input)
      currentState = nextState
      allIntents.push(...intents)
    }

    return Object.freeze([currentState, Object.freeze(allIntents)])
  }
}

/**
 * Create reducer monoid
 * 
 * Spec: Law 1 (Page 9)
 * (R ∘ identity) ≡ R [left identity]
 * (identity ∘ R) ≡ R [right identity]
 * ((R₃ ∘ R₂) ∘ R₁) ≡ (R₃ ∘ (R₂ ∘ R₁)) [associativity]
 */
export function createReducerMonoid<Σ>(): ReducerMonoid<Σ> {
  return {
    identity: identity as Reducer<Σ>,
    compose,
  }
}

/**
 * Lift a pure function to a reducer
 * 
 * Pure function: σ → σ'
 * Reducer: (σ, ι) → (σ', I*)
 */
export function lift<Σ, ι>(fn: (state: Σ) => Σ): Reducer<Σ, ι> {
  return (state: Σ): readonly [Σ, readonly Intent[]] => {
    return Object.freeze([fn(state), Object.freeze([])])
  }
}

/**
 * Emit intents without changing state
 */
export function emitIntents<Σ>(intents: readonly Intent[]): Reducer<Σ> {
  return (state: Σ): readonly [Σ, readonly Intent[]] => {
    return Object.freeze([state, Object.freeze(intents)])
  }
}

/**
 * Chain reducers with different input types
 * For advanced composition
 */
export function chain<Σ, ι1, ι2>(
  r1: Reducer<Σ, ι1>,
  r2: Reducer<Σ, ι2>
): Reducer<Σ, ι1 | ι2> {
  return (state: Σ, input: ι1 | ι2): readonly [Σ, readonly Intent[]] => {
    if (typeof input === typeof ({} as ι1)) {
      return r1(state, input as ι1)
    } else {
      return r2(state, input as ι2)
    }
  }
}