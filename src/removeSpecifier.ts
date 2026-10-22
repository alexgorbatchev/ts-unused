import { type NamespaceImport, Node } from "ts-morph";
import type { NamingSpecifier } from "./classifyExportReferences.js";

/** A specifier fix removes when the declaration or file it names is removed. */
export type RemovableSpecifier = NamingSpecifier | NamespaceImport;

/**
 * Removes an export specifier, import specifier, default import, or namespace import that names a removed
 * declaration or a deleted file. Removes the whole export/import declaration when nothing else is left in it,
 * because ts-morph would otherwise leave an empty `export {} from "./a"` or `import {} from "./a"` behind.
 */
export function removeSpecifier(node: RemovableSpecifier): void {
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
  const bindingCount =
    importDeclaration.getNamedImports().length +
    (importDeclaration.getDefaultImport() === undefined ? 0 : 1) +
    (importDeclaration.getNamespaceImport() === undefined ? 0 : 1);
  if (bindingCount === 1) {
    importDeclaration.remove();
  } else if (Node.isImportSpecifier(node)) {
    node.remove();
  } else if (Node.isNamespaceImport(node)) {
    importDeclaration.removeNamespaceImport();
  } else {
    importDeclaration.removeDefaultImport();
  }
}
