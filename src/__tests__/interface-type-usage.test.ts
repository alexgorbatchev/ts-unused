import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { analyzeProject } from "../analyzeProject";
import { formatResults } from "../formatResults";

const TEMP_DIR = path.join(import.meta.dir, "../../temp-test-interface-usage");

function createTempDir() {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

function cleanupTempDir() {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
}

function createTsConfig() {
  const tsconfigFile = path.join(TEMP_DIR, "tsconfig.json");
  fs.writeFileSync(
    tsconfigFile,
    JSON.stringify({
      compilerOptions: {
        target: "ES2020",
        module: "ESNext",
        moduleResolution: "bundler",
        strict: true,
      },
      include: ["*.ts"],
    }),
  );
  return tsconfigFile;
}

beforeEach(() => {
  createTempDir();
});

afterEach(() => {
  cleanupTempDir();
});

describe("Interface and Type Usage", () => {
  test("does not report properties as unused when the entire interface is used", async () => {
    // Create interface with properties
    fs.writeFileSync(
      path.join(TEMP_DIR, "types.ts"),
      `
        export interface Config {
          timeout: number;
          retries: number;
          debug: boolean;
        }
      `,
    );

    // Use the entire interface (not individual properties)
    fs.writeFileSync(
      path.join(TEMP_DIR, "usage.ts"),
      `
        import type { Config } from './types';

        function processConfig(config: Config): void {
          console.log('Processing config');
        }

        const myConfig: Config = {
          timeout: 5000,
          retries: 3,
          debug: true
        };

        processConfig(myConfig);
      `,
    );

    const tsconfigFile = createTsConfig();
    const results = await analyzeProject(tsconfigFile);

    // The interface Config is used, so its properties should NOT be reported as unused
    expect(results.unusedProperties).toHaveLength(0);
  });

  test("does not report properties as unused when the entire type alias is used", async () => {
    // Create type alias with properties
    fs.writeFileSync(
      path.join(TEMP_DIR, "types.ts"),
      `
        export type Config = {
          timeout: number;
          retries: number;
          debug: boolean;
        };
      `,
    );

    // Use the entire type (not individual properties)
    fs.writeFileSync(
      path.join(TEMP_DIR, "usage.ts"),
      `
        import type { Config } from './types';

        function processConfig(config: Config): void {
          console.log('Processing config');
        }

        const myConfig: Config = {
          timeout: 5000,
          retries: 3,
          debug: true
        };

        processConfig(myConfig);
      `,
    );

    const tsconfigFile = createTsConfig();
    const results = await analyzeProject(tsconfigFile);

    // The type Config is used, so its properties should NOT be reported as unused
    expect(results.unusedProperties).toHaveLength(0);
  });

  test("reports interface as unused but filters properties from output", async () => {
    // Create unused interface
    fs.writeFileSync(
      path.join(TEMP_DIR, "types.ts"),
      `
        export interface UnusedConfig {
          timeout: number;
          retries: number;
        }

        // Add a used export so the file isn't marked as completely unused
        export const USED_VALUE = 42;
      `,
    );

    // Consumer file that uses USED_VALUE but not UnusedConfig
    fs.writeFileSync(
      path.join(TEMP_DIR, "main.ts"),
      `
        import { USED_VALUE } from './types';
        console.log(USED_VALUE);
      `,
    );

    const tsconfigFile = createTsConfig();
    const results = await analyzeProject(tsconfigFile);
    const output = formatResults(results, TEMP_DIR);

    // The interface is unused, so it should be in unusedExports
    const unusedConfigExport = results.unusedExports.find((e) => e.exportName === "UnusedConfig");
    expect(unusedConfigExport).toBeDefined();

    // Properties are found by analysis
    const configProperties = results.unusedProperties.filter((p) => p.typeName === "UnusedConfig");
    expect(configProperties).toHaveLength(2);

    // But formatResults filters out properties from unused types
    expect(output).toContain("UnusedConfig");
    expect(output).not.toContain("UnusedConfig.timeout");
    expect(output).not.toContain("UnusedConfig.retries");
  });
});
