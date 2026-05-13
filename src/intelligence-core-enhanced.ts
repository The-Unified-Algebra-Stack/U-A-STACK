/**
 * ============================================================
 * ENHANCED INTELLIGENCE CORE WITH OLLAMA + ENFORCEMENT
 * ============================================================
 *
 * Integrates:
 * - Original intelligence components (kept intact)
 * - Ollama LLM backbone for generation
 * - Enforcement engine for guardrails
 *
 * ============================================================
 */

import { EventEmitter } from 'events';
import crypto from 'crypto';
import OllamaBackbone, { OllamaConfig } from './ollama-backbone';
import {
  EnforcementEngine,
  EnforcementConfig,
  EnforcementResult,
  EnforcementViolation,
} from './enforcement-engine';

// ============================================================
// UTILITIES
// ============================================================

const uid = (() => {
  let i = 0;
  return (p = '') =>
    `${p}${Date.now().toString(36)}_${(i++).toString(36)}`;
})();

const sleep = (ms: number) =>
  new Promise((r) => setTimeout(r, ms));

// ============================================================
// MATHEMATICS CORE (from original)
// ============================================================

const M = {
  rand: () => Math.random() * 2 - 1,

  dot(a: number[], b: number[]) {
    let s = 0;
    for (let i = 0; i < a.length; i++) {
      s += a[i] * b[i];
    }
    return s;
  },

  mag(v: number[]) {
    return Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  },

  norm(v: number[]) {
    const m = this.mag(v) + 1e-8;
    return v.map((x) => x / m);
  },

  softmax(arr: number[]) {
    const max = Math.max(...arr);
    const exps = arr.map((v) => Math.exp(v - max));
    const sum = exps.reduce((a, b) => a + b, 0);
    return exps.map((v) => v / sum);
  },

  cosine(a: number[], b: number[]) {
    return (
      this.dot(a, b) /
      (this.mag(a) * this.mag(b) + 1e-8)
    );
  },

  add(a: number[], b: number[]) {
    return a.map((x, i) => x + b[i]);
  },

  avg(vs: number[][]) {
    const out = Array(vs[0].length).fill(0);
    for (const v of vs) {
      for (let i = 0; i < v.length; i++) {
        out[i] += v[i];
      }
    }
    return out.map((v) => v / vs.length);
  },

  entropy(ps: number[]) {
    return -ps.reduce(
      (s, p) => (s += p ? p * Math.log2(p) : 0),
      0
    );
  },
};

// ============================================================
// LOGGER
// ============================================================

class Logger {
  private levels: Record<string, number>;
  private level: number;
  private context: string;

  constructor({
    level = 'info',
    context = 'SYSTEM',
  }: {
    level?: string;
    context?: string;
  } = {}) {
    this.levels = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
    };

    this.level = this.levels[level] ?? 1;
    this.context = context;
  }

  out(type: string, ...args: any[]) {
    if (this.levels[type] < this.level) return;

    console.log(
      `[${new Date().toISOString()}][${type.toUpperCase()}][${
        this.context
      }]`,
      ...args
    );
  }

  debug(...a: any[]) {
    this.out('debug', ...a);
  }
  info(...a: any[]) {
    this.out('info', ...a);
  }
  warn(...a: any[]) {
    this.out('warn', ...a);
  }
  error(...a: any[]) {
    this.out('error', ...a);
  }
}

// ============================================================
// TOKENIZER
// ============================================================

class Tokenizer {
  tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
  }
}

// ============================================================
// EMBEDDINGS
// ============================================================

class Embeddings {
  private dim: number;
  private vocab: Map<string, number[]> = new Map();

  constructor(dim: number = 256) {
    this.dim = dim;
  }

  vector(token: string): number[] {
    if (!this.vocab.has(token)) {
      this.vocab.set(
        token,
        M.norm(
          Array(this.dim)
            .fill(0)
            .map(() => M.rand())
        )
      );
    }
    return this.vocab.get(token)!;
  }

