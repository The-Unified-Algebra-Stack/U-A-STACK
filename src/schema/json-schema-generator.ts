/**
 * json-schema-generator.ts
 *
 * Implements `schemaForReducer` as described in the spec section
 * "SCHEMA & COMPOSABILITY → JSON Schema Generation".
 *
 * Every reducer in the system is a JSON → JSON → (JSON, Intent[]) function
 * (Spec Law 15: JSON Universality). This module makes that contract explicit
 * and machine-verifiable by generating a JSONSchema for any registered reducer.
 *
 * Spec invariants encoded here:
 *   - Reducers can emit intents; intents are never interpreted by reducers.
 *   - Intent variants are drawn from the fixed union type (Type 2).
 *   - Output schema includes both state and intents (the full (Σ', I*) pair).
 */

import type {
  JSONSchema,
  Intent,
  IntentSchemaMap,
  Reducer,
  ReducerMeta,
  ReducerSchema,
} from "./schema-types";

// ---------------------------------------------------------------------------
// Intent variant schemas
// Spec Type 2: Intent = SEND | STORE | SCHEDULE | LOG | EMIT | LLM
// ---------------------------------------------------------------------------

const INTENT_SCHEMAS: IntentSchemaMap = {
  SEND: {
    type: "object",
    description: "Send a message to another node or service.",
    properties: {
      type:    { type: "string", const: "SEND" },
      to:      { type: "string", description: "Destination address." },
      opcode:  { type: "number", description: "Numeric operation code." },
      payload: { description: "Arbitrary JSON payload." },
    },
    required: ["type", "to", "opcode", "payload"],
    additionalProperties: false,
  },

  STORE: {
    type: "object",
    description: "Persist a value to the KV store (Layer 4 executes).",
    properties: {
      type:  { type: "string", const: "STORE" },
      key:   { type: "string" },
      value: { description: "Arbitrary JSON value." },
    },
    required: ["type", "key", "value"],
    additionalProperties: false,
  },

  SCHEDULE: {
    type: "object",
    description: "Schedule a reducer to run after a delay.",
    properties: {
      type:       { type: "string", const: "SCHEDULE" },
      reducerId:  { type: "string" },
      delayMs:    { type: "number", minimum: 0 },
    },
    required: ["type", "reducerId", "delayMs"],
    additionalProperties: false,
  },

  LOG: {
    type: "object",
    description: "Emit a log entry (executed by Layer 4).",
    properties: {
      type:  { type: "string", const: "LOG" },
      level: { type: "string", enum: ["info", "warn", "error"] },
      msg:   { type: "string" },
    },
    required: ["type", "level", "msg"],
    additionalProperties: false,
  },

  EMIT: {
    type: "object",
    description: "Broadcast a payload on a named channel.",
    properties: {
      type:    { type: "string", const: "EMIT" },
      channel: { type: "string" },
      payload: { description: "Arbitrary JSON payload." },
    },
    required: ["type", "channel", "payload"],
    additionalProperties: false,
  },

  LLM: {
    type: "object",
    description: "Query a language model (Ollama, Claude, etc.).",
    properties: {
      type:      { type: "string", const: "LLM" },
      model:     { type: "string" },
      prompt:    { type: "string" },
      maxTokens: { type: "number", minimum: 1 },
    },
    required: ["type", "model", "prompt", "maxTokens"],
    additionalProperties: false,
  },
};

// ---------------------------------------------------------------------------
// IntentList schema (free monoid: concat is associative, [] is unit)
// ---------------------------------------------------------------------------

/**
 * Returns the JSON Schema for IntentList — the free monoid I* emitted
 * by any reducer.  All intent variants appear as `oneOf` items so that
 * validators can confirm the emitted list only contains known types.
 */
export function intentListSchema(): JSONSchema {
  return {
    type: "array",
    description:
      "Free monoid of side-effect descriptors. " +
      "Reducers emit these; Layer 4 executes them. " +
      "Spec invariant: emission ≠ execution.",
    items: {
      oneOf: Object.values(INTENT_SCHEMAS),
    },
  };
}

/**
 * Returns the JSON Schema for a single Intent variant.
 * Useful when a reducer is known to emit only one intent type.
 */
export function intentVariantSchema(type: Intent["type"]): JSONSchema {
  return INTENT_SCHEMAS[type];
}

// ---------------------------------------------------------------------------
// State schema inference helpers
// ---------------------------------------------------------------------------

/**
 * Infers a JSON Schema from a sample state value via structural reflection.
 * This is the lightweight "inferred from usage" approach described in the spec.
 *
 * For a production system the caller should supply an explicit schema; this
 * helper covers the common case where Σ is a plain JSON object.
 */
