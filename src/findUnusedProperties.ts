import path from "node:path";
import type { Project } from "ts-morph";
import { analyzeInterfaces } from "./analyzeInterfaces";
import { analyzeTypeAliases } from "./analyzeTypeAliases";
import { hasNoCheck } from "./hasNoCheck";
import type { IsTestFileFn, UnusedPropertyResult } from "./types";

export function findUnusedProperties(
  project: Project,
  tsConfigDir: string,
  isTestFile: IsTestFileFn,
  onProgress?: (filePath: string) => void,
  targetFilePath?: string
): UnusedPropertyResult[] {
  const results: UnusedPropertyResult[] = [];

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

    analyzeInterfaces(sourceFile, tsConfigDir, isTestFile, results, project);
    analyzeTypeAliases(sourceFile, tsConfigDir, isTestFile, results, project);
  }

  return results;
}
