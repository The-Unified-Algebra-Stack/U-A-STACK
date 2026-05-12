import type { Reducer, IntentList } from "./index"
import { compose }                  from "./index"
import type { AccountState, AccountInput } from "./account-state"
import { initialState }             from "./account-state"
import { accountReducer }           from "./account-reducer"
import { freezeClears, floorBalance, projectionTestStates } from "./projections"
import { enforceCeiling, lowBalanceAlert }                   from "./constraints"
import { mergeAccount, accountEq, mergeSamples, verifyCMA }  from "./merge"

// Φ = C₁ ∘ C₀ ∘ P₂ ∘ P₁ ∘ R
// Projections run first (any order among themselves)
// Constraints run after (strict order: 0 before 1)
const phi: Reducer<AccountState, AccountInput> = compose(
  accountReducer,   // core domain transitions
  freezeClears,     // P1
  floorBalance,     // P2
  enforceCeiling,   // C0
  lowBalanceAlert,  // C1
)

// Minimal runtime interface — replace with your UnifiedRuntime class
export type Runtime<Σ, ι> = {
  state:  () => Σ
  step:   (input: ι) => readonly [Σ, IntentList]
  config: RuntimeConfig<Σ, ι>
}

export type RuntimeConfig<Σ, ι> = {
  nodeId:         string
  initialState:   Σ
  checkpointPath: string
  phi:            Reducer<Σ, ι>
  mergeFn:        (a: Σ, b: Σ) => Σ
  eqFn:           (a: Σ, b: Σ) => boolean
  mergeSamples:   [Σ, Σ, Σ][]
  projections: {
    id:         string
    fn:         Reducer<Σ>
    testStates: Σ[]
  }[]
  constraints: {
    id:    string
    order: number
    fn:    Reducer<Σ>
  }[]
  effects: {
    send:     (to: string, op: number, payload: unknown) => Promise<void>
    store:    (key: string, value: unknown)              => Promise<void>
    schedule: (reducerId: string, delayMs: number)       => void
    log:      (level: string, msg: string)               => void
    llm:      (model: string, prompt: string, maxTokens: number) => Promise<string>
  }
}

export function createAccountRuntime(
  nodeId         = "account-shard-1",
  checkpointPath = "/var/log/account.log"
): RuntimeConfig<AccountState, AccountInput> {
  // Verify CMA laws at construction — throws if violated
  verifyCMA(mergeAccount, accountEq, mergeSamples)

  return {
    nodeId,
    initialState,
    checkpointPath,
    phi,
    mergeFn:      mergeAccount,
    eqFn:         accountEq,
    mergeSamples,

    projections: [
      { id: "freeze-clears", fn: freezeClears, testStates: projectionTestStates },
      { id: "floor-balance",  fn: floorBalance,  testStates: projectionTestStates },
    ],

    constraints: [
      { id: "enforce-ceiling",   order: 0, fn: enforceCeiling },
      { id: "low-balance-alert", order: 1, fn: lowBalanceAlert },
    ],

    effects: {
      send:     async (to, op, payload) => {
        console.log(`[SEND] to=${to} op=${op}`, payload)
      },
      store:    async (key, value) => {
        console.log(`[STORE] ${key}`, value)
      },
      schedule: (reducerId, delayMs) => {
        setTimeout(() => console.log(`[SCHEDULE] ${reducerId}`), delayMs)
      },
      log: (level, msg) => {
        console[level as "info" | "warn" | "error"](`[LOG] ${msg}`)
      },
      llm: async (model, prompt, maxTokens) => {
        throw new Error(`LLM not configured (model=${model})`)
      },
    },
  }
}