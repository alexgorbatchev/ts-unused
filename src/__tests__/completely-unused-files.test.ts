import { describe, expect, test } from "bun:test";
import path from "node:path";
import { analyzeProject } from "../analyzeProject";
import { formatResults } from "../formatResults";
import { isTestFile } from "../isTestFile";

describe("Completely Unused Files", () => {
  const fixturesDir = path.join(process.cwd(), "test-project");
  const tsConfigPath = path.join(fixturesDir, "tsconfig.json");

  test("reports files where all exports are completely unused with [ERROR]", () => {
    const results = analyzeProject(tsConfigPath, undefined, undefined, isTestFile);

    const unusedFile = results.unusedFiles.find((f) => f.endsWith("unused-file.ts"));
    expect(unusedFile).toBeDefined();

    // Check formatting
    const tsConfigDir = path.dirname(tsConfigPath);
    const formatted = formatResults(results, tsConfigDir);

    expect(formatted).toContain("Completely Unused Files:");
    expect(formatted).toContain("unused-file.ts");
    expect(formatted).toContain("file:1:1-1 [ERROR] (All exports unused - file can be deleted)");
  });
});
