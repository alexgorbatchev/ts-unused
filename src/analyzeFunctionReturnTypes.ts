import path from "node:path";
import {
  isFunctionDeclaration,
  isReturnStatement,
  type FunctionDeclaration,
  type Node,
  type SourceFile,
} from "typescript/ast";
import { type Checker, type Type, TypeFlags, TypeFormatFlags } from "typescript/async";
import { SEVERITY } from "./constants.js";
import type { INeverReturnedTypeResult } from "./types.js";

const formatFlags =
  TypeFormatFlags.UseTypeOfFunction |
  TypeFormatFlags.NoTruncation |
  TypeFormatFlags.UseFullyQualifiedType |
  TypeFormatFlags.WriteTypeArgumentsOfSignature;

export function* descendants(node: Node): Iterable<Node> {
  for (const child of node.childrenIter()) {
    yield child;
    yield* descendants(child);
  }
}

export async function unwrapPromise(checker: Checker, type: Type): Promise<Type> {
  if (type.isTypeReference() && (await type.getSymbol())?.name === "Promise") {
    const [argument] = await checker.getTypeArguments(type);
    if (argument) return argument;
  }
  return type;
}

export async function getDisplayName(checker: Checker, type: Type): Promise<string> {
  const name = (await type.getSymbol())?.name;
  if (name && name !== "__type") return name;

  const text = (await checker.typeToString(type, undefined, formatFlags)).replace(/import\([^)]+\)\./g, "");
  if (text === "true" || text === "false") return "boolean";
  return text.length > 100 ? `${text.slice(0, 100)}...` : text;
}

async function getEnumName(checker: Checker, type: Type): Promise<string | undefined> {
  if (!(type.flags & TypeFlags.EnumLiteral)) return undefined;
  const text = (await checker.typeToString(type, undefined, formatFlags)).replace(/import\([^)]+\)\./g, "");
  const separator = text.lastIndexOf(".");
  return separator > 0 ? text.slice(0, separator) : undefined;
}

async function analyzeFunction(
  checker: Checker,
  func: FunctionDeclaration,
  source: SourceFile,
  relativePath: string,
): Promise<INeverReturnedTypeResult[]> {
  if (!func.name || !func.type) return [];

  const annotated = await unwrapPromise(checker, await checker.getTypeAtLocation(func.type));
  if (!annotated.isUnionType()) return [];
  const branches = await annotated.getTypes();
  if (branches.length < 2) return [];

  const expressions: Node[] = [];
  for (const node of descendants(func)) {
    if (isReturnStatement(node) && node.expression) expressions.push(node.expression);
  }
  if (!expressions.length) return [];

  const expressionTypes = await checker.getTypeAtLocation(expressions);
  const returned = await Promise.all(expressionTypes.map((type) => unwrapPromise(checker, type)));
  const assignability = await Promise.all(
    returned.map((type) => Promise.all(branches.map((branch) => checker.isTypeAssignableTo(type, branch)))),
  );

  // A return type compatible with the union as a whole can represent any of its branches.
  for (const [index, type] of returned.entries()) {
    if (!assignability[index]?.includes(true) && (await checker.isTypeAssignableTo(type, annotated))) {
      return [];
    }
  }

  const enumNames = await Promise.all(branches.map((branch) => getEnumName(checker, branch)));
  const displayNames = await Promise.all(branches.map((branch) => getDisplayName(checker, branch)));
  const returnedBranches = branches.map((branch, index) =>
    returned.some(
      (type, returnIndex) =>
        assignability[returnIndex]?.[index] || (type.isBooleanLiteralType() && branch.isBooleanLiteralType()),
    ),
  );
  const returnedEnums = new Set(enumNames.filter((name, index) => name && returnedBranches[index]));

  const { line, character } = source.getLineAndCharacterOfPosition(func.name.getStart(source));
  const functionName = func.name.text;
  const visited = new Set<string>();
  const results: INeverReturnedTypeResult[] = [];
  for (const [index, displayName] of displayNames.entries()) {
    if (visited.has(displayName)) continue;
    visited.add(displayName);
    if (returnedBranches[index] || returnedEnums.has(enumNames[index])) continue;
    results.push({
      filePath: relativePath,
      functionName,
      neverReturnedType: displayName,
      line: line + 1,
      character: character + 1,
      endCharacter: character + 1 + functionName.length,
      severity: SEVERITY.ERROR,
    });
  }
  return results;
}

/** Reports annotated union branches that are absent from every return expression. */
export async function analyzeFunctionReturnTypes(
  checker: Checker,
  source: SourceFile,
  tsConfigDir: string,
): Promise<INeverReturnedTypeResult[]> {
  const relativePath = path.relative(tsConfigDir, source.fileName);
  const results: INeverReturnedTypeResult[] = [];
  for (const node of descendants(source)) {
    if (isFunctionDeclaration(node)) {
      results.push(...(await analyzeFunction(checker, node, source, relativePath)));
    }
  }
  return results;
}
