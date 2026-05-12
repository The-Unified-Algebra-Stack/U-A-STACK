# Runtime Model

```text
event log
    ↓
deterministic reducer
    ↓
new state
    ↓
canonical serialization
    ↓
deterministic hash
    ↓
snapshot lineage
```

## Runtime Invariants

1. Reducers must be pure
2. Serialization must be canonical
3. Hashes must be deterministic
4. Replay must reproduce identical state
5. Effects are externalized from reducers
