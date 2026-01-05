import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, loadConfigSync } from "../loadConfig";

describe("loadConfigSync", () => {
  test("returns default config when no config file exists", () => {
    const result = loadConfigSync("/non-existent-dir");
    expect(result.testFilePatterns).toEqual([
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/__tests__/**",
    ]);
    expect(result.ignoreModuleAugmentations).toBe(true);
  });

  test("loads config from specified path", () => {
    // Create a temp directory with a config file
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-unused-test-"));
    const configPath = path.join(tempDir, "unused.config.ts");

    try {
      fs.writeFileSync(
        configPath,
        `export default {
          testFilePatterns: ["**/Test*.ts"],
          ignoreExports: ["formatLogMessage"],
        };`
      );

      const result = loadConfigSync(tempDir);
      expect(result.testFilePatterns).toEqual(["**/Test*.ts"]);
      expect(result.ignoreExports).toEqual(["formatLogMessage"]);
      // Default values should still be present
      expect(result.ignoreModuleAugmentations).toBe(true);
    } finally {
      // Cleanup
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  test("loads config from custom path", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-unused-test-"));
    const configPath = path.join(tempDir, "custom.config.ts");

    try {
      fs.writeFileSync(
        configPath,
        `export default {
          ignoreProperties: ["message"],
        };`
      );

      const result = loadConfigSync("/some/other/dir", configPath);
      expect(result.ignoreProperties).toEqual(["message"]);
    } finally {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  test("merges user config with defaults", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-unused-test-"));
    const configPath = path.join(tempDir, "unused.config.ts");

    try {
      fs.writeFileSync(
        configPath,
        `export default {
          analyzeProperties: false,
        };`
      );

      const result = loadConfigSync(tempDir);
      expect(result.analyzeProperties).toBe(false);
      expect(result.analyzeExports).toBe(true); // default
      expect(result.testFilePatterns).toEqual([
        "**/*.test.ts",
        "**/*.test.tsx",
        "**/*.spec.ts",
        "**/*.spec.tsx",
        "**/__tests__/**",
      ]); // default
    } finally {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  test("throws error for invalid config file", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-unused-test-"));
    const configPath = path.join(tempDir, "unused.config.ts");

    try {
      fs.writeFileSync(configPath, "this is not valid typescript {{{");

      expect(() => loadConfigSync(tempDir)).toThrow("Failed to load config");
    } finally {
      fs.rmSync(tempDir, { recursive: true });
    }
  });
});

describe("loadConfig (async)", () => {
  test("returns default config when no config file exists", async () => {
    const result = await loadConfig("/non-existent-dir");
    expect(result.testFilePatterns).toEqual([
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/__tests__/**",
    ]);
    expect(result.ignoreModuleAugmentations).toBe(true);
  });

  test("loads config from specified path", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-unused-test-"));
    const configPath = path.join(tempDir, "unused.config.ts");

    try {
      fs.writeFileSync(
        configPath,
        `export default {
          testFilePatterns: ["**/Test*.ts"],
          ignoreExports: ["formatLogMessage"],
        };`
      );

      const result = await loadConfig(tempDir);
      expect(result.testFilePatterns).toEqual(["**/Test*.ts"]);
      expect(result.ignoreExports).toEqual(["formatLogMessage"]);
      expect(result.ignoreModuleAugmentations).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  test("loads config from custom path", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-unused-test-"));
    const configPath = path.join(tempDir, "custom.config.ts");

    try {
      fs.writeFileSync(
        configPath,
        `export default {
          ignoreProperties: ["message"],
        };`
      );

      const result = await loadConfig("/some/other/dir", configPath);
      expect(result.ignoreProperties).toEqual(["message"]);
    } finally {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  test("throws error for invalid config file", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-unused-test-"));
    const configPath = path.join(tempDir, "unused.config.ts");

    try {
      fs.writeFileSync(configPath, "this is not valid typescript {{{");

      await expect(loadConfig(tempDir)).rejects.toThrow("Failed to load config");
    } finally {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  test("handles config without default export", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-unused-test-"));
    const configPath = path.join(tempDir, "unused.config.ts");

    try {
      fs.writeFileSync(
        configPath,
        `export const testFilePatterns = ["**/Test*.ts"];
         export const ignoreExports = ["test"];`
      );

      const result = await loadConfig(tempDir);
      // Should use named exports when no default
      expect(result.testFilePatterns).toEqual(["**/Test*.ts"]);
      expect(result.ignoreExports).toEqual(["test"]);
    } finally {
      fs.rmSync(tempDir, { recursive: true });
    }
  });
});
