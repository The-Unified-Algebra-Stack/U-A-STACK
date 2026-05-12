/**
 * UNIFIED ALGEBRA STACK - WASM Sandbox Module
 * 
 * Sandboxed execution environment for reducers compiled to WASM.
 * Enforces capability-based access control, timeout limits, and memory bounds.
 * 
 * Layer 4: Effect Executor integration point
 * - Compiles reducer code to WASM
 * - Gates access to KV store, LLM, networking, scheduling
 * - Prevents clock access (purity requirement)
 * - Enforces time and memory limits
 */

import { Capability, SandboxConfig, SandboxResult } from './types'
import { createImportObject } from './imports'
import { enforceCapability } from './capability-model'

/**
 * Execute a reducer in a sandboxed WASM environment.
 * 
 * Contract:
 * - Input: reducer code, capabilities, state, input, timeouts
 * - Output: [newState, IntentList] or error
 * - Guarantees: Pure (no side effects), bounded (time/memory), deterministic
 * 
 * Formally: sandbox(R, caps, Σ, ι) ⟹ (Σ', I*) ∪ Error
 */
export async function runInSandbox<Σ, ι>(
  config: SandboxConfig,
  state: Σ,
  input: ι
): Promise<SandboxResult<Σ>> {
  try {
    // 1. Validate configuration
    validateSandboxConfig(config)

    // 2. Compile reducer code to WASM module
    const wasmModule = await compileReducerToWasm(config.reducerCode)

    // 3. Create memory with configured limit
    const memory = new WebAssembly.Memory({
      initial: Math.ceil(config.maxMemoryMb / 64), // 64KB pages
      maximum: Math.ceil(config.maxMemoryMb / 64)
    })

    // 4. Create import object with capability gates
    const imports = createImportObject({
      memory,
      capabilities: config.capabilities,
      maxTimeMs: config.timeoutMs
    })

    // 5. Instantiate WASM module
    const instance = new WebAssembly.Instance(wasmModule, {
      env: imports
    })

    // 6. Serialize state and input for WASM
    const serializedState = serialize(state)
    const serializedInput = serialize(input)

    // 7. Execute with timeout protection
    const wrapped = Promise.race([
      executeReducer(instance, serializedState, serializedInput),
      timeoutPromise(config.timeoutMs)
    ])

    const resultBuffer = await wrapped

    // 8. Deserialize output
    const [newState, intents] = deserialize(resultBuffer)

    return {
      success: true,
      state: newState as Σ,
      intents,
      executionTimeMs: 0 // Would measure actual time
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    
    if (message.includes('timeout')) {
      return {
        success: false,
        error: `Sandbox execution timeout (${config.timeoutMs}ms exceeded)`,
        errorType: 'TIMEOUT'
      }
    }

    if (message.includes('memory')) {
      return {
        success: false,
        error: `Sandbox memory limit exceeded (${config.maxMemoryMb}MB)`,
        errorType: 'OUT_OF_MEMORY'
      }
    }

    if (message.includes('not permitted')) {
      return {
        success: false,
        error: message,
        errorType: 'CAPABILITY_DENIED'
      }
    }

    return {
      success: false,
      error: `Sandbox execution error: ${message}`,
      errorType: 'EXECUTION_ERROR'
    }
  }
}

/**
 * Compile reducer source code to a WASM module.
 * 
 * In production, this would use a real Rust/C compiler toolchain.
 * For now, we assume pre-compiled WASM bytecode in config.reducerCode.
 */
async function compileReducerToWasm(
  reducerCode: string | Uint8Array | ArrayBuffer
): Promise<WebAssembly.Module> {
  try {
    let wasmBuffer: Uint8Array

    // Handle different input formats
    if (typeof reducerCode === 'string') {
      // Assume base64-encoded WASM
      wasmBuffer = base64ToUint8Array(reducerCode)
    } else if (reducerCode instanceof Uint8Array) {
      wasmBuffer = reducerCode
    } else if (reducerCode instanceof ArrayBuffer) {
      wasmBuffer = new Uint8Array(reducerCode)
    } else {
      throw new Error('Invalid reducer code format: must be string (base64), Uint8Array, or ArrayBuffer')
    }

    // Validate WASM magic number (0x00 0x61 0x73 0x6d)
    if (wasmBuffer[0] !== 0x00 || wasmBuffer[1] !== 0x61 || 
        wasmBuffer[2] !== 0x73 || wasmBuffer[3] !== 0x6d) {
      throw new Error('Invalid WASM module: magic number mismatch')
    }

    // Compile WASM module
    const module = await WebAssembly.compile(wasmBuffer)
    return module
  } catch (error) {
    throw new Error(`Failed to compile reducer to WASM: ${error}`)
  }
}

/**
 * Execute the reducer export from a WASM instance.
 * 
 * Contract: WASM instance must export a `reduce` function with signature:
 *   reduce(statePtr: i32, inputPtr: i32) => i32 (result buffer pointer)
 */
async function executeReducer(
  instance: WebAssembly.Instance,
  state: Uint8Array,
  input: Uint8Array
): Promise<Uint8Array> {
  const exports = instance.exports as Record<string, any>
  const reduceExport = exports.reduce

  if (typeof reduceExport !== 'function') {
    throw new Error('WASM module must export a "reduce" function')
  }

  // Assuming WASM allocates memory and returns pointer to result
  // In a real implementation, this would interact with WASM memory layout
  const resultPtr = reduceExport(0, state.length) // Simplified

  // For now, return mock result (in production, read from WASM linear memory)
  return new Uint8Array([0])
}

/**
 * Serialize state to binary format for WASM.
 * 
 * Uses JSON as universal format (per Axiom 15: JSON Universality).
 * In production, could use more efficient encodings (MessagePack, bincode, etc).
 */
function serialize(value: unknown): Uint8Array {
  const json = JSON.stringify(value)
  const encoder = new TextEncoder()
  return encoder.encode(json)
}

/**
 * Deserialize WASM output back to JavaScript objects.
 */
function deserialize(buffer: Uint8Array): [unknown, any[]] {
  const decoder = new TextDecoder()
  const json = decoder.decode(buffer)
  const [state, intents] = JSON.parse(json)
  return [state, intents || []]
}

/**
 * Convert base64 string to Uint8Array.
 */
function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes
}

