# Codex Ollama Integration Guide

## Overview

This guide shows how to integrate the Codex Ollama Engine into your Codex installation to replace remote AI calls with local Ollama execution.

## Architecture Changes

### Current Codex Architecture
```
Codex Electron App
    ↓
AppServerConnection (IPC)
    ↓
OpenAI API (Remote)
```

### New Architecture
```
Codex Electron App
    ↓
Flow Engine (Local)
    ↓
Ollama (localhost:11434)
```

## Installation Steps

### 1. Install Codex Ollama Engine

```bash
cd ~/.codex  # or your codex installation directory
npm install codex-ollama-engine
```

### 2. Create Flow Definitions Directory

```bash
mkdir -p ~/.codex/flows
```

Create flow files for each capability:

**~/.codex/flows/code-completion.json**
```json
{
  "flowId": "code-completion",
  "version": "1.0",
  "metadata": { "name": "Code Completion" },
  "config": {
    "llmProvider": "ollama",
    "llmModel": "mistral",
    "temperature": 0.3,
    "maxTokens": 256
  },
  "inputs": {
    "code": { "type": "string", "required": true },
    "context": { "type": "string" }
  },
  "outputs": {
    "completion": { "type": "string", "source": "steps.complete.output" }
  },
  "steps": [
    {
      "id": "complete",
      "type": "llm_call",
      "prompt": {
        "template": "Complete this code:\n\n{{code}}\n\nContext: {{context}}\n\nNext line:"
      },
      "outputKey": "completion"
    }
  ]
}
```

**~/.codex/flows/code-review.json**
```json
{
  "flowId": "code-review",
  "version": "1.0",
  "metadata": { "name": "Code Review" },
  "config": {
    "llmProvider": "ollama",
    "llmModel": "mistral",
    "temperature": 0.5,
    "maxTokens": 1024
  },
  "inputs": {
    "code": { "type": "string", "required": true },
    "language": { "type": "string", "default": "javascript" }
  },
  "outputs": {
    "review": { "type": "object", "source": "steps.format.output" }
  },
  "steps": [
    {
      "id": "analyze",
      "type": "llm_call",
      "prompt": {
        "template": "Review this {{language}} code for bugs, performance, and style:\n\n```{{language}}\n{{code}}\n```\n\nProvide JSON: {issues: [], improvements: [], score: 0-100}"
      },
      "outputKey": "analysis"
    },
    {
      "id": "format",
      "type": "function_call",
      "function": "parseJson",
      "inputs": { "json": "{{ steps.analyze.output }}" },
      "outputKey": "review"
    }
  ]
}
```

### 3. Create Flow Engine Service

