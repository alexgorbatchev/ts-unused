import type { SourceFile } from "ts-morph";
import { defaultConfig } from "./config";
import { matchesFilePattern } from "./patternMatcher";
import type { IsTestFileFn } from "./types";

const TEST_FILE_EXTENSIONS: string[] = [".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx"];

/**
 * Default test file detection using built-in patterns.
 * Checks for test file extensions and __tests__ directory.
 */
export function isTestFile(sourceFile: SourceFile): boolean {
  const filePath: string = sourceFile.getFilePath();

  return filePath.includes("__tests__") || TEST_FILE_EXTENSIONS.some((ext) => filePath.endsWith(ext));
}

/**
 * Creates a test file detection function based on custom patterns.
 *
 * @param patterns - Array of glob patterns to identify test files
 * @returns A function that checks if a source file is a test file
 */
export function createIsTestFile(patterns: string[] = defaultConfig.testFilePatterns): IsTestFileFn {
  return (sourceFile: SourceFile): boolean => {
    const filePath: string = sourceFile.getFilePath();
    return matchesFilePattern(filePath, patterns);
  };
}
