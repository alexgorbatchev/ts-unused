import { describe, expect, setDefaultTimeout, test } from "bun:test";
import path from "node:path";
import type { SourceFile } from "ts-morph";
import { analyzeProject } from "../analyzeProject";

const FIXTURES_DIR = path.join(import.meta.dir, "../../test-project");
const TSCONFIG_PATH = path.join(FIXTURES_DIR, "tsconfig.json");

// Custom isTestFile for tests that only checks file extensions, not __tests__ directories
const TEST_FILE_EXTENSIONS: string[] = [".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx"];
function isTestFileForTests(sourceFile: SourceFile): boolean {
  const filePath: string = sourceFile.getFilePath();
  return TEST_FILE_EXTENSIONS.some((ext) => filePath.endsWith(ext));
}

setDefaultTimeout(30000);

describe("analyzeProject with config", () => {
  test("ignores exports matching ignoreExports patterns", () => {
    const resultsWithoutIgnore = analyzeProject(TSCONFIG_PATH, undefined, undefined, isTestFileForTests);
    const unusedExportNames = resultsWithoutIgnore.unusedExports.map((e) => e.exportName);

    // Verify we have unused exports first
    expect(unusedExportNames).toContain("unusedFunction");

    // Now test with ignoreExports
    const resultsWithIgnore = analyzeProject(TSCONFIG_PATH, undefined, undefined, {
      isTestFile: isTestFileForTests,
      config: {
        ignoreExports: ["unusedFunction"],
      },
    });

    const ignoredExportNames = resultsWithIgnore.unusedExports.map((e) => e.exportName);
    expect(ignoredExportNames).not.toContain("unusedFunction");
    // Other unused exports should still be reported
    expect(ignoredExportNames).toContain("UNUSED_CONSTANT");
  });

  test("ignores exports matching glob patterns", () => {
    const resultsWithIgnore = analyzeProject(TSCONFIG_PATH, undefined, undefined, {
      isTestFile: isTestFileForTests,
      config: {
        ignoreExports: ["unused*", "UNUSED_*"],
      },
    });

    const exportNames = resultsWithIgnore.unusedExports.map((e) => e.exportName);
    expect(exportNames).not.toContain("unusedFunction");
    expect(exportNames).not.toContain("unusedVariable");
    expect(exportNames).not.toContain("UNUSED_CONSTANT");
    // Non-matching exports should still be reported
    expect(exportNames).toContain("UnusedInterface");
  });

  test("ignores properties matching ignoreProperties patterns", () => {
    const resultsWithoutIgnore = analyzeProject(TSCONFIG_PATH, undefined, undefined, isTestFileForTests);
    const unusedProps = resultsWithoutIgnore.unusedProperties.filter((p) => p.typeName === "UsedInterface");
    expect(unusedProps.length).toBeGreaterThan(0);

    // Get the property name to ignore
    const propToIgnore = unusedProps[0]?.propertyName ?? "unusedProperty";

    // Now test with ignoreProperties
    const resultsWithIgnore = analyzeProject(TSCONFIG_PATH, undefined, undefined, {
      isTestFile: isTestFileForTests,
      config: {
        ignoreProperties: [propToIgnore],
      },
    });

    const ignoredProps = resultsWithIgnore.unusedProperties.filter(
      (p) => p.typeName === "UsedInterface" && p.propertyName === propToIgnore
    );
    expect(ignoredProps).toHaveLength(0);
  });

  test("ignores types matching ignoreTypes patterns", () => {
    const resultsWithIgnore = analyzeProject(TSCONFIG_PATH, undefined, undefined, {
      isTestFile: isTestFileForTests,
      config: {
        ignoreTypes: ["UsedInterface", "UsedType"],
      },
    });

    // Properties from ignored types should not be reported
    const propsFromIgnoredTypes = resultsWithIgnore.unusedProperties.filter(
      (p) => p.typeName === "UsedInterface" || p.typeName === "UsedType"
    );
    expect(propsFromIgnoredTypes).toHaveLength(0);
  });

  test("can disable property analysis", () => {
    const results = analyzeProject(TSCONFIG_PATH, undefined, undefined, {
      isTestFile: isTestFileForTests,
      config: {
        analyzeProperties: false,
      },
    });

    expect(results.unusedProperties).toHaveLength(0);
    // Exports should still be analyzed
    expect(results.unusedExports.length).toBeGreaterThan(0);
  });

  test("can disable export analysis", () => {
    const results = analyzeProject(TSCONFIG_PATH, undefined, undefined, {
      isTestFile: isTestFileForTests,
      config: {
        analyzeExports: false,
      },
    });

    expect(results.unusedExports).toHaveLength(0);
    // Properties should still be analyzed
    expect(results.unusedProperties.length).toBeGreaterThan(0);
  });

  test("can disable unused files detection", () => {
    const _resultsWithDetection = analyzeProject(TSCONFIG_PATH, undefined, undefined, isTestFileForTests);

    const resultsWithoutDetection = analyzeProject(TSCONFIG_PATH, undefined, undefined, {
      isTestFile: isTestFileForTests,
      config: {
        detectUnusedFiles: false,
      },
    });

    // When detection is disabled, unusedFiles should be empty
    expect(resultsWithoutDetection.unusedFiles).toHaveLength(0);
    // But exports analysis should still work
    expect(resultsWithoutDetection.unusedExports.length).toBeGreaterThan(0);
  });

  test("backward compatible with isTestFile function", () => {
    // Old API: passing isTestFile directly as 4th argument
    const results = analyzeProject(TSCONFIG_PATH, undefined, undefined, isTestFileForTests);
    expect(results.unusedExports.length).toBeGreaterThan(0);
  });
});
