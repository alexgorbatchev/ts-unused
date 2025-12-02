import { describe, expect, test } from "bun:test";
import path from "node:path";
import { analyzeProject } from "../analyzeProject";
import { isTestFile } from "../isTestFile";

describe("Enum Return Types", () => {
  const fixturesDir = path.join(process.cwd(), "test-project");
  const tsConfigPath = path.join(fixturesDir, "tsconfig.json");

  test("should not flag enum values as never returned when at least one enum value is returned", () => {
    const results = analyzeProject(tsConfigPath, undefined, undefined, isTestFile);

    expect(results.neverReturnedTypes).toBeDefined();
    if (!results.neverReturnedTypes) {
      throw new Error("neverReturnedTypes is undefined");
    }

    // getStatus returns Status enum - should NOT flag any Status values as never returned
    const getStatusResults = results.neverReturnedTypes.filter((r) => r.functionName === "getStatus");
    expect(getStatusResults.length).toBe(0);

    // detectPlatform returns Platform enum - should NOT flag any Platform values as never returned
    const detectPlatformResults = results.neverReturnedTypes.filter((r) => r.functionName === "detectPlatform");
    expect(detectPlatformResults.length).toBe(0);
  });

  test("should still flag non-enum types as never returned in enum unions", () => {
    const results = analyzeProject(tsConfigPath, undefined, undefined, isTestFile);

    if (!results.neverReturnedTypes) {
      throw new Error("neverReturnedTypes is undefined");
    }

    // getStatusOrNull returns Status | null, never returns null - should flag null
    const nullResult = results.neverReturnedTypes.find(
      (r) => r.functionName === "getStatusOrNull" && r.neverReturnedType === "null"
    );
    expect(nullResult).toBeDefined();

    // But should NOT flag Status enum values
    const statusResults = results.neverReturnedTypes.filter(
      (r) => r.functionName === "getStatusOrNull" && r.neverReturnedType.startsWith("Status.")
    );
    expect(statusResults.length).toBe(0);

    // getStatusOrError returns Status | "unknown", never returns "unknown" - should flag it
    const unknownResult = results.neverReturnedTypes.find(
      (r) => r.functionName === "getStatusOrError" && r.neverReturnedType === '"unknown"'
    );
    expect(unknownResult).toBeDefined();

    // But should NOT flag Status enum values
    const statusResults2 = results.neverReturnedTypes.filter(
      (r) => r.functionName === "getStatusOrError" && r.neverReturnedType.startsWith("Status.")
    );
    expect(statusResults2.length).toBe(0);
  });
});
