/**
 * CONSTRAINT REDUCER
 * Spec: Type 5, Law 5 (Pages 5, 9, 29-30)
 * 
 * Properties:
 * - Non-commutative: Cᵢ ∘ Cⱼ ≠ Cⱼ ∘ Cᵢ
 * - Not idempotent: C ∘ C ≠ C
 * - Order-dependent (semantic)
 * 
 * Verification:
 * - Reorder constraints; show output differs
 */

import { ConstraintReducer, Reducer, Intent, ConstraintTestResult } from "./layer2-types"

/**
 * Create a constraint reducer
 * 
 * Spec: Type 5 (Page 5)
 * Proof obligation: Cᵢ ∘ Cⱼ ≠ Cⱼ ∘ Cᵢ when i ≠ j
 */
export function createConstraint<Σ>(
  id: string,
  order: number,
  apply: Reducer<Σ>,
  testStates?: readonly Σ[]
): ConstraintReducer<Σ> {
  return Object.freeze({
    kind: "constraint" as const,
    id,
    order,
    apply,
    testStates,
  })
}

/**
 * Test constraints for ordering semantics
 * 
 * Spec: Law 5 (Page 9)
 * For constraints C₀, C₁, ..., Cₙ ordered by slot:
 * ∃ σ ∈ test_states. Cᵢ(Cⱼ(σ)) ≠ Cⱼ(Cᵢ(σ)) when i ≠ j
 */
export function testOrderingSemantics<Σ>(
  constraints: readonly ConstraintReducer<Σ>[],
  testStates: readonly Σ[],
  eq: (a: Σ, b: Σ) => boolean
): ConstraintTestResult {
  const errors: string[] = []
  let orderMatters = false
  let details: { ordered: unknown; reordered: unknown } | undefined

  // Sort constraints by order
  const sorted = [...constraints].sort((a, b) => a.order - b.order)

  // Try reordering pairs
  for (let i = 0; i < sorted.length && !orderMatters; i++) {
    for (let j = i + 1; j < sorted.length && !orderMatters; j++) {
      const ci = sorted[i]
      const cj = sorted[j]

      for (const state of testStates) {
        // Apply in correct order (i then j)
        const [s1] = ci.apply(state, undefined)
        const [s2] = cj.apply(s1, undefined)

        // Apply in reversed order (j then i)
        const [s3] = cj.apply(state, undefined)
        const [s4] = ci.apply(s3, undefined)

        // Check if order matters
        if (!eq(s2, s4)) {
          orderMatters = true
          details = {
            ordered: s2,
            reordered: s4,
          }
          break
        }
      }
    }
  }

  if (!orderMatters) {
    errors.push("No constraint pair showed order-dependent behavior")
  }

  return {
    valid: orderMatters,
    orderMatters,
    errors,
    details,
  }
}

/**
 * Compose constraints in order
 * 
 * Strict order: Cₙ ∘ ⋯ ∘ C₁
 */
export function composeConstraints<Σ>(
  constraints: readonly ConstraintReducer<Σ>[]
): Reducer<Σ> {
  // Sort by order (ascending, so lower order runs first)
  const sorted = [...constraints].sort((a, b) => a.order - b.order)

  return (state: Σ): readonly [Σ, readonly Intent[]] => {
    let currentState = state
    const allIntents: Intent[] = []

    for (const constraint of sorted) {
      const [nextState, intents] = constraint.apply(currentState, undefined)
      currentState = nextState
      allIntents.push(...intents)
    }

    return Object.freeze([currentState, Object.freeze(allIntents)])
  }
}

/**
 * Examples of constraints
 * (Spec: Page 14)
 */

/**
 * Enforce reserve ceiling: reserved ≤ balance
 */
export function createEnforceCeilingConstraint<
  Σ extends { balance: number; reserved: number }
>(): ConstraintReducer<Σ> {
  return createConstraint(
    "enforce-ceiling",
    0, // Runs first
    (state: Σ): readonly [Σ, readonly Intent[]] => {
      return Object.freeze([
        {
          ...state,
          reserved: Math.min(state.reserved, state.balance),
        } as Σ,
        Object.freeze([]),
      ])
    }
  )
}

/**
 * Balance floor: balance ≥ 0
 */
export function createBalanceFloorConstraint<Σ extends { balance: number }>(
): ConstraintReducer<Σ> {
  return createConstraint(
    "balance-floor",
    1, // Runs second
    (state: Σ): readonly [Σ, readonly Intent[]] => {
      return Object.freeze([
        {
          ...state,
          balance: Math.max(0, state.balance),
        } as Σ,
        Object.freeze([]),
      ])
    }
  )
}

/**
 * Cascade dependencies: if frozen, clear reserved
 */
export function createCascadeConstraint<
  Σ extends { status: "active" | "frozen"; reserved: number }
>(): ConstraintReducer<Σ> {
  return createConstraint(
    "cascade-freeze",
    2, // Runs third
    (state: Σ): readonly [Σ, readonly Intent[]] => {
      if (state.status === "frozen") {
        return Object.freeze([
          {
            ...state,
            reserved: 0,
          } as Σ,
          Object.freeze([]),
        ])
      }
      return Object.freeze([state, Object.freeze([])])
    }
  )
}

/**
 * Emit alert if low balance
 */
export function createLowBalanceAlertConstraint<Σ extends { balance: number }>(
  threshold: number = 100
): ConstraintReducer<Σ> {
  return createConstraint(
    "low-balance-alert",
    10, // Runs last
    (state: Σ): readonly [Σ, readonly Intent[]] => {
      const intents: Intent[] = []
      if (state.balance < threshold) {
        intents.push({
          type: "LOG",
          level: "warn",
          msg: `Low balance: ${state.balance}`,
        })
      }
      return Object.freeze([state, Object.freeze(intents)])
    }
  )
}