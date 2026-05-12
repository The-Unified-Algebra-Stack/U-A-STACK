/**
 * Layer 3: Intent Stream — Intent Constructors
 *
 * Spec: Intent is a first-class value, not an operation.
 * Reducers emit intents; Layer 4 executes them.
 * Invariant: Reducers can emit intents; intents are never interpreted by reducers.
 */

import type { Intent } from "./types"

export function send(to: string, opcode: number, payload: unknown): Intent {
  return { type: "SEND", to, opcode, payload }
}

export function store(key: string, value: unknown): Intent {
  return { type: "STORE", key, value }
}

export function schedule(reducerId: string, delayMs: number): Intent {
  return { type: "SCHEDULE", reducerId, delayMs }
}

export function log(level: "info" | "warn" | "error", msg: string): Intent {
  return { type: "LOG", level, msg }
}

export function emitIntent(channel: string, payload: unknown): Intent {
  return { type: "EMIT", channel, payload }
}

export function llm(model: string, prompt: string, maxTokens: number): Intent {
  return { type: "LLM", model, prompt, maxTokens }
}