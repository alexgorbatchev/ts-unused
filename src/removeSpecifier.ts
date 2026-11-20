import {
  isExportDeclaration,
  isExportSpecifier,
  isImportClause,
  isImportDeclaration,
  isNamespaceImport,
  isNamedImports,
  isNamedExports,
  type ExportSpecifier,
  type ImportClause,
  type ImportSpecifier,
  type NamespaceImport,
} from "typescript/ast";
import type { ModuleStatement } from "./findModuleReferences.js";
import { removeListElements, removeSourceNode, type ISourceEdit } from "./sourceEdits.js";

export type RemovableSpecifier = ExportSpecifier | ImportClause | ImportSpecifier | NamespaceImport;

export function planSpecifierEdits(nodes: ReadonlySet<RemovableSpecifier>): ISourceEdit[] {
  const statements = new Set<ModuleStatement>();
  for (const node of nodes) {
    if (isExportSpecifier(node)) {
      const parent = node.parent.parent;
      if (isExportDeclaration(parent)) statements.add(parent);
    } else if (isImportClause(node)) {
      if (isImportDeclaration(node.parent)) statements.add(node.parent);
    } else if (isNamespaceImport(node)) {
      if (isImportDeclaration(node.parent.parent)) statements.add(node.parent.parent);
    } else {
      if (isImportDeclaration(node.parent.parent.parent)) statements.add(node.parent.parent.parent);
    }
  }

  const edits: ISourceEdit[] = [];
  for (const statement of statements) {
    const source = statement.getSourceFile();
    if (isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (!clause) continue;
      const defaultName = clause.name && !nodes.has(clause) ? clause.name : undefined;
      const bindings = clause.namedBindings;
      const elements = bindings && isNamedImports(bindings) ? bindings.elements : [];
      const keepsBindings =
        bindings &&
        (isNamespaceImport(bindings) ? !nodes.has(bindings) : elements.some((element) => !nodes.has(element)));

      if (!defaultName && !keepsBindings) {
        edits.push(removeSourceNode(statement, source));
      } else if (bindings && defaultName && !keepsBindings) {
        edits.push({ start: defaultName.end, end: bindings.end, text: "" });
      } else if (bindings && keepsBindings) {
        if (clause.name && !defaultName) {
          edits.push({ start: clause.name.getStart(source), end: bindings.getStart(source), text: "" });
        }
        edits.push(...removeListElements(elements, nodes, source));
      }
    } else {
      const clause = statement.exportClause;
      if (!clause || !isNamedExports(clause)) continue;
      if (clause.elements.every((element) => nodes.has(element))) {
        edits.push(removeSourceNode(statement, source));
      } else {
        edits.push(...removeListElements(clause.elements, nodes, source));
      }
    }
  }
  return edits;
}
