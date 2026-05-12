import type { ORSetData, MergeAlgebra } from "./types.js"

// ─── ORSet (Observed-Remove Set) ──────────────────────────────────────────────
// Each add tags the element with a unique token (UUID-style).
// Remove deletes only the tokens that were observed at remove time.
// Concurrent add + remove: add wins because the new token is not in the
// remove set.  This is the standard Add-Wins ORSet semantics.
//
// Internal representation:
//   entries[key] = [...tokens]   key = JSON.stringify(element)
//   An element is present iff entries[key].length > 0
//
// CMA laws:
//   merge = union of token sets per element key
//   Commutative, associative, idempotent (set union), monotone (tokens only added).

// ─── construction ────────────────────────────────────────────────────────────

export function empty<E>(): ORSetData<E> {
  return { entries: {} }
}

export function of<E>(...elements: E[]): ORSetData<E> {
  let s = empty<E>()
  for (const e of elements) s = add(s, e, uid())
  return s
}

// ─── operations ──────────────────────────────────────────────────────────────

/**
 * Add element with a caller-supplied token.
 * Tokens must be globally unique; generate them with `uid()` outside the reducer
 * (in the effect layer or at input time) to keep the reducer pure.
 */
export function add<E>(s: ORSetData<E>, element: E, token: string): ORSetData<E> {
  const key = toKey(element)
  const existing = s.entries[key] ?? []
  return {
    entries: {
      ...s.entries,
      [key]: dedupe([...existing, token]),
    },
  }
}

/**
 * Remove element by clearing all currently observed tokens.
 * Concurrent adds with new tokens survive (add-wins).
 */
export function remove<E>(s: ORSetData<E>, element: E): ORSetData<E> {
  const key = toKey(element)
  if (!s.entries[key]?.length) return s
  const { [key]: _removed, ...rest } = s.entries
  return { entries: rest }
}

export function has<E>(s: ORSetData<E>, element: E): boolean {
  const tokens = s.entries[toKey(element)]
  return tokens != null && tokens.length > 0
}

export function values<E>(s: ORSetData<E>): E[] {
  return Object.entries(s.entries)
    .filter(([, tokens]) => tokens.length > 0)
    .map(([key]) => JSON.parse(key) as E)
}

export function size<E>(s: ORSetData<E>): number {
  return values(s).length
}

// ─── MergeAlgebra instance ───────────────────────────────────────────────────

export function merge<E>(a: ORSetData<E>, b: ORSetData<E>): ORSetData<E> {
  const allKeys = new Set([...Object.keys(a.entries), ...Object.keys(b.entries)])
  const entries: Record<string, string[]> = {}
  for (const key of allKeys) {
    const tokensA = a.entries[key] ?? []
    const tokensB = b.entries[key] ?? []
    const merged = dedupe([...tokensA, ...tokensB])
    if (merged.length > 0) entries[key] = merged
  }
  return { entries }
}

export function eq<E>(a: ORSetData<E>, b: ORSetData<E>): boolean {
  return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b))
}

export function makeAlgebra<E>(): MergeAlgebra<ORSetData<E>> {
  return {
    merge: merge as MergeAlgebra<ORSetData<E>>["merge"],
    eq:    eq    as MergeAlgebra<ORSetData<E>>["eq"],
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function toKey<E>(element: E): string {
  return JSON.stringify(element)
}

function dedupe(tokens: string[]): string[] {
  return [...new Set(tokens)].sort()
}

function canonicalize<E>(s: ORSetData<E>): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  for (const key of Object.keys(s.entries).sort()) {
    const tokens = dedupe(s.entries[key])
    if (tokens.length > 0) result[key] = tokens
  }
  return result
}

/** Unique token generator – call this outside pure reducers. */
export function uid(): string {
  // crypto.randomUUID available in Node ≥ 19 and all modern browsers.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  // Fallback: timestamp + random suffix
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}