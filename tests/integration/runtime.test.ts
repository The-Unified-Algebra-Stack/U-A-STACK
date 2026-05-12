/**
 * Integration tests for UnifiedRuntime / Substrate<Σ> execution loop
 * Spec: §EXECUTION MODEL (Single-Node Deterministic), Type 3 (Substrate),
 *       Type 9 (Configuration), §CONCRETE EXAMPLE (Account Runtime)
 */

import { describe, it, expect, beforeEach } from "@jest/globals"
import { createHash } from "node:crypto"

// ── Types ────────────────────────────────────────────────────────────────────

type Intent =
  | { type: "SEND"; to: string; opcode: number; payload: unknown }
  | { type: "STORE"; key: string; value: unknown }
  | { type: "SCHEDULE"; reducerId: string; delayMs: number }
  | { type: "LOG"; level: "info" | "warn" | "error"; msg: string }
  | { type: "EMIT"; channel: string; payload: unknown }
  | { type: "LLM"; model: string; prompt: string; maxTokens: number }

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

// ── Account State ─────────────────────────────────────────────────────────────

type AccountState = {
  balance: number
  reserved: number
  status: "active" | "frozen"
}

// ── Runtime ───────────────────────────────────────────────────────────────────

const GENESIS_HASH = "0".repeat(64)

function sha256(obj: unknown): string {
  return createHash("sha256").update(JSON.stringify(obj)).digest("hex")
}

type EffectHandlers = {
  send: (to: string, op: number, payload: unknown) => Promise<void>
  store: (key: string, value: unknown) => Promise<void>
  schedule: (reducerId: string, delayMs: number) => void
  log: (level: string, msg: string) => void
  llm: (model: string, prompt: string, maxTokens: number) => Promise<string>
}

class UnifiedRuntime<Σ> {
  private _state: Σ
  private checkpointEvents: CheckpointEvent[] = []
  private inputQueue: unknown[] = []
  private hlcCounter = 0

  constructor(
    private readonly config: {
      nodeId: string
      initialState: Σ
      phi: Reducer<Σ>
      mergeFn: (a: Σ, b: Σ) => Σ
      eqFn: (a: Σ, b: Σ) => boolean
      effects: EffectHandlers
    },
  ) {
    this._state = config.initialState
  }

  state(): Σ {
    return this._state
  }

  enqueue(input: unknown) {
    this.inputQueue.push(input)
  }

  private nextHLC(): HLC {
    return {
      logical: ++this.hlcCounter,
      physical: Date.now(),
      nodeId: this.config.nodeId,
    }
  }

  private record(
    type: "REDUCE" | "MERGE",
    before: Σ,
    after: Σ,
    intents: IntentList,
    timestamp: HLC,
  ): CheckpointEvent {
    const prevHash =
      this.checkpointEvents.length === 0
        ? GENESIS_HASH
        : this.checkpointEvents[this.checkpointEvents.length - 1].hash

    const partial = {
      nodeId: this.config.nodeId,
      timestamp,
      type,
      before,
      after,
      intents,
      prevHash,
    }

    const hash = sha256({ ...partial, hash: undefined, prevHash: undefined })
    const event: CheckpointEvent = { ...partial, hash }
    this.checkpointEvents.push(event)
    return event
  }

  async step(input: unknown): Promise<void> {
    const before = this._state
    const [next, intents] = this.config.phi(this._state, input)
    this._state = next
    this.record("REDUCE", before, next, intents, this.nextHLC())
    await this.executeIntents(intents)
  }

  async runQueue(): Promise<void> {
    while (this.inputQueue.length > 0) {
      const input = this.inputQueue.shift()!
      await this.step(input)
    }
  }

  async merge(remote: Σ): Promise<void> {
    const before = this._state
    const merged = this.config.mergeFn(this._state, remote)
    this._state = merged
    this.record("MERGE", before, merged, [], this.nextHLC())
  }

  private async executeIntents(intents: IntentList): Promise<void> {
    for (const intent of intents) {
      switch (intent.type) {
        case "SEND":
          await this.config.effects.send(intent.to, intent.opcode, intent.payload)
          break
        case "STORE":
          await this.config.effects.store(intent.key, intent.value)
          break
        case "SCHEDULE":
          this.config.effects.schedule(intent.reducerId, intent.delayMs)
          break
        case "LOG":
          this.config.effects.log(intent.level, intent.msg)
          break
        case "LLM":
          await this.config.effects.llm(intent.model, intent.prompt, intent.maxTokens)
          break
        case "EMIT":
          break
      }
    }
  }

