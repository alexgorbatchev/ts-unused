import path from "node:path";
import type { Project } from "ts-morph";
import { SyntaxKind } from "ts-morph";
import { analyzeFunctionReturnTypes } from "./analyzeFunctionReturnTypes";
import { hasNoCheck } from "./hasNoCheck";
import type { IsTestFileFn, NeverReturnedTypeResult } from "./types";

export function findNeverReturnedTypes(
  project: Project,
  tsConfigDir: string,
  isTestFile: IsTestFileFn,
  onProgress?: (filePath: string) => void,
  targetFilePath?: string
): NeverReturnedTypeResult[] {
  const results: NeverReturnedTypeResult[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    if (isTestFile(sourceFile)) {
      continue;
    }

    if (hasNoCheck(sourceFile)) {
      continue;
    }

    if (targetFilePath && sourceFile.getFilePath() !== targetFilePath) {
      continue;
    }

    if (onProgress) {
      const relativePath: string = path.relative(tsConfigDir, sourceFile.getFilePath());
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
