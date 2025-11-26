import { describe, expect, test } from "bun:test";
import path from "node:path";
import type { SourceFile } from "ts-morph";
import { analyzeProject } from "../analyzeProject";
import { formatResults } from "../formatResults";

// Custom isTestFile for tests that only checks file extensions, not __tests__ directories
const TEST_FILE_EXTENSIONS: string[] = [".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx"];
function isTestFileForTests(sourceFile: SourceFile): boolean {
  const filePath: string = sourceFile.getFilePath();
  return TEST_FILE_EXTENSIONS.some((ext) => filePath.endsWith(ext));
}

describe("Unused Files Detection", () => {
  const fixturesDir = path.join(process.cwd(), "test-project");
  const tsConfigPath = path.join(fixturesDir, "tsconfig.json");

  test("detects completely unused files", () => {
    const results = analyzeProject(tsConfigPath, undefined, undefined, isTestFileForTests);
    
    const unusedFile = results.unusedFiles.find(f => f.endsWith("unused-file.ts"));
    expect(unusedFile).toBeDefined();
    
    // Check formatting
    const formatted = formatResults(results);
    
    expect(formatted).toContain("Completely Unused Files:");
    expect(formatted).toContain("unused-file.ts");
    expect(formatted).toContain("file:1:1-1 [ERROR] (All exports unused - file can be deleted)");
  });
});
