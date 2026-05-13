/**
 * ============================================================
 * ENFORCEMENT ENGINE FOR UNIFIED INTELLIGENCE SYSTEM
 * ============================================================
 *
 * Multi-layer constraint system for guardrails:
 * - Content filtering (blocklist/allowlist)
 * - Token limiting
 * - Output validation
 * - Reasoning depth enforcement
 *
 * ============================================================
 */

export interface EnforcementViolation {
  ruleName: string;
  message: string;
  severity: 'warning' | 'error';
  data?: any;
}

export interface EnforcementResult {
  passed: boolean;
  violations: EnforcementViolation[];
  transformed?: string;
}

export interface ContentFilterConfig {
  blocklist?: string[];
  allowlist?: string[];
}

export interface OutputValidatorConfig {
  minLength?: number;
  maxLength?: number;
  required?: string[];
  forbidden?: string[];
}

export interface ReasoningDepthConfig {
  minDepth?: number;
  maxDepth?: number;
}

export interface EnforcementConfig {
  contentFilter?: ContentFilterConfig;
  tokenLimiter?: number;
  outputValidator?: OutputValidatorConfig;
  depthEnforcer?: ReasoningDepthConfig;
}

/**
 * Content Filter - Blocks/allows specific patterns
 */
export class ContentFilter {
  private blocklist: Set<string> = new Set();
  private allowlist: Set<string> = new Set();
  private useAllowlist: boolean = false;

  constructor(config: ContentFilterConfig = {}) {
    if (config.blocklist) {
      this.blocklist = new Set(
        config.blocklist.map((b) => b.toLowerCase())
      );
    }

    if (config.allowlist) {
      this.allowlist = new Set(
        config.allowlist.map((a) => a.toLowerCase())
      );
      this.useAllowlist = true;
    }
  }

  filter(text: string): EnforcementResult {
    const violations: EnforcementViolation[] = [];
    const lower = text.toLowerCase();

    if (this.useAllowlist) {
      // Allowlist mode: only allow specified patterns
      let allowed = false;
      for (const pattern of this.allowlist) {
        if (lower.includes(pattern)) {
          allowed = true;
          break;
        }
      }
      if (!allowed) {
        violations.push({
          ruleName: 'ContentFilter:Allowlist',
          message: `Content does not match any allowed patterns`,
          severity: 'error',
        });
      }
    } else {
      // Blocklist mode: block specified patterns
      for (const pattern of this.blocklist) {
        if (lower.includes(pattern)) {
          violations.push({
            ruleName: 'ContentFilter:Blocklist',
            message: `Content contains blocked pattern: "${pattern}"`,
            severity: 'error',
            data: { pattern },
          });
        }
      }
    }

    return {
      passed: violations.length === 0,
      violations,
    };
  }

  addBlocklist(patterns: string[]): void {
    patterns.forEach((p) =>
      this.blocklist.add(p.toLowerCase())
    );
  }

  addAllowlist(patterns: string[]): void {
    patterns.forEach((p) =>
      this.allowlist.add(p.toLowerCase())
    );
  }

  clearBlocklist(): void {
    this.blocklist.clear();
  }

  clearAllowlist(): void {
    this.allowlist.clear();
  }
}

/**
 * Token Limiter - Enforces token count limits
 */
export class TokenLimiter {
  private limit: number;

  constructor(limit: number = 2048) {
    this.limit = limit;
  }

  estimate(text: string): number {
    // Rough heuristic: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
  }

  truncate(text: string): string {
    const maxChars = this.limit * 4;
    if (text.length > maxChars) {
      return text.substring(0, maxChars - 3) + '...';
    }
    return text;
  }

  enforce(text: string): EnforcementResult {
    const tokens = this.estimate(text);
    const violations: EnforcementViolation[] = [];

    if (tokens > this.limit) {
      violations.push({
        ruleName: 'TokenLimiter',
        message: `Token count ${tokens} exceeds limit of ${this.limit}`,
        severity: 'error',
        data: { tokens, limit: this.limit },
      });
    }

    return {
      passed: violations.length === 0,
      violations,
      transformed: this.truncate(text),
    };
  }

  setLimit(limit: number): void {
    this.limit = limit;
  }
}

/**
 * Output Validator - Checks quality and constraints
 */
export class OutputValidator {
  private minLength: number;
  private maxLength: number;
  private required: Set<string> = new Set();
  private forbidden: Set<string> = new Set();

  constructor(config: OutputValidatorConfig = {}) {
    this.minLength = config.minLength ?? 0;
    this.maxLength = config.maxLength ?? 10000;

    if (config.required) {
      this.required = new Set(
        config.required.map((r) => r.toLowerCase())
      );
    }

    if (config.forbidden) {
      this.forbidden = new Set(
        config.forbidden.map((f) => f.toLowerCase())
      );
    }
  }

  validate(text: string): EnforcementResult {
    const violations: EnforcementViolation[] = [];
    const lower = text.toLowerCase();

    // Length checks
    if (text.length < this.minLength) {
      violations.push({
        ruleName: 'OutputValidator:MinLength',
        message: `Output length ${text.length} is below minimum of ${this.minLength}`,
        severity: 'warning',
        data: { length: text.length, minLength: this.minLength },
      });
    }

    if (text.length > this.maxLength) {
      violations.push({
        ruleName: 'OutputValidator:MaxLength',
        message: `Output length ${text.length} exceeds maximum of ${this.maxLength}`,
        severity: 'error',
        data: { length: text.length, maxLength: this.maxLength },
      });
    }

    // Required patterns
    for (const pattern of this.required) {
      if (!lower.includes(pattern)) {
        violations.push({
          ruleName: 'OutputValidator:Required',
          message: `Output missing required pattern: "${pattern}"`,
          severity: 'warning',
          data: { pattern },
        });
      }
    }

    // Forbidden patterns
    for (const pattern of this.forbidden) {
      if (lower.includes(pattern)) {
        violations.push({
          ruleName: 'OutputValidator:Forbidden',
          message: `Output contains forbidden pattern: "${pattern}"`,
          severity: 'error',
          data: { pattern },
        });
      }
    }

    return {
      passed: violations.filter(
        (v) => v.severity === 'error'
      ).length === 0,
      violations,
    };
  }
}

