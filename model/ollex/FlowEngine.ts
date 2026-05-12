// src/FlowEngine.ts

import {
  FlowDefinition,
  ExecutionContext,
  StepResult,
  Step,
  LLMCallStep,
  FunctionCallStep,
  JsonParseStep,
  LoopStep,
  ParallelStep,
  ConditionStep,
  ExecutionProgress,
  EngineConfig
} from './types';
import { OllamaProvider } from './providers/OllamaProvider';
import { TemplateEngine } from './utils/TemplateEngine';
import { FunctionRegistry } from './FunctionRegistry';

export class FlowEngine {
  private ollama: OllamaProvider;
  private templateEngine: TemplateEngine;
  private functionRegistry: FunctionRegistry;
  private progressCallbacks: ((progress: ExecutionProgress) => void)[] = [];

  constructor(config: EngineConfig = {}) {
    this.ollama = new OllamaProvider(config.ollamaUrl);
    this.templateEngine = new TemplateEngine();
    this.functionRegistry = config.functionRegistry || new FunctionRegistry();
    this.functionRegistry.registerBuiltins();
  }

  /**
   * Execute a flow with given inputs
   */
  async execute(
    flow: FlowDefinition,
    inputs: Record<string, any>,
    onProgress?: (progress: ExecutionProgress) => void
  ): Promise<Record<string, any>> {
    if (onProgress) {
      this.progressCallbacks.push(onProgress);
    }

    const context: ExecutionContext = {
      flowId: flow.flowId,
      inputs,
      config: flow.config,
      steps: {},
      outputs: {},
      startTime: Date.now(),
      status: 'running'
    };

    try {
      // Validate inputs
      this.validateInputs(flow.inputs, inputs);
      this.emitProgress({
        flowId: flow.flowId,
        stepId: 'init',
        status: 'executing',
        progress: 0
      });

      // Initialize Ollama provider
      await this.ollama.initialize();

      // Execute steps
      const stepMap = new Map<string, number>();
      flow.steps.forEach((step, index) => stepMap.set(step.id, index));

      let currentStepIndex = 0;
      while (currentStepIndex < flow.steps.length && context.status === 'running') {
        const step = flow.steps[currentStepIndex];

        this.emitProgress({
          flowId: flow.flowId,
          stepId: step.id,
          status: 'executing',
          progress: (currentStepIndex / flow.steps.length) * 100
        });

        try {
          const result = await this.executeStep(step, context, flow);
          context.steps[step.id] = result;

          // Handle conditional branching
          if (step.type === 'condition') {
            const conditionStep = step as ConditionStep;
            const nextBranch = result.output as string;
            const nextIndex = stepMap.get(nextBranch);
            if (nextIndex !== undefined) {
              currentStepIndex = nextIndex;
              continue;
            }
          }

          currentStepIndex++;
        } catch (error) {
          // Try error handlers
          const handled = await this.tryErrorHandlers(error, step, flow, context);
          if (handled) {
            currentStepIndex++;
            continue;
          }

          // If not handled, re-throw
          throw error;
        }
      }

      // Map outputs
      for (const [key, spec] of Object.entries(flow.outputs)) {
        const source = spec.source || key;
        context.outputs[key] = this.resolveVariable(source, context);
      }

      context.status = 'completed';
      this.emitProgress({
        flowId: flow.flowId,
        stepId: 'complete',
        status: 'completed',
        progress: 100
      });

      return context.outputs;
    } catch (error) {
      context.status = 'failed';
      context.error = error instanceof Error ? error : new Error(String(error));

      this.emitProgress({
        flowId: flow.flowId,
        stepId: 'error',
        status: 'failed',
        progress: 100,
        error: String(error)
      });

      throw error;
    }
  }

