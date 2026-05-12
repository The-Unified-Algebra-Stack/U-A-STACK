import type { Reducer, IntentList } from "./index"
import type { AccountState } from "./account-state"
import { emptyIntents } from "./index"

// Constraints: non-commutative, ordered
// Cᵢ∘Cⱼ ≠ Cⱼ∘Cᵢ  (order is semantic)
// Run after projections in Φ = Cₙ∘⋯∘C₁∘Pₘ∘⋯∘P₁
// Lower order number = runs first

// C0 (order: 0): Enforce reserve ceiling — reserved ≤ balance
// Must run before C1 so the alert uses the corrected reserve value.
// Ordering proof: C1 then C0 would alert on a stale (too-high) reserve value → broken.
export const enforceCeiling: Reducer<AccountState> = (state, _) => {
  if (state.reserved <= state.balance) return [state, emptyIntents]
  return [
    { ...state, reserved: state.balance },
    emptyIntents
  ]
}

// C1 (order: 1): Emit warning if balance is low
// Runs after enforceCeiling so available = balance - reserved is accurate.
const LOW_BALANCE_THRESHOLD = 100

export const lowBalanceAlert: Reducer<AccountState> = (state, _) => {
  if (state.balance >= LOW_BALANCE_THRESHOLD) return [state, emptyIntents]
  const intents: IntentList = [
    {
      type:  "LOG",
      level: "warn",
      msg:   `Low balance: ${state.balance} (reserved: ${state.reserved})`,
    },
  ]
  return [state, intents]
}