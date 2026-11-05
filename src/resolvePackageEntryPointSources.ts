import path from "node:path";
import type { SourceFile } from "ts-morph";
import { toComparablePath } from "./mapBuildOutputsToSources.js";

/** Validates explicit package target mappings without adding files to the analyzed project. */
export function resolvePackageEntryPointSources(
  packageDir: string,
  targets: string[],
  projectFiles: SourceFile[],
  packageEntryPointSources: Record<string, string>,
): Map<string, SourceFile> {
  const targetPaths = new Set(targets.map((target) => toComparablePath(path.resolve(packageDir, target))));
  const eligibleSources = new Map(
    projectFiles
      .filter((sourceFile) => !sourceFile.isDeclarationFile() && !sourceFile.isInNodeModules())
      .map((sourceFile) => [toComparablePath(sourceFile.getFilePath()), sourceFile]),
  );
  const sources = new Map<string, SourceFile>();

  for (const [target, source] of Object.entries(packageEntryPointSources)) {
    const targetPath = toComparablePath(path.resolve(packageDir, target));
    if (!targetPaths.has(targetPath)) {
      throw new Error(
        `Invalid packageEntryPointSources target '${target}': not an explicit entry target in package.json.`,
      );
    }

    const sourceFile = eligibleSources.get(toComparablePath(path.resolve(packageDir, source)));
    if (!sourceFile) {
      throw new Error(
        `Invalid packageEntryPointSources mapping '${target}': '${source}' must be a non-declaration source file included by the analyzed tsconfig, outside node_modules.`,
      );
    }

    const existingSource = sources.get(targetPath);
    if (existingSource && existingSource !== sourceFile) {
      throw new Error(`Conflicting packageEntryPointSources mappings for target '${target}'.`);
    }
    sources.set(targetPath, sourceFile);
  }

  return sources;
}
