import type { PNCounterData, MergeAlgebra } from "./types.js"

// ─── PNCounter ────────────────────────────────────────────────────────────────
// Two grow-only maps: pos[nodeId] and neg[nodeId], each max-wins per slot.
// value = sum(pos) - sum(neg)
//
// CMA laws hold because each slot merges via max (same argument as GCounter).

export function make(nodeId: string, initial = 0): PNCounterData {
  const pos: Record<string, number> = {}
  const neg: Record<string, number> = {}
  if (initial > 0) pos[nodeId] = initial
  if (initial < 0) neg[nodeId] = -initial
  return { pos, neg }
}

export function value(c: PNCounterData): number {
  return sum(c.pos) - sum(c.neg)
}

export function increment(
  c: PNCounterData,
  nodeId: string,
  amount = 1
): PNCounterData {
  if (amount < 0) return decrement(c, nodeId, -amount)
  const pos = { ...c.pos, [nodeId]: (c.pos[nodeId] ?? 0) + amount }
  return { pos, neg: c.neg }
}

export function decrement(
  c: PNCounterData,
  nodeId: string,
  amount = 1
): PNCounterData {
  if (amount < 0) return increment(c, nodeId, -amount)
  const neg = { ...c.neg, [nodeId]: (c.neg[nodeId] ?? 0) + amount }
  return { pos: c.pos, neg }
}

// ─── MergeAlgebra instance ───────────────────────────────────────────────────

export function merge(a: PNCounterData, b: PNCounterData): PNCounterData {
  return {
    pos: mergeMax(a.pos, b.pos),
    neg: mergeMax(a.neg, b.neg),
  }
}

export function eq(a: PNCounterData, b: PNCounterData): boolean {
  return (
    JSON.stringify(sortedKeys(a.pos)) === JSON.stringify(sortedKeys(b.pos)) &&
    JSON.stringify(sortedKeys(a.neg)) === JSON.stringify(sortedKeys(b.neg))
  )
}

export const algebra: MergeAlgebra<PNCounterData> = { merge, eq }

// ─── helpers ─────────────────────────────────────────────────────────────────

function sum(map: Readonly<Record<string, number>>): number {
  return Object.values(map).reduce((acc, v) => acc + v, 0)
}

function mergeMax(
  a: Readonly<Record<string, number>>,
  b: Readonly<Record<string, number>>
): Record<string, number> {
  const result: Record<string, number> = { ...a }
  for (const [k, v] of Object.entries(b)) {
    result[k] = Math.max(result[k] ?? 0, v)
  }
  return result
}

function sortedKeys(map: Readonly<Record<string, number>>): [string, number][] {
  return Object.entries(map).sort(([a], [b]) => a.localeCompare(b))
}