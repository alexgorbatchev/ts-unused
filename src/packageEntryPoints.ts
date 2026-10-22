import fs from "node:fs";
import path from "node:path";
import type { Project, SourceFile } from "ts-morph";
import { mapBuildOutputsToSources, toComparablePath } from "./mapBuildOutputsToSources.js";

const ENTRY_FIELDS = ["main", "module", "types", "typings", "exports"];

export interface IPackageEntryPoints {
  targets: string[];
  sourceFiles: SourceFile[];
}

export function findPackageJson(startDir: string, maxLevels = 0): string | null {
  let currentDir = startDir;
  let levels = 0;

  while (currentDir !== path.dirname(currentDir) && levels <= maxLevels) {
    const packageJsonPath = path.join(currentDir, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      return packageJsonPath;
    }
    currentDir = path.dirname(currentDir);
    levels++;
  }

  return null;
}

export function resolveDistToSource(distPath: string, packageDir: string): string | null {
  let normalized = distPath.replace(/^\.\//, "");

  const distPatterns = [
    { dist: /^dist\//, src: "src/" },
    { dist: /^build\//, src: "src/" },
    { dist: /^lib\//, src: "src/" },
    { dist: /^out\//, src: "src/" },
  ];

  for (const pattern of distPatterns) {
    if (pattern.dist.test(normalized)) {
      normalized = normalized.replace(pattern.dist, pattern.src);
      break;
    }
  }

  normalized = normalized
    .replace(/\.d\.ts$/, ".ts")
    .replace(/\.js$/, ".ts")
    .replace(/\.mjs$/, ".ts")
    .replace(/\.cjs$/, ".ts");

  const fullPath = path.join(packageDir, normalized);
  if (fs.existsSync(fullPath)) {
    return normalized;
  }

  const indexPath = path.join(packageDir, normalized.replace(/\.ts$/, ""), "index.ts");
  if (fs.existsSync(indexPath)) {
    return normalized.replace(/\.ts$/, "/index.ts");
  }

  return null;
}

function collectEntryTargets(value: unknown, targets: Set<string>): void {
  if (typeof value === "string") {
    if (!value.includes("*")) {
      targets.add(value);
    }
  } else if (Array.isArray(value)) {
    for (const item of value) {
      collectEntryTargets(item, targets);
    }
  } else if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) {
      collectEntryTargets(item, targets);
    }
  }
}

export function getPackageEntryTargets(packageJsonPath: string): string[] {
  const packageJson: unknown = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
  const targets = new Set<string>();

  if (typeof packageJson === "object" && packageJson !== null) {
    for (const field of ENTRY_FIELDS) {
      collectEntryTargets(Reflect.get(packageJson, field), targets);
    }
  }

  return [...targets];
}

export function resolvePackageEntryPoints(
  packageJsonPath: string,
  project: Project,
  projectFiles: SourceFile[],
): IPackageEntryPoints {
  const packageDir = path.dirname(packageJsonPath);
  const targets = getPackageEntryTargets(packageJsonPath);
  const outputsToSources = mapBuildOutputsToSources(project, projectFiles);
  const sourceFiles = new Set<SourceFile>();

  for (const target of targets) {
    const targetPath = path.resolve(packageDir, target);
    const directSourceFile = project.getSourceFile(targetPath);
    const conventionalSourcePath = resolveDistToSource(target, packageDir);
    const sourceFile =
      outputsToSources.get(toComparablePath(targetPath)) ??
      (directSourceFile && !directSourceFile.isDeclarationFile() && !directSourceFile.isInNodeModules()
        ? directSourceFile
        : undefined) ??
      (conventionalSourcePath ? project.getSourceFile(path.join(packageDir, conventionalSourcePath)) : undefined);

    if (sourceFile) {
      sourceFiles.add(sourceFile);
    }
  }

  return { targets, sourceFiles: [...sourceFiles] };
}
