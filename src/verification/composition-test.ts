/**
 * VERIFICATION FRAMEWORK - 2. Composition Testing
 * Law 1: Reducer Monoid
 * 
 * Verification laws:
 * (R ∘ identity) ≡ R [left identity]
 * (identity ∘ R) ≡ R [right identity]
 * ((R₃ ∘ R₂) ∘ R₁) ≡ (R₃ ∘ (R₂ ∘ R₁)) [associativity]
 */

import type { Reducer, IntentList } from './types'

/**
 * Identity reducer - unit element of the monoid
 */
export function identity<Σ>(state: Σ): readonly [Σ, IntentList] {
  return [state, []] as const
}

/**
 * Compose two reducers
 * 
 * (R₂ ∘ R₁)(σ, ι) = let [σ', i₁] = R₁(σ, ι)
 *                    let [σ'', i₂] = R₂(σ', ι)
 *                    return [σ'', i₁ ++ i₂]
 */
export function compose<Σ, ι>(
  r1: Reducer<Σ, ι>,
  r2: Reducer<Σ, ι>
): Reducer<Σ, ι> {
  return (state: Σ, input: ι) => {
    const [s1, i1] = r1(state, input)
    const [s2, i2] = r2(s1, input)
    return [s2, [...i1, ...i2]] as const
  }
}

/**
 * Test composition associativity
 * 
 * Verify: ((r3 ∘ r2) ∘ r1) ≡ (r3 ∘ (r2 ∘ r1))
 */
export function testComposition<Σ, ι>(
  r1: Reducer<Σ, ι>,
  r2: Reducer<Σ, ι>,
  r3: Reducer<Σ, ι>,
  testStates: Σ[],
  testInputs: ι[]
): { leftAssoc: Σ; rightAssoc: Σ; equal: boolean } {
  const state = testStates[0]
  const input = testInputs[0]

  // Left associativity: ((r3 ∘ r2) ∘ r1)(state, input)
  const composed12 = compose(r1, r2)
  const composed312 = compose(composed12, r3)
  const [leftAssoc] = composed312(state, input)

  // Right associativity: (r3 ∘ (r2 ∘ r1))(state, input)
  const composed23 = compose(r2, r3)
  const composed123 = compose(r1, composed23)
  const [rightAssoc] = composed123(state, input)

  return {
    leftAssoc,
    rightAssoc,
    equal: JSON.stringify(leftAssoc) === JSON.stringify(rightAssoc)
  }
}

/**
 * Test identity laws
 */
export function testIdentityLaws<Σ, ι>(
  reducer: Reducer<Σ, ι>,
  testStates: Σ[],
  testInputs: ι[]
): { leftIdentity: boolean; rightIdentity: boolean } {
  let leftIdentity = true
  let rightIdentity = true

  for (const state of testStates) {
    for (const input of testInputs) {
      // Test left identity: (R ∘ identity) ≡ R
      const [s1] = reducer(state, input)
      const [s2] = compose(identity, reducer)(state, input)
      if (JSON.stringify(s1) !== JSON.stringify(s2)) {
        leftIdentity = false
      }

      // Test right identity: (identity ∘ R) ≡ R
      const [s3] = compose(reducer, identity)(state, input)
      if (JSON.stringify(s1) !== JSON.stringify(s3)) {
        rightIdentity = false
      }
    }
  }

  return { leftIdentity, rightIdentity }
}