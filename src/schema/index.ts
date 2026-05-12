/**
 * schema/index.ts
 *
 * Public entry point for the Schema & Composability layer.
 *
 * Exports:
 *   - All types from schema-types.ts
 *   - schemaForReducer, intentListSchema, schemaForPhi from json-schema-generator.ts
 *   - All validators and law-verifiers from type-validator.ts
 *   - SchemaRegistry — runtime registry mapping reducer ids to their schemas
 *
 * Spec reference: "SCHEMA & COMPOSABILITY" section and Law 15 (JSON Universality).
 */

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export type {
  // Core algebra types
  Intent,
  IntentList,
  Reducer,

  // Schema types
  JSONSchema,
  JSONSchemaType,
  ReducerSchema,
  IntentSchemaMap,

  // Metadata
  ProjectionMeta,
  ConstraintMeta,
  ReducerMeta,

  // Validation
  ValidationResult,
  ValidationSuccess,
  ValidationFailure,
  ValidationError,

  // Registry
  SchemaRegistryEntry,
} from "./schema-types";

export {
  // JSON Schema generation
  schemaForReducer,
  intentListSchema,
  intentVariantSchema,
  inferSchema,
  schemaForPhi,
} from "./json-schema-generator";

export {
  // Value / state / intent validation
  validateValue,
  validateState,
  validateIntentList,

  // Algebraic law verifiers (Spec: VERIFICATION FRAMEWORK)
  assertPure,
  assertIdempotent,
  assertProjectionsCommute,
  assertMergeCMA,
  assertIntentsDeferred,
} from "./type-validator";

// ---------------------------------------------------------------------------
// SchemaRegistry
// ---------------------------------------------------------------------------

import type { ReducerSchema, SchemaRegistryEntry } from "./schema-types";

/**
 * Runtime registry that maps reducer ids to their ReducerSchemas.
 *
 * Designed to be constructed once at startup (alongside the Substrate) and
 * queried throughout the runtime for type-checking and documentation.
 *
 * Spec composability requirement:
 *   "Stdlib library: 20+ proven reducers"
 *   "Schema generation: JSON Schema for type checking"
 *   "User-defined reducers: tested + verified before deployment"
 */
export class SchemaRegistry {
  private readonly entries = new Map<string, SchemaRegistryEntry>();
  private logicalClock = 0;

  /**
   * Register a reducer schema.
   * Overwrites any previous entry with the same id (last-write-wins, matching
   * the LWWRegister semantics used throughout the spec's CRDT layer).
   */
  register(schema: ReducerSchema): void {
    this.entries.set(schema.id, {
      reducerId: schema.id,
      schema,
      registeredAt: ++this.logicalClock,
    });
  }

  /**
   * Look up a registered schema by reducer id.
   * Returns undefined if the reducer has not been registered.
   */
  get(reducerId: string): ReducerSchema | undefined {
    return this.entries.get(reducerId)?.schema;
  }

  /**
   * Check whether a reducer has a registered schema.
   */
  has(reducerId: string): boolean {
    return this.entries.has(reducerId);
  }

  /**
   * Remove a reducer schema from the registry.
   */
  deregister(reducerId: string): boolean {
    return this.entries.delete(reducerId);
  }

  /**
   * All registered entries, ordered by registration time (ascending).
   * Useful for building the canonical Φ schema via `schemaForPhi`.
   */
  allEntries(): SchemaRegistryEntry[] {
    return [...this.entries.values()].sort(
      (a, b) => a.registeredAt - b.registeredAt
    );
  }

  /**
   * Separate projection schemas from constraint schemas, each sorted per
   * their respective semantics.
   *
   * Projections: order-independent (commutative) — returned in registration order.
   * Constraints: ordered by `order` field (Spec Law 5) — returned ascending.
   *
   * Used when calling `schemaForPhi` to produce the canonical Φ schema.
   */
  partitioned(): {
    projections: ReducerSchema[];
    constraints: ReducerSchema[];
  } {
    const projections: ReducerSchema[] = [];
    const constraints: ReducerSchema[] = [];

    for (const entry of this.allEntries()) {
      if (entry.schema.kind === "projection") {
        projections.push(entry.schema);
      } else {
        constraints.push(entry.schema);
      }
    }

    // Constraints sorted by their order field (lower = runs first, Spec Law 5)
    constraints.sort((a, b) => {
      // We stored order on the ReducerMeta; retrieve it from the registry
      // entry's registeredAt as a stable secondary key when orders are equal.
      const orderA = (a as ReducerSchema & { order?: number }).order ?? 0;
      const orderB = (b as ReducerSchema & { order?: number }).order ?? 0;
      return orderA - orderB;
    });

    return { projections, constraints };
  }

  /** Number of registered reducers. */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Returns all registered schemas as a plain object keyed by reducer id.
   * Useful for serialisation / documentation export.
   * Spec Law 15: JSON universality — the registry itself is JSON-serialisable.
   */
  toJSON(): Record<string, ReducerSchema> {
    const out: Record<string, ReducerSchema> = {};
    for (const [id, entry] of this.entries) {
      out[id] = entry.schema;
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Module-level singleton (optional convenience export)
// ---------------------------------------------------------------------------

/**
 * Default global SchemaRegistry instance.
 * Import and use this when a single shared registry is appropriate.
 * For multi-tenant or test scenarios, construct a fresh SchemaRegistry instead.
 */
export const globalSchemaRegistry = new SchemaRegistry();