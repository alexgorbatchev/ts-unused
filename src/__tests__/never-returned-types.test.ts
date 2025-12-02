import { describe, expect, test } from "bun:test";
import path from "node:path";
import { analyzeProject } from "../analyzeProject";
import { isTestFile } from "../isTestFile";

describe("Never-Returned Types Detection", () => {
  const fixturesDir = path.join(process.cwd(), "test-project");
  const tsConfigPath = path.join(fixturesDir, "tsconfig.json");

  test("detects union type branches that are never returned", () => {
    const results = analyzeProject(tsConfigPath, undefined, undefined, isTestFile);

    // Should have neverReturnedTypes property
    expect(results.neverReturnedTypes).toBeDefined();
    expect(Array.isArray(results.neverReturnedTypes)).toBe(true);

    if (!results.neverReturnedTypes) {
      throw new Error("neverReturnedTypes is undefined");
    }

    // Case 1: alwaysSucceeds never returns ErrorResult
    const alwaysSucceeds = results.neverReturnedTypes.find(
      (r) => r.functionName === "alwaysSucceeds" && r.neverReturnedType === "ErrorResult"
    );
    expect(alwaysSucceeds).toBeDefined();
    expect(alwaysSucceeds?.severity).toBe("error");

    // Case 2: alwaysFails never returns SuccessResult
    const alwaysFails = results.neverReturnedTypes.find(
      (r) => r.functionName === "alwaysFails" && r.neverReturnedType === "SuccessResult"
    );
    expect(alwaysFails).toBeDefined();
    expect(alwaysFails?.severity).toBe("error");

    // Case 3: sometimesSucceeds returns both types (should NOT be flagged)
    const sometimesSucceeds = results.neverReturnedTypes.filter((r) => r.functionName === "sometimesSucceeds");
    expect(sometimesSucceeds.length).toBe(0);

    // Case 4: asyncAlwaysSucceeds never returns ErrorResult (even with Promise)
    const asyncAlwaysSucceeds = results.neverReturnedTypes.find(
      (r) => r.functionName === "asyncAlwaysSucceeds" && r.neverReturnedType === "ErrorResult"
    );
    expect(asyncAlwaysSucceeds).toBeDefined();

    // Case 5: neverWarns never returns WarningResult
    const neverWarns = results.neverReturnedTypes.find(
      (r) => r.functionName === "neverWarns" && r.neverReturnedType === "WarningResult"
    );
    expect(neverWarns).toBeDefined();

    // Case 6: onlyReturnsString never returns number or boolean
    const onlyReturnsStringNumber = results.neverReturnedTypes.find(
      (r) => r.functionName === "onlyReturnsString" && r.neverReturnedType === "number"
    );
    const onlyReturnsStringBoolean = results.neverReturnedTypes.find(
      (r) => r.functionName === "onlyReturnsString" && r.neverReturnedType === "boolean"
    );
    expect(onlyReturnsStringNumber).toBeDefined();
    expect(onlyReturnsStringBoolean).toBeDefined();

    // Case 7: returnsAll returns all types (should NOT be flagged)
    const returnsAll = results.neverReturnedTypes.filter((r) => r.functionName === "returnsAll");
    expect(returnsAll.length).toBe(0);
  });

  test("includes file location information", () => {
    const results = analyzeProject(tsConfigPath, undefined, undefined, isTestFile);

    if (!results.neverReturnedTypes) {
      throw new Error("neverReturnedTypes is undefined");
    }

    const result = results.neverReturnedTypes.find((r) => r.functionName === "alwaysSucceeds");
    expect(result).toBeDefined();
    expect(result?.filePath).toContain("return-types.ts");
    expect(result?.line).toBeGreaterThan(0);
    expect(result?.character).toBeGreaterThan(0);
  });

  test("displays simple type names without import paths", () => {
    const results = analyzeProject(tsConfigPath, undefined, undefined, isTestFile);

    if (!results.neverReturnedTypes) {
      throw new Error("neverReturnedTypes is undefined");
    }

    // Check imported types show simple names, not full import paths
    const importedTypeResult = results.neverReturnedTypes.find((r) => r.functionName === "processWithImportedTypes");
    expect(importedTypeResult).toBeDefined();
    expect(importedTypeResult?.neverReturnedType).toBe("LocalError");
    expect(importedTypeResult?.neverReturnedType).not.toContain("import(");
    expect(importedTypeResult?.neverReturnedType).not.toContain("/");

    // Check async with imported types
    const asyncImportedResult = results.neverReturnedTypes.find(
      (r) => r.functionName === "asyncProcessWithImportedTypes"
    );
    expect(asyncImportedResult).toBeDefined();
    expect(asyncImportedResult?.neverReturnedType).toBe("LocalError");
    expect(asyncImportedResult?.neverReturnedType).not.toContain("import(");

    // Check explicit imported union types
    const explicitResult = results.neverReturnedTypes.find((r) => r.functionName === "explicitImportedType");
    expect(explicitResult).toBeDefined();
    expect(explicitResult?.neverReturnedType).toBe("LocalError");
    expect(explicitResult?.neverReturnedType).not.toContain("import(");

    // Check inline object types with imported types - should not have full import paths
    const inlineResult = results.neverReturnedTypes.find((r) => r.functionName === "inlineObjectReturn");
    expect(inlineResult).toBeDefined();
    // The type should not contain import() paths
    expect(inlineResult?.neverReturnedType).not.toContain("import(");
    expect(inlineResult?.neverReturnedType).not.toMatch(/\/.*\/.*\//); // No file paths with multiple slashes

    // Check very long inline types are truncated to reasonable length
    const longTypeResult = results.neverReturnedTypes.find((r) => r.functionName === "veryLongInlineType");
    expect(longTypeResult).toBeDefined();
    // Type should be truncated to max 100 characters with ellipsis
    expect(longTypeResult?.neverReturnedType.length).toBeLessThanOrEqual(103); // 100 + "..." = 103
    if (longTypeResult && longTypeResult.neverReturnedType.length > 100) {
      expect(longTypeResult.neverReturnedType).toMatch(/\.\.\.$/); // Should end with ...
    }
  });
});
