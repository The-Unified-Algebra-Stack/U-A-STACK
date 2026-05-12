// examples/basic-example.ts

import { FlowEngine, FlowDefinition } from '../src/index';
import * as fs from 'fs';
import * as path from 'path';

async function runCodeAnalysisExample() {
  // Initialize engine
  const engine = new FlowEngine({
    ollamaUrl: 'http://localhost:11434'
  });

  // Register custom function
  engine.registerFunction('customAnalyze', (inputs, context) => {
    return {
      custom: true,
      inputLength: String(inputs.text || '').length
    };
  });

  // Load flow definition
  const flowPath = path.join(__dirname, 'code-analysis-flow.json');
  const flowDef = JSON.parse(fs.readFileSync(flowPath, 'utf-8')) as FlowDefinition;

  // Sample code to analyze
  const sampleCode = `
function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

// Usage
const result = fibonacci(10);
console.log(result);
`;

  try {
    console.log('🚀 Starting code analysis flow...');
    console.log('Flow:', flowDef.metadata.name);
    console.log('Model:', flowDef.config.llmModel);
    console.log('---');

    const result = await engine.execute(
      flowDef,
      {
        code: sampleCode,
        language: 'javascript'
      },
      (progress) => {
        console.log(`[${progress.stepId}] ${progress.status} (${progress.progress.toFixed(0)}%)`);
      }
    );

    console.log('\n✅ Analysis Complete!');
    console.log('\nResults:');
    console.log(JSON.stringify(result, null, 2));

    return result;
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

// Run example
runCodeAnalysisExample().catch(console.error);
