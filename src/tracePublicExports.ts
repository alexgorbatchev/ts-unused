import path from "node:path";
import { Project, type SourceFile, SyntaxKind } from "ts-morph";

/**
 * Represents a public export that should be considered "used" in package mode.
 */
export interface PublicExport {
  /** The name of the exported symbol */
  exportName: string;
  /** The file path where the symbol is originally defined (relative to project root) */
  definitionFilePath: string;
}

/**
 * Traces all exports from package entry point files and builds a set of public exports.
 * This follows re-exports through barrel files to find the original definitions.
 */
export function tracePublicExports(
  project: Project,
  entryPointFiles: string[],
  projectRoot: string
): Set<string> {
  const publicExports = new Set<string>();
  const visitedFiles = new Set<string>();

  for (const entryFile of entryPointFiles) {
    const absolutePath = path.join(projectRoot, entryFile);
    const sourceFile = project.getSourceFile(absolutePath);
    if (sourceFile) {
      traceExportsFromFile(sourceFile, publicExports, visitedFiles, projectRoot);
    }
  }

  return publicExports;
}

/**
 * Creates a unique key for an export to track it.
 */
function createExportKey(filePath: string, exportName: string): string {
  return `${filePath}::${exportName}`;
}

/**
 * Recursively traces exports from a source file.
 */
function traceExportsFromFile(
  sourceFile: SourceFile,
  publicExports: Set<string>,
  visitedFiles: Set<string>,
  projectRoot: string
): void {
  const filePath = sourceFile.getFilePath();
  if (visitedFiles.has(filePath)) {
    return;
  }
  visitedFiles.add(filePath);

  const relativePath = path.relative(projectRoot, filePath);

  // Get all exported declarations
  const exportedDeclarations = sourceFile.getExportedDeclarations();

  for (const [exportName, declarations] of exportedDeclarations) {
    for (const declaration of declarations) {
      const declSourceFile = declaration.getSourceFile();
      const declFilePath = declSourceFile.getFilePath();
      const declRelativePath = path.relative(projectRoot, declFilePath);

      // Add the export with its definition file
      const exportKey = createExportKey(declRelativePath, exportName);
      publicExports.add(exportKey);
    }
  }

  // Handle "export * from './module'" statements
  const exportDeclarations = sourceFile.getExportDeclarations();
  for (const exportDecl of exportDeclarations) {
    const moduleSpecifier = exportDecl.getModuleSpecifier();
    if (!moduleSpecifier) continue;

    const moduleSourceFile = exportDecl.getModuleSpecifierSourceFile();
    if (!moduleSourceFile) continue;

    // Check if it's a namespace export (export * from)
    const namedExports = exportDecl.getNamedExports();
    if (namedExports.length === 0 && !exportDecl.isNamespaceExport()) {
      // This is "export * from './module'"
      // Recursively trace exports from the target module
      traceExportsFromFile(moduleSourceFile, publicExports, visitedFiles, projectRoot);
    }
  }
}

/**
 * Checks if a given export is part of the public API.
 */
export function isPublicExport(
  publicExports: Set<string>,
  filePath: string,
  exportName: string
): boolean {
  const exportKey = createExportKey(filePath, exportName);
  return publicExports.has(exportKey);
}
