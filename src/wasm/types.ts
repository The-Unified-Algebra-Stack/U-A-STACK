/**
 * WASM SANDBOX & CAPABILITIES - Type Definitions
 * From spec pages 26-28
 */

export enum Capability {
  KV_READ,
  KV_WRITE,
  LLM_QUERY,
  SEND_MESSAGE,
  EMIT_INTENT
}

export type SandboxConfig = {
  reducerCode: string
  capabilities: Capability[]
  timeoutMs: number
  maxMemoryMb: number
}

export type Intent = unknown

export type KVStore = {
  get(key: string): unknown
  set(key: string, value: unknown): void
}

export type LLMProvider = {
  generate(prompt: string): Promise<string>
}