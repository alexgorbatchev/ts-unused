import path from "node:path";
import { readFileSync } from "node:fs";
import type { SourceFile } from "typescript/ast";
import type { Project } from "typescript/async";
import { mapBuildOutputsToSources, toComparablePath } from "./mapBuildOutputsToSources.js";

const SOURCE_MAPPING_URL_PATTERN = /^\/\/[#@] sourceMappingURL=(\S+)\s*$/gm;

interface IDeclarationMap {
  sourceRoot?: string;
  sources: string[];
}

interface IDeclarationMapFile {
  mapPath: string;
  map: IDeclarationMap;
}

function isDeclarationMap(value: unknown): value is IDeclarationMap {
  return (
    typeof value === "object" &&
    value !== null &&
    "sources" in value &&
    Array.isArray(value.sources) &&
    value.sources.every((source: unknown) => typeof source === "string") &&
    (!("sourceRoot" in value) || value.sourceRoot === undefined || typeof value.sourceRoot === "string")
  );
}

/** Read the declaration map a `//# sourceMappingURL=` comment points to; inline and remote maps are not followed. */
function readDeclarationMap(declarationFile: SourceFile): IDeclarationMapFile | undefined {
  const url = [...declarationFile.text.matchAll(SOURCE_MAPPING_URL_PATTERN)].at(-1)?.[1];
  if (!url || /^[a-z][a-z\d+.-]+:/i.test(url)) {
    return undefined;
  }
  try {
    const mapPath = path.resolve(path.dirname(declarationFile.fileName), decodeURI(url));
    const map: unknown = JSON.parse(readFileSync(mapPath, "utf8"));
    return isDeclarationMap(map) ? { mapPath, map } : undefined;
  } catch {
    return undefined;
  }
}

function isMappedToProjectSource(declarationFile: SourceFile, paths: ReadonlySet<string>): boolean {
  const declarationMap = readDeclarationMap(declarationFile);
  if (!declarationMap) {
    return false;
  }
  const { mapPath, map } = declarationMap;
  return map.sources.some((source) => {
    return paths.has(toComparablePath(path.resolve(path.dirname(mapPath), map.sourceRoot ?? "", source)));
  });
}

/**
 * Find the declaration files in the project that are build output of its own sources: the files the tsconfig
 * would emit, and declaration files whose declaration map points back to a source file in the program.
 */
export async function findEmittedDeclarationFiles(
  project: Project,
  configPath: string,
  projectFiles: SourceFile[],
): Promise<Set<SourceFile>> {
  const declarationFiles = projectFiles.filter((sourceFile) => sourceFile.isDeclarationFile);
  if (declarationFiles.length === 0) {
    return new Set();
  }
  const programFiles = await project.program.getSourceFileNames();
  const buildOutputs = mapBuildOutputsToSources(
    configPath,
    await project.program.getCompilerOptions(),
    projectFiles,
    programFiles,
  );
  const sources = new Set(programFiles.filter((file) => !/\.d\.[cm]?ts$/i.test(file)).map(toComparablePath));
  return new Set(
    declarationFiles.filter(
      (sourceFile) =>
        buildOutputs.has(toComparablePath(sourceFile.fileName)) || isMappedToProjectSource(sourceFile, sources),
    ),
  );
}
