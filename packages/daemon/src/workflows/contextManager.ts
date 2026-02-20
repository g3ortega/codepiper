/**
 * ContextManager - manages workflow context and variable substitution
 */

export class ContextManager {
  private context: Record<string, any>;

  constructor() {
    this.context = {};
  }

  /**
   * Set a context value
   * @param key - Context key
   * @param value - Value to store
   */
  set(key: string, value: any): void {
    this.context[key] = value;
  }

  /**
   * Get a context value, supporting nested paths
   * @param key - Context key or path (e.g., "user.name")
   * @returns Value or undefined if not found
   */
  get(key: string): any {
    const parts = key.split(".");
    let current = this.context;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }

      if (typeof current === "object" && part in current) {
        current = current[part];
      } else {
        return undefined;
      }
    }

    return current;
  }

  /**
   * Substitute variables in a string using ${variable} syntax
   * @param text - Text with variables to substitute
   * @returns Text with variables replaced
   */
  substitute(text: string): string {
    // Match ${variable} or ${nested.path}
    return text.replace(/\$\{([^}]+)\}/g, (match, key) => {
      const value = this.get(key.trim());

      if (value === undefined) {
        // Leave unresolved variables as-is
        return match;
      }

      // Convert objects/arrays to JSON
      if (typeof value === "object" && value !== null) {
        return JSON.stringify(value);
      }

      return String(value);
    });
  }

  /**
   * Get all context as a plain object
   * @returns Copy of entire context
   */
  getAllContext(): Record<string, any> {
    return { ...this.context };
  }

  /**
   * Clear all context
   */
  clear(): void {
    this.context = {};
  }
}
