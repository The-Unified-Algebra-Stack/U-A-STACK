# Layer 4: Effect Executor

## Purpose

Layer 4 is the impure boundary. It receives the `IntentList` produced by Layer 2 and executes each intent against real infrastructure: network, storage, scheduling, logging, and LLM calls. It **never** modifies state `Σ` directly.

## Effect Handlers

Configured via `RuntimeConfig.effects`:

```typescript
effects: {
  send:     (to: string, op: number, payload: unknown) => Promise<void>  // network / gossip
  store:    (key: string, value: unknown)              => Promise<void>  // KV store
  schedule: (reducerId: string, delayMs: number)       => void           // deferred task
  log:      (level: string, msg: string)               => void           // stdout / file
  llm:      (model: string, prompt: string, maxTokens: number) => Promise<string>  // Ollama, Claude, etc.
}
```

## Intent Dispatch

Each `Intent` type maps to one effect handler:

| Intent type | Handler | Purpose |
|---|---|---|
| `SEND` | `send` | Gossip, replication, inter-node messaging |
| `STORE` | `store` | Append to KV store |
| `SCHEDULE` | `schedule` | Queue a deferred reducer invocation |
| `LOG` | `log` | Emit to stdout or log file |
| `EMIT` | channel broadcast | Pub/sub delivery |
| `LLM` | `llm` | Query a language model |

## WASM Sandbox & Capability Model

User-defined reducers run inside a WASM sandbox with explicit capability grants:

```typescript
enum Capability {
  KV_READ,
  KV_WRITE,
  LLM_QUERY,
  SEND_MESSAGE,
  EMIT_INTENT
}

type SandboxConfig = {
  reducerCode:  string
  capabilities: Capability[]
  timeoutMs:    number
  maxMemoryMb:  number
}
```

Capabilities are enforced at the import boundary. Any access not in `capabilities` throws immediately. The clock (`now`) is always trapped — reducers cannot access wall time.

```typescript
async function runInSandbox<Σ, ι>(
  config: SandboxConfig,
  state: Σ,
  input: ι
): Promise<[Σ, Intent[]]> {
  const module  = wasmCompile(config.reducerCode)
  const imports = {
    env: {
      memory:    new WebAssembly.Memory({ initial: config.maxMemoryMb }),
      now:       () => { throw new Error("clock access not permitted") },
      kv_read:   (key) => {
        if (!config.capabilities.includes(Capability.KV_READ))
          throw new Error("KV_READ not granted")
        return kv.get(key)
      },
      kv_write:  (key, value) => {
        if (!config.capabilities.includes(Capability.KV_WRITE))
          throw new Error("KV_WRITE not granted")
        kv.set(key, value)
      },
      llm_query: async (prompt) => {
        if (!config.capabilities.includes(Capability.LLM_QUERY))
          throw new Error("LLM_QUERY not granted")
        return await ollama.generate(prompt)
      }
    }
  }

  const instance = new WebAssembly.Instance(module, imports)
  const wrapped  = Promise.race([
    instance.exports.reduce(serialize(state), serialize(input)),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Sandbox timeout")), config.timeoutMs)
    )
  ])

  const [resultState, resultIntents] = await wrapped
  return [deserialize(resultState), resultIntents]
}
```

## Key Invariant

Layer 4 only executes intents. It does not read or write `Σ`. State transitions happen exclusively in Layer 2 via `Φ`.