  positional(i: number): number[] {
    const out: number[] = [];
    for (let k = 0; k < this.dim; k++) {
      if (k % 2 === 0) {
        out.push(
          Math.sin(
            i / Math.pow(10000, k / this.dim)
          )
        );
      } else {
        out.push(
          Math.cos(
            i / Math.pow(10000, k / this.dim)
          )
        );
      }
    }
    return out;
  }

  encode(tokens: string[]): number[][] {
    return tokens.map((t, i) =>
      M.add(this.vector(t), this.positional(i))
    );
  }
}

// ============================================================
// ATTENTION
// ============================================================

class Attention {
  private dim: number;

  constructor(dim: number = 256) {
    this.dim = dim;
  }

  forward(vs: number[][]): number[][] {
    const out: number[][] = [];

    for (let i = 0; i < vs.length; i++) {
      const scores: number[] = [];

      for (let j = 0; j < vs.length; j++) {
        scores.push(
          M.dot(vs[i], vs[j]) / Math.sqrt(this.dim)
        );
      }

      const weights = M.softmax(scores);
      const vec = Array(this.dim).fill(0);

      for (let j = 0; j < vs.length; j++) {
        for (let k = 0; k < this.dim; k++) {
          vec[k] += vs[j][k] * weights[j];
        }
      }

      out.push(vec);
    }

    return out;
  }
}

// ============================================================
// MULTIHEAD ATTENTION
// ============================================================

class MultiheadAttention {
  private heads: Attention[];

  constructor({
    heads = 8,
    dim = 256,
  }: { heads?: number; dim?: number } = {}) {
    this.heads = Array(heads)
      .fill(0)
      .map(() => new Attention(dim));
  }

  forward(vs: number[][]): number[][] {
    const outputs = this.heads.map((h) => h.forward(vs));
    return outputs[0].map((_, i) =>
      outputs.flatMap((h) => h[i])
    );
  }
}

// ============================================================
// SPARSE EXPERTS
// ============================================================

class SparseExperts {
  private count: number;

  constructor(count: number = 8) {
    this.count = count;
  }

  route(v: number[]): number[] {
    const winner = Math.floor(Math.random() * this.count);
    return v.map((x) => Math.tanh(x * (winner + 1)));
  }

  forward(vs: number[][]): number[][] {
    return vs.map((v) => this.route(v));
  }
}

// ============================================================
// MEMORY SYSTEM
// ============================================================

class HyperMemory {
  private limit: number;
  private short: number[][] = [];
  private semantic: number[][] = [];

  constructor(limit: number = 4096) {
    this.limit = limit;
  }

  store(v: number[]): void {
    this.short.push(v);

    if (this.short.length > this.limit) {
      this.compress();
    }
  }

  compress(): void {
    const next: number[][] = [];

    while (this.short.length > 1) {
      const a = this.short.pop()!;
      const b = this.short.pop()!;
      next.push(M.avg([a, b]));
    }

    this.semantic.push(...next);
  }

