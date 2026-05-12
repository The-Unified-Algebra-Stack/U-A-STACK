/**
 * Layer 3: Intent Stream — Types
 *
 * Spec: Intent = { type: T, payload: P }
 * Spec: IntentList = [I₁, I₂, ..., Iₙ] — Free Monoid
 *
 * Properties (from spec):
 * - Opaque to reducer algebra (reducers can only emit, never interpret)
 * - Concatenable: [] is unit, ++ is associative
 * - Replayable: same input + same reducer = same intents
 * - Deferrable: emission ≠ execution
 */

export type Intent =
  | { type: "SEND"; to: string; opcode: number; payload: unknown }
  | { type: "STORE"; key: string; value: unknown }
  | { type: "SCHEDULE"; reducerId: string; delayMs: number }
  | { type: "LOG"; level: "info" | "warn" | "error"; msg: string }
  | { type: "EMIT"; channel: string; payload: unknown }
  | { type: "LLM"; model: string; prompt: string; maxTokens: number }

export type IntentList = readonly Intent[]