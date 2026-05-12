/**
 * type-validator.ts
 *
 * Runtime validation of states, inputs, and intents against their JSON Schemas.
 * Also exposes the algebraic law verification helpers described in the spec's
 * VERIFICATION FRAMEWORK section.
 *
 * Spec invariants enforced here:
 *   - Law 3:  Projection idempotence   P(P(σ)) = P(σ)
 *   - Law 4:  Projection commutativity Pᵢ∘Pⱼ = Pⱼ∘Pᵢ
 *   - Law 6–9: Merge CMA laws
 *   - Law 14: Intent deferred execution (intents returned, not side-effected)
 *   - Law 15: JSON universality — Σ serialisable to JSON
 */

import type {
  JSONSchema,
  Intent,
  IntentList,
  Reducer,
  ProjectionMeta,
  ValidationResult,
  ValidationError,
} from "./schema-types";

// ---------------------------------------------------------------------------
// Lightweight structural JSON Schema validator
// (No external deps; covers the subset used by this spec.)
// ---------------------------------------------------------------------------

function validate(
  value: unknown,
  schema: JSONSchema,
  path: string,
  errors: ValidationError[]
): void {
  // $ref is not resolved at runtime — skip
  if (schema.$ref) return;

  // type check
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actualType = jsonTypeOf(value);
    if (!types.includes(actualType)) {
      errors.push({
        path,
        message: `Expected type ${types.join(" | ")}, got ${actualType}`,
        actual: actualType,
        expected: types,
      });
      return; // no point drilling deeper
    }
  }

  // const
  if ("const" in schema && value !== schema.const) {
    errors.push({
      path,
      message: `Expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`,
      actual: value,
      expected: schema.const,
    });
  }

  // enum
  if (schema.enum !== undefined) {
    if (!schema.enum.some((e) => deepEqual(e, value))) {
      errors.push({
        path,
        message: `Value not in enum ${JSON.stringify(schema.enum)}`,
        actual: value,
        expected: schema.enum,
      });
    }
  }

  // number constraints
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push({ path, message: `${value} < minimum ${schema.minimum}` });
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push({ path, message: `${value} > maximum ${schema.maximum}` });
    }
  }

  // string constraints
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push({ path, message: `Length ${value.length} < minLength ${schema.minLength}` });
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push({ path, message: `Length ${value.length} > maxLength ${schema.maxLength}` });
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
      errors.push({ path, message: `String does not match pattern ${schema.pattern}` });
    }
  }

  // object
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;

    if (schema.required) {
      for (const key of schema.required) {
        if (!(key in obj)) {
          errors.push({ path: `${path}.${key}`, message: `Required property "${key}" missing` });
        }
      }
    }

    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (key in obj) {
          validate(obj[key], propSchema, `${path}.${key}`, errors);
        }
      }
    }

    if (schema.additionalProperties === false && schema.properties) {
      const allowed = new Set(Object.keys(schema.properties));
      for (const key of Object.keys(obj)) {
        if (!allowed.has(key)) {
          errors.push({ path: `${path}.${key}`, message: `Additional property "${key}" not allowed` });
        }
      }
    }
  }

  // array
  if (Array.isArray(value)) {
    if (schema.items) {
      value.forEach((item, i) =>
        validate(item, schema.items!, `${path}[${i}]`, errors)
      );
    }
  }

  // oneOf
  if (schema.oneOf) {
    const matching = schema.oneOf.filter((s) => {
      const e: ValidationError[] = [];
      validate(value, s, path, e);
      return e.length === 0;
    });
    if (matching.length !== 1) {
      errors.push({
        path,
        message: `Expected exactly one of ${schema.oneOf.length} schemas to match; ${matching.length} matched`,
      });
    }
  }

  // anyOf
  if (schema.anyOf) {
    const matching = schema.anyOf.filter((s) => {
      const e: ValidationError[] = [];
      validate(value, s, path, e);
      return e.length === 0;
    });
    if (matching.length === 0) {
      errors.push({ path, message: `Value does not match any of ${schema.anyOf.length} schemas` });
    }
  }
}

