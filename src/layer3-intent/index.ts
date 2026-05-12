/**
 * Layer 3: Intent Stream
 *
 * Free monoid of side-effect descriptors.
 * No computation, no interpretation — only emission and deferral.
 *
 * Spec: Layer 3 sits between the deterministic algebra (Layer 2)
 * and the effect executor (Layer 4). Reducers emit IntentLists;
 * Layer 4 executes them outside the reducer boundary.
 */

export type { Intent, IntentList } from "./types"
export { empty, concat, concatAll, singleton } from "./intent-list"
export { send, store, schedule, log, emitIntent, llm } from "./intent"