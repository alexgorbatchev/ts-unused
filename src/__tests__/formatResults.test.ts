import { describe, expect, test } from "bun:test";
import path from "node:path";
import { formatResults } from "../formatResults";
import type { IAnalysisResults } from "../types";

describe("formatResults", () => {
  test("formats file paths relative to process.cwd", () => {
    const cwd = process.cwd();
    const tsConfigDir = cwd; // Simulating tsconfig in project root

    const results: IAnalysisResults = {
      unusedFiles: [],
      unusedExports: [
        {
          filePath: "src/types.ts", // Path relative to tsConfigDir
          exportName: "unusedFunction",
          line: 10,
          character: 1,
          endCharacter: 15,
          kind: "function",
          severity: "error",
          onlyUsedInTests: false,
        },
      ],
      unusedProperties: [],
    };

    const output = formatResults(results, tsConfigDir);

    // Should output path relative to cwd
    expect(output).toContain("src/types.ts");
    // Should not contain absolute path
    expect(output).not.toContain(path.join(cwd, "src/types.ts"));
  });

  test("formats results with unused exports and properties", () => {
    const tsConfigDir = "/path/to/project";
    const results: IAnalysisResults = {
      unusedFiles: [],
      unusedExports: [
        {
          filePath: "file.ts",
          exportName: "unusedFunction",
          line: 10,
          character: 1,
          endCharacter: 15,
          kind: "function",
          severity: "error",
          onlyUsedInTests: false,
        },
        {
          filePath: "file.ts",
          exportName: "UNUSED_CONSTANT",
          line: 20,
          character: 7,
          endCharacter: 22,
          kind: "const",
          severity: "error",
          onlyUsedInTests: false,
        },
      ],
      unusedProperties: [
        {
          filePath: "types.ts",
          typeName: "UserConfig",
          propertyName: "unusedProp",
          line: 5,
          character: 3,
          endCharacter: 13,
          severity: "error",
          onlyUsedInTests: false,
        },
      ],
    };

    const output = formatResults(results, tsConfigDir);

    expect(output).toContain("Unused Exports:");
    expect(output).toContain("unusedFunction:10:1-15 [ERROR] (Unused function)");
    expect(output).toContain("UNUSED_CONSTANT:20:7-22 [ERROR] (Unused const)");
    expect(output).toMatch(/file\.ts/);

    expect(output).toContain("Unused Type/Interface Properties:");
    expect(output).toContain("UserConfig.unusedProp:5:3-13 [ERROR] (Unused property)");
    expect(output).toMatch(/types\.ts/);

    expect(output).toContain("Summary:");
    expect(output).toContain("Unused exports: 2");
    expect(output).toContain("Unused properties: 1");
  });

  test("formats results with no unused items", () => {
    const tsConfigDir = "/path/to/project";
    const results: IAnalysisResults = {
      unusedFiles: [],
      unusedExports: [],
      unusedProperties: [],
    };

    const output = formatResults(results, tsConfigDir);

    expect(output).toContain("No unused exports or properties found!");
    expect(output).not.toContain("Unused Exports:");
    expect(output).not.toContain("Unused Type/Interface Properties:");
  });

  test("formats results with only unused exports", () => {
    const tsConfigDir = "/path/to/project";
    const results: IAnalysisResults = {
      unusedFiles: [],
      unusedExports: [
        {
          filePath: "file.ts",
          exportName: "unusedFunction",
          line: 10,
          character: 1,
          endCharacter: 15,
          kind: "function",
          severity: "error",
          onlyUsedInTests: false,
        },
      ],
      unusedProperties: [],
    };

    const output = formatResults(results, tsConfigDir);

    expect(output).toContain("Unused Exports:");
    expect(output).not.toContain("Unused Type/Interface Properties:");
    expect(output).toContain("Summary:");
    expect(output).toContain("Unused exports: 1");
    expect(output).toContain("Unused properties: 0");
  });

  test("formats results with only unused properties", () => {
    const tsConfigDir = "/path/to/project";
    const results: IAnalysisResults = {
      unusedFiles: [],
      unusedExports: [],
      unusedProperties: [
        {
          filePath: "types.ts",
          typeName: "UserConfig",
          propertyName: "unusedProp",
          line: 5,
          character: 3,
          endCharacter: 13,
          severity: "error",
          onlyUsedInTests: false,
        },
      ],
    };

    const output = formatResults(results, tsConfigDir);

    expect(output).not.toContain("Unused Exports:");
    expect(output).toContain("Unused Type/Interface Properties:");
    expect(output).toContain("Summary:");
    expect(output).toContain("Unused exports: 0");
    expect(output).toContain("Unused properties: 1");
  });
});
