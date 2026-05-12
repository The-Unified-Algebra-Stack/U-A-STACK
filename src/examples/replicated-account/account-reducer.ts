import type { Reducer, IntentList } from "./index"
import type { AccountState, AccountInput } from "./account-state"
import { emptyIntents } from "./index"

// Core domain reducer — pure, total, deterministic
// Handles all AccountInput events; emits intents for side effects
// Does NOT enforce invariants (projections + constraints handle that)
export const accountReducer: Reducer<AccountState, AccountInput> = (state, input) => {
  switch (input.action) {
    case "deposit": {
      return [
        { ...state, balance: state.balance + input.amount },
        [{ type: "LOG", level: "info", msg: `Deposit ${input.amount}` }]
      ]
    }

    case "withdraw": {
      return [
        { ...state, balance: state.balance - input.amount },
        [{ type: "LOG", level: "info", msg: `Withdraw ${input.amount}` }]
      ]
    }

    case "reserve": {
      return [
        { ...state, reserved: state.reserved + input.amount },
        emptyIntents
      ]
    }

    case "release": {
      return [
        { ...state, reserved: Math.max(0, state.reserved - input.amount) },
        emptyIntents
      ]
    }

    case "freeze": {
      return [
        { ...state, status: { value: "frozen", timestamp: state.status.timestamp + 1 } },
        [{ type: "LOG", level: "warn", msg: "Account frozen" }]
      ]
    }

    case "unfreeze": {
      return [
        { ...state, status: { value: "active", timestamp: state.status.timestamp + 1 } },
        [{ type: "LOG", level: "info", msg: "Account unfrozen" }]
      ]
    }

    case "tag": {
      const metadata = new Set(state.metadata)
      metadata.add(input.key)
      return [{ ...state, metadata }, emptyIntents]
    }

    case "untag": {
      const metadata = new Set(state.metadata)
      metadata.delete(input.key)
      return [{ ...state, metadata }, emptyIntents]
    }

    default: {
      // Exhaustive check — unknown inputs are a no-op
      const _: never = input
      return [state, emptyIntents]
    }
  }
}