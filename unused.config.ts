import { defineConfig } from "./src/config";

export default defineConfig({
  // Ignore test file patterns (default patterns are sufficient)
  testFilePatterns: [
    "**/__tests__/**",
  ],

  // Ignore generated files, test fixtures, and scripts
  ignoreFilePatterns: [
    "**/test-project/**",
    "**/scripts/**",
    "**/dist/**",
    "**/*.d.ts",
  ],

  // No ignoreExports - let's see what's actually unused
  ignoreExports: [],

  // Ignore properties that are part of public interfaces
  ignoreProperties: [],

  // Ignore internal helper types
  ignoreTypes: [],

  // Keep module augmentation analysis on
  ignoreModuleAugmentations: true,
});