export function inferSchema(value: unknown, description?: string): JSONSchema {
  if (value === null)   return { type: "null",    description };
  if (typeof value === "boolean") return { type: "boolean", description };
  if (typeof value === "number")  return { type: "number",  description };
  if (typeof value === "string")  return { type: "string",  description };

  if (Array.isArray(value)) {
    const itemSchema =
      value.length > 0 ? inferSchema(value[0]) : {};
    return { type: "array", items: itemSchema, description };
  }

  if (typeof value === "object") {
    const properties: Record<string, JSONSchema> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      properties[k] = inferSchema(v);
    }
    return {
      type: "object",
      properties,
      required: Object.keys(properties),
      description,
    };
  }

  // Fallback — unknown shapes are left open
  return { description };
}

// ---------------------------------------------------------------------------
// Primary export: schemaForReducer
// Spec: "function schemaForReducer(reducer): JSONSchema"
// ---------------------------------------------------------------------------

/**
 * Generates a ReducerSchema for the given reducer.
 *
 * Usage:
 *   const schema = schemaForReducer(myReducer, meta, sampleState, sampleInput);
 *
 * @param reducer    - The reducer function R : (Σ, ι) → (Σ', I*)
 * @param meta       - Registration metadata (id, kind, order for constraints)
 * @param sampleState - Representative Σ for structural schema inference
 * @param sampleInput - Representative ι for structural schema inference
 * @param explicitInputSchema  - Override the inferred input schema
 * @param explicitOutputSchema - Override the inferred output schema
 */
export function schemaForReducer<Σ, ι>(
  reducer: Reducer<Σ, ι>,
  meta: ReducerMeta,
  sampleState: Σ,
  sampleInput: ι,
  explicitInputSchema?: JSONSchema,
  explicitOutputSchema?: JSONSchema
): ReducerSchema {
  // Derive output state by running the reducer once on the sample.
  // This is safe: reducers are pure and deterministic (Spec Type 1).
  const [outputState] = reducer(sampleState, sampleInput);

  const inputSchema: JSONSchema = explicitInputSchema ?? {
    ...inferSchema(sampleInput),
    description: "Input type (inferred from usage)",
  };

  const outputSchema: JSONSchema = explicitOutputSchema ?? {
    ...inferSchema(outputState),
    description: "Output state type (inferred from usage)",
  };

  return {
    id: meta.id,
    kind: meta.kind,
    input: inputSchema,
    output: outputSchema,
    intents: intentListSchema(),
  };
}

// ---------------------------------------------------------------------------
// Phi schema: schema for the composed canonical reducer Φ = Cₙ∘⋯∘C₁∘Pₘ∘⋯∘P₁
// Spec Law 10: Dual Algebra Composition
// ---------------------------------------------------------------------------

/**
 * Builds the schema for the composed canonical reducer Φ.
 * Projections run first (any order); constraints run after (strict order).
 *
 * The returned schema documents the full pipeline contract:
 * input flows through projections then constraints, producing a final state
 * and the union of all emitted intents.
 */
export function schemaForPhi(
  projectionSchemas: ReducerSchema[],
  constraintSchemas: ReducerSchema[],
  description?: string
): JSONSchema {
  // Constraints must be listed in ascending order (Spec Law 5).
  const orderedConstraintIds = constraintSchemas
    .map((s) => s.id)
    .join(", ");
  const projectionIds = projectionSchemas.map((s) => s.id).join(", ");

  return {
    type: "object",
    title: "Φ — Canonical Reducer",
    description:
      description ??
      `Composed canonical reducer: Φ = Cₙ∘⋯∘C₁∘Pₘ∘⋯∘P₁. ` +
      `Projections (order-independent): [${projectionIds}]. ` +
      `Constraints (ordered): [${orderedConstraintIds}].`,
    properties: {
      input: {
        description: "Input event / mutation ι",
        // Union of all projection + constraint input schemas
        anyOf: [
          ...projectionSchemas.map((s) => s.input),
          ...constraintSchemas.map((s) => s.input),
        ],
      },
      output: {
        description: "New state Σ' after full pipeline",
        // Final output matches the last constraint's output schema
        ...(constraintSchemas.length > 0
          ? constraintSchemas[constraintSchemas.length - 1].output
          : projectionSchemas.length > 0
          ? projectionSchemas[projectionSchemas.length - 1].output
          : {}),
      },
      intents: intentListSchema(),
    },
    required: ["input", "output", "intents"],
  };
}