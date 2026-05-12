/**
 * Layer 4: Effect Executor — LLM Effect
 *
 * Spec Intent variant: { type: "LLM"; model: string; prompt: string; maxTokens: number }
 * Spec Layer 4: LLM (LLM): query Ollama, Claude, etc.
 * Spec RuntimeConfig.effects.llm: (model, prompt, maxTokens) => Promise<string>
 *
 * Invariant: Never modifies state Σ. Pure side-effect execution only.
 * LLM responses are not fed back into state — callers may emit further intents
 * if needed, but that decision lives outside this executor.
 */

import type { Intent, EffectResult } from "./types"

export async function executeLLM(
  intent: Extract<Intent, { type: "LLM" }>,
  llm: (model: string, prompt: string, maxTokens: number) => Promise<string>
): Promise<EffectResult> {
  try {
    await llm(intent.model, intent.prompt, intent.maxTokens)
    return { ok: true, intent }
  } catch (error) {
    return { ok: false, intent, error }
  }
}