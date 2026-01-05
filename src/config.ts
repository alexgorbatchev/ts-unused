/**
 * Configuration options for ts-unused analysis.
 */
export interface UnusedConfig {
  /**
   * Patterns to identify test files. Supports glob patterns.
   * Files matching these patterns will be treated as test files
   * and their usages won't count as production usage.
   *
   * @default ["**\/*.test.ts", "**\/*.test.tsx", "**\/*.spec.ts", "**\/*.spec.tsx", "**\/__tests__/**"]
   */
  testFilePatterns?: string[];

  /**
   * Patterns for files to completely ignore during analysis.
   * Supports glob patterns.
   *
   * @default []
   */
  ignoreFilePatterns?: string[];

  /**
   * Export names to ignore (will not be reported as unused).
   * Supports exact names or glob patterns.
   *
   * @default []
   */
  ignoreExports?: string[];

  /**
   * Property names to ignore (will not be reported as unused).
   * Supports exact names or glob patterns.
   *
   * @default []
   */
  ignoreProperties?: string[];

  /**
   * Type names to ignore (their properties will not be analyzed).
   * Supports exact names or glob patterns.
   *
   * @default []
   */
  ignoreTypes?: string[];

  /**
   * Whether to ignore module augmentation declarations.
   * Module augmentations (declare module "...") are typically used
   * to extend existing types and don't have direct usages.
   *
   * @default true
   */
  ignoreModuleAugmentations?: boolean;

  /**
   * Whether to analyze properties for unused status.
   *
   * @default true
   */
  analyzeProperties?: boolean;

  /**
   * Whether to analyze exports for unused status.
   *
   * @default true
   */
  analyzeExports?: boolean;

  /**
   * Whether to analyze for never-returned types in function return types.
   *
   * @default true
   */
  analyzeNeverReturnedTypes?: boolean;

  /**
   * Whether to detect completely unused files.
   *
   * @default true
   */
  detectUnusedFiles?: boolean;
}

/**
 * Default configuration values.
 */
export const defaultConfig: Required<UnusedConfig> = {
  testFilePatterns: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx", "**/__tests__/**"],
  ignoreFilePatterns: [],
  ignoreExports: [],
  ignoreProperties: [],
  ignoreTypes: [],
  ignoreModuleAugmentations: true,
  analyzeProperties: true,
  analyzeExports: true,
  analyzeNeverReturnedTypes: true,
  detectUnusedFiles: true,
};

/**
 * Helper function for creating a strongly-typed configuration file.
 * Use this in your `unused.config.ts` file:
 *
 * @example
 * ```typescript
 * import { defineConfig } from "ts-unused";
 *
 * export default defineConfig({
 *   testFilePatterns: ["**\/*.test.ts", "**\/TestLogger.ts"],
 *   ignoreExports: ["moduleAugmentation"],
 * });
 * ```
 */
export function defineConfig(config: UnusedConfig): UnusedConfig {
  return config;
}
