import type { IntentList } from "./index"

// CRDT field types
export type EscrowCounter = number   // max-wins, nonnegative
export type PNCounter     = number   // increment and decrement
export type ORSet<T>      = Set<T>   // observed-remove set

export type LWWRegister<T> = {
  value:     T
  timestamp: number
}

// Σ: Account state space (CRDT-backed, convergent)
export type AccountState = {
  balance:  EscrowCounter                        // max-wins, nonnegative
  reserved: EscrowCounter                        // max-wins
  status:   LWWRegister<"active" | "frozen">     // last-write-wins
  metadata: ORSet<string>                        // set of metadata keys
}

// ι: Account input events
export type AccountInput =
  | { action: "deposit";  amount: number }
  | { action: "withdraw"; amount: number }
  | { action: "reserve";  amount: number }
  | { action: "release";  amount: number }
  | { action: "freeze" }
  | { action: "unfreeze" }
  | { action: "tag";      key: string }
  | { action: "untag";    key: string }

export const initialState: AccountState = {
  balance:  0,
  reserved: 0,
  status:   { value: "active", timestamp: 0 },
  metadata: new Set(),
}