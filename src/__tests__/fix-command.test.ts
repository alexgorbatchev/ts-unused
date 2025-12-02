import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { fixProject } from "../fixProject";

// Create a temporary test directory
const TEMP_DIR = path.join(import.meta.dir, "../../temp-test-fix");

beforeEach(() => {
  // Clean up and create fresh temp directory
  if (fs.existsSync(TEMP_DIR)) {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEMP_DIR, { recursive: true });
});

afterEach(() => {
  // Clean up temp directory after tests
  if (fs.existsSync(TEMP_DIR)) {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }
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
});
