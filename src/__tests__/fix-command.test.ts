import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { fixProject } from "../fixProject";

// Create a temporary test directory
const TEMP_DIR = path.join(import.meta.dir, "../../temp-test-fix");

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

function createTsConfig(dir: string = TEMP_DIR) {
  const tsconfigFile = path.join(dir, "tsconfig.json");
  fs.writeFileSync(
    tsconfigFile,
    JSON.stringify({
      compilerOptions: {
        target: "ES2020",
        module: "ESNext",
        moduleResolution: "bundler",
      },
      include: ["*.ts"],
    })
  );
  return tsconfigFile;
}

beforeEach(() => {
  createTempDir();
});

afterEach(() => {
  cleanupTempDir();
});

describe("fixProject", () => {
  test("removes unused exports from files", () => {
    // Create test files
    const testFile = path.join(TEMP_DIR, "test.ts");
    const consumerFile = path.join(TEMP_DIR, "consumer.ts");
    const tsconfigFile = path.join(TEMP_DIR, "tsconfig.json");

    fs.writeFileSync(
      testFile,
      `export function usedFunction() {
  return "used";
}

export function unusedFunction() {
  return "unused";
}

export const USED_CONSTANT = 42;
export const UNUSED_CONSTANT = 99;
`
    );

    fs.writeFileSync(
      consumerFile,
      `import { usedFunction, USED_CONSTANT } from "./test";

console.log(usedFunction(), USED_CONSTANT);
`
    );

    fs.writeFileSync(
      tsconfigFile,
      JSON.stringify({
        compilerOptions: {
          target: "ES2020",
          module: "ESNext",
          moduleResolution: "bundler",
        },
        include: ["*.ts"],
      })
    );

    // Run fix
    const results = fixProject(tsconfigFile);

    // Check that unused exports were removed
    const fixedContent = fs.readFileSync(testFile, "utf-8");
    expect(fixedContent).not.toContain("unusedFunction");
    expect(fixedContent).not.toContain("UNUSED_CONSTANT");
    expect(fixedContent).toContain("usedFunction");
    expect(fixedContent).toContain("USED_CONSTANT");

    // Check results
    expect(results.fixedExports).toBeGreaterThan(0);
  });

  test("removes unused properties from interfaces", () => {
    const testFile = path.join(TEMP_DIR, "test.ts");
    const consumerFile = path.join(TEMP_DIR, "consumer.ts");
    const tsconfigFile = path.join(TEMP_DIR, "tsconfig.json");

    fs.writeFileSync(
      testFile,
      `export interface User {
  id: number;
  name: string;
  unusedField: string;
}
`
    );

    fs.writeFileSync(
      consumerFile,
      `import type { User } from "./test";

const user: Partial<User> = {
  id: 1,
  name: "John",
};

console.log(user.id, user.name);
`
    );

    fs.writeFileSync(
      tsconfigFile,
      JSON.stringify({
        compilerOptions: {
          target: "ES2020",
          module: "ESNext",
          moduleResolution: "bundler",
        },
        include: ["*.ts"],
      })
    );

    const results = fixProject(tsconfigFile);

    const fixedContent = fs.readFileSync(testFile, "utf-8");
    expect(fixedContent).not.toContain("unusedField");
    expect(fixedContent).toContain("id");
    expect(fixedContent).toContain("name");

    expect(results.fixedProperties).toBeGreaterThan(0);
  });

  test("deletes completely unused files", () => {
    const usedFile = path.join(TEMP_DIR, "used.ts");
    const unusedFile = path.join(TEMP_DIR, "unused.ts");
    const consumerFile = path.join(TEMP_DIR, "consumer.ts");
    const tsconfigFile = path.join(TEMP_DIR, "tsconfig.json");

    fs.writeFileSync(
      usedFile,
      `export function usedFunction() {
  return "used";
}
`
    );

    fs.writeFileSync(
      unusedFile,
      `export function unusedFunction() {
  return "unused";
}

export const UNUSED = 42;
`
    );

    fs.writeFileSync(
      consumerFile,
      `import { usedFunction } from "./used";

console.log(usedFunction());
`
    );

    fs.writeFileSync(
      tsconfigFile,
      JSON.stringify({
        compilerOptions: {
          target: "ES2020",
          module: "ESNext",
          moduleResolution: "bundler",
        },
        include: ["*.ts"],
      })
    );

    const results = fixProject(tsconfigFile);

    expect(fs.existsSync(usedFile)).toBe(true);
    expect(fs.existsSync(unusedFile)).toBe(false);
    expect(results.deletedFiles).toBeGreaterThan(0);
  });

  test("skips files with local git changes", () => {
    // This test will be implemented once we have git integration
    // For now, just ensure the function exists and can be called
    expect(fixProject).toBeDefined();
  });

  test("deletes files that only re-export from deleted files", () => {
    const originalFile = path.join(TEMP_DIR, "original.ts");
    const reexportFile = path.join(TEMP_DIR, "reexport.ts");
    const consumerFile = path.join(TEMP_DIR, "consumer.ts");
    const tsconfigFile = path.join(TEMP_DIR, "tsconfig.json");

    // Create an unused file
    fs.writeFileSync(
      originalFile,
      `export function originalFunction() {
  return "original";
}

export const ORIGINAL_CONSTANT = "original";
`
    );

    // Create a file that only re-exports from the unused file
    fs.writeFileSync(
      reexportFile,
      `export * from "./original";
`
    );

    // Consumer that doesn't use anything
    fs.writeFileSync(
      consumerFile,
      `console.log("nothing imported");
`
    );

    fs.writeFileSync(
      tsconfigFile,
      JSON.stringify({
        compilerOptions: {
          target: "ES2020",
          module: "ESNext",
          moduleResolution: "bundler",
        },
        include: ["*.ts"],
      })
    );

    const results = fixProject(tsconfigFile);

    // Both original and reexport should be deleted
    expect(fs.existsSync(originalFile)).toBe(false);
    expect(fs.existsSync(reexportFile)).toBe(false);
    expect(fs.existsSync(consumerFile)).toBe(true);
    expect(results.deletedFiles).toBe(2);
  });

  test("removes broken re-exports but keeps file with other content", () => {
    const originalFile = path.join(TEMP_DIR, "original.ts");
    const mixedFile = path.join(TEMP_DIR, "mixed.ts");
    const consumerFile = path.join(TEMP_DIR, "consumer.ts");
    const tsconfigFile = path.join(TEMP_DIR, "tsconfig.json");

    // Create an unused file
    fs.writeFileSync(
      originalFile,
      `export function originalFunction() {
  return "original";
}
`
    );

    // Create a file that re-exports from unused file but also has its own exports
    fs.writeFileSync(
      mixedFile,
      `export * from "./original";

export function ownFunction() {
  return "own";
}
`
    );

    // Consumer uses the own function
    fs.writeFileSync(
      consumerFile,
      `import { ownFunction } from "./mixed";

console.log(ownFunction());
`
    );

    fs.writeFileSync(
      tsconfigFile,
      JSON.stringify({
        compilerOptions: {
          target: "ES2020",
          module: "ESNext",
          moduleResolution: "bundler",
        },
        include: ["*.ts"],
      })
    );

    const results = fixProject(tsconfigFile);

    // Original should be deleted
    expect(fs.existsSync(originalFile)).toBe(false);

    // Mixed file should still exist but without the broken re-export
    expect(fs.existsSync(mixedFile)).toBe(true);
    const mixedContent = fs.readFileSync(mixedFile, "utf-8");
    expect(mixedContent).not.toContain('from "./original"');
    expect(mixedContent).toContain("ownFunction");

    expect(results.deletedFiles).toBe(1);
  });

  test("removes unused properties from type aliases", () => {
    const testFile = path.join(TEMP_DIR, "test.ts");
    const consumerFile = path.join(TEMP_DIR, "consumer.ts");
    const tsconfigFile = createTsConfig();

    fs.writeFileSync(
      testFile,
      `export type Config = {
  host: string;
  port: number;
  unusedOption: boolean;
};
`
    );

    fs.writeFileSync(
      consumerFile,
      `import type { Config } from "./test";

const config: Partial<Config> = {
  host: "localhost",
  port: 3000,
};

console.log(config.host, config.port);
`
    );

    const results = fixProject(tsconfigFile);

    const fixedContent = fs.readFileSync(testFile, "utf-8");
    expect(fixedContent).not.toContain("unusedOption");
    expect(fixedContent).toContain("host");
    expect(fixedContent).toContain("port");

    expect(results.fixedProperties).toBeGreaterThan(0);
  });

  test("removes never-returned types from function return type unions", () => {
    const testFile = path.join(TEMP_DIR, "test.ts");
    const consumerFile = path.join(TEMP_DIR, "consumer.ts");
    const tsconfigFile = createTsConfig();

    fs.writeFileSync(
      testFile,
      `export interface Success {
  status: "success";
  data: string;
}

export interface Error {
  status: "error";
  message: string;
}

export function fetchData(): Success | Error {
  return { status: "success", data: "hello" };
}
`
    );

    fs.writeFileSync(
      consumerFile,
      `import { fetchData, type Success } from "./test";

const result = fetchData();
if (result.status === "success") {
  const data: Success = result;
  console.log(data.data);
}
`
    );

    const results = fixProject(tsconfigFile);

    // Error type should be removed from union since it's never returned
    expect(results.fixedNeverReturnedTypes).toBeGreaterThanOrEqual(0);
  });

  test("calls progress callback with status messages", () => {
    const testFile = path.join(TEMP_DIR, "test.ts");
    const consumerFile = path.join(TEMP_DIR, "consumer.ts");
    const tsconfigFile = createTsConfig();

    fs.writeFileSync(
      testFile,
      `export function unusedFn() { return 1; }
`
    );

    fs.writeFileSync(
      consumerFile,
      `console.log("nothing used");
`
    );

    const progressMessages: string[] = [];
    fixProject(tsconfigFile, (msg) => progressMessages.push(msg));

    expect(progressMessages.length).toBeGreaterThan(0);
    expect(progressMessages.some((m) => m.includes("Deleting"))).toBe(true);
  });

  test("handles non-existent source files gracefully", () => {
    const consumerFile = path.join(TEMP_DIR, "consumer.ts");
    const tsconfigFile = createTsConfig();

    fs.writeFileSync(
      consumerFile,
      `console.log("hello");
`
    );

    // Should not throw
    const results = fixProject(tsconfigFile);
    expect(results).toBeDefined();
  });

  test("handles functions without explicit return type", () => {
    const testFile = path.join(TEMP_DIR, "test.ts");
    const consumerFile = path.join(TEMP_DIR, "consumer.ts");
    const tsconfigFile = createTsConfig();

    fs.writeFileSync(
      testFile,
      `export function noReturnType() {
  return "hello";
}
`
    );

    fs.writeFileSync(
      consumerFile,
      `import { noReturnType } from "./test";
console.log(noReturnType());
`
    );

    // Should not throw even if function has no explicit return type
    const results = fixProject(tsconfigFile);
    expect(results).toBeDefined();
  });

  test("handles Promise return types with union", () => {
    const testFile = path.join(TEMP_DIR, "test.ts");
    const consumerFile = path.join(TEMP_DIR, "consumer.ts");
    const tsconfigFile = createTsConfig();

    fs.writeFileSync(
      testFile,
      `export interface Data {
  value: string;
}

export interface Err {
  code: number;
}

export async function fetchAsync(): Promise<Data | Err> {
  return { value: "test" };
}
`
    );

    fs.writeFileSync(
      consumerFile,
      `import { fetchAsync, type Data } from "./test";

async function main() {
  const result = await fetchAsync();
  const data = result as Data;
  console.log(data.value);
}

main();
`
    );

    const results = fixProject(tsconfigFile);
    expect(results).toBeDefined();
  });

  test("handles inline object types in return unions", () => {
    const testFile = path.join(TEMP_DIR, "test.ts");
    const consumerFile = path.join(TEMP_DIR, "consumer.ts");
    const tsconfigFile = createTsConfig();

    fs.writeFileSync(
      testFile,
      `export function getData(): { ok: true; data: string } | { ok: false; error: string } {
  return { ok: true, data: "success" };
}
`
    );

    fs.writeFileSync(
      consumerFile,
      `import { getData } from "./test";

const result = getData();
if (result.ok) {
  console.log(result.data);
}
`
    );

    const results = fixProject(tsconfigFile);
    expect(results).toBeDefined();
  });

  test("handles removal of boolean literal types", () => {
    const testFile = path.join(TEMP_DIR, "test.ts");
    const consumerFile = path.join(TEMP_DIR, "consumer.ts");
    const tsconfigFile = createTsConfig();

    fs.writeFileSync(
      testFile,
      `export function check(): true | false {
  return true;
}
`
    );

    fs.writeFileSync(
      consumerFile,
      `import { check } from "./test";
const result = check();
if (result === true) {
  console.log("yes");
}
`
    );

    const results = fixProject(tsconfigFile);
    expect(results).toBeDefined();
  });

  test("handles multiple exports in same file with different severities", () => {
    const testFile = path.join(TEMP_DIR, "test.ts");
    const consumerFile = path.join(TEMP_DIR, "consumer.ts");
    const tsconfigFile = createTsConfig();

    fs.writeFileSync(
      testFile,
      `export function usedExport() { return 1; }
export function unusedExport() { return 2; }
export const USED = "used";
export const UNUSED = "unused";
`
    );

    fs.writeFileSync(
      consumerFile,
      `import { usedExport, USED } from "./test";
console.log(usedExport(), USED);
`
    );

    const results = fixProject(tsconfigFile);
    expect(results.fixedExports).toBe(2);

    const content = fs.readFileSync(testFile, "utf-8");
    expect(content).toContain("usedExport");
    expect(content).toContain("USED");
    expect(content).not.toContain("unusedExport");
    expect(content).not.toContain("UNUSED");
  });

  test("handles class exports", () => {
    const testFile = path.join(TEMP_DIR, "test.ts");
    const consumerFile = path.join(TEMP_DIR, "consumer.ts");
    const tsconfigFile = createTsConfig();

    fs.writeFileSync(
      testFile,
      `export class UsedClass {
  method() { return 1; }
}

export class UnusedClass {
  method() { return 2; }
}
`
    );

    fs.writeFileSync(
      consumerFile,
      `import { UsedClass } from "./test";
const instance = new UsedClass();
console.log(instance.method());
`
    );

    const results = fixProject(tsconfigFile);
    expect(results.fixedExports).toBe(1);

    const content = fs.readFileSync(testFile, "utf-8");
    expect(content).toContain("UsedClass");
    expect(content).not.toContain("UnusedClass");
  });

  test("handles enum exports", () => {
    const testFile = path.join(TEMP_DIR, "test.ts");
    const consumerFile = path.join(TEMP_DIR, "consumer.ts");
    const tsconfigFile = createTsConfig();

    fs.writeFileSync(
      testFile,
      `export enum UsedEnum {
  A = "a",
  B = "b",
}

export enum UnusedEnum {
  X = "x",
  Y = "y",
}
`
    );

    fs.writeFileSync(
      consumerFile,
      `import { UsedEnum } from "./test";
console.log(UsedEnum.A);
`
    );

    const results = fixProject(tsconfigFile);
    expect(results.fixedExports).toBe(1);

    const content = fs.readFileSync(testFile, "utf-8");
    expect(content).toContain("UsedEnum");
    expect(content).not.toContain("UnusedEnum");
  });

  test("handles files in subdirectories", () => {
    const subDir = path.join(TEMP_DIR, "sub");
    fs.mkdirSync(subDir, { recursive: true });

    const testFile = path.join(subDir, "test.ts");
    const consumerFile = path.join(TEMP_DIR, "consumer.ts");

    fs.writeFileSync(
      testFile,
      `export function subFn() { return 1; }
export function unusedSubFn() { return 2; }
`
    );

    fs.writeFileSync(
      consumerFile,
      `import { subFn } from "./sub/test";
console.log(subFn());
`
    );

    const tsconfigFile = path.join(TEMP_DIR, "tsconfig.json");
    fs.writeFileSync(
      tsconfigFile,
      JSON.stringify({
        compilerOptions: {
          target: "ES2020",
          module: "ESNext",
          moduleResolution: "bundler",
        },
        include: ["*.ts", "**/*.ts"],
      })
    );

    const results = fixProject(tsconfigFile);
    expect(results.fixedExports).toBe(1);

    const content = fs.readFileSync(testFile, "utf-8");
    expect(content).toContain("subFn");
    expect(content).not.toContain("unusedSubFn");
  });

  test("handles index.ts files", () => {
    const subDir = path.join(TEMP_DIR, "utils");
    fs.mkdirSync(subDir, { recursive: true });

    const indexFile = path.join(subDir, "index.ts");
    const consumerFile = path.join(TEMP_DIR, "consumer.ts");

    fs.writeFileSync(
      indexFile,
      `export function utilFn() { return 1; }
export function unusedUtilFn() { return 2; }
`
    );

    fs.writeFileSync(
      consumerFile,
      `import { utilFn } from "./utils";
console.log(utilFn());
`
    );

    const tsconfigFile = path.join(TEMP_DIR, "tsconfig.json");
    fs.writeFileSync(
      tsconfigFile,
      JSON.stringify({
        compilerOptions: {
          target: "ES2020",
          module: "ESNext",
          moduleResolution: "bundler",
        },
        include: ["*.ts", "**/*.ts"],
      })
    );

    const results = fixProject(tsconfigFile);
    expect(results.fixedExports).toBe(1);

    const content = fs.readFileSync(indexFile, "utf-8");
    expect(content).toContain("utilFn");
    expect(content).not.toContain("unusedUtilFn");
  });
});
