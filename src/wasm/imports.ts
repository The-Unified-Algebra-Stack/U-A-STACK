/**
 * WASM SANDBOX & CAPABILITIES - Import Object Construction
 * From spec pages 27-28
 */

import { Capability, SandboxConfig, KVStore, LLMProvider } from './types'
import { checkCapability } from './capability-model'

export function createImports(
  config: SandboxConfig,
  kv: KVStore,
  ollama: LLMProvider
): WebAssembly.Imports {
  return {
    env: {
      memory: new WebAssembly.Memory({ initial: config.maxMemoryMb }),
      
      // Clock: always trapped
      now: () => {
        throw new Error("clock access not permitted")
      },
      
      // KV: gated by capability
      kv_read: (key: string) => {
        checkCapability(config.capabilities, Capability.KV_READ, "KV_READ")
        return kv.get(key)
      },
      
      kv_write: (key: string, value: unknown) => {
        checkCapability(config.capabilities, Capability.KV_WRITE, "KV_WRITE")
        kv.set(key, value)
      },
      
      // LLM: gated by capability
      llm_query: async (prompt: string) => {
        checkCapability(config.capabilities, Capability.LLM_QUERY, "LLM_QUERY")
        return await ollama.generate(prompt)
      }
    }
  }
}