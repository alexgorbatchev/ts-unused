import path from "node:path";
import type { Project } from "ts-morph";
import { type CheckExportOptions, checkExportUsage } from "./checkExportUsage";
import { hasNoCheck } from "./hasNoCheck";
import { matchesFilePattern } from "./patternMatcher";
import type { IsTestFileFn, UnusedExportResult } from "./types";

export interface FindUnusedExportsOptions extends CheckExportOptions {
  ignoreFilePatterns?: string[];
}

export function findUnusedExports(
  project: Project,
  tsConfigDir: string,
  isTestFile: IsTestFileFn,
  onProgress?: (filePath: string) => void,
  targetFilePath?: string,
  options: FindUnusedExportsOptions = {}
): UnusedExportResult[] {
  const { ignoreFilePatterns = [], ...checkOptions } = options;
  const results: UnusedExportResult[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    if (isTestFile(sourceFile)) {
      continue;
    }

    if (hasNoCheck(sourceFile)) {
      continue;
    }

    const filePath = sourceFile.getFilePath();

    if (targetFilePath && filePath !== targetFilePath) {
      continue;
    }

    // Check if file should be ignored based on patterns
    if (ignoreFilePatterns.length > 0 && matchesFilePattern(filePath, ignoreFilePatterns)) {
      continue;
    }

    if (onProgress) {
      const relativePath: string = path.relative(tsConfigDir, filePath);
      onProgress(relativePath);
    }

    const exports = sourceFile.getExportedDeclarations();

    for (const [exportName, declarations] of exports.entries()) {
      const unusedExport: UnusedExportResult | null = checkExportUsage(
        exportName,
        declarations,
        sourceFile,
        tsConfigDir,
        isTestFile,
        checkOptions
      );
      if (unusedExport) {
        results.push(unusedExport);
      }
    }
  }

  return results;
}
