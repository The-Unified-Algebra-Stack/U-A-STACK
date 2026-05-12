import type { Reducer } from "./index"
import type { AccountState } from "./account-state"
import { emptyIntents } from "./index"

// Projections: idempotent, commutative
// P(P(σ)) = P(σ)  ∀σ
// Pᵢ(Pⱼ(σ)) = Pⱼ(Pᵢ(σ))  ∀σ
// Run before constraints in Φ = Cₙ∘⋯∘C₁∘Pₘ∘⋯∘P₁

// P1: If frozen, clear reserved
// Idempotence: frozen account always has reserved=0; applying again changes nothing
// Commutativity: P1(P2(σ)) = P2(P1(σ)) — both end with frozen→reserved=0, balance≥0
export const freezeClears: Reducer<AccountState> = (state, _) => {
  if (state.status.value !== "frozen") return [state, emptyIntents]
  return [
    { ...state, reserved: 0 },
    emptyIntents
  ]
}

// P2: Floor balance to 0 (EscrowCounter is nonneg)
// Idempotence: negative balance floored to 0; applying again changes nothing
export const floorBalance: Reducer<AccountState> = (state, _) => {
  if (state.balance >= 0) return [state, emptyIntents]
  return [
    { ...state, balance: 0 },
    emptyIntents
  ]
}

// Test states for idempotence verification at registration
export const projectionTestStates: AccountState[] = [
  // Active account, normal balance
  {
    balance:  500,
    reserved: 100,
    status:   { value: "active", timestamp: 0 },
    metadata: new Set(),
  },
  // Frozen account with reserved > 0 — P1 must clear reserved
  {
    balance:  300,
    reserved: 200,
    status:   { value: "frozen", timestamp: 1 },
    metadata: new Set(),
  },
  // Negative balance — P2 must floor to 0
  {
    balance:  -50,
    reserved: 0,
    status:   { value: "active", timestamp: 0 },
    metadata: new Set(),
  },
  // Frozen + negative balance — both projections fire
  {
    balance:  -100,
    reserved: 50,
    status:   { value: "frozen", timestamp: 2 },
    metadata: new Set(["vip"]),
  },
]