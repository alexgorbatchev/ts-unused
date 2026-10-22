import { Node } from "ts-morph";
import type { ForwardingNode } from "./classifyExportReferences.js";

/**
 * Removes an export specifier, import specifier, or default import that forwards a removed declaration.
 * Removes the whole export/import declaration when nothing else is left in it, because ts-morph would
 * otherwise leave an empty `export {} from "./a"` or `import {} from "./a"` behind.
 */
export function removeForwardingNode(node: ForwardingNode): void {
  if (node.wasForgotten()) {
    return;
  }

  if (Node.isExportSpecifier(node)) {
    const exportDeclaration = node.getExportDeclaration();
    if (exportDeclaration.getNamedExports().length === 1) {
      exportDeclaration.remove();
    } else {
      node.remove();
    }
    return;
  }

  const importDeclaration = node.getFirstAncestorOrThrow(Node.isImportDeclaration);
  const hasNamespaceImport = importDeclaration.getNamespaceImport() !== undefined;
  if (Node.isImportSpecifier(node)) {
    const isOnlyBinding =
      importDeclaration.getNamedImports().length === 1 &&
      importDeclaration.getDefaultImport() === undefined &&
      !hasNamespaceImport;
    if (isOnlyBinding) {
      importDeclaration.remove();
    } else {
      node.remove();
    }
    return;
  }

  if (importDeclaration.getNamedImports().length === 0 && !hasNamespaceImport) {
    importDeclaration.remove();
  } else {
    importDeclaration.removeDefaultImport();
  }
}