**src/services/FlowEngineService.ts**
```typescript
import { FlowEngine, FlowDefinition } from 'codex-ollama-engine';
import * as fs from 'fs';
import * as path from 'path';

export class FlowEngineService {
  private engine: FlowEngine;
  private flows: Map<string, FlowDefinition> = new Map();
  private flowsDir: string;

  constructor(flowsDir: string = '~/.codex/flows') {
    this.flowsDir = path.expanduser(flowsDir);
    this.engine = new FlowEngine({
      ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434'
    });
  }

  async initialize(): Promise<void> {
    // Load all flow definitions
    const files = fs.readdirSync(this.flowsDir)
      .filter(f => f.endsWith('.json'));

    for (const file of files) {
      const flowPath = path.join(this.flowsDir, file);
      const content = fs.readFileSync(flowPath, 'utf-8');
      const flow = JSON.parse(content) as FlowDefinition;
      this.flows.set(flow.flowId, flow);
    }

    // Register custom domain-specific functions
    this.registerDomainFunctions();

    console.log(`✓ Flow engine initialized with ${this.flows.size} flows`);
  }

  async executeFlow(
    flowId: string,
    inputs: Record<string, any>,
    onProgress?: (progress: any) => void
  ): Promise<Record<string, any>> {
    const flow = this.flows.get(flowId);
    if (!flow) {
      throw new Error(`Flow not found: ${flowId}`);
    }

    return this.engine.execute(flow, inputs, onProgress);
  }

  async codeCompletion(
    code: string,
    context: string = ''
  ): Promise<string> {
    const result = await this.executeFlow('code-completion', {
      code,
      context
    });
    return result.completion;
  }

  async codeReview(
    code: string,
    language: string = 'javascript'
  ): Promise<any> {
    const result = await this.executeFlow('code-review', {
      code,
      language
    });
    return result.review;
  }

  private registerDomainFunctions(): void {
    // Register code-specific functions
    this.engine.registerFunction('lintCode', (inputs, context) => {
      const code = String(inputs.code || '');
      const language = inputs.language || 'javascript';
      
      // Simple linting heuristics
      const issues = [];
      if (code.includes('var ')) issues.push('Use const/let instead of var');
      if (code.includes('console.log')) issues.push('Remove debug logs');
      if (code.length > 5000) issues.push('Code block is too long');
      
      return { issues, language };
    });

    this.engine.registerFunction('estimateComplexity', (inputs, context) => {
      const code = String(inputs.code || '');
      const lines = code.split('\n').length;
      const functions = (code.match(/function|=>|async/g) || []).length;
      
      return {
        lines,
        functions,
        complexity: lines > 100 ? 'high' : lines > 50 ? 'medium' : 'low'
      };
    });

    this.engine.registerFunction('suggestRefactors', (inputs, context) => {
      const code = String(inputs.code || '');
      const suggestions = [];
      
      if (code.includes('if (') && code.includes('else')) {
        suggestions.push('Consider using switch or ternary for multiple conditions');
      }
      if (code.split('\n').some(line => line.length > 100)) {
        suggestions.push('Break up long lines for readability');
      }
      
      return { suggestions };
    });
  }

  listFlows(): string[] {
    return Array.from(this.flows.keys());
  }

  getFlow(flowId: string): FlowDefinition | undefined {
    return this.flows.get(flowId);
  }
}
```

### 4. Replace AppServerConnection Handler

**src/handlers/AIRequestHandler.ts**
```typescript
import { FlowEngineService } from '../services/FlowEngineService';
import { IpcMainInvokeEvent } from 'electron';

export class AIRequestHandler {
  private flowEngine: FlowEngineService;

  constructor() {
    this.flowEngine = new FlowEngineService();
  }

  async initialize(): Promise<void> {
    await this.flowEngine.initialize();
    this.registerHandlers();
  }

  private registerHandlers(): void {
    ipcMain.handle('ai:code-completion', async (event, inputs) => {
      return await this.flowEngine.codeCompletion(
        inputs.code,
        inputs.context
      );
    });

    ipcMain.handle('ai:code-review', async (event, inputs) => {
      return await this.flowEngine.codeReview(
        inputs.code,
        inputs.language
      );
    });

    ipcMain.handle('ai:generate-code', async (event, inputs) => {
      return await this.flowEngine.executeFlow('code-generation', inputs);
    });

    ipcMain.handle('ai:fix-issues', async (event, inputs) => {
      return await this.flowEngine.executeFlow('code-fixing', inputs);
    });

    ipcMain.handle('ai:list-flows', (event) => {
      return this.flowEngine.listFlows();
    });

    ipcMain.handle('ai:get-flow', (event, flowId) => {
      return this.flowEngine.getFlow(flowId);
    });
  }

  async handleLLMRequest(request: AIRequest): Promise<AIResponse> {
    // Route different request types to appropriate flows
    switch (request.type) {
      case 'completion':
        return {
          type: 'completion',
          result: await this.flowEngine.codeCompletion(request.prompt)
        };

      case 'analysis':
        return {
          type: 'analysis',
          result: await this.flowEngine.codeReview(request.code, request.language)
        };

      case 'generation':
        return {
          type: 'generation',
          result: await this.flowEngine.executeFlow('code-generation', request.inputs)
        };

      default:
        throw new Error(`Unknown request type: ${request.type}`);
    }
  }
}

interface AIRequest {
  type: 'completion' | 'analysis' | 'generation' | 'fixing';
  prompt?: string;
  code?: string;
  language?: string;
  inputs?: Record<string, any>;
}

interface AIResponse {
  type: string;
  result: any;
}
```

