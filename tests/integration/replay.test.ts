/**
 * Integration tests for the Replay Theorem — Law 12
 * Spec: Law 12 (Replay Theorem), §EXECUTION MODEL (Replay-Safe)
 * "Given log + initial state + reducers → reconstruct exact state sequence"
 */

import { describe, it, expect } from "@jest/globals"
import { createHash } from "node:crypto"

// ── Types ────────────────────────────────────────────────────────────────────

type Intent =
  | { type: "LOG"; level: "info" | "warn" | "error"; msg: string }
  | { type: "STORE"; key: string; value: unknown }
  | { type: "EMIT"; channel: string; payload: unknown }

type IntentList = readonly Intent[]
type Reducer<Σ, ι = unknown> = (state: Σ, input: ι) => readonly [Σ, IntentList]
type HLC = { logical: number; physical: number; nodeId: string }

type CheckpointEvent = {
  nodeId: string
  timestamp: HLC
  type: "REDUCE" | "MERGE"
  before: unknown
  after: unknown
  intents: IntentList
  prevHash: string
  hash: string
}

// ── Hashing ───────────────────────────────────────────────────────────────────

const GENESIS_HASH = "0".repeat(64)

function sha256(obj: unknown): string {
  return createHash("sha256").update(JSON.stringify(obj)).digest("hex")
}

// ── Account Domain ────────────────────────────────────────────────────────────

type AccountState = {
  balance: number
  reserved: number
  status: "active" | "frozen"
  txCount: number
}

type AccountInput =
  | { type: "DEPOSIT"; amount: number }
  | { type: "WITHDRAW"; amount: number }
  | { type: "RESERVE"; amount: number }
  | { type: "FREEZE" }
  | { type: "UNFREEZE" }

// ── Φ (full pipeline) ─────────────────────────────────────────────────────────

// Domain reducer
const accountReducer: Reducer<AccountState, AccountInput> = (state, input) => {
  switch (input.type) {
    case "DEPOSIT":
      return [
        { ...state, balance: state.balance + input.amount, txCount: state.txCount + 1 },
        [{ type: "STORE", key: "balance", value: state.balance + input.amount }],
      ]
    case "WITHDRAW":
      return [
        {
          ...state,
          balance: Math.max(0, state.balance - input.amount),
          txCount: state.txCount + 1,
        },
        state.balance - input.amount < 0
          ? [{ type: "LOG", level: "warn", msg: "Overdraft prevented" }]
          : [],
      ]
    case "RESERVE":
      return [
        { ...state, reserved: state.reserved + input.amount, txCount: state.txCount + 1 },
        [],
      ]
    case "FREEZE":
      return [
        { ...state, status: "frozen" },
        [{ type: "EMIT", channel: "account-events", payload: { type: "frozen" } }],
      ]
    case "UNFREEZE":
      return [
        { ...state, status: "active" },
        [{ type: "EMIT", channel: "account-events", payload: { type: "unfrozen" } }],
      ]
  }
}

// P1: If frozen, reserved = 0
const P_freezeClears: Reducer<AccountState> = (state, _) => [
  state.status === "frozen" ? { ...state, reserved: 0 } : state,
  [],
]

// P2: Floor balance
const P_floorBalance: Reducer<AccountState> = (state, _) => [
  { ...state, balance: Math.max(0, state.balance) },
  [],
]

// C0: ceiling
const C_ceiling: Reducer<AccountState> = (state, _) => [
  { ...state, reserved: Math.min(state.reserved, state.balance) },
  [],
]

// C1: low balance alert
const C_alert: Reducer<AccountState> = (state, _) => [
  state,
  state.balance < 100
    ? [{ type: "LOG", level: "warn", msg: `Low: ${state.balance}` }]
    : [],
]

function compose<Σ>(...rs: Reducer<Σ>[]): Reducer<Σ> {
  return (state, input) => {
    let s = state
    let intents: Intent[] = []
    for (const r of rs) {
      const [ns, ni] = r(s, input)
      s = ns
      intents = [...intents, ...(ni as Intent[])]
    }
    return [s, intents] as const
  }
}

