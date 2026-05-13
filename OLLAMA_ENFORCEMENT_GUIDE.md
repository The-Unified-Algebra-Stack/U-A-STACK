# Ollama + Enforcement Integration Guide

## Overview

This guide explains how to integrate **Ollama** (local LLM) as the backbone of your Unified Intelligence System with **Enforcement constraints** to control reasoning depth, output quality, and content safety.

## Architecture

```
Input
  ↓
[Tokenizer] → [Embeddings] → [Attention] → [Sparse Experts]
  ↓
[Memory] → [World Model] → [Speculative Engine]
  ↓
[Reasoning] → [Distillation]
  ↓
[OLLAMA LLM BACKBONE] ← Generates creative/semantic content
  ↓
[ENFORCEMENT ENGINE] ← Validates & enforces constraints
  ↓
Output (Thought)
```

## Prerequisites

### 1. Install Ollama

Download from [ollama.ai](https://ollama.ai)

### 2. Run Ollama Service

```bash
ollama serve
```

### 3. Download a Model

```bash
# Popular options:
ollama pull mistral        # Fast, 7B parameters
ollama pull llama2         # Solid general-purpose
ollama pull neural-chat    # Optimized for conversation
ollama pull dolphin-mixtral # More creative
```

### 4. Install Node Dependencies

```bash
npm install axios
```

## Configuration

### Ollama Configuration

```typescript
const ollamaConfig = {
  baseURL: 'http://localhost:11434',  // Ollama service endpoint
  model: 'mistral',                    // Model name
  temperature: 0.7,                    // Creativity (0-1)
  topK: 40,                            // Top-K sampling
  topP: 0.9,                           // Nucleus sampling
  context: [],                         // Conversation context
  timeout: 30000,                      // Request timeout (ms)
};
```

**Temperature Tuning:**
- `0.1 - 0.3`: Focused, deterministic
- `0.5 - 0.7`: Balanced (recommended)
- `0.9 - 1.0`: Creative, varied

### Enforcement Configuration

```typescript
const enforcementConfig = {
  contentFilter: {
    blocklist: ['illegal', 'harmful', 'dangerous'],
    allowlist: ['helpful', 'safe', 'constructive'],
  },
  
  tokenLimiter: 2048,  // Max tokens in output
  
  outputValidator: {
    minLength: 10,      // Minimum output length
    maxLength: 1000,    // Maximum output length
    required: ['response', 'reasoning'],  // Required patterns
    forbidden: ['REDACTED', 'ERROR'],     // Forbidden words
  },
  
  depthEnforcer: {
    minDepth: 1,        // Minimum reasoning iterations
    maxDepth: 8,        // Maximum reasoning iterations
  },
};
```

## Usage Examples

### Basic Usage

```typescript
import { MetaWeave } from './intelligence-core-enhanced';

const agi = new MetaWeave({
  iterations: 5,
  ollama: {
    model: 'mistral',
    temperature: 0.7,
  },
  enforcement: {
    tokenLimiter: 2048,
  },
});

const outputs = await agi.emergeloop({
  input: 'How can we build better systems?',
});

console.log(outputs[0].ollamaGeneration);  // LLM output
console.log(outputs[0].intelligence);      // Intelligence metric
```

### Advanced with Custom Rules

```typescript
import { IntelligenceCore, EnforcementEngine } from './intelligence-core-enhanced';

const core = new IntelligenceCore({
  ollama: {
    model: 'llama2',
    temperature: 0.5,
  },
  enforcement: {
    contentFilter: {
      blocklist: ['violence', 'hate'],
    },
    outputValidator: {
      required: ['because'],  // Require reasoning
      minLength: 50,
    },
    depthEnforcer: {
      maxDepth: 6,
    },
  },
});

const thought = await core.think('What is intelligence?');

if (thought.enforcementResult.passed) {
  console.log('✓ Output passed all checks');
  console.log(thought.ollamaGeneration);
} else {
  console.log('✗ Enforcement violations:');
  thought.enforcementResult.violations.forEach(v => {
    console.log(`  - ${v.ruleName}: ${v.message}`);
  });
}
```

### Checking Ollama Status

```typescript
const agi = new MetaWeave({
  ollama: { model: 'mistral' },
});

const available = await agi.checkOllamaStatus();
if (!available) {
  console.log('Ollama not running. Start with: ollama serve');
}
```

## Enforcement Rules

### ContentFilter
- Blocks specified patterns
- Optionally allows only specified patterns
- Applied before output is returned

```typescript
const filter = new ContentFilter({
  blocklist: ['unsafe1', 'unsafe2'],
  allowlist: ['safe1', 'safe2'],  // optional: whitelist mode
});

const result = filter.filter('some text');
```

### TokenLimiter
- Estimates token count (1 token ≈ 4 characters)
- Prevents outputs exceeding limit
- Can truncate to fit

```typescript
const limiter = new TokenLimiter(2048);
const estimated = limiter.estimate(text);
if (estimated > 2048) {
  const truncated = limiter.truncate(text);
}
```

### OutputValidator
- Checks min/max length
- Validates required/forbidden patterns
- Ensures quality standards

```typescript
const validator = new OutputValidator({
  minLength: 10,
  maxLength: 5000,
  required: ['because', 'however'],  // reasoning indicators
  forbidden: ['ERROR', 'FAIL'],
});

const result = validator.validate(output);
```

### ReasoningDepthEnforcer
- Limits recursive reasoning iterations
- Prevents infinite loops
- Balances quality vs compute

```typescript
const enforcer = new ReasoningDepthEnforcer({
  minDepth: 1,
  maxDepth: 8,
});

const { valid, enforcedDepth } = enforcer.validate(proposedDepth);
```

## Integration with Intelligence Components

### Memory + Ollama
Memory system stores embeddings for retrieval:
```typescript
const thought = await core.think(input);
console.log(thought.retrieval);  // Retrieved from memory
console.log(thought.ollamaGeneration);  // Generated by Ollama
```

### World Model + Ollama
World model provides context for generation:
```typescript
const thought = await core.think('What follows X?');
console.log(thought.predictions);  // Predicted next tokens
console.log(thought.ollamaGeneration);  // LLM elaboration
```

### Attention + Ollama
Attention produces context vectors for LLM:
```typescript
// Attended vectors are passed through reasoning pipeline
// Then used as prompt context for Ollama
```

## Troubleshooting

### Ollama Connection Failed
```
Error: connect ECONNREFUSED 127.0.0.1:11434
```
**Solution:** Start Ollama service with `ollama serve`

### Model Not Found
```
Error: model not found
```
**Solution:** Download model with `ollama pull mistral`

### Slow Generation
- Reduce `temperature` for faster deterministic output
- Increase `topK` for broader sampling
- Reduce `maxTokens` in generation options

### Enforcement Violations
Check violation messages:
```typescript
if (!result.passed) {
  result.violations.forEach(v => {
    console.log(`[${v.severity}] ${v.ruleName}`);
    console.log(`  ${v.message}`);
  });
}
```

## Performance Optimization

### Local Model Selection
| Model | Speed | Quality | Memory | Best For |
|-------|-------|---------|--------|----------|
| mistral-7b | Fast | Good | 4GB | Default choice |
| llama2-7b | Medium | Very Good | 4GB | Balanced |
| neural-chat | Fast | Good | 4GB | Conversation |
| dolphin-mixtral | Slow | Excellent | 48GB | Quality-focused |

### Batch Processing
```typescript
async function processMultiple(inputs: string[]) {
  const results = [];
  for (const input of inputs) {
    const thought = await core.think(input);
    results.push(thought);
  }
  return results;
}
```

### Caching Responses
```typescript
const cache = new Map();

async function thinkWithCache(input: string) {
  if (cache.has(input)) {
    return cache.get(input);
  }
  const result = await core.think(input);
  cache.set(input, result);
  return result;
}
```

## API Reference

### MetaWeave

```typescript
class MetaWeave extends EventEmitter {
  constructor(config: MetaWeaveConfig);
  
  async emergeloop(config?: { input?: string }): Promise<ThoughtOutput[]>;
  getState(): string;  // 'idle' | 'running'
  async checkOllamaStatus(): Promise<boolean>;
  
  // Events
  on('iteration', (index: number, output: ThoughtOutput) => void);
}
```

### IntelligenceCore

```typescript
class IntelligenceCore extends EventEmitter {
  constructor(config: IntelligenceCoreConfig);
  
  async think(input: string): Promise<ThoughtOutput>;
  async isOllamaAvailable(): Promise<boolean>;
  setOllamaModel(model: string): void;
  getEnforcementRules(): EnforcementRule[];
  
  // Events
  on('thought', (output: ThoughtOutput) => void);
}
```

### OllamaBackbone

```typescript
class OllamaBackbone {
  async generate(prompt: string, options?: GenerationOptions): Promise<string>;
  async *generateStreaming(prompt: string, options?: GenerationOptions): AsyncGenerator<string>;
  async embed(text: string): Promise<number[]>;
  async chat(messages: Array<{ role: string; content: string }>): Promise<string>;
  async isAvailable(): Promise<boolean>;
  getAvailableModels(): Promise<string[]>;
  resetContext(): void;
  setModel(model: string): void;
}
```

### EnforcementEngine

```typescript
class EnforcementEngine {
  enforceInput(input: string): EnforcementResult;
  enforceOutput(output: string): EnforcementResult;
  enforceDepth(depth: number): { valid: boolean; enforcedDepth: number };
  addRule(rule: EnforcementRule): void;
  getRules(): EnforcementRule[];
  enableRule(ruleId: string): void;
  disableRule(ruleId: string): void;
}
```

## Output Format

### ThoughtOutput
```typescript
interface ThoughtOutput {
  id: string;                    // Unique thought ID
  input: string;                 // Original input
  tokens: string[];              // Tokenized input
  entropy: number;               // Information entropy
  compute: number;               // Reasoning depth (enforced)
  reasoning: string;             // Recursive abstraction
  distilled: string;             // Compressed representation
  predictions: string[];         // Predicted next tokens
  retrieval: Array<{             // Retrieved memories
    memory: number[];
    score: number;
  }>;
  speculative: number[];         // Speculative scores
  intelligence: number;          // Intelligence metric
  principle: string;             // Core principle
  ollamaGeneration?: string;     // LLM generation
  enforcementResult?: {           // Enforcement status
    passed: boolean;
    violations: EnforcementViolation[];
    transformed?: string;
  };
}
```

## Examples

See `examples/ollama-enforcement-example.ts` for complete working example.

## Best Practices

1. **Always check Ollama availability** before relying on generation
2. **Set reasonable enforcement limits** to balance safety and quality
3. **Monitor enforcement violations** to understand what's being blocked
4. **Use appropriate models** for your use case
5. **Cache results** when processing similar inputs repeatedly
6. **Handle errors gracefully** - fallback to rule-based generation if Ollama fails
7. **Test enforcement rules** with sample outputs before production use

## Next Steps

- Integrate with your data pipeline
- Build custom enforcement rules for your domain
- Deploy with Docker for reproducibility
- Monitor performance metrics
- Experiment with different Ollama models
- Share learnings with the community!
