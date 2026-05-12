# Codex Ollama Engine

Pure function JSON flow substrate for local LLM execution. Replace remote AI APIs with local Ollama in Codex using deterministic, composable JSON-based workflows.

## Features

✨ **Pure Functions** - Deterministic, stateless computation model  
🔄 **JSON Flows** - Define complex operations as declarative workflows  
🤖 **Local LLM** - Run everything offline with Ollama  
⚡ **Parallel Execution** - Built-in concurrency control  
🔀 **Conditional Branching** - Route execution based on runtime state  
🔁 **Loops & Composition** - Chain operations together seamlessly  
📊 **Progress Tracking** - Real-time execution monitoring  
🛡️ **Error Handling** - Fallbacks, retries, and recovery strategies  

## Installation

```bash
npm install codex-ollama-engine
# or
yarn add codex-ollama-engine
```

## Prerequisites

1. **Ollama** installed and running on `localhost:11434`

```bash
# Install Ollama: https://ollama.ai
# Start Ollama
ollama serve

# In another terminal, pull a model
ollama pull mistral
```

## Quick Start

```typescript
import { FlowEngine, FlowDefinition } from 'codex-ollama-engine';

// Define a flow
const flow: FlowDefinition = {
  flowId: 'example-1',
  version: '1.0',
  metadata: { name: 'Simple Analysis' },
  config: {
    llmProvider: 'ollama',
    llmModel: 'mistral',
    temperature: 0.7,
    maxTokens: 512
  },
  inputs: {
    text: { type: 'string', required: true }
  },
  outputs: {
    result: { type: 'string', source: 'steps.analyze.output' }
  },
  steps: [
    {
      id: 'analyze',
      type: 'llm_call',
      prompt: { template: 'Analyze: {{text}}' },
      outputKey: 'result'
    }
  ]
};

// Execute flow
const engine = new FlowEngine();
const result = await engine.execute(flow, {
  text: 'Your input here'
});

console.log(result);
```

## Flow Step Types

### LLM Call
```json
{
  "id": "my-step",
  "type": "llm_call",
  "llmConfig": {
    "model": "mistral",
    "temperature": 0.7,
    "maxTokens": 1024
  },
  "prompt": {
    "template": "Analyze: {{input}}"
  }
}
```

### Function Call
```json
{
  "id": "transform",
  "type": "function_call",
  "function": "uppercase",
  "inputs": {
    "text": "{{ steps.previous.output }}"
  }
}
```

### JSON Parse
```json
{
  "id": "parse",
  "type": "json_parse",
  "input": "{{ steps.llm.output }}",
  "schema": {
    "issues": { "type": "array" },
    "score": { "type": "number" }
  }
}
```

### Loop
```json
{
  "id": "process-files",
  "type": "loop",
  "array": "{{ inputs.files }}",
  "itemKey": "file",
  "steps": [
    {
      "id": "analyze-file",
      "type": "llm_call",
      "prompt": { "template": "Check: {{file.name}}" }
    }
  ]
}
```

### Parallel
```json
{
  "id": "parallel-checks",
  "type": "parallel",
  "concurrency": 3,
  "steps": [
    { "id": "lint", "type": "function_call", ... },
    { "id": "type-check", "type": "function_call", ... },
    { "id": "format-check", "type": "function_call", ... }
  ]
}
```

### Conditional
```json
{
  "id": "check-size",
  "type": "condition",
  "test": "{{ inputs.code.length > 1000 }}",
  "trueBranch": "deep-analysis",
  "falseBranch": "quick-analysis"
}
```

## Variable Resolution

Use `{{ }}` syntax to reference variables:

```
{{ inputs.code }}           → Access inputs
{{ steps.step-1.output }}   → Access step outputs
{{ config.temperature }}    → Access config
{{ env.HOME }}             → Access environment
```

## Built-in Functions

### String
- `concat` - Join strings
- `uppercase` - Convert to uppercase
- `lowercase` - Convert to lowercase
- `trim` - Remove whitespace
- `split` - Split string into array
- `join` - Join array into string

### Array
- `length` - Get array/string length
- `filter` - Filter array
- `map` - Transform array

### Object
- `merge` - Merge objects
- `pick` - Extract properties

### Type Checking
- `typeof` - Get type
- `isArray` - Check if array
- `isObject` - Check if object

### Math
- `sum` - Sum array values
- `avg` - Average array values
- `min` - Find minimum
- `max` - Find maximum

### JSON
- `formatJson` - Pretty-print JSON
- `parseJson` - Parse JSON string

### Code Analysis
- `extractErrors` - Extract error messages
- `formatCode` - Format as code block
- `countLines` - Count lines of code

## Custom Functions

Register custom pure functions:

```typescript
engine.registerFunction('myFunction', (inputs, context) => {
  return {
    processed: inputs.data.toUpperCase(),
    timestamp: new Date().toISOString()
  };
});
```

## Error Handling

```json
{
  "errorHandlers": [
    {
      "matchType": "Model not found",
      "action": "fallback",
      "fallbackValue": { "error": "Model unavailable" }
    },
    {
      "matchType": "timeout",
      "action": "retry"
    }
  ]
}
```

## Integration with Codex

Replace AI provider calls in Codex:

```typescript
// Before: Remote API call
const result = await openai.createCompletion(prompt);

// After: Local flow execution
const flow = loadFlowDefinition('analysis.json');
const result = await flowEngine.execute(flow, inputs);
```

## Examples

See `examples/` directory:

- `code-analysis-flow.json` - Analyze code and suggest improvements
- `multi-file-analysis-flow.json` - Process multiple files in parallel
- `basic-example.ts` - TypeScript usage example

## Architecture

```
Codex UI
    ↓
Flow Engine (Pure JSON)
    ↓
Ollama Provider
    ↓
Ollama (localhost:11434)
```

## Performance

- **Local execution** - No network latency
- **Parallel processing** - Concurrent step execution
- **Streaming** - Progressive output with callbacks
- **Deterministic** - Same inputs = same outputs
- **Debuggable** - Complete execution trace

## License

MIT
