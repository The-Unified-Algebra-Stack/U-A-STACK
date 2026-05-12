/**
 * Layer 4: Effect Executor
 *
 * The impure boundary of the stack.
 * Receives IntentList from the execution loop after Φ runs.
 * Executes each intent via the injected EffectHandlers.
 * Never modifies, reads, or returns state Σ.
 *
 * Spec Layer 4 responsibilities:
 *   Network (SEND):      gossip, replication
 *   Storage (STORE):     append to KV store
 *   Scheduling (SCHEDULE): queue deferred task
 *   Logging (LOG):       emit to stdout/file
 *   LLM (LLM):           query Ollama, Claude, etc.
 */

export type { EffectHandlers, EffectResult } from "./types"
export { executeIntents } from "./effect-executor"
export { executeNetwork } from "./network-effect"
export { executeStorage } from "./storage-effect"
export { executeSchedule } from "./schedule-effect"
export { executeLog, executeEmit } from "./logging-effect"
export { executeLLM } from "./llm-effect"