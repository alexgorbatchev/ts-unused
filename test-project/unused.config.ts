import { defineConfig } from "../src/config";

export default defineConfig({
  // Custom test file patterns - includes TestLogger.ts style files
  testFilePatterns: [
    "**/*.test.ts",
    "**/*.test.tsx",
    "**/*.spec.ts",
    "**/*.spec.tsx",
    "**/__tests__/**",
    "**/Test*.ts", // Files like TestLogger.ts
  ],

  // Ignore generated files completely
  ignoreFilePatterns: [
    "**/generated/**", // All files in generated/ folders
  ],

  // Ignore module augmentations (declare module "...")
  ignoreModuleAugmentations: true,

  // Ignore internal functions
  ignoreExports: [
    "internal*", // All exports starting with "internal"
  ],

  // Ignore common properties that are accessed dynamically
  ignoreProperties: [
    "message", // Common error property
    "_*", // Private-like properties
  ],

  // Skip property analysis for certain config types
  ignoreTypes: [
    "GitHubApiResponse", // API response types with dynamic methods
  ],

  // Enable all analysis features
  analyzeExports: true,
  analyzeProperties: true,
  analyzeNeverReturnedTypes: true,
  detectUnusedFiles: true,
});
