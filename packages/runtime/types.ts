export type Brand<T, B> = T & {
  readonly __brand: B
}

export type NodeId = Brand<string, "NodeId">
export type EventId = Brand<string, "EventId">
export type SnapshotHash = Brand<string, "SnapshotHash">

export function asNodeId(value: string): NodeId {
  return value as NodeId
}

export function asEventId(value: string): EventId {
  return value as EventId
}

export function asSnapshotHash(value: string): SnapshotHash {
  return value as SnapshotHash
}
