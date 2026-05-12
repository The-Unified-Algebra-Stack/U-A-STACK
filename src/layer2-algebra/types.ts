/**
 * LAYER 2: DETERMINISTIC ALGEBRA
 * Core type definitions
 * 
 * Spec: Pages 3-6, 29-30
 */

/**
 * Type 1: Reducer Type
 * Spec: Page 3
 * 
 * R : (Σ, ι) → (Σ', I*)
 * Σ = state
 * ι = input
 * Σ' = new state
 * I* = free monoid of intents
 */
export type Reducer<Σ, ι = unknown> = (
  state: Σ,
  input: ι
) => readonly [Σ, readonly Intent[]]

/**
 * Type 2: Intent
 * From Layer 1
 */
export type Intent =
  | { readonly type: "SEND"; readonly to: string; readonly opcode: number; readonly payload: unknown }
  | { readonly type: "STORE"; readonly key: string; readonly value: unknown }
  | { readonly type: "SCHEDULE"; readonly reducerId: string; readonly delayMs: number }
  | { readonly type: "LOG"; readonly level: "info" | "warn" | "error"; readonly msg: string }
  | { readonly type: "EMIT"; readonly channel: string; readonly payload: unknown }
  | { readonly type: "LLM"; readonly model: string; readonly prompt: string; readonly maxTokens: number }

/**
 * Type 4: Projection Reducer
 * Spec: Page 5
 * 
 * Properties:
 * - kind: "projection"
 * - Commutative: Pᵢ ∘ Pⱼ = Pⱼ ∘ Pᵢ
 * - Idempotent: P(P(σ)) = P(σ)
 * - Order-independent
 */
export interface ProjectionReducer<Σ> {
  readonly kind: "projection"
  readonly id: string
  readonly apply: Reducer<Σ>
  /**
   * Proof obligation: apply(apply(σ)) = apply(σ) ∀σ
   * Verified at registration via test states
   */
  readonly testStates?: readonly Σ[]
}

/**
 * Type 5: Constraint Reducer
 * Spec: Page 5
 * 
 * Properties:
 * - kind: "constraint"
 * - Non-commutative: Cᵢ ∘ Cⱼ ≠ Cⱼ ∘ Cᵢ
 * - Not idempotent: C ∘ C ≠ C
 * - Order-dependent (semantic)
 */
export interface ConstraintReducer<Σ> {
  readonly kind: "constraint"
  readonly id: string
  readonly apply: Reducer<Σ>
  readonly order: number // Lower = runs first
  /**
   * Proof obligation: Cᵢ ∘ Cⱼ ≠ Cⱼ ∘ Cᵢ when i ≠ j
   * Verified by comparing reordered outputs
   */
  readonly testStates?: readonly Σ[]
}

/**
 * Type 6: Merge Algebra
 * Spec: Page 6
 * 
 * Properties:
 * - M(a, b) = M(b, a) [Commutative]
 * - M(M(a, b), c) = M(a, M(b, c)) [Associative]
 * - M(a, a) = a [Idempotent]
 * - a ⊆ M(a, b) [Monotone]
 */
export interface MergeAlgebra<Σ> {
  readonly merge: (a: Σ, b: Σ) => Σ
  readonly eq: (a: Σ, b: Σ) => boolean
  /**
   * CMA Law samples for verification
   */
  readonly samples?: readonly [Σ, Σ, Σ][]
}

/**
 * Dual Algebra Composition
 * Spec: Page 2, 5
 * 
 * Φ = Cₙ ∘ ⋯ ∘ C₁ ∘ Pₘ ∘ ⋯ ∘ P₁
 * 
 * Properties:
 * 1. Projections run first (any order)
 * 2. Constraints run after (strict order)
 * 3. Final result is deterministic, replayable
 */
export interface DualAlgebra<Σ> {
  readonly projections: readonly ProjectionReducer<Σ>[]
  readonly constraints: readonly ConstraintReducer<Σ>[]
  readonly phi: Reducer<Σ> // Φ = Cₙ ∘ ⋯ ∘ P₁
}

/**
 * Reducer Composition
 * Spec: Axiom 2, Pages 2-3
 * 
 * (R₃ ∘ R₂) ∘ R₁ ≡ R₃ ∘ (R₂ ∘ R₁) [associativity]
 * Unit: identity(σ) = [σ, []]
 * Op: [σ₁, i₁] ∘ [σ₂, i₂] = [σ₂, i₁ + i₂] [concat intents]
 */
export interface ReducerMonoid<Σ> {
  readonly identity: Reducer<Σ>
  readonly compose: (r1: Reducer<Σ>, r2: Reducer<Σ>) => Reducer<Σ>
}

/**
 * Verification Result
 */
export interface VerificationResult {
  readonly valid: boolean
  readonly errors: readonly string[]
  readonly details?: unknown
}

/**
 * Composition Test Result
 */
export interface CompositionTestResult extends VerificationResult {
  readonly associative: boolean
  readonly leftIdentity: boolean
  readonly rightIdentity: boolean
}

/**
 * Projection Test Result
 */
export interface ProjectionTestResult extends VerificationResult {
  readonly idempotent: boolean
  readonly commutative: boolean
}

/**
 * Constraint Test Result
 */
export interface ConstraintTestResult extends VerificationResult {
  readonly orderMatters: boolean
  readonly details?: {
    readonly ordered: unknown
    readonly reordered: unknown
  }
}

/**
 * Merge Test Result
 */
export interface MergeTestResult extends VerificationResult {
  readonly commutative: boolean
  readonly associative: boolean
  readonly idempotent: boolean
  readonly monotone: boolean
}