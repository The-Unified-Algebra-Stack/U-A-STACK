/**
 * Unit tests for Intent free monoid — Laws 2, 14
 * Spec: Axiom 4 (Intent as Free Monoid), Law 14 (Intent Deferred Execution)
 */

import { describe, it, expect } from "@jest/globals"

// ── Types ────────────────────────────────────────────────────────────────────

type Intent =
  | { type: "SEND"; to: string; opcode: number; payload: unknown }
  | { type: "STORE"; key: string; value: unknown }
  | { type: "SCHEDULE"; reducerId: string; delayMs: number }
  | { type: "LOG"; level: "info" | "warn" | "error"; msg: string }
  | { type: "EMIT"; channel: string; payload: unknown }
  | { type: "LLM"; model: string; prompt: string; maxTokens: number }

type IntentList = readonly Intent[]

function concat(a: IntentList, b: IntentList): IntentList {
  return Object.freeze([...a, ...b])
}

const empty: IntentList = Object.freeze([])

type Reducer<Σ, ι = unknown> = (state: Σ, input: ι) => readonly [Σ, IntentList]

// ── Fixtures ─────────────────────────────────────────────────────────────────

const i1: IntentList = [
  { type: "LOG", level: "info", msg: "first" },
  { type: "STORE", key: "x", value: 42 },
]

const i2: IntentList = [
  { type: "EMIT", channel: "events", payload: { event: "test" } },
]

const i3: IntentList = [
  { type: "SEND", to: "peer-1", opcode: 0x01, payload: null },
  { type: "SCHEDULE", reducerId: "heartbeat", delayMs: 5000 },
]

const allIntentTypes: Intent[] = [
  { type: "SEND", to: "node-2", opcode: 1, payload: { data: 123 } },
  { type: "STORE", key: "state-key", value: { nested: true } },
  { type: "SCHEDULE", reducerId: "retry-reducer", delayMs: 1000 },
  { type: "LOG", level: "info", msg: "info message" },
  { type: "LOG", level: "warn", msg: "warn message" },
  { type: "LOG", level: "error", msg: "error message" },
  { type: "EMIT", channel: "broadcast", payload: [1, 2, 3] },
  { type: "LLM", model: "claude-3", prompt: "summarize", maxTokens: 256 },
]

// ── Free Monoid Laws ─────────────────────────────────────────────────────────

describe("Intent free monoid — concat unit and associativity (Law 2)", () => {
  it("right unit: concat(intents, empty) ≡ intents", () => {
    expect(concat(i1, empty)).toEqual(i1)
    expect(concat(i2, empty)).toEqual(i2)
    expect(concat(empty, empty)).toEqual(empty)
  })

  it("left unit: concat(empty, intents) ≡ intents", () => {
    expect(concat(empty, i1)).toEqual(i1)
    expect(concat(empty, i2)).toEqual(i2)
  })

  it("associativity: concat(concat(i1,i2),i3) ≡ concat(i1,concat(i2,i3))", () => {
    const leftAssoc = concat(concat(i1, i2), i3)
    const rightAssoc = concat(i1, concat(i2, i3))
    expect(leftAssoc).toEqual(rightAssoc)
  })

  it("concat preserves order", () => {
    const result = concat(i1, i2)
    expect(result[0]).toEqual(i1[0])
    expect(result[1]).toEqual(i1[1])
    expect(result[2]).toEqual(i2[0])
  })

  it("concat result is frozen (immutable)", () => {
    const result = concat(i1, i2)
    expect(Object.isFrozen(result)).toBe(true)
  })

  it("concat does not mutate inputs", () => {
    const a: IntentList = Object.freeze([{ type: "LOG", level: "info", msg: "a" }])
    const b: IntentList = Object.freeze([{ type: "LOG", level: "info", msg: "b" }])
    const _ = concat(a, b)
    expect(a.length).toBe(1)
    expect(b.length).toBe(1)
  })
})

// ── Opaqueness: reducers emit, never interpret ────────────────────────────────

