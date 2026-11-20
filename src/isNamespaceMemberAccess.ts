import { Node } from "ts-morph";

/**
 * Whether a reference to a namespace import names one member: `ns.a`, `ns.Type`, `typeof ns.a`, or `ns["a"]`.
 * The language service already reports these as references to that member's declaration.
 */
export function isNamespaceMemberAccess(reference: Node): boolean {
  const parent = reference.getParent();
  if (Node.isPropertyAccessExpression(parent) || Node.isElementAccessExpression(parent)) {
    const argument = Node.isElementAccessExpression(parent) ? parent.getArgumentExpression() : undefined;
    const isLiteralKey =
      argument === undefined || Node.isStringLiteral(argument) || Node.isNoSubstitutionTemplateLiteral(argument);
    return parent.getExpression() === reference && isLiteralKey;
  }
  return Node.isQualifiedName(parent) && parent.getLeft() === reference;
}
