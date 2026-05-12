import { createHash } from "crypto"
import { canonicalize, Json } from "./canonical-json"

export type Brand<T, B> = T & { readonly __brand: B }

export type SnapshotHash = Brand<string, "SnapshotHash">

export function deterministicHash(value: Json): SnapshotHash {
  const canonical = canonicalize(value)

  return createHash("sha256")
    .update(canonical)
    .digest("hex") as SnapshotHash
}
