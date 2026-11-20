import {
  getTouchingToken,
  isBindingElement,
  isClassDeclaration,
  isEnumDeclaration,
  isFunctionDeclaration,
  isIdentifier,
  isInterfaceDeclaration,
  isModuleDeclaration,
  isTypeAliasDeclaration,
  isVariableDeclaration,
  SyntaxKind,
  type Node,
} from "typescript/ast";
import type { Project } from "typescript/async";

export function getReferenceLocation(node: Node): Node | undefined {
  if (isIdentifier(node)) return node;
  if (
    isFunctionDeclaration(node) ||
    isClassDeclaration(node) ||
    isEnumDeclaration(node) ||
    isInterfaceDeclaration(node) ||
    isModuleDeclaration(node) ||
    isTypeAliasDeclaration(node) ||
    isVariableDeclaration(node) ||
    isBindingElement(node)
  ) {
    if (node.name) return node.name;
    if (isFunctionDeclaration(node) || isClassDeclaration(node)) {
      return node.modifiers?.find((modifier) => modifier.kind === SyntaxKind.DefaultKeyword) ?? undefined;
    }
  }
  return undefined;
}

export async function findNativeReferenceNodes(project: Project, declaration: Node): Promise<Node[]> {
  const location = getReferenceLocation(declaration);
  if (!location) return [];
  const source = location.getSourceFile();
  const position = location.getStart(source);
  const token = getTouchingToken(source, position);
  const groups = await project.languageService.getReferencedSymbolsForNode(token, position);
  const references = await Promise.all(
    groups.flatMap(({ references }) => references.map((handle) => handle.resolve())),
  );
  return [...new Set(references.filter((node): node is Node => node !== undefined))];
}
