import { ts, type Project, type SourceFile } from "ts-morph";
import type { PropertyAccesses } from "./types.js";
import { getKeyProperties } from "./getKeyProperties.js";
import { isAssignmentPattern } from "./isAssignmentPattern.js";
import { recordPropertySymbols } from "./recordPropertySymbols.js";
import { recordDirectPropertyAccess } from "./recordDirectPropertyAccess.js";

const REFLECT_PROPERTY_METHODS = new Set([
  "get",
  "set",
  "has",
  "deleteProperty",
  "getOwnPropertyDescriptor",
  "defineProperty",
]);

const accessCache = new WeakMap<Project, PropertyAccesses>();

function recordAccess(
  accesses: PropertyAccesses,
  checker: ts.TypeChecker,
  objectType: ts.Type,
  key: ts.Node,
  sourceFile: SourceFile,
): void {
  recordPropertySymbols(accesses, checker, getKeyProperties(key, objectType, checker), sourceFile);
}

function getReflectMethodName(callee: ts.Expression): string | undefined {
  if (ts.isPropertyAccessExpression(callee)) {
    return ts.isIdentifier(callee.expression) && callee.expression.text === "Reflect" ? callee.name.text : undefined;
  }
  if (ts.isElementAccessExpression(callee)) {
    const argument = callee.argumentExpression;
    const isReflect = ts.isIdentifier(callee.expression) && callee.expression.text === "Reflect";
    return isReflect && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))
      ? argument.text
      : undefined;
  }
  return undefined;
}

/** Records `Reflect.get(receiver, "key")` and the other property-keyed Reflect methods. */
function recordReflectAccess(
  node: ts.CallExpression,
  accesses: PropertyAccesses,
  checker: ts.TypeChecker,
  sourceFile: SourceFile,
): void {
  const methodName = getReflectMethodName(node.expression);
  const [receiver, key] = node.arguments;
  if (!methodName || !REFLECT_PROPERTY_METHODS.has(methodName) || !receiver || !key) {
    return;
  }
  if (ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key)) {
    recordAccess(accesses, checker, checker.getTypeAtLocation(receiver), key, sourceFile);
  }
}

/**
 * Applies TypeScript's identifier rule (the key names a property of the destructured or indexed type) to the
 * key forms its find-references skips:
 * - `const { "a-b": x, 0: y, [KEY]: z } = value` (binding patterns, including parameters)
 * - `({ "a-b": x, [KEY]: z } = value)` and `for ({ "a-b": x } of values)` (assignment patterns)
 * - `value[KEY]` where `KEY` has a literal or `unique symbol` type (literal element access is already resolved)
 */
function recordNodeAccess(
  node: ts.Node,
  accesses: PropertyAccesses,
  checker: ts.TypeChecker,
  sourceFile: SourceFile,
): void {
  if (ts.isBindingElement(node) && node.propertyName && !ts.isIdentifier(node.propertyName)) {
    recordAccess(accesses, checker, checker.getTypeAtLocation(node.parent), node.propertyName, sourceFile);
  } else if (ts.isObjectLiteralExpression(node) && isAssignmentPattern(node)) {
    const patternType = checker.getTypeOfAssignmentPattern(node);
    for (const property of node.properties) {
      if (ts.isPropertyAssignment(property) && !ts.isIdentifier(property.name)) {
        recordAccess(accesses, checker, patternType, property.name, sourceFile);
      }
    }
  } else if (ts.isElementAccessExpression(node)) {
    recordAccess(accesses, checker, checker.getTypeAtLocation(node.expression), node.argumentExpression, sourceFile);
  } else if (ts.isCallExpression(node)) {
    recordReflectAccess(node, accesses, checker, sourceFile);
  }
}

/**
 * Indexes property uses with the existing compiler checker, avoiding a second semantic program for reference queries.
 * The result is computed once per project and cached.
 */
export function getPropertyAccesses(project: Project): PropertyAccesses {
  const cached = accessCache.get(project);
  if (cached) {
    return cached;
  }

  const accesses: PropertyAccesses = new Map();
  const checker = project.getTypeChecker().compilerObject;
  for (const compilerFile of project.getProgram().compilerObject.getSourceFiles()) {
    const sourceFile = project.getSourceFileOrThrow(compilerFile.fileName);
    const visit = (node: ts.Node): void => {
      recordNodeAccess(node, accesses, checker, sourceFile);
      recordDirectPropertyAccess(node, accesses, checker, sourceFile);
      ts.forEachChild(node, visit);
    };
    // Package redirects can give the compiler a different AST than ts-morph's cached wrapper.
    visit(compilerFile);
  }

  accessCache.set(project, accesses);
  return accesses;
}
