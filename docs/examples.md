# Examples

## Concrete Example: Replicated Account

### State Schema

```typescript
type AccountState = {
  balance:  EscrowCounter                      // max-wins, nonnegative
  reserved: EscrowCounter                      // max-wins
  status:   LWWRegister<"active" | "frozen">   // last-write-wins
  metadata: ORSet<string>                      // set of metadata keys
}
```

### Projections (Idempotent, Order-Independent)

```typescript
// P1: If frozen, clear reserved
const freezeClears: Reducer<AccountState> = (state, _) => [
  state.status.value === "frozen" ? { ...state, reserved: 0 } : state,
  []
]

// P2: Floor balance to 0
const floorBalance: Reducer<AccountState> = (state, _) => [
  { ...state, balance: Math.max(0, state.balance) },
  []
]
```

**Idempotence verification:**
- Apply P1 twice: frozen account always has `reserved=0`; applying again changes nothing ✓
- Apply P2 twice: negative balance floored to 0; applying again changes nothing ✓

**Commutativity verification:**
- `P1(P2(σ)) = P2(P1(σ))` — both end with frozen→reserved=0, balance≥0 ✓

### Constraints (Non-Commutative, Ordered)

```typescript
// C0: Enforce reserve ceiling (reserved ≤ balance)
const enforceCeiling = (state: AccountState, _): [AccountState, IntentList] => [
  { ...state, reserved: Math.min(state.reserved, state.balance) },
  []
]

// C1: Emit alert if low balance
const lowBalanceAlert = (state: AccountState, _): [AccountState, IntentList] => {
  const intents = state.balance < 100
    ? [{ type: "LOG", level: "warn", msg: `Low balance: ${state.balance}` }]
    : []
  return [state, intents]
}
```

**Order semantics:**
- C0 then C1: enforce ceiling, then alert if low → **correct**
- C1 then C0: alert before ceiling, then enforce → alert uses wrong reserve value → **broken**

### Execution Trace

```
Input: { action: "deposit", amount: 50 }
Φ = C1 ∘ C0 ∘ P2 ∘ P1

Step 1: P1(σ0)
  status = "active", no change → σ1 = σ0

Step 2: P2(σ1)
  balance = 500 ≥ 0, no change → σ2 = σ1

Step 3: C0(σ2)
  reserved 100 ≤ balance 500, no change → σ3 = σ2

Step 4: C1(σ3)
  balance 500 ≥ 100, no alert → σ4 = σ3, intents = []

Output: [σ4, []]
Checkpoint: { before: σ0, after: σ4, intents: [] }
```

### Full Runtime Configuration

```typescript
const accountRuntime = new UnifiedRuntime<AccountState>({
  nodeId: "account-shard-1",
  initialState: {
    balance: 500,
    reserved: 100,
    status: { value: "active", timestamp: 0 },
    metadata: new Set()
  },
  checkpointPath: "/var/log/account.log",
  mergeFn: mergeAccount,
  eqFn: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  mergeSamples: [
    [
      { balance: 500, reserved: 100, status: { value: "active", timestamp: 0 }, metadata: new Set() },
      { balance: 600, reserved: 150, status: { value: "active", timestamp: 1 }, metadata: new Set() },
      { balance: 0,   reserved: 0,   status: { value: "frozen",  timestamp: 2 }, metadata: new Set() }
    ]
  ],
  projections: [
    { id: "freeze-clears", fn: freezeClears, testStates: [...] },
    { id: "floor-balance",  fn: floorBalance,  testStates: [...] }
  ],
  constraints: [
    { id: "enforce-ceiling",   order: 0, fn: enforceCeiling },
    { id: "low-balance-alert", order: 1, fn: lowBalanceAlert }
  ],
  effects: {
    send:     async (to, op, payload) => { /* network */ },
    store:    async (key, value)      => { /* KV store */ },
    schedule: (rid, ms)               => setTimeout(() => {}, ms),
    log:      (level, msg)            => console[level](msg),
    llm:      async (model, prompt, maxTokens) => { /* Ollama */ }
  }
})
```