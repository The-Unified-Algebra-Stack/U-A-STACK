# Layer 3: Intent Stream

## Purpose

Intents are first-class values describing side effects. They are emitted by reducers but never interpreted or executed within the reducer. Execution happens in Layer 4, outside the deterministic algebra boundary.

## Intent Type

```typescript
type Intent =
  | { type: "SEND";     to: string; opcode: number; payload: unknown }
  | { type: "STORE";    key: string; value: unknown }
  | { type: "SCHEDULE"; reducerId: string; delayMs: number }
  | { type: "LOG";      level: "info" | "warn" | "error"; msg: string }
  | { type: "EMIT";     channel: string; payload: unknown }
  | { type: "LLM";      model: string; prompt: string; maxTokens: number }

type IntentList = readonly Intent[]
```

## Free Monoid Structure (Axiom 4)

```typescript
function concat(a: IntentList, b: IntentList): IntentList {
  return Object.freeze([...a, ...b])
}

const empty: IntentList = Object.freeze([])
```

**Laws (Law 2):**

```
concat(intents, []) ≡ intents    [right unit]
concat([], intents) ≡ intents    [left unit]
concat(concat(i₁, i₂), i₃) ≡ concat(i₁, concat(i₂, i₃))  [associativity]
```

## Properties

- **Opaque:** reducers can only emit intents, never interpret them
- **Concatenable:** `[]` is the unit, `++` is associative
- **Replayable:** same input + same reducer = same intents
- **Deferred:** emission ≠ execution

## Law 14: Intent Deferred Execution

```
R(σ, ι) = [σ', I*]

Guarantee: I* is emitted but NOT executed within R.
Execution happens in Layer 4, outside the reducer.
```

**Verification:** Mock the effect executor; run the reducer; verify intents are returned but no side effects occur.