const Phi: Reducer<AccountState, AccountInput> = compose(
  accountReducer as Reducer<AccountState>,
  P_freezeClears,
  P_floorBalance,
  C_ceiling,
  C_alert,
)

// ── Log writer ────────────────────────────────────────────────────────────────

class Log {
  events: CheckpointEvent[] = []
  private hlc = 0

  record(
    nodeId: string,
    type: "REDUCE" | "MERGE",
    before: unknown,
    after: unknown,
    intents: IntentList,
  ): void {
    const prevHash =
      this.events.length === 0 ? GENESIS_HASH : this.events[this.events.length - 1].hash

    const ts: HLC = { logical: ++this.hlc, physical: 0, nodeId }
    const partial = { nodeId, timestamp: ts, type, before, after, intents, prevHash }
    const hash = sha256({ ...partial, hash: undefined, prevHash: undefined })
    this.events.push({ ...partial, hash })
  }
}

// ── Execution helpers ─────────────────────────────────────────────────────────

function runTrace(
  initial: AccountState,
  inputs: AccountInput[],
  nodeId: string,
): { states: AccountState[]; log: Log } {
  const log = new Log()
  let state = initial
  const states = [state]

  for (const input of inputs) {
    const before = state
    const [next, intents] = Phi(state, input)
    log.record(nodeId, "REDUCE", before, next, intents)
    state = next
    states.push(state)
  }

  return { states, log }
}

function replayFromLog(
  initial: AccountState,
  events: CheckpointEvent[],
): AccountState[] {
  const states = [initial]
  for (const event of events) {
    states.push(event.after as AccountState)
  }
  return states
}

function replayWithReducers(
  initial: AccountState,
  events: CheckpointEvent[],
  inputs: AccountInput[],
): AccountState[] {
  // Re-execute reducers from before state + input (as stored in log)
  const states = [initial]
  let state = initial
  for (let i = 0; i < events.length; i++) {
    const [next] = Phi(events[i].before as AccountState, inputs[i])
    state = next
    states.push(state)
  }
  return states
}

// ── Scenarios ─────────────────────────────────────────────────────────────────

const NODE_ID = "account-shard-1"

const INITIAL: AccountState = { balance: 500, reserved: 0, status: "active", txCount: 0 }

const SCENARIO_A: AccountInput[] = [
  { type: "DEPOSIT", amount: 100 },
  { type: "RESERVE", amount: 200 },
  { type: "WITHDRAW", amount: 400 },
  { type: "DEPOSIT", amount: 50 }, // will trigger low-balance alert
  { type: "FREEZE" },
  { type: "RESERVE", amount: 999 }, // frozen: reserved will be cleared by P1
  { type: "UNFREEZE" },
  { type: "DEPOSIT", amount: 1000 },
]

const SCENARIO_B: AccountInput[] = Array.from({ length: 100 }, (_, i) => ({
  type: "DEPOSIT" as const,
  amount: i + 1,
}))

// ── Replay Theorem (Law 12) ───────────────────────────────────────────────────

