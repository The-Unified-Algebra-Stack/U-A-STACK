/**
 * Layer 4: Effect Executor
 *
 * Spec:
 *   Layer 4: EFFECT EXECUTOR
 *   ├─ Impure boundary (network, filesystem, LLM, time)
 *   └─ Never modifies state; only executes intents
 *
 * Spec (Law 14 — Intent Deferred Execution):
 *   R(σ, ι) = [σ', I*]
 *   Guarantee: I* is emitted but NOT executed within R.
 *   Execution happens in Layer 4, outside reducer.
 *
 * Spec execution loop:
 *   [state, intents] ← Φ(state, input)
 *   await executeIntents(intents)
 *   intents ← []
 *
 * Invariant: executeIntents never receives or returns Σ.
 */

import type { IntentList, EffectHandlers, EffectResult } from "./types"
import { executeNetwork } from "./network-effect"
import { executeStorage } from "./storage-effect"
import { executeSchedule } from "./schedule-effect"
import { executeLog, executeEmit } from "./logging-effect"
import { executeLLM } from "./llm-effect"

/**
 * Execute every intent in the list sequentially.
 * Order matches emission order (free monoid concat order).
 * Returns one EffectResult per intent — never throws.
 * Never touches or returns state Σ.
 */
export async function executeIntents(
  intents: IntentList,
  handlers: EffectHandlers
): Promise<EffectResult[]> {
  const results: EffectResult[] = []

  for (const intent of intents) {
    let result: EffectResult

    switch (intent.type) {
      case "SEND":
        result = await executeNetwork(intent, handlers.send)
        break
      case "STORE":
        result = await executeStorage(intent, handlers.store)
        break
      case "SCHEDULE":
        result = executeSchedule(intent, handlers.schedule)
        break
      case "LOG":
        result = executeLog(intent, handlers.log)
        break
      case "EMIT":
        result = executeEmit(intent, handlers.log)
        break
      case "LLM":
        result = await executeLLM(intent, handlers.llm)
        break
      default: {
        // Exhaustiveness check — TypeScript will error if a new Intent variant
        // is added to Layer 3 without a corresponding case here.
        const _exhaustive: never = intent
        result = { ok: false, intent: _exhaustive, error: new Error("Unknown intent type") }
      }
    }

    results.push(result)
  }

  return results
}