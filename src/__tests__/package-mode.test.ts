import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { analyzeProject } from "../analyzeProject";

const TEMP_DIR = path.join(import.meta.dir, "../../temp-test-package-mode");

function createTempDir() {
  if (fs.existsSync(TEMP_DIR)) {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

function cleanupTempDir() {
  if (fs.existsSync(TEMP_DIR)) {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }
}

function createTsConfig(includePatterns: string[] = ["src/**/*.ts"]) {
  const tsconfigFile = path.join(TEMP_DIR, "tsconfig.json");
  fs.writeFileSync(
    tsconfigFile,
    JSON.stringify({
      compilerOptions: {
        target: "ES2020",
        module: "ESNext",
        moduleResolution: "bundler",
        strict: true,
        declaration: true,
        outDir: "./dist",
      },
      include: includePatterns,
    })
  );
  return tsconfigFile;
}

function createPackageJson(
  options: {
    main?: string;
    exports?: Record<string, unknown> | string;
  } = {}
) {
  const packageJson = path.join(TEMP_DIR, "package.json");
  fs.writeFileSync(
    packageJson,
    JSON.stringify(
      {
        name: "test-package",
        version: "1.0.0",
        type: "module",
        ...options,
      },
      null,
      2
    )
  );
  return packageJson;
}

beforeEach(() => {
  createTempDir();
});

afterEach(() => {
  cleanupTempDir();
});

describe("Package Mode", () => {
  test("considers exports used when they are re-exported through barrel file to package entry point", async () => {
    // Create package.json with main pointing to barrel file
    createPackageJson({
      main: "./dist/index.js",
      exports: {
        ".": {
          types: "./dist/index.d.ts",
          default: "./dist/index.js",
        },
      },
    });

    // Create src directory
    fs.mkdirSync(path.join(TEMP_DIR, "src"), { recursive: true });

    // Create a utility function in a nested file
    fs.writeFileSync(
      path.join(TEMP_DIR, "src/utils.ts"),
      `
export function formatDate(date: Date): string {
  return date.toISOString();
}

export function parseDate(str: string): Date {
  return new Date(str);
}
      `.trim()
    );

    // Create the main barrel file that re-exports
    fs.writeFileSync(
      path.join(TEMP_DIR, "src/index.ts"),
      `
export { formatDate, parseDate } from "./utils";
      `.trim()
    );

    const tsconfigFile = createTsConfig();
    const results = await analyzeProject(tsconfigFile, undefined, undefined, {
      config: {
        packageMode: true,
      },
    });

    // In package mode, formatDate and parseDate should NOT be reported as unused
    // because they are exported through the barrel file which is the package entry point
    const unusedExportNames = results.unusedExports.map((e) => e.exportName);
    expect(unusedExportNames).not.toContain("formatDate");
    expect(unusedExportNames).not.toContain("parseDate");
  });

  test("considers exports used when they are re-exported through multiple nested barrel files", async () => {
    // Create package.json with exports
    createPackageJson({
      main: "./dist/index.js",
      exports: {
        ".": {
          types: "./dist/index.d.ts",
          default: "./dist/index.js",
        },
      },
    });

    // Create nested directory structure
    fs.mkdirSync(path.join(TEMP_DIR, "src/utils/string"), { recursive: true });

    // Create the deepest file with actual implementation
    fs.writeFileSync(
      path.join(TEMP_DIR, "src/utils/string/capitalize.ts"),
      `
export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function lowercase(str: string): string {
  return str.toLowerCase();
}
      `.trim()
    );

    // Create barrel file for string utils
    fs.writeFileSync(
      path.join(TEMP_DIR, "src/utils/string/index.ts"),
      `
export { capitalize, lowercase } from "./capitalize";
      `.trim()
    );

    // Create barrel file for utils
    fs.writeFileSync(
      path.join(TEMP_DIR, "src/utils/index.ts"),
      `
export * from "./string";
      `.trim()
    );

    // Create main barrel file
    fs.writeFileSync(
      path.join(TEMP_DIR, "src/index.ts"),
      `
export * from "./utils";
      `.trim()
    );

    const tsconfigFile = createTsConfig();
    const results = await analyzeProject(tsconfigFile, undefined, undefined, {
      config: {
        packageMode: true,
      },
    });

    // In package mode, capitalize and lowercase should NOT be reported as unused
    // because they are exported through the barrel chain to the package entry point
    const unusedExportNames = results.unusedExports.map((e) => e.exportName);
    expect(unusedExportNames).not.toContain("capitalize");
    expect(unusedExportNames).not.toContain("lowercase");
  });

  test("still reports exports that are NOT re-exported through barrel file to package entry", async () => {
    // Create package.json with main pointing to barrel file
    createPackageJson({
      main: "./dist/index.js",
      exports: {
        ".": {
          types: "./dist/index.d.ts",
          default: "./dist/index.js",
        },
      },
    });

    // Create src directory
    fs.mkdirSync(path.join(TEMP_DIR, "src"), { recursive: true });

    // Create a utility function in a nested file - one exported, one not
    fs.writeFileSync(
      path.join(TEMP_DIR, "src/utils.ts"),
      `
export function publicFunction(): string {
  return "public";
}

export function internalFunction(): string {
  return "internal";
}
      `.trim()
    );

    // Create the main barrel file that only re-exports publicFunction
    fs.writeFileSync(
      path.join(TEMP_DIR, "src/index.ts"),
      `
export { publicFunction } from "./utils";
      `.trim()
    );

    const tsconfigFile = createTsConfig();
    const results = await analyzeProject(tsconfigFile, undefined, undefined, {
      config: {
        packageMode: true,
      },
    });

    // publicFunction should NOT be reported (it's in the public API)
    // internalFunction SHOULD be reported (not part of public API)
    const unusedExportNames = results.unusedExports.map((e) => e.exportName);
    expect(unusedExportNames).not.toContain("publicFunction");
    expect(unusedExportNames).toContain("internalFunction");
  });

  test("handles exports field with multiple entry points", async () => {
    // Create package.json with multiple exports
    createPackageJson({
      exports: {
        ".": {
          types: "./dist/index.d.ts",
          default: "./dist/index.js",
        },
        "./utils": {
          types: "./dist/utils/index.d.ts",
          default: "./dist/utils/index.js",
        },
      },
    });

    // Create directory structure
    fs.mkdirSync(path.join(TEMP_DIR, "src/utils"), { recursive: true });

    // Create core function
    fs.writeFileSync(
      path.join(TEMP_DIR, "src/core.ts"),
      `
export function coreFunction(): string {
  return "core";
}
      `.trim()
    );

    // Create util function
    fs.writeFileSync(
      path.join(TEMP_DIR, "src/utils/helper.ts"),
      `
export function helperFunction(): string {
  return "helper";
}
      `.trim()
    );

    // Create utils barrel
    fs.writeFileSync(
      path.join(TEMP_DIR, "src/utils/index.ts"),
      `
export { helperFunction } from "./helper";
      `.trim()
    );

    // Create main barrel
    fs.writeFileSync(
      path.join(TEMP_DIR, "src/index.ts"),
      `
export { coreFunction } from "./core";
      `.trim()
    );

    const tsconfigFile = createTsConfig();
    const results = await analyzeProject(tsconfigFile, undefined, undefined, {
      config: {
        packageMode: true,
      },
    });

    // Both coreFunction and helperFunction should NOT be reported
    // coreFunction is exported via main entry point "."
    // helperFunction is exported via "./utils" entry point
    const unusedExportNames = results.unusedExports.map((e) => e.exportName);
    expect(unusedExportNames).not.toContain("coreFunction");
    expect(unusedExportNames).not.toContain("helperFunction");
  });

  test("handles types and interfaces exported through barrel files", async () => {
    // Create package.json with main
    createPackageJson({
      main: "./dist/index.js",
      exports: {
        ".": {
          types: "./dist/index.d.ts",
          default: "./dist/index.js",
        },
      },
    });

    // Create src directory
    fs.mkdirSync(path.join(TEMP_DIR, "src"), { recursive: true });

    // Create types file
    fs.writeFileSync(
      path.join(TEMP_DIR, "src/types.ts"),
      `
export interface User {
  id: string;
  name: string;
}

export type UserRole = "admin" | "user" | "guest";

export interface InternalConfig {
  debug: boolean;
}
      `.trim()
    );

    // Create main barrel file that only exports public types
    fs.writeFileSync(
      path.join(TEMP_DIR, "src/index.ts"),
      `
export type { User, UserRole } from "./types";
      `.trim()
    );

    const tsconfigFile = createTsConfig();
    const results = await analyzeProject(tsconfigFile, undefined, undefined, {
      config: {
        packageMode: true,
      },
    });

    // User and UserRole should NOT be reported (public API)
    // InternalConfig SHOULD be reported (not exported in barrel)
    const unusedExportNames = results.unusedExports.map((e) => e.exportName);
    expect(unusedExportNames).not.toContain("User");
    expect(unusedExportNames).not.toContain("UserRole");
    expect(unusedExportNames).toContain("InternalConfig");
  });

  test("handles main field without exports field", async () => {
    // Create package.json with only main field
    createPackageJson({
      main: "./dist/index.js",
    });

    // Create src directory
    fs.mkdirSync(path.join(TEMP_DIR, "src"), { recursive: true });

    // Create a utility function
    fs.writeFileSync(
      path.join(TEMP_DIR, "src/utils.ts"),
      `
export function helper(): string {
  return "helper";
}
      `.trim()
    );

    // Create the main barrel file that re-exports
    fs.writeFileSync(
      path.join(TEMP_DIR, "src/index.ts"),
      `
export { helper } from "./utils";
      `.trim()
    );

    const tsconfigFile = createTsConfig();
    const results = await analyzeProject(tsconfigFile, undefined, undefined, {
      config: {
        packageMode: true,
      },
    });

    // helper should NOT be reported because it's exported through main entry point
    const unusedExportNames = results.unusedExports.map((e) => e.exportName);
    expect(unusedExportNames).not.toContain("helper");
  });

  test("reports error when packageMode is true but no package.json is found", async () => {
    // Do NOT create package.json

    // Create src directory
    fs.mkdirSync(path.join(TEMP_DIR, "src"), { recursive: true });

    // Create a utility function
    fs.writeFileSync(
      path.join(TEMP_DIR, "src/utils.ts"),
      `
export function helper(): string {
  return "helper";
}
      `.trim()
    );

    fs.writeFileSync(
      path.join(TEMP_DIR, "src/index.ts"),
      `
export { helper } from "./utils";
      `.trim()
    );

    const tsconfigFile = createTsConfig();

    // Should throw an error or warn when packageMode is enabled but no package.json exists
    await expect(
      analyzeProject(tsconfigFile, undefined, undefined, {
        config: {
          packageMode: true,
        },
      })
    ).rejects.toThrow(/package\.json/i);
  });

  test("reports error when packageMode is true but package.json has no entry points", async () => {
    // Create package.json without main or exports
    createPackageJson({});

    // Create src directory
    fs.mkdirSync(path.join(TEMP_DIR, "src"), { recursive: true });

    fs.writeFileSync(
      path.join(TEMP_DIR, "src/utils.ts"),
      `
export function helper(): string {
  return "helper";
}
      `.trim()
    );

    fs.writeFileSync(
      path.join(TEMP_DIR, "src/index.ts"),
      `
export { helper } from "./utils";
      `.trim()
    );

    const tsconfigFile = createTsConfig();

    // Should throw an error when packageMode is enabled but package.json has no entry points
    await expect(
      analyzeProject(tsconfigFile, undefined, undefined, {
        config: {
          packageMode: true,
        },
      })
    ).rejects.toThrow(/entry point|main|exports/i);
  });

  test("handles export * re-exports correctly", async () => {
    // Create package.json
    createPackageJson({
      main: "./dist/index.js",
    });

    // Create src directory
    fs.mkdirSync(path.join(TEMP_DIR, "src"), { recursive: true });

    // Create types file with multiple exports
    fs.writeFileSync(
      path.join(TEMP_DIR, "src/types.ts"),
      `
export interface Config {
  name: string;
}

export type Status = "active" | "inactive";

export const VERSION = "1.0.0";
      `.trim()
    );

    // Create main barrel file using export *
    fs.writeFileSync(
      path.join(TEMP_DIR, "src/index.ts"),
      `
export * from "./types";
      `.trim()
    );

    const tsconfigFile = createTsConfig();
    const results = await analyzeProject(tsconfigFile, undefined, undefined, {
      config: {
        packageMode: true,
      },
    });

    // All exports from types.ts should NOT be reported because export * includes them all
    const unusedExportNames = results.unusedExports.map((e) => e.exportName);
    expect(unusedExportNames).not.toContain("Config");
    expect(unusedExportNames).not.toContain("Status");
    expect(unusedExportNames).not.toContain("VERSION");
  });

  test("handles mixed export * and named exports", async () => {
    // Create package.json
    createPackageJson({
      main: "./dist/index.js",
    });

    // Create src directory
    fs.mkdirSync(path.join(TEMP_DIR, "src"), { recursive: true });

    // Create first module
    fs.writeFileSync(
      path.join(TEMP_DIR, "src/moduleA.ts"),
      `
export function funcA(): string {
  return "A";
}
      `.trim()
    );

    // Create second module
    fs.writeFileSync(
      path.join(TEMP_DIR, "src/moduleB.ts"),
      `
export function funcB(): string {
  return "B";
}

export function internalB(): string {
  return "internal";
}
      `.trim()
    );

    // Create main barrel file with mixed exports
    fs.writeFileSync(
      path.join(TEMP_DIR, "src/index.ts"),
      `
export * from "./moduleA";
export { funcB } from "./moduleB";
      `.trim()
    );

    const tsconfigFile = createTsConfig();
    const results = await analyzeProject(tsconfigFile, undefined, undefined, {
      config: {
        packageMode: true,
      },
    });

    // funcA and funcB should NOT be reported (public API)
    // internalB SHOULD be reported (not exported)
    const unusedExportNames = results.unusedExports.map((e) => e.exportName);
    expect(unusedExportNames).not.toContain("funcA");
    expect(unusedExportNames).not.toContain("funcB");
    expect(unusedExportNames).toContain("internalB");
  });
});