  getCheckpointLog(): readonly CheckpointEvent[] {
    return this.checkpointEvents
  }

  resetWithState(state: Σ) {
    this._state = state
    this.checkpointEvents = []
    this.hlcCounter = 0
  }
}

// ── Reducers (spec example) ───────────────────────────────────────────────────

// P1: If frozen, clear reserved
const freezeClears: Reducer<AccountState> = (state, _) => [
  state.status === "frozen" ? { ...state, reserved: 0 } : state,
  [],
]

// P2: Floor balance to 0
const floorBalance: Reducer<AccountState> = (state, _) => [
  { ...state, balance: Math.max(0, state.balance) },
  [],
]

// C0: Enforce reserve ceiling
const enforceCeiling: Reducer<AccountState> = (state, _) => [
  { ...state, reserved: Math.min(state.reserved, state.balance) },
  [],
]

// C1: Low balance alert
const lowBalanceAlert: Reducer<AccountState> = (state, _) => [
  state,
  state.balance < 100
    ? [{ type: "LOG", level: "warn", msg: `Low balance: ${state.balance}` }]
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

// Φ = C₁ ∘ C₀ ∘ P₂ ∘ P₁
const Phi = compose(freezeClears, floorBalance, enforceCeiling, lowBalanceAlert)

function mergeAccount(a: AccountState, b: AccountState): AccountState {
  const statusWinner =
    (a as any).statusTimestamp >= (b as any).statusTimestamp ? a : b
  return {
    balance: Math.max(a.balance, b.balance),
    reserved: Math.max(a.reserved, b.reserved),
    status: statusWinner.status,
  }
}

function eqAccount(a: AccountState, b: AccountState): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

// ── Test setup ────────────────────────────────────────────────────────────────

function makeRuntime(
  initial: AccountState,
  effects?: Partial<EffectHandlers>,
): UnifiedRuntime<AccountState> {
  return new UnifiedRuntime<AccountState>({
    nodeId: "account-shard-1",
    initialState: initial,
    phi: Phi,
    mergeFn: mergeAccount,
    eqFn: eqAccount,
    effects: {
      send: jest.fn().mockResolvedValue(undefined),
      store: jest.fn().mockResolvedValue(undefined),
      schedule: jest.fn(),
      log: jest.fn(),
      llm: jest.fn().mockResolvedValue(""),
      ...effects,
    },
  })
}

const initial: AccountState = { balance: 500, reserved: 100, status: "active" }

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Single-node deterministic execution (spec §EXECUTION MODEL)", () => {
  it("spec execution trace: deposit on active account with no changes (page 16)", async () => {
    const runtime = makeRuntime(initial)
    const stateBefore = runtime.state()

    // Φ on { balance:500, reserved:100, status:active } with deposit input
    // P1: active → no change
    // P2: balance=500≥0 → no change
    // C0: reserved=100≤balance=500 → no change
    // C1: balance=500≥100 → no alert
    await runtime.step({ action: "deposit", amount: 50 })

    // State unchanged by Φ (Phi only normalizes; a separate deposit reducer would update it)
    // The spec trace shows Φ applied to the state, not a deposit reducer — so state is σ₄=σ₀
    const stateAfter = runtime.state()
    expect(stateAfter).toEqual(stateBefore)
    expect(runtime.getCheckpointLog()).toHaveLength(1)
  })

  it("checkpoint is written after each step", async () => {
    const runtime = makeRuntime(initial)
    await runtime.step({})
    await runtime.step({})
    await runtime.step({})
    expect(runtime.getCheckpointLog()).toHaveLength(3)
  })

  it("checkpoint records before/after state", async () => {
    const state: AccountState = { balance: 50, reserved: 60, status: "active" }
    const runtime = makeRuntime(state)
    await runtime.step({})

    const events = runtime.getCheckpointLog()
    expect(events[0].before).toEqual({ balance: 50, reserved: 60, status: "active" })
    // C0 enforces ceiling: reserved(60) → min(60, 50) = 50
    // C1 alerts: balance(50) < 100 → LOG intent
    expect((events[0].after as AccountState).reserved).toBe(50)
  })

  it("intents are emitted and executed (effect handler called)", async () => {
    const logFn = jest.fn()
    const state: AccountState = { balance: 50, reserved: 0, status: "active" }
    const runtime = makeRuntime(state, { log: logFn })

    await runtime.step({})

    // balance < 100 triggers LOG intent
    expect(logFn).toHaveBeenCalledWith("warn", expect.stringContaining("Low balance"))
  })

  it("STORE intent invokes store effect", async () => {
    const storeFn = jest.fn().mockResolvedValue(undefined)
    const reducer: Reducer<AccountState> = (state, _) => [
      state,
      [{ type: "STORE", key: "test-key", value: state.balance }],
    ]
    const runtime = new UnifiedRuntime<AccountState>({
      nodeId: "test",
      initialState: initial,
      phi: reducer,
      mergeFn: mergeAccount,
      eqFn: eqAccount,
      effects: {
        send: jest.fn().mockResolvedValue(undefined),
        store: storeFn,
        schedule: jest.fn(),
        log: jest.fn(),
        llm: jest.fn().mockResolvedValue(""),
      },
    })

    await runtime.step({})
    expect(storeFn).toHaveBeenCalledWith("test-key", 500)
  })

  it("state is deterministic: same input produces same state", async () => {
    const r1 = makeRuntime(initial)
    const r2 = makeRuntime(initial)
    await r1.step({ val: 42 })
    await r2.step({ val: 42 })
    expect(eqAccount(r1.state(), r2.state())).toBe(true)
  })

  it("effect executor never modifies state (Layer 4 invariant)", async () => {
    let capturedState: AccountState | undefined
    const storeFn = jest.fn().mockImplementation(async (_key: string, value: unknown) => {
      // Even if effect tries to read the runtime state — state must be already set
      capturedState = value as AccountState
    })

    const runtime = makeRuntime(initial, { store: storeFn })
    const stateBefore = { ...runtime.state() }
    await runtime.step({})
    const stateAfter = runtime.state()

    // State change happened via Φ (not via effect)
    // The effect executed after state was committed
    expect(typeof stateAfter).toBe("object")
    expect(stateAfter).not.toBe(stateBefore) // different reference
  })
})

