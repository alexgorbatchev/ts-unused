import path from "node:path";
import type { Project, SourceFile } from "ts-morph";
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
function readDeclarationMap(declarationFile: SourceFile, project: Project): IDeclarationMapFile | undefined {
  const url = [...declarationFile.getFullText().matchAll(SOURCE_MAPPING_URL_PATTERN)].at(-1)?.[1];
  if (!url || /^[a-z][a-z\d+.-]+:/i.test(url)) {
    return undefined;
  }
  const fileSystem = project.getFileSystem();
  try {
    const mapPath = path.resolve(path.dirname(declarationFile.getFilePath()), decodeURI(url));
    if (!fileSystem.fileExistsSync(mapPath)) {
      return undefined;
    }
    const map: unknown = JSON.parse(fileSystem.readFileSync(mapPath));
    return isDeclarationMap(map) ? { mapPath, map } : undefined;
  } catch {
    return undefined;
  }
}

function isMappedToProjectSource(declarationFile: SourceFile, project: Project): boolean {
  const declarationMap = readDeclarationMap(declarationFile, project);
  if (!declarationMap) {
    return false;
  }
  const { mapPath, map } = declarationMap;
  return map.sources.some((source) => {
    const sourceFile = project.getSourceFile(path.resolve(path.dirname(mapPath), map.sourceRoot ?? "", source));
    return sourceFile !== undefined && !sourceFile.isDeclarationFile();
  });
}

/**
 * Find the declaration files in the project that are build output of its own sources: the files the tsconfig
 * would emit, and declaration files whose declaration map points back to a source file in the program.
 */
export function findEmittedDeclarationFiles(project: Project, projectFiles: SourceFile[]): Set<SourceFile> {
  const declarationFiles = projectFiles.filter((sourceFile) => sourceFile.isDeclarationFile());
  if (declarationFiles.length === 0) {
    return new Set();
  }
  const buildOutputs = mapBuildOutputsToSources(project, projectFiles);
  return new Set(
    declarationFiles.filter(
      (sourceFile) =>
        buildOutputs.has(toComparablePath(sourceFile.getFilePath())) || isMappedToProjectSource(sourceFile, project),
    ),
  );
}