### 5. Update React Components

**src/components/CodeEditor.tsx** (Example)
```typescript
import { useIPC } from '../hooks/useIPC';

export function CodeEditor() {
  const { invoke } = useIPC();
  const [code, setCode] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const getCompletion = async () => {
    setLoading(true);
    try {
      const completion = await invoke('ai:code-completion', {
        code,
        context: 'In a React component'
      });
      setSuggestions([completion]);
    } catch (error) {
      console.error('Completion failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const getReview = async () => {
    setLoading(true);
    try {
      const review = await invoke('ai:code-review', {
        code,
        language: 'javascript'
      });
      setSuggestions(review.issues || []);
    } catch (error) {
      console.error('Review failed:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <textarea value={code} onChange={(e) => setCode(e.target.value)} />
      <button onClick={getCompletion} disabled={loading}>
        {loading ? 'Completing...' : 'Complete'}
      </button>
      <button onClick={getReview} disabled={loading}>
        {loading ? 'Reviewing...' : 'Review'}
      </button>
      {suggestions.map((s, i) => (
        <div key={i} className="suggestion">{s}</div>
      ))}
    </div>
  );
}
```

## Configuration

### Environment Variables

**.env**
```
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=mistral
FLOWS_DIR=~/.codex/flows
LOG_LEVEL=info
```

### Ollama Setup

```bash
# Install Ollama if not already installed
# https://ollama.ai

# Start Ollama service
ollama serve

# Pull models
ollama pull mistral      # Fast, good quality
ollama pull neural-chat  # Specialized for chat
ollama pull llama2       # Meta's model
```

## Migration Checklist

- [ ] Install `codex-ollama-engine`
- [ ] Create `~/.codex/flows` directory
- [ ] Add flow definitions (JSON files)
- [ ] Implement `FlowEngineService`
- [ ] Create `AIRequestHandler`
- [ ] Update IPC handlers in main process
- [ ] Update React components to use new IPC handlers
- [ ] Test code completion
- [ ] Test code analysis/review
- [ ] Benchmark performance vs remote API
- [ ] Document custom flows
- [ ] Deploy to users

## Performance Optimization

### 1. Model Selection

```json
{
  "models": {
    "fast": "neural-chat",      // For real-time features
    "quality": "mistral",       // For detailed analysis
    "coding": "mistral-7b",     // Specialized for code
    "reasoning": "llama2"       // For complex logic
  }
}
```

### 2. Flow Caching

```typescript
class FlowCache {
  private cache = new Map<string, any>();

  async executeWithCache(
    flowId: string,
    inputs: Record<string, any>,
    ttl: number = 3600000 // 1 hour
  ) {
    const key = `${flowId}:${JSON.stringify(inputs)}`;
    
    if (this.cache.has(key)) {
      return this.cache.get(key);
    }
    
    const result = await engine.execute(...);
    this.cache.set(key, result);
    
    setTimeout(() => this.cache.delete(key), ttl);
    
    return result;
  }
}
```

### 3. Parallel Processing

Leverage parallel execution for independent operations:

```json
{
  "type": "parallel",
  "concurrency": 3,
  "steps": [
    { "id": "lint", ... },
    { "id": "type-check", ... },
    { "id": "format-check", ... }
  ]
}
```

## Troubleshooting

### "Connection refused" to Ollama

```bash
# Make sure Ollama is running
ollama serve

# Check it's accessible
curl http://localhost:11434/api/tags
```

### Model not found

```bash
# Pull the required model
ollama pull mistral

# List available models
ollama list
```

### Slow responses

1. Use faster model: `neural-chat` instead of `mistral`
2. Reduce `maxTokens` in flow config
3. Enable result caching
4. Check system resources

### High memory usage

1. Reduce concurrent flows
2. Set `concurrency: 1` for parallel steps
3. Use smaller model (7B instead of 13B)
4. Monitor with `ollama ps`

## Next Steps

1. Create additional flow definitions for your use cases
2. Register domain-specific functions
3. Build flow composition patterns
4. Implement flow versioning
5. Add flow testing/validation
6. Create flow marketplace/sharing

## Support

See main README.md for API documentation and examples.
