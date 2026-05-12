/**
 * WASM SANDBOX & CAPABILITIES - Capability Model
 * From spec page 27
 */

import { Capability } from './types'

export function checkCapability(
  granted: Capability[],
  required: Capability,
  operation: string
): void {
  if (!granted.includes(required)) {
    throw new Error(`${operation} not granted`)
  }
}