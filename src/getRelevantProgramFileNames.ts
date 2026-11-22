import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import type { Project } from "typescript/async";

const NODE_MODULES_PATTERN = /(?:^|[\\/])node_modules[\\/]/;
const SPECIFIER_PATTERN =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\/\/\/\s*<reference\s+path\s*=\s*)["']([^"']+)["']/g;
const PACKAGE_SEGMENT_PATTERN = /(?:^|[\\/])node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)/g;

const relevantFilesCache = new WeakMap<Project, Promise<string[]>>();

function isNodeModulesPath(filePath: string): boolean {
  return NODE_MODULES_PATTERN.test(filePath);
}

function getOwningPackageName(filePath: string): string | undefined {
  let lastMatch: string | undefined;
  for (const match of filePath.matchAll(PACKAGE_SEGMENT_PATTERN)) {
    lastMatch = match[1]?.split("\\").join("/");
  }
  return lastMatch;
}

function getBarePackageName(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") && parts.length >= 2 ? `${parts[0]}/${parts[1]}` : (parts[0] ?? specifier);
}

function isSymlinkOutsideNodeModules(filePath: string): boolean {
  try {
    return !isNodeModulesPath(realpathSync(filePath));
  } catch {
    return false;
  }
}

function matchesNonNodeModulesPathMapping(specifier: string, pathPrefixes: readonly string[]): boolean {
  return pathPrefixes.some((prefix) => (prefix === "" ? true : specifier.startsWith(prefix)));
}

function extractPathPrefixes(project: Project): string[] {
  const paths = project.program.getCompilerOptions().paths;
  if (!paths) return [];
  const prefixes: string[] = [];
  for (const [pattern, targets] of Object.entries(paths)) {
    if (!targets.some((target) => !isNodeModulesPath(target))) continue;
    const wildcardIndex = pattern.indexOf("*");
    prefixes.push(wildcardIndex === -1 ? pattern : pattern.slice(0, wildcardIndex));
  }
  return prefixes;
}

async function computeRelevantProgramFileNames(project: Project): Promise<string[]> {
  const allFiles = await project.program.getSourceFileNames();
  const projectFiles: string[] = [];
  const nodeModulesFiles: string[] = [];

  for (const file of allFiles) {
    if (!isNodeModulesPath(file) || isSymlinkOutsideNodeModules(file)) {
      projectFiles.push(file);
    } else {
      nodeModulesFiles.push(file);
    }
  }

  if (nodeModulesFiles.length === 0) return projectFiles;

  const pathPrefixes = extractPathPrefixes(project);
  const relevantExternal = new Set<string>();
  const relevantPackages = new Set<string>();
  const packageQueue: string[] = [];
  const importersByPackage = new Map<string, string[]>();

  const markRelevant = (file: string): void => {
    if (relevantExternal.has(file)) return;
    relevantExternal.add(file);
    const owner = getOwningPackageName(file);
    if (owner && !relevantPackages.has(owner)) {
      relevantPackages.add(owner);
      packageQueue.push(owner);
    }
  };

  for (const file of nodeModulesFiles) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      markRelevant(file);
      continue;
    }

    const dir = path.dirname(file);
    for (const match of text.matchAll(SPECIFIER_PATTERN)) {
      const specifier = match[1];
      if (!specifier) continue;
      if (specifier.startsWith(".")) {
        const resolved = path.resolve(dir, specifier);
        if (!isNodeModulesPath(resolved)) {
          markRelevant(file);
        }
      } else {
        if (matchesNonNodeModulesPathMapping(specifier, pathPrefixes)) {
          markRelevant(file);
        }
        const pkg = getBarePackageName(specifier);
        const importers = importersByPackage.get(pkg) ?? [];
        importers.push(file);
        importersByPackage.set(pkg, importers);
      }
    }
  }

  for (const pkg of packageQueue) {
    for (const importer of importersByPackage.get(pkg) ?? []) {
      markRelevant(importer);
    }
  }

  if (relevantExternal.size === 0) return projectFiles;
  return allFiles.filter(
    (file) => !isNodeModulesPath(file) || relevantExternal.has(file) || isSymlinkOutsideNodeModules(file),
  );
}

/**
 * Returns program files that can reference project declarations: all non-`node_modules` files plus any
 * `node_modules` files that directly or transitively import outside `node_modules` (or symlink outside it).
 */
export function getRelevantProgramFileNames(project: Project): Promise<string[]> {
  const cached = relevantFilesCache.get(project);
  if (cached) return cached;
  const result = computeRelevantProgramFileNames(project);
  relevantFilesCache.set(project, result);
  return result;
}
