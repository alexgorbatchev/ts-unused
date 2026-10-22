import { Node, type SourceFile } from "ts-morph";

function addExportedDeclarations(
  sourceFile: SourceFile,
  publicDeclarations: Set<Node>,
  visitedFiles: Set<SourceFile>,
): void {
  if (visitedFiles.has(sourceFile)) {
    return;
  }
  visitedFiles.add(sourceFile);

  for (const declarations of sourceFile.getExportedDeclarations().values()) {
    for (const declaration of declarations) {
      publicDeclarations.add(declaration);
      if (Node.isSourceFile(declaration)) {
        addExportedDeclarations(declaration, publicDeclarations, visitedFiles);
      }
    }
  }
}

export function tracePublicExports(entryPointFiles: SourceFile[]): Set<Node> {
  const publicDeclarations = new Set<Node>();
  const visitedFiles = new Set<SourceFile>();

  for (const entryFile of entryPointFiles) {
    addExportedDeclarations(entryFile, publicDeclarations, visitedFiles);
  }

  return publicDeclarations;
}
