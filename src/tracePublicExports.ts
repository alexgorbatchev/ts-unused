import { Node, type SourceFile } from "ts-morph";

/**
 * Recursively traces exports from a source file.
 */
function addExportedDeclarations(
  sourceFile: SourceFile,
  publicDeclarations: Set<Node>,
  visitedFiles: Set<SourceFile>,
): void {
  if (visitedFiles.has(sourceFile)) {
    return;
  }
  visitedFiles.add(sourceFile);

  // Get all exported declarations; the language service already follows named re-exports,
  // aliased re-exports, and "export * from './module'" chains to the original definitions
  for (const declarations of sourceFile.getExportedDeclarations().values()) {
    for (const declaration of declarations) {
      // Add the export's original declaration
      publicDeclarations.add(declaration);
      // A namespace re-export (export * as ns from './module') resolves to the module itself,
      // so recursively trace exports from the target module
      if (Node.isSourceFile(declaration)) {
        addExportedDeclarations(declaration, publicDeclarations, visitedFiles);
      }
    }
  }
}

/**
 * Traces all exports from package entry point files and builds a set of public declarations.
 * This follows re-exports through barrel files to find the original definitions.
 */
export function tracePublicExports(entryPointFiles: SourceFile[]): Set<Node> {
  const publicDeclarations = new Set<Node>();
  const visitedFiles = new Set<SourceFile>();

  for (const entryFile of entryPointFiles) {
    addExportedDeclarations(entryFile, publicDeclarations, visitedFiles);
  }

  return publicDeclarations;
}