  retrieve(
    v: number[],
    topK: number = 5
  ): Array<{ memory: number[]; score: number }> {
    return [...this.short, ...this.semantic]
      .map((m) => ({
        memory: m,
        score: M.cosine(v, m),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}

// ============================================================
// WORLD MODEL
// ============================================================

class WorldModel {
  private graph: Map<string, string[]> = new Map();

  observe(tokens: string[]): void {
    for (let i = 0; i < tokens.length - 1; i++) {
      const a = tokens[i];
      const b = tokens[i + 1];

      if (!this.graph.has(a)) {
        this.graph.set(a, []);
      }

      this.graph.get(a)!.push(b);
    }
  }

  predict(token: string): string[] {
    return this.graph.get(token) || [];
  }
}

// ============================================================
// SPECULATIVE ENGINE
// ============================================================

class SpeculativeEngine {
  private closures: Array<{ id: string; fn: () => Promise<any> }> =
    [];

  add(fn: () => Promise<any>): void {
    this.closures.push({
      id: uid('spec_'),
      fn,
    });
  }

  async collapse(topK: number = 1): Promise<any[]> {
    const scored = await Promise.all(
      this.closures.map(async (c) => ({
        c,
        score:
          typeof (await c.fn()) === 'number'
            ? await c.fn()
            : Math.random(),
      }))
    );

    scored.sort((a, b) => b.score - a.score);

    return Promise.all(
      scored
        .slice(0, topK)
        .map((x) => x.c.fn())
    );
  }
}

// ============================================================
// THOUGHT OUTPUT TYPE
// ============================================================

export interface ThoughtOutput {
  id: string;
  input: string;
  tokens: string[];
  entropy: number;
  compute: number;
  reasoning: string;
  distilled: string;
  predictions: string[];
  retrieval: Array<{ memory: number[]; score: number }>;
  speculative: any[];
  intelligence: number;
  principle: string;
  ollamaGeneration?: string;
  enforcementResult?: EnforcementResult;
}

// ============================================================
// ENHANCED INTELLIGENCE CORE
// ============================================================

export class IntelligenceCore extends EventEmitter {
  private tokenizer: Tokenizer;
  private embeddings: Embeddings;
  private attention: MultiheadAttention;
  private experts: SparseExperts;
  private memory: HyperMemory;
  private world: WorldModel;
  private speculative: SpeculativeEngine;
  private logger: Logger;
  private ollama: OllamaBackbone | null = null;
  private enforcement: EnforcementEngine | null = null;
  private identity: string;

  constructor({
    dim = 256,
    heads = 8,
    experts = 8,
    memory = 4096,
    logger = new Logger({ context: 'AGI' }),
    ollama,
    enforcement,
  }: {
    dim?: number;
    heads?: number;
    experts?: number;
    memory?: number;
    logger?: Logger;
    ollama?: OllamaConfig;
    enforcement?: EnforcementConfig;
  } = {}) {
    super();

    this.logger = logger;
    this.tokenizer = new Tokenizer();
    this.embeddings = new Embeddings(dim);
    this.attention = new MultiheadAttention({ heads, dim });
    this.experts = new SparseExperts(experts);
    this.memory = new HyperMemory(memory);
    this.world = new WorldModel();
    this.speculative = new SpeculativeEngine();
    this.identity =
      'Recursive Predictive Compression';

    if (ollama) {
      this.ollama = new OllamaBackbone(ollama);
    }

    if (enforcement) {
      this.enforcement = new EnforcementEngine(enforcement);
    }
  }

  private entropy(vs: number[][]): number {
    const probs = vs[0]
      .slice(0, 16)
      .map((x) => Math.abs(x));

    const sum = probs.reduce((a, b) => a + b, 0);

    return M.entropy(probs.map((x) => x / sum));
  }

  private reason(input: string, depth: number): string {
    let x = input;

    for (let i = 0; i < depth; i++) {
      x = `Abstract(${x})`;
    }

    return x;
  }

  private distill(text: string): string {
    return text
      .split(/\s+/)
      .filter((_, i) => i % 2 === 0)
      .join(' ');
  }

  private intelligenceMetric({
    predictive,
    abstraction,
    transfer,
    entropy,
    compute,
  }: {
    predictive: number;
    abstraction: number;
    transfer: number;
    entropy: number;
    compute: number;
  }): number {
    return (
      (predictive * abstraction * transfer) /
      (entropy * compute)
    );
  }

  async isOllamaAvailable(): Promise<boolean> {
    if (!this.ollama) return false;
    return this.ollama.isAvailable();
  }

  async think(input: string): Promise<ThoughtOutput> {
    this.logger.info('THINK', input);

    /* ENFORCE INPUT */
    let enforcementInput: EnforcementResult | undefined;
    if (this.enforcement) {
      enforcementInput = this.enforcement.enforceInput(input);
      if (!enforcementInput.passed) {
        this.logger.warn(
          'Input enforcement violations:',
          enforcementInput.violations
        );
      }
    }

    /* TOKENIZATION */
    const tokens = this.tokenizer.tokenize(input);

    /* EMBEDDINGS */
    const vectors = this.embeddings.encode(tokens);

    /* ATTENTION */
    const attended = this.attention.forward(vectors);

    /* SPARSE ROUTING */
    const routed = this.experts.forward(attended);

    /* MEMORY */
    routed.forEach((v) => this.memory.store(v));

    /* WORLD MODEL */
    this.world.observe(tokens);

    /* ENTROPY */
    const entropy = this.entropy(routed);

    /* ADAPTIVE COMPUTE */
    let compute = Math.max(1, Math.floor(entropy * 10));

    /* ENFORCE DEPTH */
    if (this.enforcement) {
      const depthResult = this.enforcement.enforceDepth(compute);
      compute = depthResult.enforcedDepth;
    }

    /* REASONING */
    const reasoning = this.reason(input, compute);

    /* DISTILLATION */
    const distilled = this.distill(reasoning);

    /* RETRIEVAL */
    const retrieval = this.memory.retrieve(routed[0]);

    /* PREDICTION */
    const predictions = this.world.predict(tokens[0]);

    /* SPECULATION */
    this.speculative.add(async () => Math.random());
    const speculative = await this.speculative.collapse(1);

    /* OLLAMA GENERATION */
    let ollamaGeneration: string | undefined;
    if (this.ollama && (await this.isOllamaAvailable())) {
      try {
        const prompt = `${reasoning}\n\n${distilled}`;
        ollamaGeneration = await this.ollama.generate(prompt, {
          maxTokens: 512,
        });
      } catch (error) {
        this.logger.warn('Ollama generation failed:', error);
      }
    }

    /* METRIC */
    const intelligence = this.intelligenceMetric({
      predictive: 1 - entropy,
      abstraction: compute,
      transfer: retrieval.length + 1,
      entropy,
      compute,
    });

    /* ENFORCE OUTPUT */
    let enforcementResult: EnforcementResult | undefined;
    if (this.enforcement && ollamaGeneration) {
      enforcementResult = this.enforcement.enforceOutput(
        ollamaGeneration
      );
      if (!enforcementResult.passed) {
        this.logger.warn(
          'Output enforcement violations:',
          enforcementResult.violations
        );
      }
    }

    const out: ThoughtOutput = {
      id: uid('thought_'),
      input,
      tokens,
      entropy,
      compute,
      reasoning,
      distilled,
      predictions,
      retrieval,
      speculative,
      intelligence,
      principle: this.identity,
      ollamaGeneration,
      enforcementResult,
    };

    this.emit('thought', out);

    return out;
  }
}

// ============================================================
// METAWEAVE WITH OLLAMA + ENFORCEMENT
// ============================================================

export interface MetaWeaveConfig {
  iterations?: number;
  logger?: Logger;
  ollama?: OllamaConfig;
  enforcement?: EnforcementConfig;
}

export class MetaWeave extends EventEmitter {
  private logger: Logger;
  private iterations: number;
  private core: IntelligenceCore;
  private state: 'idle' | 'running' = 'idle';

  constructor(config: MetaWeaveConfig = {}) {
    super();

    this.logger =
      config.logger ||
      new Logger({ context: 'MetaWeave' });

    this.iterations = config.iterations ?? 10;

    this.core = new IntelligenceCore({
      logger: this.logger,
      ollama: config.ollama,
      enforcement: config.enforcement,
    });
  }

  async emergeloop({
    input = 'Intelligence emerges from recursive predictive compression',
  }: { input?: string } = {}): Promise<ThoughtOutput[]> {
    this.state = 'running';

    let current = input;
    const outputs: ThoughtOutput[] = [];

    for (let i = 0; i < this.iterations; i++) {
      const out = await this.core.think(current);

      outputs.push(out);

      current = out.distilled;

      this.emit('iteration', i, out);

      await sleep(1);
    }

    this.state = 'idle';

    return outputs;
  }

  getState(): string {
    return this.state;
  }

  async checkOllamaStatus(): Promise<boolean> {
    return this.core.isOllamaAvailable();
  }
}

export default IntelligenceCore;
