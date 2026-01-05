import { describe, expect, test } from "bun:test";
import { defaultConfig, defineConfig, mergeConfig } from "../config";

describe("defaultConfig", () => {
  test("has expected default values", () => {
    expect(defaultConfig.testFilePatterns).toEqual([
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/__tests__/**",
    ]);
    expect(defaultConfig.ignoreFilePatterns).toEqual([]);
    expect(defaultConfig.ignoreExports).toEqual([]);
    expect(defaultConfig.ignoreProperties).toEqual([]);
    expect(defaultConfig.ignoreTypes).toEqual([]);
    expect(defaultConfig.ignoreModuleAugmentations).toBe(true);
    expect(defaultConfig.analyzeProperties).toBe(true);
    expect(defaultConfig.analyzeExports).toBe(true);
    expect(defaultConfig.analyzeNeverReturnedTypes).toBe(true);
    expect(defaultConfig.detectUnusedFiles).toBe(true);
  });
});

describe("defineConfig", () => {
  test("returns the same config object", () => {
    const config = {
      testFilePatterns: ["**/custom.test.ts"],
    };
    expect(defineConfig(config)).toBe(config);
  });

  test("provides type safety", () => {
    const config = defineConfig({
      testFilePatterns: ["**/Test*.ts"],
      ignoreExports: ["formatLogMessage"],
      ignoreProperties: ["message"],
    });
    expect(config.testFilePatterns).toEqual(["**/Test*.ts"]);
    expect(config.ignoreExports).toEqual(["formatLogMessage"]);
    expect(config.ignoreProperties).toEqual(["message"]);
  });
});

describe("mergeConfig", () => {
  test("uses defaults when no overrides provided", () => {
    const result = mergeConfig({});
    expect(result).toEqual(defaultConfig);
  });

  test("overrides testFilePatterns", () => {
    const result = mergeConfig({
      testFilePatterns: ["**/custom.test.ts"],
    });
    expect(result.testFilePatterns).toEqual(["**/custom.test.ts"]);
    expect(result.ignoreFilePatterns).toEqual([]);
  });

  test("overrides multiple options", () => {
    const result = mergeConfig({
      testFilePatterns: ["**/Test*.ts"],
      ignoreExports: ["formatLogMessage"],
      ignoreModuleAugmentations: false,
    });
    expect(result.testFilePatterns).toEqual(["**/Test*.ts"]);
    expect(result.ignoreExports).toEqual(["formatLogMessage"]);
    expect(result.ignoreModuleAugmentations).toBe(false);
    expect(result.analyzeProperties).toBe(true); // default
  });

  test("allows disabling features", () => {
    const result = mergeConfig({
      analyzeProperties: false,
      analyzeExports: false,
      detectUnusedFiles: false,
    });
    expect(result.analyzeProperties).toBe(false);
    expect(result.analyzeExports).toBe(false);
    expect(result.detectUnusedFiles).toBe(false);
  });
});
