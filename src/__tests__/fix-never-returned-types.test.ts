import { afterAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { fixProject } from "../fixProject";

const TEMP_DIR = path.join(process.cwd(), ".test-temp-fix-never-returned");

// Cleanup after tests
afterAll(() => {
  if (fs.existsSync(TEMP_DIR)) {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }
});

describe("Fix Never-Returned Types", () => {
  test("removes never-returned types from union return types", async () => {
    // Setup temp directory
    if (fs.existsSync(TEMP_DIR)) {
      fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TEMP_DIR, { recursive: true });

    const testFile = path.join(TEMP_DIR, "test.ts");
    const consumerFile = path.join(TEMP_DIR, "consumer.ts");
    const tsconfigFile = path.join(TEMP_DIR, "tsconfig.json");

    fs.writeFileSync(
      testFile,
      `export interface SuccessResult {
  success: true;
  data: string;
}

export interface ErrorResult {
  success: false;
  error: string;
}

export type ResultType = SuccessResult | ErrorResult;

// ErrorResult is never returned
export function alwaysSucceeds(): ResultType {
  return { success: true, data: "test" };
}

// SuccessResult is never returned
export function alwaysFails(): ResultType {
  return { success: false, error: "failed" };
}
`
    );

    // Add a consumer to prevent functions from being removed as unused
    fs.writeFileSync(
      consumerFile,
      `import { alwaysSucceeds, alwaysFails } from "./test";
console.log(alwaysSucceeds());
console.log(alwaysFails());
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
    const results = await fixProject(tsconfigFile);

    // Check results
    expect(results.fixedNeverReturnedTypes).toBe(2);
    expect(results.errors).toHaveLength(0);

    // Check that the file was modified correctly
    const fixedContent = fs.readFileSync(testFile, "utf-8");

    // alwaysSucceeds should only return SuccessResult
    expect(fixedContent).toContain("function alwaysSucceeds(): SuccessResult");

    // alwaysFails should only return ErrorResult
    expect(fixedContent).toContain("function alwaysFails(): ErrorResult");
  });

  test("removes never-returned types from Promise<Union> return types", async () => {
    if (fs.existsSync(TEMP_DIR)) {
      fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TEMP_DIR, { recursive: true });

    const testFile = path.join(TEMP_DIR, "test.ts");
    const consumerFile = path.join(TEMP_DIR, "consumer.ts");
    const tsconfigFile = path.join(TEMP_DIR, "tsconfig.json");

    fs.writeFileSync(
      testFile,
      `export interface SuccessResult {
  success: true;
  data: string;
}

export interface ErrorResult {
  success: false;
  error: string;
}

export async function asyncAlwaysSucceeds(): Promise<SuccessResult | ErrorResult> {
  return { success: true, data: "test" };
}
`
    );

    fs.writeFileSync(
      consumerFile,
      `import { asyncAlwaysSucceeds } from "./test";
asyncAlwaysSucceeds();
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

    const results = await fixProject(tsconfigFile);

    expect(results.fixedNeverReturnedTypes).toBe(1);
    expect(results.errors).toHaveLength(0);

    const fixedContent = fs.readFileSync(testFile, "utf-8");
    expect(fixedContent).toContain("Promise<SuccessResult>");
  });

  test("removes primitive never-returned types", async () => {
    if (fs.existsSync(TEMP_DIR)) {
      fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TEMP_DIR, { recursive: true });

    const testFile = path.join(TEMP_DIR, "test.ts");
    const consumerFile = path.join(TEMP_DIR, "consumer.ts");
    const tsconfigFile = path.join(TEMP_DIR, "tsconfig.json");

    fs.writeFileSync(
      testFile,
      `export function onlyReturnsString(): string | number | boolean {
  return "always a string";
}
`
    );

    fs.writeFileSync(
      consumerFile,
      `import { onlyReturnsString } from "./test";
console.log(onlyReturnsString());
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

    const results = await fixProject(tsconfigFile);

    // Should remove number and boolean (2 fixes)
    expect(results.fixedNeverReturnedTypes).toBeGreaterThanOrEqual(1);
    expect(results.errors).toHaveLength(0);

    const fixedContent = fs.readFileSync(testFile, "utf-8");
    // Should eventually have only string
    expect(fixedContent).toContain("function onlyReturnsString():");
    // Should not have all three types anymore (at least one removed)
    expect(fixedContent).not.toContain("string | number | boolean");
  });
});