  /**
   * Execute a single step
   */
  private async executeStep(
    step: Step,
    context: ExecutionContext,
    flow: FlowDefinition
  ): Promise<StepResult> {
    const startTime = Date.now();

    try {
      let output: any;

      switch (step.type) {
        case 'llm_call':
          output = await this.executeLLMCall(step as LLMCallStep, context);
          break;

        case 'function_call':
          output = await this.executeFunctionCall(step as FunctionCallStep, context);
          break;

        case 'json_parse':
          output = this.executeJsonParse(step as JsonParseStep, context);
          break;

        case 'loop':
          output = await this.executeLoop(step as LoopStep, context, flow);
          break;

        case 'parallel':
          output = await this.executeParallel(step as ParallelStep, context, flow);
          break;

        case 'condition':
          output = this.evaluateCondition(step as ConditionStep, context);
          break;

        default:
          throw new Error(`Unknown step type: ${(step as any).type}`);
      }

      return {
        stepId: step.id,
        status: 'success',
        output,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        stepId: step.id,
        status: 'error',
        error: String(error),
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Execute LLM call step
   */
  private async executeLLMCall(step: LLMCallStep, context: ExecutionContext): Promise<string> {
    // Render prompt with variables
    const prompt = this.templateEngine.render(
      step.prompt.template,
      this.buildTemplateContext(context)
    );

    // Determine model
    const model = step.llmConfig?.model || context.config.llmModel;

    // Call Ollama
    const response = await this.ollama.complete({
      model,
      prompt,
      temperature: step.llmConfig?.temperature ?? context.config.temperature,
      num_predict: step.llmConfig?.maxTokens ?? context.config.maxTokens,
      top_p: step.llmConfig?.topP ?? context.config.topP,
      top_k: step.llmConfig?.topK ?? context.config.topK,
      stream: step.streaming || false
    });

    return response.response;
  }

  /**
   * Execute function call step
   */
  private async executeFunctionCall(
    step: FunctionCallStep,
    context: ExecutionContext
  ): Promise<any> {
    const fn = this.functionRegistry.get(step.function);
    if (!fn) {
      throw new Error(`Function not found: ${step.function}`);
    }

    // Resolve input variables
    const inputs = this.resolveVariables(step.inputs, context);
    return await Promise.resolve(fn(inputs, context));
  }

  /**
   * Execute JSON parse step
   */
  private executeJsonParse(step: JsonParseStep, context: ExecutionContext): any {
    const input = this.resolveVariable(step.input, context);

    try {
      const parsed = typeof input === 'string' ? JSON.parse(input) : input;

      // Validate against schema if provided
      if (step.schema) {
        this.validateAgainstSchema(parsed, step.schema);
      }

      return parsed;
    } catch (error) {
      throw new Error(`JSON parse failed: ${error}`);
    }
  }

  /**
   * Execute loop step
   */
  private async executeLoop(
    step: LoopStep,
    context: ExecutionContext,
    flow: FlowDefinition
  ): Promise<any[]> {
    const array = this.resolveVariable(step.array, context);
    if (!Array.isArray(array)) {
      throw new Error(`Loop array is not an array: ${step.array}`);
    }

    const results = [];
    for (let i = 0; i < array.length; i++) {
      const item = array[i];
      const itemContext: ExecutionContext = {
        ...context,
        inputs: {
          ...context.inputs,
          [step.itemKey]: item,
          [`${step.itemKey}Index`]: i
        },
        steps: { ...context.steps }
      };

      for (const loopStep of step.steps) {
        const result = await this.executeStep(loopStep, itemContext, flow);
        itemContext.steps[loopStep.id] = result;
      }

      results.push({
        item,
        index: i,
        results: itemContext.steps
      });
    }

    return results;
  }

  /**
   * Execute parallel step
   */
  private async executeParallel(
    step: ParallelStep,
    context: ExecutionContext,
    flow: FlowDefinition
  ): Promise<Record<string, StepResult>> {
    const { concurrency = 3 } = step;
    const results: Record<string, StepResult> = {};
    const queue = [...step.steps];
    const active: Promise<void>[] = [];

    while (queue.length > 0 || active.length > 0) {
      while (active.length < concurrency && queue.length > 0) {
        const substep = queue.shift()!;
        const promise = this.executeStep(substep, context, flow)
          .then(result => {
            results[substep.id] = result;
          })
          .catch(error => {
            results[substep.id] = {
              stepId: substep.id,
              status: 'error',
              error: String(error),
              duration: 0,
              timestamp: new Date().toISOString()
            };
          })
          .finally(() => {
            const index = active.indexOf(promise);
            if (index > -1) active.splice(index, 1);
          });
        active.push(promise);
      }

      if (active.length > 0) {
        await Promise.race(active);
      }
    }

    return results;
  }

  /**
   * Evaluate conditional step
   */
  private evaluateCondition(step: ConditionStep, context: ExecutionContext): string {
    const testResult = this.templateEngine.evaluateBool(
      step.test,
      this.buildTemplateContext(context)
    );
    return testResult ? step.trueBranch : step.falseBranch;
  }

  /**
   * Build template context
   */
  private buildTemplateContext(context: ExecutionContext): Record<string, any> {
    return {
      inputs: context.inputs,
      config: context.config,
      steps: Object.entries(context.steps).reduce(
        (acc, [id, result]) => {
          acc[id] = {
            output: result.output,
            status: result.status,
            error: result.error
          };
          return acc;
        },
        {} as Record<string, any>
      ),
      env: process.env
    };
  }

  /**
   * Resolve a single variable
   */
  private resolveVariable(variable: string, context: ExecutionContext): any {
    // Handle template expressions
    if (!variable.includes('{{')) {
      variable = `{{${variable}}}`;
    }
    const rendered = this.templateEngine.render(variable, this.buildTemplateContext(context));
    return rendered;
  }

  /**
   * Resolve variables in an object
   */
  private resolveVariables(
    obj: Record<string, any>,
    context: ExecutionContext
  ): Record<string, any> {
    const resolved: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string' && value.includes('{{')) {
        resolved[key] = this.resolveVariable(value, context);
      } else if (typeof value === 'object' && value !== null) {
        resolved[key] = this.resolveVariables(value, context);
      } else {
        resolved[key] = value;
      }
    }
    return resolved;
  }

  /**
   * Validate inputs against schema
   */
  private validateInputs(inputSchema: Record<string, any>, inputs: Record<string, any>): void {
    for (const [key, spec] of Object.entries(inputSchema)) {
      if (spec.required && !(key in inputs)) {
        throw new Error(`Missing required input: ${key}`);
      }
    }
  }

  /**
   * Validate data against schema
   */
  private validateAgainstSchema(data: any, schema: any): void {
    // Simple validation - could use ajv for more robust validation
    if (schema.type && typeof data !== schema.type) {
      throw new Error(`Type mismatch: expected ${schema.type}, got ${typeof data}`);
    }
  }

  /**
   * Try error handlers
   */
  private async tryErrorHandlers(
    error: any,
    step: Step,
    flow: FlowDefinition,
    context: ExecutionContext
  ): Promise<boolean> {
    const handlers = flow.errorHandlers || [];

    for (const handler of handlers) {
      const matches = Array.isArray(handler.matchType)
        ? handler.matchType.includes(error.code || error.message)
        : handler.matchType === error.code || handler.matchType === error.message;

      if (matches) {
        if (handler.action === 'fallback' && handler.fallbackValue !== undefined) {
          context.outputs = handler.fallbackValue;
          return true;
        } else if (handler.action === 'stop') {
          context.status = 'stopped';
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Register custom function
   */
  registerFunction(name: string, fn: (inputs: Record<string, any>, context: ExecutionContext) => any): void {
    this.functionRegistry.register(name, fn);
  }

  /**
   * Emit progress
   */
  private emitProgress(progress: ExecutionProgress): void {
    for (const callback of this.progressCallbacks) {
      callback(progress);
    }
  }
}
