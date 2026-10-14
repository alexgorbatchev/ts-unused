import { Node, SyntaxKind } from "ts-morph";
import type { Type } from "ts-morph";
import type { TypeDeclaration } from "./types";

function ownsDefinition(declaration: TypeDeclaration, node: Node): boolean {
  return (
    node.getSourceFile() === declaration.getSourceFile() &&
    node.getStart() >= declaration.getStart() &&
    node.getEnd() <= declaration.getEnd()
  );
}

function hasOwnResolvedDefinition(declaration: TypeDeclaration, type: Type, visited = new Set<Type>()): boolean {
  if (type.isTypeParameter() || visited.has(type)) {
    return false;
  }
  visited.add(type);
  const definitions = [
    ...(type.getSymbol()?.getDeclarations() ?? []),
    ...type.getProperties().flatMap((property) => property.getDeclarations()),
    ...type.getCallSignatures().map((signature) => signature.getDeclaration()),
    ...type.getConstructSignatures().map((signature) => signature.getDeclaration()),
  ];
  return (
    definitions.some((node) => ownsDefinition(declaration, node)) ||
    (type.isUnion() &&
      declaration.getDescendantsOfKind(SyntaxKind.UnionType).some((node) => {
        const authoredParts = node.getType().getUnionTypes();
        const resolvedParts = type.getUnionTypes();
        return (
          authoredParts.length === resolvedParts.length &&
          resolvedParts.every((part) => authoredParts.some((authored) => authored.compilerType === part.compilerType))
        );
      })) ||
    // Literal unions in utility arguments may select keys; only the resolved output owns a union definition.
    [...type.getIntersectionTypes(), ...type.getAliasTypeArguments().filter((part) => !part.isUnion())].some((part) =>
      hasOwnResolvedDefinition(declaration, part, visited),
    )
  );
}

/** Recognize reuse by the origins of the resolved members, rather than by alias names. */
export function isDerivedTypeDeclaration(declaration: TypeDeclaration): boolean {
  if (Node.isInterfaceDeclaration(declaration)) {
    return declaration.getMembers().length === 0 && declaration.getExtends().length > 0;
  }
  let node = declaration.getTypeNodeOrThrow();
  while (Node.isParenthesizedTypeNode(node)) {
    node = node.getTypeNode();
  }
  if (Node.isTypeOperatorTypeNode(node)) {
    const operand = node.getTypeNode();
    if (Node.isTupleTypeNode(operand) || Node.isArrayTypeNode(operand) || Node.isTypeLiteral(operand)) {
      return false;
    }
  }
  const isDerivation =
    Node.isTypeReference(node) ||
    Node.isIndexedAccessTypeNode(node) ||
    Node.isTypeQuery(node) ||
    Node.isTypeOperatorTypeNode(node) ||
    Node.isIntersectionTypeNode(node);
  return isDerivation && !hasOwnResolvedDefinition(declaration, declaration.getType());
}
