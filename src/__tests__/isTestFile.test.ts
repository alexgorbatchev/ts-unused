import { describe, expect, test } from "bun:test";
import { createIsTestFile, isTestFile } from "../isTestFile";

// Helper to create a mock source file
describe("isTestFile", () => {
  test("identifies .test.ts files", () => {
    const sourceFile = "/src/component.test.ts";
    expect(isTestFile(sourceFile)).toBe(true);
  });

  test("identifies .test.tsx files", () => {
    const sourceFile = "/src/component.test.tsx";
    expect(isTestFile(sourceFile)).toBe(true);
  });

  test("identifies .spec.ts files", () => {
    const sourceFile = "/src/component.spec.ts";
    expect(isTestFile(sourceFile)).toBe(true);
  });

  test("identifies .spec.tsx files", () => {
    const sourceFile = "/src/component.spec.tsx";
    expect(isTestFile(sourceFile)).toBe(true);
  });

  test("identifies files in __tests__ directory", () => {
    const sourceFile = "/src/__tests__/component.ts";
    expect(isTestFile(sourceFile)).toBe(true);
  });

  test("does not identify regular .ts files as test files", () => {
    const sourceFile = "/src/component.ts";
    expect(isTestFile(sourceFile)).toBe(false);
  });

  test("does not identify files with test in name but wrong extension", () => {
    const sourceFile = "/src/test-utils.ts";
    expect(isTestFile(sourceFile)).toBe(false);
  });
});

describe("createIsTestFile", () => {
  test("creates function that matches custom patterns", () => {
    const customIsTestFile = createIsTestFile(["**/Test*.ts"]);

    const testLogger = "/src/TestLogger.ts";
    const logger = "/src/Logger.ts";

    expect(customIsTestFile(testLogger)).toBe(true);
    expect(customIsTestFile(logger)).toBe(false);
  });

  test("creates function that matches multiple patterns", () => {
    const customIsTestFile = createIsTestFile(["**/*.test.ts", "**/Test*.ts", "**/__mocks__/**"]);

    const testFile = "/src/component.test.ts";
    const testLogger = "/src/TestLogger.ts";
    const mockFile = "/src/__mocks__/api.ts";
    const regularFile = "/src/component.ts";

    expect(customIsTestFile(testFile)).toBe(true);
    expect(customIsTestFile(testLogger)).toBe(true);
    expect(customIsTestFile(mockFile)).toBe(true);
    expect(customIsTestFile(regularFile)).toBe(false);
  });

  test("uses default patterns when none provided", () => {
    const defaultIsTestFile = createIsTestFile();

    const testFile = "/src/component.test.ts";
    const specFile = "/src/component.spec.ts";
    const testsDir = "/src/__tests__/component.ts";
    const regularFile = "/src/component.ts";

    expect(defaultIsTestFile(testFile)).toBe(true);
    expect(defaultIsTestFile(specFile)).toBe(true);
    expect(defaultIsTestFile(testsDir)).toBe(true);
    expect(defaultIsTestFile(regularFile)).toBe(false);
  });

  test("handles empty patterns array", () => {
    const noTestFiles = createIsTestFile([]);

    const testFile = "/src/component.test.ts";
    expect(noTestFiles(testFile)).toBe(false);
  });
});
