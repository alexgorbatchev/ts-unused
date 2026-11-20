import {
  isExportSpecifier,
  isImportClause,
  isImportSpecifier,
  type ExportSpecifier,
  type ImportClause,
  type ImportSpecifier,
  type Node,
} from "typescript/ast";

export type NamingSpecifier = ExportSpecifier | ImportSpecifier | ImportClause;

export function classifyExportReferences(references: readonly Node[]) {
  const usages: Node[] = [];
  const specifiers = new Set<NamingSpecifier>();
  for (const node of references) {
    const parent = node.parent;
    if (isExportSpecifier(node)) specifiers.add(node);
    else if (isExportSpecifier(parent) || isImportSpecifier(parent) || isImportClause(parent)) specifiers.add(parent);
    else usages.push(node);
  }
  return { usages, specifiers: [...specifiers] };
}
