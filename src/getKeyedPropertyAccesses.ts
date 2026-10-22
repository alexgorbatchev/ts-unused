import { ts, type Project, type SourceFile } from "ts-morph";

/** Files that access each property declaration (keyed by compiler node) through a key the language service misses. */
export type KeyedPropertyAccesses = Map<ts.Node, Set<SourceFile>>;

const REFLECT_PROPERTY_METHODS = new Set([
  "get",
  "set",
  "has",
  "deleteProperty",
  "getOwnPropertyDescriptor",
  "defineProperty",
]);

/** A key that names one property by its text: `"a-b"`, `\`a-b\``, or `0`. */
type LiteralKey = ts.StringLiteralLike | ts.NumericLiteral;

const accessCache = new WeakMap<Project, KeyedPropertyAccesses>();

function isLiteralKey(node: ts.Node): node is LiteralKey {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isNumericLiteral(node);
}

/**
 * Resolves the property names a key can stand for: the text of a literal key, or every string/number
 * literal in the type of a computed key. Keys of a wider type (e.g. `string`) name no specific property.
 */
function getKeyNames(key: ts.Node, checker: ts.TypeChecker): string[] {
  if (isLiteralKey(key)) {
    return [key.text];
  }

  const keyType = checker.getTypeAtLocation(ts.isComputedPropertyName(key) ? key.expression : key);
  const keyTypes = keyType.isUnion() ? keyType.types : [keyType];
  return keyTypes.flatMap((type) => (type.isStringLiteral() || type.isNumberLiteral() ? [String(type.value)] : []));
}

/**
 * Mirrors TypeScript's `isArrayLiteralOrObjectLiteralDestructuringPattern`, which is not part of the public API.
 * Matches exactly the positions `checker.getTypeOfAssignmentPattern` accepts.
 */
function isAssignmentPattern(node: ts.Node): node is ts.AssignmentPattern {
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

function recordAccess(
  accesses: KeyedPropertyAccesses,
  checker: ts.TypeChecker,
  objectType: ts.Type,
  key: ts.Node,
  sourceFile: SourceFile,
): void {
  for (const name of getKeyNames(key, checker)) {
    for (const declaration of checker.getPropertyOfType(objectType, name)?.declarations ?? []) {
      if (!ts.isPropertySignature(declaration) && !ts.isPropertyDeclaration(declaration)) {
        continue;
      }
      const files = accesses.get(declaration) ?? new Set<SourceFile>();
      files.add(sourceFile);
      accesses.set(declaration, files);
    }
  }
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
  accesses: KeyedPropertyAccesses,
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
 * - `value[KEY]` where `KEY` has a literal type (literal element access is already resolved)
 */
function recordNodeAccess(
  node: ts.Node,
  accesses: KeyedPropertyAccesses,
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
  } else if (ts.isElementAccessExpression(node) && !isLiteralKey(node.argumentExpression)) {
    recordAccess(accesses, checker, checker.getTypeAtLocation(node.expression), node.argumentExpression, sourceFile);
  } else if (ts.isCallExpression(node)) {
    recordReflectAccess(node, accesses, checker, sourceFile);
  }
}

/**
 * Collects property reads that `findReferences` does not report, so usage analysis can count them.
 * The result is computed once per project and cached.
 */
export function getKeyedPropertyAccesses(project: Project): KeyedPropertyAccesses {
  const cached = accessCache.get(project);
  if (cached) {
    return cached;
  }

  const accesses: KeyedPropertyAccesses = new Map();
  const checker = project.getTypeChecker().compilerObject;
  for (const sourceFile of project.getSourceFiles()) {
    if (sourceFile.isDeclarationFile()) {
      continue;
    }
    const visit = (node: ts.Node): void => {
      recordNodeAccess(node, accesses, checker, sourceFile);
      ts.forEachChild(node, visit);
    };
    visit(sourceFile.compilerNode);
  }

  accessCache.set(project, accesses);
  return accesses;
}
