import { describe, expect, test } from "bun:test";
import { Project } from "ts-morph";
import { createIsTestFile, isTestFile } from "../isTestFile";

// Helper to create a mock source file
function createMockSourceFile(filePath: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile(filePath, "export const x = 1;");
}

describe("isTestFile", () => {
  test("identifies .test.ts files", () => {
    const sourceFile = createMockSourceFile("/src/component.test.ts");
    expect(isTestFile(sourceFile)).toBe(true);
  });

  test("identifies .test.tsx files", () => {
    const sourceFile = createMockSourceFile("/src/component.test.tsx");
    expect(isTestFile(sourceFile)).toBe(true);
  });

  test("identifies .spec.ts files", () => {
    const sourceFile = createMockSourceFile("/src/component.spec.ts");
    expect(isTestFile(sourceFile)).toBe(true);
  });

  test("identifies .spec.tsx files", () => {
    const sourceFile = createMockSourceFile("/src/component.spec.tsx");
    expect(isTestFile(sourceFile)).toBe(true);
  });

  test("identifies files in __tests__ directory", () => {
    const sourceFile = createMockSourceFile("/src/__tests__/component.ts");
    expect(isTestFile(sourceFile)).toBe(true);
  });

  test("does not identify regular .ts files as test files", () => {
    const sourceFile = createMockSourceFile("/src/component.ts");
    expect(isTestFile(sourceFile)).toBe(false);
  });

  test("does not identify files with test in name but wrong extension", () => {
    const sourceFile = createMockSourceFile("/src/test-utils.ts");
    expect(isTestFile(sourceFile)).toBe(false);
  });
});

describe("createIsTestFile", () => {
  test("creates function that matches custom patterns", () => {
    const customIsTestFile = createIsTestFile(["**/Test*.ts"]);

    const testLogger = createMockSourceFile("/src/TestLogger.ts");
    const logger = createMockSourceFile("/src/Logger.ts");

    expect(customIsTestFile(testLogger)).toBe(true);
    expect(customIsTestFile(logger)).toBe(false);
  });

  test("creates function that matches multiple patterns", () => {
    const customIsTestFile = createIsTestFile(["**/*.test.ts", "**/Test*.ts", "**/__mocks__/**"]);

    const testFile = createMockSourceFile("/src/component.test.ts");
    const testLogger = createMockSourceFile("/src/TestLogger.ts");
    const mockFile = createMockSourceFile("/src/__mocks__/api.ts");
    const regularFile = createMockSourceFile("/src/component.ts");

    expect(customIsTestFile(testFile)).toBe(true);
    expect(customIsTestFile(testLogger)).toBe(true);
    expect(customIsTestFile(mockFile)).toBe(true);
    expect(customIsTestFile(regularFile)).toBe(false);
  });

  test("uses default patterns when none provided", () => {
    const defaultIsTestFile = createIsTestFile();

    const testFile = createMockSourceFile("/src/component.test.ts");
    const specFile = createMockSourceFile("/src/component.spec.ts");
    const testsDir = createMockSourceFile("/src/__tests__/component.ts");
    const regularFile = createMockSourceFile("/src/component.ts");

    expect(defaultIsTestFile(testFile)).toBe(true);
    expect(defaultIsTestFile(specFile)).toBe(true);
    expect(defaultIsTestFile(testsDir)).toBe(true);
    expect(defaultIsTestFile(regularFile)).toBe(false);
  });

  test("handles empty patterns array", () => {
    const noTestFiles = createIsTestFile([]);

    const testFile = createMockSourceFile("/src/component.test.ts");
    expect(noTestFiles(testFile)).toBe(false);
  });
});
