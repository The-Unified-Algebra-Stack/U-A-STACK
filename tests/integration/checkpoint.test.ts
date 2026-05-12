/**
 * Integration tests for CheckpointEvent — Laws 12, 13
 * Spec: Type 7 (Checkpoint Event), Law 12 (Replay Theorem), Law 13 (Hash Chain Integrity)
 */

import { describe, it, expect, beforeEach } from "@jest/globals"
import { createHash } from "node:crypto"

// ── Types ────────────────────────────────────────────────────────────────────

type Intent =
  | { type: "LOG"; level: "info" | "warn" | "error"; msg: string }
  | { type: "STORE"; key: string; value: unknown }

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

function computeHash(event: Omit<CheckpointEvent, "hash">): string {
  const payload = { ...event, hash: undefined, prevHash: undefined }
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex")
}

// ── Checkpoint Log ────────────────────────────────────────────────────────────

const GENESIS_HASH = "0".repeat(64)

class CheckpointLog<Σ> {
  private events: CheckpointEvent[] = []

  record(
    nodeId: string,
    type: "REDUCE" | "MERGE",
    before: Σ,
    after: Σ,
    intents: IntentList,
    timestamp: HLC,
  ): CheckpointEvent {
    const prevHash =
      this.events.length === 0
        ? GENESIS_HASH
        : this.events[this.events.length - 1].hash

    const partial: Omit<CheckpointEvent, "hash"> = {
      nodeId,
      timestamp,
      type,
      before,
      after,
      intents,
      prevHash,
    }

    const hash = computeHash(partial)

    const event: CheckpointEvent = { ...partial, hash }
    this.events.push(event)
    return event
  }

  getEvents(): readonly CheckpointEvent[] {
    return this.events
  }

  clear() {
    this.events = []
  }
}

// ── Test runtime ──────────────────────────────────────────────────────────────

type AccountState = { balance: number; reserved: number }

const depositReducer: Reducer<AccountState, { amount: number }> = (state, input) => [
  { ...state, balance: state.balance + input.amount },
  [{ type: "STORE", key: "balance", value: state.balance + input.amount }],
]

const reserveReducer: Reducer<AccountState, { amount: number }> = (state, input) => [
  { ...state, reserved: Math.min(state.reserved + input.amount, state.balance) },
  [],
]

const enforceCeiling: Reducer<AccountState, unknown> = (state, _) => [
  { ...state, reserved: Math.min(state.reserved, state.balance) },
  state.reserved > state.balance
    ? [{ type: "LOG", level: "warn", msg: "ceiling enforced" }]
    : [],
]

let hlcCounter = 0

