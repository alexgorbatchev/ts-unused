import fs from "node:fs";
import path from "node:path";
import type { SourceFile } from "typescript/ast";
import type { Project } from "typescript/async";
import { mapBuildOutputsToSources, toComparablePath } from "./mapBuildOutputsToSources.js";
import { resolvePackageEntryPointSources } from "./resolvePackageEntryPointSources.js";

const ENTRY_FIELDS = ["main", "module", "types", "typings", "exports"];

/**
 * Finds package.json by walking up from the given directory.
 * @param startDir - The directory to start searching from
 * @param maxLevels - Maximum number of parent directories to traverse (default: 0, only same directory)
 */
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

/**
 * Resolves a dist path to a source path by naming convention.
 * Converts paths like "./dist/index.js" to "src/index.ts"
 */
export function resolveDistToSource(distPath: string, packageDir: string): string | null {
  // Remove leading "./"
  let normalized = distPath.replace(/^\.\//, "");

  // Common dist folder patterns to replace with src
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

  // Convert .js/.mjs/.cjs and .d.ts to .ts
  normalized = normalized
    .replace(/\.d\.ts$/, ".ts")
    .replace(/\.js$/, ".ts")
    .replace(/\.mjs$/, ".ts")
    .replace(/\.cjs$/, ".ts");

  // Check if the source file exists
  const fullPath = path.join(packageDir, normalized);
  if (fs.existsSync(fullPath)) {
    return normalized;
  }

  // Try adding index.ts if it's a directory
  const indexPath = path.join(packageDir, normalized.replace(/\.ts$/, ""), "index.ts");
  if (fs.existsSync(indexPath)) {
    return normalized.replace(/\.ts$/, "/index.ts");
  }

  return null;
}

/**
 * Extracts entry targets from a package.json entry field, at any nesting depth.
 * Subpath patterns containing "*" are skipped because they name no single file.
 */
function collectEntryTargets(value: unknown, targets: Set<string>): void {
  if (typeof value === "string") {
    // Simple string target: "main": "./dist/index.js" or "exports": "./dist/index.js"
    if (!value.includes("*")) {
      targets.add(value);
    }
  } else if (Array.isArray(value)) {
    // Fallback arrays: "exports": ["./dist/index.js", "./dist/index.cjs"]
    for (const item of value) {
      collectEntryTargets(item, targets);
    }
  } else if (typeof value === "object" && value !== null) {
    // Subpath and conditional exports: "./utils": { "types": "...", "import": { "default": "..." } }
    // Every condition is collected, since each one names a file consumers can load
    for (const item of Object.values(value)) {
      collectEntryTargets(item, targets);
    }
  }
}

/**
 * Parses package.json and extracts all entry targets from `main`, `module`, `types`, `typings`, and `exports`.
 */
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

/**
 * Resolves package entry targets to the project source files they are built from.
 */
export async function resolvePackageEntryPoints(
  packageDir: string,
  targets: string[],
  project: Project,
  configPath: string,
  projectFiles: SourceFile[],
  packageEntryPointSources: Record<string, string> = {},
): Promise<SourceFile[]> {
  const explicitSources = resolvePackageEntryPointSources(packageDir, targets, projectFiles, packageEntryPointSources);
  const outputsToSources = mapBuildOutputsToSources(
    configPath,
    await project.program.getCompilerOptions(),
    projectFiles,
    await project.program.getSourceFileNames(),
  );
  const sourceFiles = new Set<SourceFile>();

  for (const target of targets) {
    const targetPath = path.resolve(packageDir, target);
    const directSourceFile = await project.program.getSourceFile(targetPath);
    const conventionalSourcePath = resolveDistToSource(target, packageDir);
    // Explicit mappings take precedence over automatic build and source layouts.
    const sourceFile =
      explicitSources.get(toComparablePath(targetPath)) ??
      outputsToSources.get(toComparablePath(targetPath)) ??
      (directSourceFile &&
      !directSourceFile.isDeclarationFile &&
      !directSourceFile.fileName.split(path.sep).includes("node_modules")
        ? directSourceFile
        : undefined) ??
      (conventionalSourcePath
        ? await project.program.getSourceFile(path.join(packageDir, conventionalSourcePath))
        : undefined);

    if (sourceFile) {
      sourceFiles.add(sourceFile);
    }
  }

  return [...sourceFiles];
}
