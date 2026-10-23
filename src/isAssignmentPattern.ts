import { ts } from "ts-morph";

/**
 * Mirrors TypeScript's `isArrayLiteralOrObjectLiteralDestructuringPattern`, which is not part of the public API.
 * Matches exactly the positions `checker.getTypeOfAssignmentPattern` accepts.
 */
export function isAssignmentPattern(node: ts.Node): node is ts.AssignmentPattern {
  if (!ts.isObjectLiteralExpression(node) && !ts.isArrayLiteralExpression(node)) {
    return false;
  }

  const { parent } = node;
  if (
    ts.isBinaryExpression(parent) &&
    parent.left === node &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
  ) {
    return true;
  }
  if (ts.isForOfStatement(parent) && parent.initializer === node) {
    return true;
  }
  return isAssignmentPattern(ts.isPropertyAssignment(parent) ? parent.parent : parent);
}
