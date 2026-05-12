# Causal Consistency

## Hybrid Logical Clock (HLC)

Every event is annotated with an HLC timestamp:

```typescript
type HLC = {
  logical: number  // Lamport clock (logical time)
  physical: number // Wall clock (milliseconds)
  nodeId: string   // Originating node (tiebreaker)
}
```

## Happens-Before Relation

```typescript
type CausalOrder = {
  happensBefore(a: HLC, b: HLC): boolean
  concurrent(a: HLC, b: HLC): boolean
}
```

**Semantics:**

- `a` happens-before `b` iff `a.logical < b.logical`, or `a.logical === b.logical && a.nodeId < b.nodeId`
- `concurrent(a, b)` := `!happensBefore(a, b) && !happensBefore(b, a)`

## Law 11: Causal Consistency

```
event(a) → event(b)  implies  timestamp(a).logical < timestamp(b).logical
```

**Verification:** Check the HLC invariant across all events in the checkpoint log.

## Causal Ordering Under Network Reordering

When events arrive out of order across nodes:

```
Event A emitted at node X
Event B emitted at node Y
A happens-before B (per HLC)

If B arrives at node X before A:
  X queues B until A is applied
  Then applies A, then B
```

**Property:** No causal anomalies. If A caused B, they execute in order. Events are applied in logical order, not physical arrival order.

## Vector Clock / HLC Causal Ordering (Distributed)

```
Each event annotated with HLC: { logical, physical, nodeId }

When event E arrives:
  1. Check if all dependencies are applied (via prevHash chain)
  2. If not, queue E until dependencies satisfied
  3. Apply E in happens-before order
  4. Emit intents from E
```

**Result:** Causal consistency; no anomalies across network reordering.