describe("Replay Theorem — log + reducers reconstructs state (Law 12)", () => {
  it("replay from log events matches original run (scenario A)", () => {
    const { states: original, log } = runTrace(INITIAL, SCENARIO_A, NODE_ID)
    const replayed = replayFromLog(INITIAL, log.events)

    expect(replayed.length).toBe(original.length)
    for (let i = 0; i < original.length; i++) {
      expect(replayed[i]).toEqual(original[i])
    }
  })

  it("replay by re-executing reducers matches original run", () => {
    const { states: original, log } = runTrace(INITIAL, SCENARIO_A, NODE_ID)
    const reexecuted = replayWithReducers(INITIAL, log.events, SCENARIO_A)

    expect(reexecuted.length).toBe(original.length)
    for (let i = 0; i < original.length; i++) {
      expect(reexecuted[i]).toEqual(original[i])
    }
  })

  it("replay over 100 sequential deposits (scenario B)", () => {
    const { states: original, log } = runTrace(INITIAL, SCENARIO_B, NODE_ID)
    const replayed = replayFromLog(INITIAL, log.events)

    expect(replayed.length).toBe(original.length)
    expect(replayed[replayed.length - 1]).toEqual(original[original.length - 1])
  })

  it("final state is fully reconstructible from last log event", () => {
    const { states: original, log } = runTrace(INITIAL, SCENARIO_A, NODE_ID)
    const finalFromLog = log.events[log.events.length - 1].after as AccountState
    expect(finalFromLog).toEqual(original[original.length - 1])
  })

  it("partial replay reconstructs intermediate state", () => {
    const { states: original, log } = runTrace(INITIAL, SCENARIO_A, NODE_ID)
    const halfway = Math.floor(SCENARIO_A.length / 2)
    const partial = replayFromLog(INITIAL, log.events.slice(0, halfway))

    expect(partial[partial.length - 1]).toEqual(original[halfway])
  })

  it("crash recovery: state reconstructed from full log replay", () => {
    const { log } = runTrace(INITIAL, SCENARIO_A, NODE_ID)
    const originalFinal = log.events[log.events.length - 1].after as AccountState

    // Simulate crash by using a "fresh" runtime that replays the log
    const recovered = replayFromLog(INITIAL, log.events)
    expect(recovered[recovered.length - 1]).toEqual(originalFinal)
  })
})

describe("Replay invariants", () => {
  it("replay is deterministic: same log produces same state every time", () => {
    const { log } = runTrace(INITIAL, SCENARIO_A, NODE_ID)

    const replayed1 = replayFromLog(INITIAL, log.events)
    const replayed2 = replayFromLog(INITIAL, log.events)

    for (let i = 0; i < replayed1.length; i++) {
      expect(replayed1[i]).toEqual(replayed2[i])
    }
  })

  it("each log event's before matches the prior event's after", () => {
    const { log } = runTrace(INITIAL, SCENARIO_A, NODE_ID)
    const events = log.events

    expect(events[0].before).toEqual(INITIAL)
    for (let i = 1; i < events.length; i++) {
      expect(events[i].before).toEqual(events[i - 1].after)
    }
  })

  it("intents in log match what Φ produces on replay", () => {
    const { log } = runTrace(INITIAL, SCENARIO_A, NODE_ID)

    for (let i = 0; i < log.events.length; i++) {
      const [, intents] = Phi(
        log.events[i].before as AccountState,
        SCENARIO_A[i],
      )
      expect(JSON.stringify(intents)).toBe(JSON.stringify(log.events[i].intents))
    }
  })

  it("log has one event per step (no dropped steps)", () => {
    const { log } = runTrace(INITIAL, SCENARIO_A, NODE_ID)
    expect(log.events).toHaveLength(SCENARIO_A.length)
  })
})

describe("Replay after state mutations", () => {
  it("frozen account replay: reserved always 0 after FREEZE input", () => {
    const inputs: AccountInput[] = [
      { type: "RESERVE", amount: 100 },
      { type: "FREEZE" },
      { type: "RESERVE", amount: 500 }, // frozen → P1 clears to 0
    ]
    const { states } = runTrace(INITIAL, inputs, NODE_ID)

    // After FREEZE + RESERVE: P1 clears reserved
    const finalState = states[states.length - 1]
    expect(finalState.status).toBe("frozen")
    expect(finalState.reserved).toBe(0)
  })

  it("overdraft prevention: balance never goes below 0", () => {
    const inputs: AccountInput[] = [
      { type: "WITHDRAW", amount: 1_000_000 }, // far exceeds balance
    ]
    const { states } = runTrace(INITIAL, inputs, NODE_ID)
    expect(states[1].balance).toBeGreaterThanOrEqual(0)
  })
})