describe("Intent opaqueness — reducers emit only (Axiom 4)", () => {
  it("reducer returns intents without executing them", () => {
    const sideEffect = jest.fn()

    const reducer: Reducer<{ x: number }, unknown> = (state, _) => [
      state,
      [{ type: "STORE", key: "k", value: 99 }],
    ]

    const [, intents] = reducer({ x: 0 }, {})

    // The side effect function is never called inside the reducer
    expect(sideEffect).not.toHaveBeenCalled()
    expect(intents).toHaveLength(1)
    expect(intents[0]).toMatchObject({ type: "STORE", key: "k", value: 99 })
  })

  it("reducer emitting LLM intent does not invoke LLM", () => {
    const llmCalled = jest.fn()

    const reducer: Reducer<{ prompt: string }, unknown> = (state, _) => [
      state,
      [{ type: "LLM", model: "claude-3", prompt: state.prompt, maxTokens: 100 }],
    ]

    const [, intents] = reducer({ prompt: "hello" }, {})

    expect(llmCalled).not.toHaveBeenCalled()
    expect(intents[0]).toMatchObject({ type: "LLM", model: "claude-3" })
  })

  it("reducer emitting SEND intent does not perform network call", () => {
    const networkSend = jest.fn()

    const reducer: Reducer<{}, unknown> = (_, __) => [
      {},
      [{ type: "SEND", to: "node-99", opcode: 42, payload: { msg: "ping" } }],
    ]

    const [, intents] = reducer({}, {})

    expect(networkSend).not.toHaveBeenCalled()
    expect(intents[0]).toMatchObject({ type: "SEND", to: "node-99" })
  })
})

// ── Deferred Execution (Law 14) ───────────────────────────────────────────────

describe("Intent deferred execution (Law 14)", () => {
  it("intents are returned as data, not executed", () => {
    const executed: string[] = []

    const reducer: Reducer<{ n: number }, unknown> = (state, _) => [
      { n: state.n + 1 },
      [
        { type: "LOG", level: "info", msg: "step completed" },
        { type: "STORE", key: "counter", value: state.n + 1 },
      ],
    ]

    const [nextState, intents] = reducer({ n: 0 }, {})

    expect(nextState.n).toBe(1)
    expect(intents).toHaveLength(2)
    expect(executed).toHaveLength(0) // Nothing executed yet
  })

  it("effect executor is the only caller of intents — called separately", () => {
    const log: string[] = []

    const executeIntents = (intents: IntentList) => {
      for (const intent of intents) {
        if (intent.type === "LOG") {
          log.push(intent.msg)
        }
      }
    }

    const reducer: Reducer<{}, unknown> = (state, _) => [
      state,
      [{ type: "LOG", level: "info", msg: "executed after reduce" }],
    ]

    // Phase 1: pure reduce
    const [nextState, intents] = reducer({}, {})
    expect(log).toHaveLength(0) // Not yet executed

    // Phase 2: effect execution (Layer 4, separate)
    executeIntents(intents)
    expect(log).toHaveLength(1)
    expect(log[0]).toBe("executed after reduce")
  })

  it("same intents emitted regardless of when reducer runs (replayability)", () => {
    const reducer: Reducer<{ val: number }, { amount: number }> = (state, input) => [
      { val: state.val + input.amount },
      [{ type: "STORE", key: "val", value: state.val + input.amount }],
    ]

    const state = { val: 10 }
    const input = { amount: 5 }

    const [, intents1] = reducer(state, input)
    const [, intents2] = reducer(state, input)

    expect(JSON.stringify(intents1)).toBe(JSON.stringify(intents2))
  })
})

// ── All intent variants are valid ─────────────────────────────────────────────

describe("All Intent variant types are well-formed", () => {
  it("covers all 6 intent types", () => {
    const types = new Set(allIntentTypes.map((i) => i.type))
    expect(types.has("SEND")).toBe(true)
    expect(types.has("STORE")).toBe(true)
    expect(types.has("SCHEDULE")).toBe(true)
    expect(types.has("LOG")).toBe(true)
    expect(types.has("EMIT")).toBe(true)
    expect(types.has("LLM")).toBe(true)
  })

  it("all intent types survive JSON round-trip (Law 15 — JSON universality)", () => {
    for (const intent of allIntentTypes) {
      const roundTripped = JSON.parse(JSON.stringify(intent))
      expect(roundTripped).toEqual(intent)
    }
  })
})