import { describe, expect, test } from "bun:test";
import { matchesFilePattern, matchesPattern, patternToRegex } from "../patternMatcher";

describe("patternToRegex", () => {
  test("converts simple pattern", () => {
    const regex = patternToRegex("hello");
    expect(regex.test("hello")).toBe(true);
    expect(regex.test("hello world")).toBe(false);
  });

  test("converts * pattern", () => {
    const regex = patternToRegex("*.ts");
    expect(regex.test("file.ts")).toBe(true);
    expect(regex.test("dir/file.ts")).toBe(false);
  });

  test("converts ** pattern", () => {
    const regex = patternToRegex("**/*.ts");
    expect(regex.test("dir/file.ts")).toBe(true);
    expect(regex.test("deep/nested/file.ts")).toBe(true);
    // Note: **/*.ts doesn't match file.ts directly since ** expects a path separator
    // The matchesFilePattern function handles this case specially
  });

  test("converts ? pattern", () => {
    const regex = patternToRegex("file?.ts");
    expect(regex.test("file1.ts")).toBe(true);
    expect(regex.test("fileA.ts")).toBe(true);
    expect(regex.test("file.ts")).toBe(false);
    expect(regex.test("file12.ts")).toBe(false);
  });

  test("escapes regex special characters", () => {
    const regex = patternToRegex("file.test.ts");
    expect(regex.test("file.test.ts")).toBe(true);
    expect(regex.test("fileXtestXts")).toBe(false);
  });

  test("handles pattern with brackets", () => {
    const regex = patternToRegex("file[1].ts");
    expect(regex.test("file[1].ts")).toBe(true);
    expect(regex.test("file1.ts")).toBe(false);
  });

  test("handles pattern with parentheses", () => {
    const regex = patternToRegex("file(test).ts");
    expect(regex.test("file(test).ts")).toBe(true);
  });

  test("handles pattern with plus sign", () => {
    const regex = patternToRegex("file+.ts");
    expect(regex.test("file+.ts")).toBe(true);
    expect(regex.test("fileee.ts")).toBe(false);
  });
});

describe("matchesPattern", () => {
  test("matches exact string", () => {
    expect(matchesPattern("hello", ["hello"])).toBe(true);
    expect(matchesPattern("hello", ["world"])).toBe(false);
  });

  test("matches multiple patterns", () => {
    expect(matchesPattern("hello", ["world", "hello"])).toBe(true);
    expect(matchesPattern("hello", ["world", "foo"])).toBe(false);
  });

  test("matches glob pattern", () => {
    expect(matchesPattern("formatLogMessage", ["format*"])).toBe(true);
    expect(matchesPattern("getMessage", ["format*"])).toBe(false);
  });

  test("matches with ** pattern", () => {
    expect(matchesPattern("SomeModule", ["*Module"])).toBe(true);
    expect(matchesPattern("SomeLogger", ["*Module"])).toBe(false);
  });

  test("returns false for empty patterns array", () => {
    expect(matchesPattern("anything", [])).toBe(false);
  });

  test("matches pattern without wildcards as exact match only", () => {
    expect(matchesPattern("hello", ["hello"])).toBe(true);
    expect(matchesPattern("hello world", ["hello"])).toBe(false);
  });
});

describe("matchesFilePattern", () => {
  test("matches test file patterns", () => {
    expect(matchesFilePattern("/src/file.test.ts", ["**/*.test.ts"])).toBe(true);
    expect(matchesFilePattern("/src/file.ts", ["**/*.test.ts"])).toBe(false);
  });

  test("matches __tests__ directory", () => {
    expect(matchesFilePattern("/src/__tests__/user.test.ts", ["**/__tests__/**"])).toBe(true);
    expect(matchesFilePattern("/src/user.test.ts", ["**/__tests__/**"])).toBe(false);
  });

  test("matches multiple patterns", () => {
    const patterns = ["**/*.test.ts", "**/*.spec.ts", "**/__tests__/**"];
    expect(matchesFilePattern("/src/file.test.ts", patterns)).toBe(true);
    expect(matchesFilePattern("/src/file.spec.ts", patterns)).toBe(true);
    expect(matchesFilePattern("/src/__tests__/file.ts", patterns)).toBe(true);
    expect(matchesFilePattern("/src/file.ts", patterns)).toBe(false);
  });

  test("matches custom test file pattern like TestLogger.ts", () => {
    expect(matchesFilePattern("/src/TestLogger.ts", ["**/Test*.ts"])).toBe(true);
    expect(matchesFilePattern("/src/Logger.ts", ["**/Test*.ts"])).toBe(false);
  });

  test("normalizes path separators", () => {
    expect(matchesFilePattern("src\\__tests__\\file.ts", ["**/__tests__/**"])).toBe(true);
  });

  test("returns false for empty patterns array", () => {
    expect(matchesFilePattern("/src/file.ts", [])).toBe(false);
  });

  test("matches non-** patterns exactly", () => {
    expect(matchesFilePattern("src/file.ts", ["src/file.ts"])).toBe(true);
    expect(matchesFilePattern("src/file.ts", ["src/*.ts"])).toBe(true);
    expect(matchesFilePattern("other/file.ts", ["src/*.ts"])).toBe(false);
  });

  test("matches file in root with ** pattern", () => {
    // This tests the suffix matching logic
    expect(matchesFilePattern("file.test.ts", ["**/*.test.ts"])).toBe(true);
  });

  test("handles pattern with backslash on Windows-style paths", () => {
    expect(matchesFilePattern("src\\generated\\file.ts", ["**/generated/**"])).toBe(true);
  });

  test("matches deeply nested paths", () => {
    expect(matchesFilePattern("/a/b/c/d/e/file.test.ts", ["**/*.test.ts"])).toBe(true);
  });
});
