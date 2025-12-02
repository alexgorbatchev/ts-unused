import path from "node:path";
import { type FunctionDeclaration, type SourceFile, SyntaxKind, type Type } from "ts-morph";
import type { NeverReturnedTypeResult } from "./types";

/**
 * Analyzes a function to detect union type branches in the return type that are never actually returned
 */
export function analyzeFunctionReturnTypes(
  func: FunctionDeclaration,
  sourceFile: SourceFile,
  tsConfigDir: string
): NeverReturnedTypeResult[] {
  const results: NeverReturnedTypeResult[] = [];
  const functionName = func.getName();

  // Skip functions without names
  if (!functionName) {
    return results;
  }

  // Get the return type node
  const returnTypeNode = func.getReturnTypeNode();
  if (!returnTypeNode) {
    return results;
  }

  // Get the actual Type from the type checker
  const returnType = returnTypeNode.getType();

  // Try to unwrap Promise first
  const unwrappedPromise = unwrapPromiseType(returnType);
  const typeToCheck = unwrappedPromise || returnType;

  // Check if it's a union type (or contains a union after unwrapping Promise)
  if (!typeToCheck.isUnion()) {
    return results;
  }

  // Get all union type branches
  const unionTypes = typeToCheck.getUnionTypes();

  if (unionTypes.length < 2) {
    // Not a meaningful union
    return results;
  }

  // Get all return statements in the function
  const returnStatements = func.getDescendantsOfKind(SyntaxKind.ReturnStatement);

  // Collect types of all returned values
  const returnedTypes: Type[] = [];
  for (const returnStmt of returnStatements) {
    const expression = returnStmt.getExpression();
    if (expression) {
      const exprType = expression.getType();
      // Unwrap Promise if needed
      const unwrapped = unwrapPromiseType(exprType);
      returnedTypes.push(unwrapped || exprType);
    }
  }

  // If no return statements, can't determine what's returned
  if (returnedTypes.length === 0) {
    return results;
  }

  // Group union branches by display name to handle boolean (true/false) and avoid duplicates
  const branchMap = new Map<string, Type>();
  for (const unionBranch of unionTypes) {
    const displayName = getTypeDisplayName(unionBranch);
    if (!branchMap.has(displayName)) {
      branchMap.set(displayName, unionBranch);
    }
  }

  // Check each unique union branch to see if it's ever returned
  for (const [displayName, unionBranch] of branchMap.entries()) {
    let isReturned = false;

    for (const returnedType of returnedTypes) {
      // Check if the returned type is assignable to this union branch
      if (isTypeAssignableTo(returnedType, unionBranch)) {
        isReturned = true;
        break;
      }
    }

    if (!isReturned) {
      // This union branch is never returned
      const relativePath = path.relative(tsConfigDir, sourceFile.getFilePath());
      const nameNode = func.getNameNode();

      if (nameNode) {
        const startPos = nameNode.getStart();
        const lineStartPos = nameNode.getStartLinePos();
        const character = startPos - lineStartPos + 1;
        const endCharacter = character + functionName.length;

        results.push({
          filePath: relativePath,
          functionName,
          neverReturnedType: displayName,
          line: nameNode.getStartLineNumber(),
          character,
          endCharacter,
          severity: "error",
        });
      }
    }
  }

  return results;
}

/**
 * Unwrap Promise<T> to get T
 */
function unwrapPromiseType(type: Type): Type | null {
  const symbol = type.getSymbol();
  if (symbol?.getName() === "Promise") {
    const typeArgs = type.getTypeArguments();
    if (typeArgs.length > 0 && typeArgs[0]) {
      return typeArgs[0];
    }
  }
  return null;
}

/**
 * Check if sourceType is assignable to targetType
 */
function isTypeAssignableTo(sourceType: Type, targetType: Type): boolean {
  // Use TypeScript's built-in type checker for assignability
  // This properly handles structural compatibility, inferred types, etc.
  if (sourceType.isAssignableTo(targetType)) {
    return true;
  }

  // Special handling for boolean literals (true/false)
  // TypeScript represents boolean as true | false, so we need to check
  // if both are boolean literals when comparing
  const sourceText = sourceType.getText();
  const targetText = targetType.getText();

  const isBooleanLiteral = (text: string) => text === "true" || text === "false";

  if (isBooleanLiteral(sourceText) && isBooleanLiteral(targetText)) {
    return true;
  }

  return false;
}

/**
 * Get a readable display name for a type
 */
function getTypeDisplayName(type: Type): string {
  const symbol = type.getSymbol();

  // If it has a symbol with a name, use that
  if (symbol) {
    const name = symbol.getName();
    if (name && name !== "__type") {
      return name;
    }
  }

  // Otherwise, use the type text
  let typeText = type.getText();

  // Strip import paths from type text
  // Pattern: import("path/to/file").TypeName -> TypeName
  typeText = typeText.replace(/import\([^)]+\)\./g, "");

  // Simplify common type texts
  if (typeText === "string") return "string";
  if (typeText === "number") return "number";
  if (typeText === "boolean") return "boolean";
  if (typeText === "true" || typeText === "false") return "boolean";
  if (typeText === "null") return "null";
  if (typeText === "undefined") return "undefined";

  // Truncate very long types (e.g., inline object types)
  const MAX_TYPE_LENGTH = 100;
  if (typeText.length > MAX_TYPE_LENGTH) {
    return typeText.substring(0, MAX_TYPE_LENGTH) + "...";
  }

  return typeText;
}