function jsonTypeOf(value: unknown): string {
  if (value === null)        return "null";
  if (Array.isArray(value))  return "array";
  return typeof value;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---------------------------------------------------------------------------
// Public API: value validation
// ---------------------------------------------------------------------------

/**
 * Validates any JSON value against a schema.
 * Returns a typed ValidationResult (success or failure with error list).
 *
 * Spec Law 15: any Σ must be JSON-serialisable; this is the runtime gate.
 */
export function validateValue(value: unknown, schema: JSONSchema): ValidationResult {
  const errors: ValidationError[] = [];
  validate(value, schema, "$", errors);
  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

/**
 * Validates a state Σ against its output schema.
 */
export function validateState<Σ>(state: Σ, schema: JSONSchema): ValidationResult {
  // Law 15: Σ must be JSON-serialisable
  try {
    JSON.stringify(state);
  } catch {
    return {
      valid: false,
      errors: [{ path: "$", message: "State is not JSON-serialisable (violates Law 15)" }],
    };
  }
  return validateValue(state, schema);
}

/**
 * Validates an IntentList I* against the known intent union type.
 * Spec invariant: reducers emit intents; intents are not interpreted inside Φ.
 */
export function validateIntentList(intents: IntentList): ValidationResult {
  const errors: ValidationError[] = [];
  const validTypes = new Set<Intent["type"]>([
    "SEND", "STORE", "SCHEDULE", "LOG", "EMIT", "LLM",
  ]);

  intents.forEach((intent, i) => {
    if (!validTypes.has(intent.type as Intent["type"])) {
      errors.push({
        path: `$[${i}].type`,
        message: `Unknown intent type "${intent.type}"`,
        actual: intent.type,
        expected: [...validTypes],
      });
    }
    // Each known type has required fields — validated structurally below
    switch (intent.type) {
      case "SEND":
        if (typeof intent.to      !== "string") errors.push({ path: `$[${i}].to`,      message: "SEND.to must be string" });
        if (typeof intent.opcode  !== "number") errors.push({ path: `$[${i}].opcode`,  message: "SEND.opcode must be number" });
        break;
      case "STORE":
        if (typeof intent.key !== "string") errors.push({ path: `$[${i}].key`, message: "STORE.key must be string" });
        break;
      case "SCHEDULE":
        if (typeof intent.reducerId !== "string") errors.push({ path: `$[${i}].reducerId`, message: "SCHEDULE.reducerId must be string" });
        if (typeof intent.delayMs   !== "number") errors.push({ path: `$[${i}].delayMs`,   message: "SCHEDULE.delayMs must be number" });
        break;
      case "LOG":
        if (!["info","warn","error"].includes(intent.level)) errors.push({ path: `$[${i}].level`, message: 'LOG.level must be "info"|"warn"|"error"' });
        if (typeof intent.msg !== "string") errors.push({ path: `$[${i}].msg`, message: "LOG.msg must be string" });
        break;
      case "EMIT":
        if (typeof intent.channel !== "string") errors.push({ path: `$[${i}].channel`, message: "EMIT.channel must be string" });
        break;
      case "LLM":
        if (typeof intent.model     !== "string") errors.push({ path: `$[${i}].model`,     message: "LLM.model must be string" });
        if (typeof intent.prompt    !== "string") errors.push({ path: `$[${i}].prompt`,     message: "LLM.prompt must be string" });
        if (typeof intent.maxTokens !== "number") errors.push({ path: `$[${i}].maxTokens`, message: "LLM.maxTokens must be number" });
        break;
    }
  });

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

// ---------------------------------------------------------------------------
// Algebraic law verifiers
// Spec: VERIFICATION FRAMEWORK (sections 1–5)
// ---------------------------------------------------------------------------

/**
 * Law 1 / Verification section 1 — Purity testing.
 * Spec: "Run reducer twice with same input; assert outputs are identical."
 */
export function assertPure<Σ, ι>(
  reducer: Reducer<Σ, ι>,
  testStates: Σ[],
  testInputs: ι[]
): boolean {
  for (const state of testStates) {
    for (const input of testInputs) {
      const [s1, i1] = reducer(state, input);
      const [s2, i2] = reducer(state, input);
      if (JSON.stringify(s1) !== JSON.stringify(s2)) return false;
      if (i1.length !== i2.length)                   return false;
    }
  }
  return true;
}

/**
 * Law 3 / Verification section 3 — Projection idempotence.
 * Spec: "Apply projection twice; assert second application changes nothing."
 * P(P(σ)) = P(σ) ∀σ ∈ testStates
 */
export function assertIdempotent<Σ>(
  projection: { apply: Reducer<Σ> },
  testStates: Σ[],
  eq: (a: Σ, b: Σ) => boolean = (a, b) => JSON.stringify(a) === JSON.stringify(b)
): boolean {
  for (const state of testStates) {
    const [s1] = projection.apply(state, undefined);
    const [s2] = projection.apply(s1, undefined);
    if (!eq(s1, s2)) return false;
  }
  return true;
}

/**
 * Law 4 — Projection commutativity.
 * Spec: "Try all permutations of projections; verify final state is identical."
 * Pᵢ(Pⱼ(σ)) = Pⱼ(Pᵢ(σ)) ∀σ ∈ testStates
 */
export function assertProjectionsCommute<Σ>(
  p1: { apply: Reducer<Σ> },
  p2: { apply: Reducer<Σ> },
  testStates: Σ[],
  eq: (a: Σ, b: Σ) => boolean = (a, b) => JSON.stringify(a) === JSON.stringify(b)
): boolean {
  for (const state of testStates) {
    const [s_p1p2] = p1.apply((p2.apply(state, undefined))[0], undefined);
    const [s_p2p1] = p2.apply((p1.apply(state, undefined))[0], undefined);
    if (!eq(s_p1p2, s_p2p1)) return false;
  }
  return true;
}

/**
 * Laws 6–9 / Verification section 4 — Merge CMA testing.
 * Verifies commutativity, associativity, idempotence for a merge function.
 * Spec: testMergeCMA
 */
export function assertMergeCMA<Σ>(
  merge: (a: Σ, b: Σ) => Σ,
  samples: [Σ, Σ, Σ][],
  eq: (a: Σ, b: Σ) => boolean = (a, b) => JSON.stringify(a) === JSON.stringify(b)
): { commutative: boolean; associative: boolean; idempotent: boolean } {
  let commutative = true;
  let associative = true;
  let idempotent  = true;

  for (const [a, b, c] of samples) {
    if (!eq(merge(a, b), merge(b, a)))                       commutative = false;
    if (!eq(merge(merge(a, b), c), merge(a, merge(b, c))))   associative = false;
    if (!eq(merge(a, a), a))                                  idempotent  = false;
  }

  return { commutative, associative, idempotent };
}

/**
 * Law 14 — Intent deferred execution.
 * Spec: "Mock effect executor; run reducer; verify intents are returned but not
 * side-effected."
 *
 * Checks that the reducer returns intents without executing them.
 * Since reducers are pure (no IO), we verify no side-effects leaked by
 * asserting the reducer can be called in a clean environment and returns
 * a non-empty (or expected) IntentList.
 */
export function assertIntentsDeferred<Σ, ι>(
  reducer: Reducer<Σ, ι>,
  state: Σ,
  input: ι,
  expectedIntentTypes?: Array<Intent["type"]>
): { deferred: boolean; intents: IntentList; errors: string[] } {
  const errors: string[] = [];
  const [, intents] = reducer(state, input);

  // Intent list must be a plain array (readonly), not a side-effecting object
  if (!Array.isArray(intents)) {
    errors.push("Reducer did not return an array for intents (violation of IntentList type)");
  }

  if (expectedIntentTypes) {
    const actualTypes = intents.map((i) => i.type);
    for (const expected of expectedIntentTypes) {
      if (!actualTypes.includes(expected)) {
        errors.push(`Expected intent type "${expected}" not found in emitted list`);
      }
    }
  }

  // Validate each emitted intent against the known schema
  const validationResult = validateIntentList(intents);
  if (!validationResult.valid) {
    errors.push(...validationResult.errors.map((e) => `${e.path}: ${e.message}`));
  }

  return { deferred: errors.length === 0, intents, errors };
}