/**
 * Reasoning Depth Enforcer - Limits recursion depth
 */
export class ReasoningDepthEnforcer {
  private minDepth: number;
  private maxDepth: number;

  constructor(config: ReasoningDepthConfig = {}) {
    this.minDepth = config.minDepth ?? 1;
    this.maxDepth = config.maxDepth ?? 8;
  }

  validate(
    depth: number
  ): { valid: boolean; enforcedDepth: number; violations: EnforcementViolation[] } {
    const violations: EnforcementViolation[] = [];
    let enforcedDepth = Math.max(
      this.minDepth,
      Math.min(depth, this.maxDepth)
    );

    if (depth < this.minDepth) {
      violations.push({
        ruleName: 'ReasoningDepthEnforcer:MinDepth',
        message: `Reasoning depth ${depth} is below minimum of ${this.minDepth}`,
        severity: 'warning',
        data: { depth, minDepth: this.minDepth },
      });
      enforcedDepth = this.minDepth;
    }

    if (depth > this.maxDepth) {
      violations.push({
        ruleName: 'ReasoningDepthEnforcer:MaxDepth',
        message: `Reasoning depth ${depth} exceeds maximum of ${this.maxDepth}, capped at ${this.maxDepth}`,
        severity: 'warning',
        data: { depth, maxDepth: this.maxDepth },
      });
      enforcedDepth = this.maxDepth;
    }

    return {
      valid: violations.length === 0,
      enforcedDepth,
      violations,
    };
  }
}

/**
 * Main Enforcement Engine - Orchestrates all rules
 */
export class EnforcementEngine {
  private contentFilter: ContentFilter | null = null;
  private tokenLimiter: TokenLimiter | null = null;
  private outputValidator: OutputValidator | null = null;
  private depthEnforcer: ReasoningDepthEnforcer | null = null;
  private rules: Map<string, boolean> = new Map();

  constructor(config: EnforcementConfig = {}) {
    if (config.contentFilter) {
      this.contentFilter = new ContentFilter(
        config.contentFilter
      );
      this.rules.set('contentFilter', true);
    }

    if (config.tokenLimiter) {
      this.tokenLimiter = new TokenLimiter(config.tokenLimiter);
      this.rules.set('tokenLimiter', true);
    }

    if (config.outputValidator) {
      this.outputValidator = new OutputValidator(
        config.outputValidator
      );
      this.rules.set('outputValidator', true);
    }

    if (config.depthEnforcer) {
      this.depthEnforcer = new ReasoningDepthEnforcer(
        config.depthEnforcer
      );
      this.rules.set('depthEnforcer', true);
    }
  }

  enforceInput(input: string): EnforcementResult {
    const violations: EnforcementViolation[] = [];

    if (
      this.contentFilter &&
      this.rules.get('contentFilter')
    ) {
      const result = this.contentFilter.filter(input);
      violations.push(...result.violations);
    }

    return {
      passed: violations.length === 0,
      violations,
    };
  }

  enforceOutput(output: string): EnforcementResult {
    const violations: EnforcementViolation[] = [];
    let transformed = output;

    if (
      this.contentFilter &&
      this.rules.get('contentFilter')
    ) {
      const result = this.contentFilter.filter(output);
      violations.push(...result.violations);
    }

    if (
      this.tokenLimiter &&
      this.rules.get('tokenLimiter')
    ) {
      const result = this.tokenLimiter.enforce(output);
      violations.push(...result.violations);
      if (result.transformed) {
        transformed = result.transformed;
      }
    }

    if (
      this.outputValidator &&
      this.rules.get('outputValidator')
    ) {
      const result = this.outputValidator.validate(transformed);
      violations.push(...result.violations);
    }

    return {
      passed: violations.filter(
        (v) => v.severity === 'error'
      ).length === 0,
      violations,
      transformed,
    };
  }

  enforceDepth(depth: number): {
    valid: boolean;
    enforcedDepth: number;
    violations: EnforcementViolation[];
  } {
    if (
      !this.depthEnforcer ||
      !this.rules.get('depthEnforcer')
    ) {
      return { valid: true, enforcedDepth: depth, violations: [] };
    }

    return this.depthEnforcer.validate(depth);
  }

  enableRule(ruleName: string): void {
    this.rules.set(ruleName, true);
  }

  disableRule(ruleName: string): void {
    this.rules.set(ruleName, false);
  }

  getRules(): Map<string, boolean> {
    return new Map(this.rules);
  }

  getContentFilter(): ContentFilter | null {
    return this.contentFilter;
  }

  getTokenLimiter(): TokenLimiter | null {
    return this.tokenLimiter;
  }

  getOutputValidator(): OutputValidator | null {
    return this.outputValidator;
  }

  getDepthEnforcer(): ReasoningDepthEnforcer | null {
    return this.depthEnforcer;
  }
}

export default EnforcementEngine;
