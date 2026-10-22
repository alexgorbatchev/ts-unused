import path from "node:path";
import { ts, type Project, type SourceFile } from "ts-morph";

const IGNORE_CASE = !ts.sys.useCaseSensitiveFileNames;

/**
 * Normalizes a path for map lookups: absolute, forward slashes, and lowercase on case-insensitive file systems.
 */
export function toComparablePath(filePath: string): string {
  const normalizedPath = path.resolve(filePath).split(path.sep).join("/");
  return IGNORE_CASE ? normalizedPath.toLowerCase() : normalizedPath;
}

/**
 * Returns the deepest directory shared by all given paths, the way TypeScript before 6.0 inferred rootDir.
 */
function getCommonDirectory(filePaths: string[]): string | undefined {
  const [firstPath, ...otherPaths] = filePaths.map((filePath) => path.dirname(filePath).split("/"));
  if (!firstPath) {
    return undefined;
  }

  let commonLength = firstPath.length;
  for (const segments of otherPaths) {
    let index = 0;
    while (index < commonLength && index < segments.length && segments[index] === firstPath[index]) {
      index++;
    }
    commonLength = index;
  }

  return firstPath.slice(0, commonLength).join("/") || "/";
}

/**
 * Lists the rootDir values a build may use: an explicit rootDir, or, when it is omitted, both the tsconfig
 * directory (TypeScript 6.0+ default) and the common source directory (earlier TypeScript versions).
 */
function getRootDirCandidates(project: Project, compilerOptions: ts.CompilerOptions): string[] {
  if (compilerOptions.rootDir) {
    return [compilerOptions.rootDir];
  }

  const candidates: string[] = [];
  const { configFilePath } = compilerOptions;
  if (typeof configFilePath === "string") {
    candidates.push(path.dirname(configFilePath));
  }

  const emittedFilePaths = project
    .getSourceFiles()
    .filter((sourceFile) => !sourceFile.isDeclarationFile() && !sourceFile.isInNodeModules())
    .map((sourceFile) => sourceFile.getFilePath());
  const commonSourceDirectory = getCommonDirectory(emittedFilePaths);
  if (commonSourceDirectory && !candidates.includes(commonSourceDirectory)) {
    candidates.push(commonSourceDirectory);
  }

  return candidates;
}

/**
 * Maps every JavaScript and declaration file the tsconfig would emit back to the source file that emits it,
 * using the same TypeScript API tsc uses to name emitted files. Keys are comparable paths.
 * Returns an empty map for outFile builds, which bundle all sources into one output.
 */
export function mapBuildOutputsToSources(project: Project, projectFiles: SourceFile[]): Map<string, SourceFile> {
  const outputsToSources = new Map<string, SourceFile>();
  const compilerOptions = project.getCompilerOptions();
  if (compilerOptions.outFile) {
    return outputsToSources;
  }

  const inputFiles = projectFiles.filter((sourceFile) => !sourceFile.isDeclarationFile());
  const fileNames = inputFiles.map((sourceFile) => sourceFile.getFilePath());

  for (const rootDir of getRootDirCandidates(project, compilerOptions)) {
    const commandLine: ts.ParsedCommandLine = {
      options: { ...compilerOptions, rootDir, declaration: true, emitDeclarationOnly: false },
      fileNames,
      errors: [],
    };

    for (const sourceFile of inputFiles) {
      for (const outputPath of ts.getOutputFileNames(commandLine, sourceFile.getFilePath(), IGNORE_CASE)) {
        const outputKey = toComparablePath(outputPath);
        // Source maps are not entry targets; the first rootDir candidate wins for duplicate outputs
        if (!outputPath.endsWith(".map") && !outputsToSources.has(outputKey)) {
          outputsToSources.set(outputKey, sourceFile);
        }
      }
    }
  }

  return outputsToSources;
}
