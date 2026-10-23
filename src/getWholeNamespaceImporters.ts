import { type Identifier, Node, type SourceFile } from "ts-morph";
import { findReferenceNodes } from "./findReferenceNodes.js";

const importersCache = new WeakMap<SourceFile, SourceFile[]>();

/**
 * Whether a reference to a namespace import names one member: `ns.a`, `ns.Type`, `typeof ns.a`, or `ns["a"]`.
 * The language service already reports these as references to that member's declaration.
 */
function isMemberAccess(reference: Node): boolean {
  const parent = reference.getParent();
  if (Node.isPropertyAccessExpression(parent) || Node.isElementAccessExpression(parent)) {
    const argument = Node.isElementAccessExpression(parent) ? parent.getArgumentExpression() : undefined;
    const isLiteralKey =
      argument === undefined || Node.isStringLiteral(argument) || Node.isNoSubstitutionTemplateLiteral(argument);
    return parent.getExpression() === reference && isLiteralKey;
  }
  return Node.isQualifiedName(parent) && parent.getLeft() === reference;
}

function isUsedAsWhole(namespaceImport: Identifier): boolean {
  return findReferenceNodes(namespaceImport).some(
    (reference) => reference !== namespaceImport && !isMemberAccess(reference),
  );
}

/**
 * Returns the files that use a namespace import of this module as a whole value, for example `register(ns)`,
 * `Object.keys(ns)`, `typeof ns`, or `export { ns }`. Such a use can reach every export at runtime, so it counts as
 * usage of each of them. Member accesses such as `ns.a` count only for `a`, and an unreferenced namespace import
 * counts for nothing. The result is computed once per module and cached.
 */
export function getWholeNamespaceImporters(sourceFile: SourceFile): SourceFile[] {
  const cached = importersCache.get(sourceFile);
  if (cached) {
    return cached;
  }

  const importers = new Set<SourceFile>();
  for (const node of sourceFile.getReferencingNodesInOtherSourceFiles()) {
    const namespaceImport = Node.isImportDeclaration(node) ? node.getNamespaceImport() : undefined;
    if (namespaceImport && isUsedAsWhole(namespaceImport)) {
      importers.add(node.getSourceFile());
    }
  }

  const result = [...importers];
  importersCache.set(sourceFile, result);
  return result;
}
