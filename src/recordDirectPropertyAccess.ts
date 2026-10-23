import { ts, type SourceFile } from "ts-morph";
import type { PropertyAccesses, PropertyAccessName } from "./types.js";
import { recordPropertySymbols } from "./recordPropertySymbols.js";
import { getPropertyNameSymbols } from "./getPropertyNameSymbols.js";
import { isAssignmentPattern } from "./isAssignmentPattern.js";
import { recordContextualPropertyAccess } from "./recordContextualPropertyAccess.js";

function recordNamedAccess(
  name: PropertyAccessName,
  object: ts.Type | undefined,
  checker: ts.TypeChecker,
  accesses: PropertyAccesses,
  sourceFile: SourceFile,
): void {
  if (!object) {
    return;
  }
  recordPropertySymbols(accesses, checker, getPropertyNameSymbols(name, object, checker), sourceFile);
}

/** Records native symbol reads and property names in bindings, contextual literals, and JSX attributes. */
export function recordDirectPropertyAccess(
  node: ts.Node,
  accesses: PropertyAccesses,
  checker: ts.TypeChecker,
  sourceFile: SourceFile,
): void {
  if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
    const parent = node.parent;
    const isDefinition = (ts.isPropertySignature(parent) || ts.isPropertyDeclaration(parent)) && parent.name === node;
    if (!isDefinition) {
      const symbol = checker.getSymbolAtLocation(node);
      if (symbol) {
        recordPropertySymbols(accesses, checker, [symbol], sourceFile);
      }
    }
  }
  if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
    const key = node.propertyName ?? node.name;
    if (ts.isIdentifier(key)) {
      recordNamedAccess(key, checker.getTypeAtLocation(node.parent), checker, accesses, sourceFile);
    }
  }
  if (
    (ts.isPropertyAssignment(node) ||
      ts.isShorthandPropertyAssignment(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)) &&
    ts.isObjectLiteralExpression(node.parent)
  ) {
    if (isAssignmentPattern(node.parent)) {
      recordNamedAccess(node.name, checker.getTypeOfAssignmentPattern(node.parent), checker, accesses, sourceFile);
    } else {
      recordContextualPropertyAccess(node.parent, node.name, accesses, checker, sourceFile);
    }
  }
  if (ts.isJsxAttribute(node)) {
    recordContextualPropertyAccess(node.parent, node.name, accesses, checker, sourceFile);
  }
}
