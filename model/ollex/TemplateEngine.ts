// src/utils/TemplateEngine.ts

export class TemplateEngine {
  /**
   * Render a template string with variables
   * Supports: {{variable}}, {{object.property}}, {{array[0]}}
   */
  render(template: string, context: Record<string, any>): string {
    return template.replace(/\{\{([^}]+)\}\}/g, (match, expression) => {
      const value = this.evaluate(expression.trim(), context);
      return String(value ?? '');
    });
  }

  /**
   * Evaluate an expression against a context
   */
  evaluate(expression: string, context: Record<string, any>): any {
    // Simple dot notation and array access
    const parts = expression.match(/[a-zA-Z_$][\w.$\[\]]*|'[^']*'|"[^"]*"/g) || [];
    
    if (parts.length === 0) return undefined;

    let current: any = context;

    for (const part of parts) {
      if (!current) return undefined;

      // Handle array index notation: array[0]
      if (part.includes('[')) {
        const [key, indexStr] = part.split('[');
        const index = parseInt(indexStr.replace(/[\[\]]/g, ''), 10);
        current = current[key]?.[index];
      } else {
        // Handle object property
        current = current[part];
      }
    }

    return current;
  }

  /**
   * Evaluate a boolean expression
   */
  evaluateBool(expression: string, context: Record<string, any>): boolean {
    // Handle simple comparisons
    if (expression.includes('>')) {
      const [left, right] = expression.split('>').map(s => s.trim());
      return this.evaluate(left, context) > this.evaluate(right, context);
    }
    if (expression.includes('<')) {
      const [left, right] = expression.split('<').map(s => s.trim());
      return this.evaluate(left, context) < this.evaluate(right, context);
    }
    if (expression.includes('===')) {
      const [left, right] = expression.split('===').map(s => s.trim());
      return this.evaluate(left, context) === this.evaluate(right, context);
    }
    if (expression.includes('==')) {
      const [left, right] = expression.split('==').map(s => s.trim());
      return this.evaluate(left, context) == this.evaluate(right, context);
    }
    if (expression.includes('!=')) {
      const [left, right] = expression.split('!=').map(s => s.trim());
      return this.evaluate(left, context) != this.evaluate(right, context);
    }

    // Simple variable evaluation
    return !!this.evaluate(expression, context);
  }

  /**
   * Extract variables from a template
   */
  extractVariables(template: string): string[] {
    const matches = template.match(/\{\{([^}]+)\}\}/g) || [];
    return matches.map(match => match.slice(2, -2).trim());
  }
}
