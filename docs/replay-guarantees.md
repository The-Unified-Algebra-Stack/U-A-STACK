# Replay Guarantees

The runtime guarantees deterministic replay under the following conditions:

- identical input event log
- identical reducer versions
- identical runtime configuration
- identical deterministic environment
- identical canonical serialization

Under these constraints the following MUST be identical:

- resulting state
- snapshot hashes
- lineage hashes
- emitted intents
- replay traces

## Forbidden Sources of Nondeterminism

The following are prohibited inside reducers:

- Date.now()
- Math.random()
- random UUID generation
- mutable global state
- ambient system time
- network access
- filesystem access

## Deterministic Environment

All entropy must be injected explicitly through:

- deterministic clocks
- deterministic RNGs
- replay-controlled effect boundaries
