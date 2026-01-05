import path from "node:path";
import type { Project } from "ts-morph";
import { SyntaxKind } from "ts-morph";
import { analyzeFunctionReturnTypes } from "./analyzeFunctionReturnTypes";
import { hasNoCheck } from "./hasNoCheck";
import { matchesFilePattern } from "./patternMatcher";
import type { IsTestFileFn, NeverReturnedTypeResult } from "./types";

export interface FindNeverReturnedTypesOptions {
  ignoreFilePatterns?: string[];
}

export function findNeverReturnedTypes(
  project: Project,
  tsConfigDir: string,
  isTestFile: IsTestFileFn,
  onProgress?: (filePath: string) => void,
  targetFilePath?: string,
  options: FindNeverReturnedTypesOptions = {}
): NeverReturnedTypeResult[] {
  const { ignoreFilePatterns = [] } = options;
  const results: NeverReturnedTypeResult[] = [];

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

    // Check if file matches ignore patterns
    if (ignoreFilePatterns.length > 0 && matchesFilePattern(filePath, ignoreFilePatterns)) {
      continue;
    }

    if (onProgress) {
      const relativePath: string = path.relative(tsConfigDir, filePath);
      onProgress(relativePath);
    }

    // Get all function declarations
    const functions = sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration);

    for (const func of functions) {
      const funcResults = analyzeFunctionReturnTypes(func, sourceFile, tsConfigDir);
      results.push(...funcResults);
    }
  }

  return results;
}
