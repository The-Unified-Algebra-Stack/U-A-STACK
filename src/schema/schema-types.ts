/**
 * schema-types.ts
 *
 * Type definitions for the Schema & Composability layer.
 * Derived directly from the Unified Algebra Stack Specification.
 *
 * Spec reference: "SCHEMA & COMPOSABILITY → JSON Schema Generation"
 * Law 15: JSON Universality — any state Σ can be serialized to JSON.
 */

// ---------------------------------------------------------------------------
// Core algebra types (re-exported for schema layer consumers)
// ---------------------------------------------------------------------------

/** Free monoid of side-effect descriptors. Reducers emit; never interpret. */
export type Intent =
  | { type: "SEND";     to: string; opcode: number; payload: unknown }
  | { type: "STORE";    key: string; value: unknown }
  | { type: "SCHEDULE"; reducerId: string; delayMs: number }
  | { type: "LOG";      level: "info" | "warn" | "error"; msg: string }
  | { type: "EMIT";     channel: string; payload: unknown }
  | { type: "LLM";      model: string; prompt: string; maxTokens: number };

export type IntentList = readonly Intent[];

/**
 * Universal reducer type.
 * Spec Axiom 1: Every computation is reduction R : (Σ, ι) → (Σ', I*)
 * Formal properties:
 *   1. Pure:          R(s, i, t₁) = R(s, i, t₂)
 *   2. Total:         defined for all (s, i) pairs
 *   3. Deterministic: no random, no clock, no IO
 *   4. Composable:    R₁ ∘ R₂ is also a Reducer
 */
export type Reducer<Σ, ι = unknown> = (
  state: Σ,
  input: ι
) => readonly [Σ, IntentList];

// ---------------------------------------------------------------------------
// JSON Schema primitive types
// ---------------------------------------------------------------------------

export type JSONSchemaType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "object"
  | "array"
  | "null";

/**
 * Minimal JSON Schema representation used throughout this layer.
 * Kept to the subset actually needed by the algebra stack; extended
 * only as required by the spec's composability guarantees.
 */
export interface JSONSchema {
  type?: JSONSchemaType | JSONSchemaType[];
  description?: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  additionalProperties?: boolean | JSONSchema;
  items?: JSONSchema;
  oneOf?: JSONSchema[];
  anyOf?: JSONSchema[];
  allOf?: JSONSchema[];
  const?: unknown;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  $schema?: string;
  $id?: string;
  title?: string;
  definitions?: Record<string, JSONSchema>;
  $ref?: string;
}

// ---------------------------------------------------------------------------
// Reducer schema descriptor
// Spec: "JSON Schema Generation" section
// ---------------------------------------------------------------------------

/**
 * Schema descriptor produced for a reducer.
 * Captures the input type, output state type, and the intent variants
 * the reducer may emit — making the reducer's contract machine-verifiable.
 */
export interface ReducerSchema {
  /** Human-readable identifier for this reducer. */
  id: string;

  /** Whether this is a projection (idempotent) or constraint (ordered). */
  kind: "projection" | "constraint";

  /** JSON Schema for the input ι accepted by this reducer. */
  input: JSONSchema;

  /** JSON Schema for the output state Σ' produced by this reducer. */
  output: JSONSchema;

  /**
   * JSON Schema for the IntentList I* emitted by this reducer.
   * Spec invariant: reducers can only emit intents, never interpret them.
   */
  intents: JSONSchema;
}

// ---------------------------------------------------------------------------
// Intent schema (derived from the Intent union type)
// Used by schemaForReducer and the validator.
// ---------------------------------------------------------------------------

/** Individual intent variant schemas, keyed by intent type. */
export type IntentSchemaMap = {
  [K in Intent["type"]]: JSONSchema;
};

// ---------------------------------------------------------------------------
// Projection & Constraint metadata (mirrors runtime config types)
// ---------------------------------------------------------------------------

export interface ProjectionMeta {
  id: string;
  kind: "projection";
  /** Test states used to verify idempotence: P(P(σ)) = P(σ) */
  testStates: unknown[];
}

export interface ConstraintMeta {
  id: string;
  kind: "constraint";
  /** Lower order runs first. Spec Law 5: Cᵢ ∘ Cⱼ ≠ Cⱼ ∘ Cᵢ */
  order: number;
}

export type ReducerMeta = ProjectionMeta | ConstraintMeta;

// ---------------------------------------------------------------------------
// Validation result types (used by type-validator.ts)
// ---------------------------------------------------------------------------

export interface ValidationSuccess {
  valid: true;
}

export interface ValidationFailure {
  valid: false;
  errors: ValidationError[];
}

export interface ValidationError {
  path: string;        // JSON pointer to the failing field
  message: string;
  actual?: unknown;
  expected?: unknown;
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

// ---------------------------------------------------------------------------
// Schema registry entry (used by index.ts)
// ---------------------------------------------------------------------------

export interface SchemaRegistryEntry {
  reducerId: string;
  schema: ReducerSchema;
  registeredAt: number; // logical timestamp (HLC.logical)
}