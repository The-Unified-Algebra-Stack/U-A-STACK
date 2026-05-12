// src/FunctionRegistry.ts

import { PureFunctionCallback, ExecutionContext } from './types';

export class FunctionRegistry {
  private functions: Map<string, PureFunctionCallback> = new Map();

  /**
   * Register a pure function
   */
  register(name: string, fn: PureFunctionCallback): void {
    if (this.functions.has(name)) {
      console.warn(`Function '${name}' is being overwritten`);
    }
    this.functions.set(name, fn);
  }

  /**
   * Get a registered function
   */
  get(name: string): PureFunctionCallback | undefined {
    return this.functions.get(name);
  }

  /**
   * Check if a function exists
   */
  has(name: string): boolean {
    return this.functions.has(name);
  }

  /**
   * Call a registered function
   */
  async call(
    name: string,
    inputs: Record<string, any>,
    context: ExecutionContext
  ): Promise<any> {
    const fn = this.get(name);
    if (!fn) {
      throw new Error(`Function not found: ${name}`);
    }
    return fn(inputs, context);
  }

  /**
   * Register built-in functions
   */
  registerBuiltins(): void {
    // String operations
    this.register('concat', (inputs: Record<string, any>) => {
      return String(inputs.a || '') + String(inputs.b || '');
    });

    this.register('uppercase', (inputs: Record<string, any>) => {
      return String(inputs.text || '').toUpperCase();
    });

    this.register('lowercase', (inputs: Record<string, any>) => {
      return String(inputs.text || '').toLowerCase();
    });

    this.register('trim', (inputs: Record<string, any>) => {
      return String(inputs.text || '').trim();
    });

    this.register('split', (inputs: Record<string, any>) => {
      const text = String(inputs.text || '');
      const separator = inputs.separator || ',';
      return text.split(separator);
    });

    this.register('join', (inputs: Record<string, any>) => {
      const array = Array.isArray(inputs.array) ? inputs.array : [];
      const separator = inputs.separator || ',';
      return array.join(separator);
    });

    // Array operations
    this.register('length', (inputs: Record<string, any>) => {
      if (Array.isArray(inputs.value)) return inputs.value.length;
      if (typeof inputs.value === 'string') return inputs.value.length;
      return 0;
    });

    this.register('filter', (inputs: Record<string, any>) => {
      const array = Array.isArray(inputs.array) ? inputs.array : [];
      // Simple filter - would need more complex logic for predicate functions
      return array;
    });

    this.register('map', (inputs: Record<string, any>) => {
      const array = Array.isArray(inputs.array) ? inputs.array : [];
      const transform = inputs.transform || ((x: any) => x);
      return array.map(transform);
    });

    // Object operations
    this.register('merge', (inputs: Record<string, any>) => {
      return Object.assign({}, inputs.obj1 || {}, inputs.obj2 || {});
    });

    this.register('pick', (inputs: Record<string, any>) => {
      const obj = inputs.object || {};
      const keys = Array.isArray(inputs.keys) ? inputs.keys : [];
      return Object.fromEntries(keys.map((k: string) => [k, obj[k]]));
    });

    // Type operations
    this.register('typeof', (inputs: Record<string, any>) => {
      return typeof inputs.value;
    });

    this.register('isArray', (inputs: Record<string, any>) => {
      return Array.isArray(inputs.value);
    });

    this.register('isObject', (inputs: Record<string, any>) => {
      return typeof inputs.value === 'object' && inputs.value !== null;
    });

    // Math operations
    this.register('sum', (inputs: Record<string, any>) => {
      const array = Array.isArray(inputs.array) ? inputs.array : [];
      return array.reduce((a: number, b: number) => a + b, 0);
    });

    this.register('avg', (inputs: Record<string, any>) => {
      const array = Array.isArray(inputs.array) ? inputs.array : [];
      return array.length > 0 ? array.reduce((a: number, b: number) => a + b, 0) / array.length : 0;
    });

    this.register('min', (inputs: Record<string, any>) => {
      const array = Array.isArray(inputs.array) ? inputs.array : [];
      return array.length > 0 ? Math.min(...array) : 0;
    });

    this.register('max', (inputs: Record<string, any>) => {
      const array = Array.isArray(inputs.array) ? inputs.array : [];
      return array.length > 0 ? Math.max(...array) : 0;
    });

    // Conditional
    this.register('ternary', (inputs: Record<string, any>) => {
      return inputs.condition ? inputs.trueValue : inputs.falseValue;
    });

    // Formatting
    this.register('formatJson', (inputs: Record<string, any>) => {
      return JSON.stringify(inputs.value, null, inputs.indent || 2);
    });

    this.register('parseJson', (inputs: Record<string, any>) => {
      try {
        return JSON.parse(inputs.json);
      } catch (error) {
        throw new Error(`Invalid JSON: ${error}`);
      }
    });

    // Code analysis (example domain-specific functions)
    this.register('extractErrors', (inputs: Record<string, any>) => {
      const text = String(inputs.text || '');
      const errorPatterns = [/error:/gi, /failed:/gi, /exception:/gi];
      const errors: string[] = [];

      for (const pattern of errorPatterns) {
        const matches = text.match(pattern);
        if (matches) {
          errors.push(...matches.map(m => text.substring(text.indexOf(m), text.indexOf('\n', text.indexOf(m)))));
        }
      }

      return errors;
    });

    this.register('formatCode', (inputs: Record<string, any>) => {
      const code = String(inputs.code || '');
      const language = inputs.language || 'text';
      return `\`\`\`${language}\n${code}\n\`\`\``;
    });

    this.register('countLines', (inputs: Record<string, any>) => {
      const code = String(inputs.code || '');
      return code.split('\n').length;
    });
  }

  /**
   * Get all registered function names
   */
  listFunctions(): string[] {
    return Array.from(this.functions.keys());
  }
}
