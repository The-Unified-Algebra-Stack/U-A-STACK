/**
 * Layer 3: Intent Stream — IntentList (Free Monoid)
 *
 * Spec Laws (Axiom 4 + Law 2):
 *   concat(intents, []) ≡ intents       [right unit]
 *   concat([], intents) ≡ intents       [left unit]
 *   concat(concat(i₁, i₂), i₃) ≡ concat(i₁, concat(i₂, i₃))  [associativity]
 *
 * Properties:
 * - Opaque: reducers emit, never interpret
 * - Deferrable: emission ≠ execution
 * - Replayable: same input + same reducer = same intents
 */

import type { Intent, IntentList } from "./types"

/**
 * The unit (empty) IntentList — left and right identity for concat.
 */
export const empty: IntentList = Object.freeze([])

/**
 * Concatenate two IntentLists.
 * Associative: concat(concat(a, b), c) = concat(a, concat(b, c))
 * Left unit:   concat(empty, a) = a
 * Right unit:  concat(a, empty) = a
 */
export function concat(a: IntentList, b: IntentList): IntentList {
  return Object.freeze([...a, ...b])
}

/**
 * Fold multiple IntentLists into one via concat.
 * concat(concat(...concat(lists[0], lists[1])...), lists[n])
 */
export function concatAll(lists: IntentList[]): IntentList {
  return lists.reduce(concat, empty)
}

/**
 * Wrap a single Intent into an IntentList.
 */
export function singleton(intent: Intent): IntentList {
  return Object.freeze([intent])
}