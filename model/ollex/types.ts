// src/types.ts

export interface FlowDefinition {
  flowId: string;
  version: string;
  metadata: {
    name: string;
    description?: string;
    timeout?: number;
    retryPolicy?: {
      maxAttempts: number;
      backoffMs: number;
    };
  };
  config: {
    llmProvider: 'ollama' | 'openai';
    llmModel: string;
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    topK?: number;
    [key: string]: any;
  };
  inputs: Record<string, InputSchema>;
  outputs: Record<string, OutputSchema>;
  steps: Step[];
  errorHandlers?: ErrorHandler[];
}

export interface InputSchema {
  type: string;
  description?: string;
  required?: boolean;
  default?: any;
  enum?: any[];
  [key: string]: any;
}

export interface OutputSchema {
  type: string;
  source?: string;
  schema?: any;
  [key: string]: any;
}

export type Step =
  | LLMCallStep
  | FunctionCallStep
  | JsonParseStep
  | LoopStep
  | ParallelStep
  | ConditionStep;

export interface BaseStep {
  id: string;
  type: string;
  outputKey?: string;
  errorHandling?: 'throw' | 'return_null' | 'continue';
  retryPolicy?: {
    maxAttempts: number;
    backoffMs: number;
  };
}

export interface LLMCallStep extends BaseStep {
  type: 'llm_call';
  llmConfig?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    topK?: number;
  };
  prompt: {
    template: string;
    variables?: string[];
  };
  streaming?: boolean;
  outputKey: string;
}

export interface FunctionCallStep extends BaseStep {
  type: 'function_call';
  function: string;
  inputs: Record<string, any>;
  outputKey: string;
}

export interface JsonParseStep extends BaseStep {
  type: 'json_parse';
  input: string;
  schema?: any;
  outputKey: string;
}

export interface LoopStep extends BaseStep {
  type: 'loop';
  array: string;
  itemKey: string;
  steps: Step[];
  outputKey: string;
}

export interface ParallelStep extends BaseStep {
  type: 'parallel';
  steps: Step[];
  concurrency?: number;
  outputKey: string;
}

export interface ConditionStep extends BaseStep {
  type: 'condition';
  test: string;
  trueBranch: string;
  falseBranch: string;
}

export interface ErrorHandler {
  matchType: string | string[];
  action: 'retry' | 'fallback' | 'throw' | 'stop';
  fallbackValue?: any;
  nextStepId?: string;
}

export interface ExecutionContext {
  flowId: string;
  inputs: Record<string, any>;
  config: FlowDefinition['config'];
  steps: Record<string, StepResult>;
  outputs: Record<string, any>;
  startTime: number;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  error?: Error;
}

export interface StepResult {
  stepId: string;
  status: 'success' | 'error' | 'skipped';
  output?: any;
  error?: string;
  duration: number;
  timestamp: string;
}

export interface ExecutionProgress {
  flowId: string;
  stepId: string;
  status: 'executing' | 'completed' | 'failed';
  progress: number;
  error?: string;
}

export interface EngineConfig {
  ollamaUrl?: string;
  openaiApiKey?: string;
  functionRegistry?: Map<string, Function>;
  timeout?: number;
}

export type PureFunctionCallback = (
  inputs: Record<string, any>,
  context: ExecutionContext
) => Promise<any> | any;
