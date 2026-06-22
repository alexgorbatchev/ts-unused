import fs from "node:fs";
import path from "node:path";

export interface IPackageEntryPoint {
  /** The export path (e.g., ".", "./utils") */
  exportPath: string;
  /** The resolved source file path relative to package root */
  sourceFile: string;
}

export interface IPackageJson {
  main?: string;
  module?: string;
  exports?: PackageExports;
}

type PackageExports = string | Record<string, string | IPackageExportConditions>;

interface IPackageExportConditions {
  types?: string;
  import?: string;
  require?: string;
  default?: string;
  [key: string]: string | undefined;
}

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
 * Resolves a dist path to a source path.
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

  // Convert .js to .ts and .d.ts to .ts
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
 * Extracts entry points from package.json exports field.
 */
function extractExportsEntryPoints(exports: PackageExports, packageDir: string): IPackageEntryPoint[] {
  const entryPoints: IPackageEntryPoint[] = [];

  if (typeof exports === "string") {
    // Simple string export: "exports": "./dist/index.js"
    const sourceFile = resolveDistToSource(exports, packageDir);
    if (sourceFile) {
      entryPoints.push({ exportPath: ".", sourceFile });
    }
    return entryPoints;
  }

  // Object exports
  for (const [key, value] of Object.entries(exports)) {
    if (typeof value === "string") {
      // Direct path: "./utils": "./dist/utils/index.js"
      const sourceFile = resolveDistToSource(value, packageDir);
      if (sourceFile) {
        entryPoints.push({ exportPath: key, sourceFile });
      }
    } else if (value && typeof value === "object") {
      // Conditional exports: ".": { "types": "...", "default": "..." }
      // Prefer: types > import > default > require
      const candidates = [value.types, value.import, value.default, value.require];
      for (const candidate of candidates) {
        if (candidate) {
          const sourceFile = resolveDistToSource(candidate, packageDir);
          if (sourceFile) {
            entryPoints.push({ exportPath: key, sourceFile });
            break;
          }
        }
      }
    }
  }

  return entryPoints;
}

/**
 * Parses package.json and extracts all entry points.
 * Returns entry points with their corresponding source file paths.
 */
export function getPackageEntryPoints(packageJsonPath: string): IPackageEntryPoint[] {
  const packageDir = path.dirname(packageJsonPath);
  const content = fs.readFileSync(packageJsonPath, "utf-8");
  const packageJson: IPackageJson = JSON.parse(content);

  const entryPoints: IPackageEntryPoint[] = [];

  // Handle "exports" field (takes precedence)
  if (packageJson.exports) {
    entryPoints.push(...extractExportsEntryPoints(packageJson.exports, packageDir));
  }

  // Handle "main" field if no exports or as fallback for "."
  if (packageJson.main && !entryPoints.some((ep) => ep.exportPath === ".")) {
    const sourceFile = resolveDistToSource(packageJson.main, packageDir);
    if (sourceFile) {
      entryPoints.push({ exportPath: ".", sourceFile });
    }
  }

  // Handle "module" field as additional entry point
  if (packageJson.module && !entryPoints.some((ep) => ep.exportPath === ".")) {
    const sourceFile = resolveDistToSource(packageJson.module, packageDir);
    if (sourceFile) {
      entryPoints.push({ exportPath: ".", sourceFile });
    }
  }

  return entryPoints;
}
