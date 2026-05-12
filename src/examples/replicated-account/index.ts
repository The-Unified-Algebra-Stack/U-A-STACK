// Core algebra types

export type Intent =
  | { type: "SEND";     to: string; opcode: number; payload: unknown }
  | { type: "STORE";    key: string; value: unknown }
  | { type: "SCHEDULE"; reducerId: string; delayMs: number }
  | { type: "LOG";      level: "info" | "warn" | "error"; msg: string }
  | { type: "EMIT";     channel: string; payload: unknown }
  | { type: "LLM";      model: string; prompt: string; maxTokens: number }

export type IntentList = readonly Intent[]

// Free monoid
export const emptyIntents: IntentList = Object.freeze([])

export function concatIntents(a: IntentList, b: IntentList): IntentList {
  return Object.freeze([...a, ...b])
}

// R : (Σ, ι) → (Σ', I*)
export type Reducer<Σ, ι = unknown> =
  (state: Σ, input: ι) => readonly [Σ, IntentList]

// Compose reducers left-to-right: output state of rA feeds into rB
export function compose<Σ, ι>(...reducers: Reducer<Σ, ι>[]): Reducer<Σ, ι> {
  return (state, input) => {
    let current = state
    let intents: Intent[] = []
    for (const r of reducers) {
      const [nextState, nextIntents] = r(current, input)
      current = nextState
      intents = [...intents, ...nextIntents]
    }
    return [current, Object.freeze(intents)]
  }
}

// identity reducer — unit of the monoid
export function identity<Σ>(): Reducer<Σ> {
  return (state) => [state, emptyIntents]
}

export type { AccountState, AccountInput } from "./account-state"
export { initialState }                    from "./account-state"
export { accountReducer }                  from "./account-reducer"
export { mergeAccount, mergeAlgebra }      from "./merge"
export { freezeClears, floorBalance }      from "./projections"
export { enforceCeiling, lowBalanceAlert } from "./constraints"
export { createAccountRuntime }            from "./runtime-setup"