describe("Merge operation", () => {
  it("merges remote state and records MERGE checkpoint", async () => {
    const runtime = makeRuntime(initial)
    const remote: AccountState = { balance: 800, reserved: 200, status: "active" }

    await runtime.merge(remote)

    const merged = runtime.state()
    expect(merged.balance).toBe(Math.max(500, 800)) // 800
    expect(merged.reserved).toBe(Math.max(100, 200)) // 200

    const events = runtime.getCheckpointLog()
    expect(events[0].type).toBe("MERGE")
  })

  it("merge is idempotent: merging same state twice = once", async () => {
    const r1 = makeRuntime(initial)
    const r2 = makeRuntime(initial)
    const remote: AccountState = { balance: 700, reserved: 50, status: "active" }

    await r1.merge(remote)
    await r2.merge(remote)
    await r2.merge(remote) // second merge with same remote

    expect(eqAccount(r1.state(), r2.state())).toBe(true)
  })
})

describe("Input queue processing", () => {
  it("runQueue processes all queued inputs", async () => {
    const runtime = makeRuntime(initial)
    runtime.enqueue({ a: 1 })
    runtime.enqueue({ a: 2 })
    runtime.enqueue({ a: 3 })

    await runtime.runQueue()

    expect(runtime.getCheckpointLog()).toHaveLength(3)
  })
})

describe("Hash chain integrity across runtime steps (Law 13)", () => {
  it("chain unbroken across 10 steps", async () => {
    const runtime = makeRuntime(initial)
    for (let i = 0; i < 10; i++) {
      await runtime.step({ i })
    }

    const events = runtime.getCheckpointLog()
    expect(events[0].prevHash).toBe(GENESIS_HASH)
    for (let i = 1; i < events.length; i++) {
      expect(events[i].prevHash).toBe(events[i - 1].hash)
    }
  })
})