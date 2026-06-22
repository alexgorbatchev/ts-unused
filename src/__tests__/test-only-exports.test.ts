import { describe, expect, setDefaultTimeout, test } from "bun:test";
import path from "node:path";
import type { SourceFile } from "ts-morph";
import { analyzeProject } from "../analyzeProject";

const FIXTURES_DIR = path.join(import.meta.dir, "../../test-project");
const TSCONFIG_PATH = path.join(FIXTURES_DIR, "tsconfig.json");

// Custom isTestFile that only looks at test file extensions (not directories)
// This allows us to analyze test-helpers.ts even though it's in __tests__
const TEST_FILE_EXTENSIONS: string[] = [".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx"];
function isTestFileForTests(sourceFile: SourceFile): boolean {
  const filePath: string = sourceFile.getFilePath();
  return TEST_FILE_EXTENSIONS.some((ext) => filePath.endsWith(ext));
}

setDefaultTimeout(30000);

describe("Test-Only Exports", () => {
  test("marks exports used only in tests with [INFO] severity and onlyUsedInTests flag", async () => {
    const results = await analyzeProject(TSCONFIG_PATH, undefined, undefined, isTestFileForTests);

    // Find the createTestUser function which is only used in test files
    // test-helpers.ts is in __tests__ folder but not treated as test file due to our custom isTestFile
    const createTestUser = results.unusedExports.find(
      (item) => item.exportName === "createTestUser" && item.filePath.includes("test-helpers.ts"),
    );

    expect(createTestUser).toBeDefined();
    expect(createTestUser?.onlyUsedInTests).toBe(true);
    expect(createTestUser?.severity).toBe("info");
  });

  test("marks completely unused exports with [ERROR] severity", async () => {
    const results = await analyzeProject(TSCONFIG_PATH, undefined, undefined, isTestFileForTests);

    // Find the createTestPost function which is not used anywhere
    const createTestPost = results.unusedExports.find(
      (item) => item.exportName === "createTestPost" && item.filePath.includes("test-helpers.ts"),
    );

    expect(createTestPost).toBeDefined();
    expect(createTestPost?.onlyUsedInTests).toBe(false);
    expect(createTestPost?.severity).toBe("error");
  });

  test("marks test setup functions (beforeEach/afterEach) used only in tests with [INFO] severity", async () => {
    const results = await analyzeProject(TSCONFIG_PATH, undefined, undefined, isTestFileForTests);

    // Find the withMockServer function which is called in test files but only sets up hooks
    const withMockServer = results.unusedExports.find(
      (item) => item.exportName === "withMockServer" && item.filePath.includes("test-helpers.ts"),
    );

    expect(withMockServer).toBeDefined();
    expect(withMockServer?.onlyUsedInTests).toBe(true);
    expect(withMockServer?.severity).toBe("info");
  });

  test("does not mark files with test-only exports as completely unused", async () => {
    const results = await analyzeProject(TSCONFIG_PATH, undefined, undefined, isTestFileForTests);

    // test-helpers.ts has createTestUser and withMockServer (both onlyUsedInTests: true)
    // and createTestPost (unused). But since not ALL exports are completely unused,
    // it should NOT be in the unusedFiles list

    // Actually, let me check what the current behavior is
    const testHelpersInUnusedFiles = results.unusedFiles.find((file) => file.includes("test-helpers.ts"));

    // The bug: test-helpers.ts appears in unusedFiles even though it has exports used in tests
    expect(testHelpersInUnusedFiles).toBeUndefined();
  });
});