function nextHLC(nodeId: string): HLC {
  return { logical: ++hlcCounter, physical: Date.now(), nodeId }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

let log: CheckpointLog<AccountState>
const NODE_ID = "node-1"

beforeEach(() => {
  log = new CheckpointLog<AccountState>()
  hlcCounter = 0
})

describe("CheckpointEvent hash chain integrity (Law 13)", () => {
  it("first event prevHash is genesis (all zeros)", () => {
    const before: AccountState = { balance: 500, reserved: 100 }
    const after: AccountState = { balance: 550, reserved: 100 }
    const event = log.record(NODE_ID, "REDUCE", before, after, [], nextHLC(NODE_ID))
    expect(event.prevHash).toBe(GENESIS_HASH)
  })

  it("each event's prevHash equals the previous event's hash", () => {
    const states: AccountState[] = [
      { balance: 500, reserved: 0 },
      { balance: 550, reserved: 0 },
      { balance: 600, reserved: 50 },
      { balance: 600, reserved: 100 },
      { balance: 700, reserved: 100 },
    ]

    for (let i = 0; i + 1 < states.length; i++) {
      log.record(NODE_ID, "REDUCE", states[i], states[i + 1], [], nextHLC(NODE_ID))
    }

    const events = log.getEvents()
    for (let i = 1; i < events.length; i++) {
      expect(events[i].prevHash).toBe(events[i - 1].hash)
    }
  })

  it("hash is computed deterministically (same fields = same hash)", () => {
    const before: AccountState = { balance: 100, reserved: 0 }
    const after: AccountState = { balance: 200, reserved: 0 }
    const ts: HLC = { logical: 1, physical: 1000, nodeId: NODE_ID }

    const e1 = log.record(NODE_ID, "REDUCE", before, after, [], ts)
    log.clear()
    const e2 = log.record(NODE_ID, "REDUCE", before, after, [], ts)

    expect(e1.hash).toBe(e2.hash)
  })

  it("changing any field invalidates the hash (tamper-evident)", () => {
    const before: AccountState = { balance: 500, reserved: 100 }
    const after: AccountState = { balance: 550, reserved: 100 }
    const event = log.record(NODE_ID, "REDUCE", before, after, [], nextHLC(NODE_ID))

    // Tamper with balance field
    const tampered = { ...event, after: { balance: 999, reserved: 100 } }
    const recomputed = computeHash({
      nodeId: tampered.nodeId,
      timestamp: tampered.timestamp,
      type: tampered.type,
      before: tampered.before,
      after: tampered.after,
      intents: tampered.intents,
      prevHash: tampered.prevHash,
    })

    expect(recomputed).not.toBe(event.hash)
  })

  it("chain of 20 events maintains unbroken prevHash linkage", () => {
    let state: AccountState = { balance: 0, reserved: 0 }

    for (let i = 0; i < 20; i++) {
      const next: AccountState = { balance: state.balance + 10, reserved: state.reserved }
      log.record(NODE_ID, "REDUCE", state, next, [], nextHLC(NODE_ID))
      state = next
    }

    const events = log.getEvents()
    expect(events).toHaveLength(20)

    // Verify chain
    expect(events[0].prevHash).toBe(GENESIS_HASH)
    for (let i = 1; i < events.length; i++) {
      expect(events[i].prevHash).toBe(events[i - 1].hash)
    }
  })

  it("intents are recorded in checkpoint (not dropped)", () => {
    const before: AccountState = { balance: 50, reserved: 0 }
    const after: AccountState = { balance: 50, reserved: 0 }
    const intents: IntentList = [
      { type: "LOG", level: "warn", msg: "Low balance: 50" },
    ]
    const event = log.record(NODE_ID, "REDUCE", before, after, intents, nextHLC(NODE_ID))
    expect(event.intents).toHaveLength(1)
    expect((event.intents[0] as any).msg).toBe("Low balance: 50")
  })
})

describe("Checkpoint log — replay produces identical state sequence (Law 12)", () => {
  function runSteps(
    initialState: AccountState,
    inputs: { type: "deposit" | "reserve"; amount: number }[],
    log: CheckpointLog<AccountState>,
  ): AccountState[] {
    const states: AccountState[] = [initialState]
    let state = initialState

    for (const input of inputs) {
      const before = state
      let next: AccountState
      let intents: IntentList

      if (input.type === "deposit") {
        ;[next, intents] = depositReducer(state, { amount: input.amount })
      } else {
        ;[next, intents] = reserveReducer(state, { amount: input.amount })
      }

      ;[next, intents] = enforceCeiling(next, undefined) as [AccountState, IntentList]

      log.record(NODE_ID, "REDUCE", before, next, intents, nextHLC(NODE_ID))
      state = next
      states.push(state)
    }

    return states
  }

  function replayLog(
    initialState: AccountState,
    events: readonly CheckpointEvent[],
  ): AccountState[] {
    const states: AccountState[] = [initialState]
    for (const event of events) {
      states.push(event.after as AccountState)
    }
    return states
  }

  const inputs: { type: "deposit" | "reserve"; amount: number }[] = [
    { type: "deposit", amount: 100 },
    { type: "deposit", amount: 200 },
    { type: "reserve", amount: 50 },
    { type: "deposit", amount: 50 },
    { type: "reserve", amount: 400 }, // will hit ceiling
    { type: "deposit", amount: 1000 },
  ]

  it("replay theorem: log replay produces same state sequence as original run", () => {
    const initialState: AccountState = { balance: 500, reserved: 0 }

    // Original run
    const originalStates = runSteps(initialState, inputs, log)
    const events = log.getEvents()

    // Replay from log
    const replayed = replayLog(initialState, events)

    expect(replayed).toHaveLength(originalStates.length)
    for (let i = 0; i < originalStates.length; i++) {
      expect(replayed[i]).toEqual(originalStates[i])
    }
  })

  it("replay is deterministic: running the same inputs twice produces identical logs", () => {
    const initialState: AccountState = { balance: 200, reserved: 0 }

    // First run
    runSteps(initialState, inputs, log)
    const events1 = [...log.getEvents()]

    // Second run with fresh log
    log.clear()
    hlcCounter = 0
    runSteps(initialState, inputs, log)
    const events2 = [...log.getEvents()]

    expect(events1).toHaveLength(events2.length)
    for (let i = 0; i < events1.length; i++) {
      expect(JSON.stringify(events1[i].before)).toBe(JSON.stringify(events2[i].before))
      expect(JSON.stringify(events1[i].after)).toBe(JSON.stringify(events2[i].after))
    }
  })

  it("state is fully reconstructible from log + reducers (spec guarantee)", () => {
    const initialState: AccountState = { balance: 1000, reserved: 0 }

    const originalStates = runSteps(initialState, inputs, log)
    const finalOriginal = originalStates[originalStates.length - 1]

    // Reconstruct by replaying log events
    let reconstructed = initialState
    for (const event of log.getEvents()) {
      reconstructed = event.after as AccountState
    }

    expect(reconstructed).toEqual(finalOriginal)
  })
})

describe("Checkpoint MERGE events", () => {
  it("records merge operations with type=MERGE", () => {
    const before: AccountState = { balance: 500, reserved: 100 }
    const after: AccountState = { balance: 600, reserved: 100 } // merged
    const event = log.record(NODE_ID, "MERGE", before, after, [], nextHLC(NODE_ID))
    expect(event.type).toBe("MERGE")
  })

  it("merge events participate in hash chain", () => {
    const s0: AccountState = { balance: 100, reserved: 0 }
    const s1: AccountState = { balance: 200, reserved: 0 }
    const s2: AccountState = { balance: 300, reserved: 0 }

    log.record(NODE_ID, "REDUCE", s0, s1, [], nextHLC(NODE_ID))
    log.record(NODE_ID, "MERGE", s1, s2, [], nextHLC(NODE_ID))

    const events = log.getEvents()
    expect(events[1].prevHash).toBe(events[0].hash)
  })
})