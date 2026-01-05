import path from "node:path";
import type { Project } from "ts-morph";
import { type AnalyzeInterfacesOptions, analyzeInterfaces } from "./analyzeInterfaces";
import { analyzeTypeAliases } from "./analyzeTypeAliases";
import { hasNoCheck } from "./hasNoCheck";
import { matchesFilePattern } from "./patternMatcher";
import type { IsTestFileFn, UnusedPropertyResult } from "./types";

export interface FindUnusedPropertiesOptions extends AnalyzeInterfacesOptions {
  ignoreFilePatterns?: string[];
}

export function findUnusedProperties(
  project: Project,
  tsConfigDir: string,
  isTestFile: IsTestFileFn,
  onProgress?: (filePath: string) => void,
  targetFilePath?: string,
  options: FindUnusedPropertiesOptions = {}
): UnusedPropertyResult[] {
  const { ignoreFilePatterns = [], ...analyzeOptions } = options;
  const results: UnusedPropertyResult[] = [];

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

    analyzeInterfaces(sourceFile, tsConfigDir, isTestFile, results, project, analyzeOptions);
    analyzeTypeAliases(sourceFile, tsConfigDir, isTestFile, results, project, analyzeOptions);
  }

  return results;
}
