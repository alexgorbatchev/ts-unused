import {
  isPropertyAccessExpression,
  isElementAccessExpression,
  isStringLiteral,
  isNoSubstitutionTemplateLiteral,
  isQualifiedName,
  type Node,
} from "typescript/ast";

/**
 * Whether a reference to a namespace import names one member: `ns.a`, `ns.Type`, `typeof ns.a`, or `ns["a"]`.
 * The language service already reports these as references to that member's declaration.
 */
export function isNamespaceMemberAccess(reference: Node): boolean {
  const parent = reference.parent;
  if (isPropertyAccessExpression(parent) || isElementAccessExpression(parent)) {
    const argument = isElementAccessExpression(parent) ? parent.argumentExpression : undefined;
    const isLiteralKey =
      argument === undefined || isStringLiteral(argument) || isNoSubstitutionTemplateLiteral(argument);
    return parent.expression === reference && isLiteralKey;
  }
  return isQualifiedName(parent) && parent.left === reference;
}