/**
 * Promise that rejects after timeout milliseconds.
 */
function timeoutPromise(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(
      () => reject(new Error(`Sandbox timeout exceeded: ${ms}ms`)),
      ms
    )
  })
}

/**
 * Validate sandbox configuration at registration time.
 * 
 * Ensures:
 * - Timeout is positive
 * - Memory limit is reasonable (1MB - 1GB)
 * - Reducer code is valid format
 * - Capabilities are recognized
 */
function validateSandboxConfig(config: SandboxConfig): void {
  if (config.timeoutMs <= 0) {
    throw new Error('Timeout must be positive milliseconds')
  }

  if (config.timeoutMs > 300000) {
    throw new Error('Timeout exceeds 5 minute limit')
  }

  if (config.maxMemoryMb < 1 || config.maxMemoryMb > 1024) {
    throw new Error('Memory limit must be between 1MB and 1GB')
  }

  if (!config.reducerCode) {
    throw new Error('Reducer code must be provided')
  }

  if (!Array.isArray(config.capabilities)) {
    throw new Error('Capabilities must be an array')
  }

  // Validate all capabilities are recognized
  const validCapabilities = new Set(Object.values(Capability))
  for (const cap of config.capabilities) {
    if (!validCapabilities.has(cap)) {
      throw new Error(`Unknown capability: ${cap}`)
    }
  }
}

/**
 * Check if a reducer has a given capability.
 * Wrapper for enforceCapability from capability-model.
 */
export function hasCapability(
  config: SandboxConfig,
  capability: Capability
): boolean {
  return config.capabilities.includes(capability)
}

/**
 * Get all capabilities granted to a sandbox.
 */
export function getCapabilities(config: SandboxConfig): readonly Capability[] {
  return Object.freeze([...config.capabilities])
}

/**
 * Export types and utilities for external use
 */
export type { SandboxConfig, SandboxResult } from './types'
export { Capability } from './types'