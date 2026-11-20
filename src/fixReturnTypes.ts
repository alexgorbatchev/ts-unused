import {
  isParenthesizedTypeNode,
  isTypeReferenceNode,
  isUnionTypeNode,
  type FunctionDeclaration,
  type TypeNode,
} from "typescript/ast";
import type { Checker } from "typescript/async";
import { getDisplayName, unwrapPromise } from "./analyzeFunctionReturnTypes.js";
import type { ISourceEdit } from "./sourceEdits.js";

function skipParentheses(node: TypeNode): TypeNode {
  while (isParenthesizedTypeNode(node)) node = node.type;
  return node;
}

export async function planReturnTypeEdit(
  checker: Checker,
  declaration: FunctionDeclaration,
  removed: ReadonlySet<string>,
): Promise<ISourceEdit | undefined> {
  if (!declaration.type) return undefined;
  const annotated = await checker.getTypeAtLocation(declaration.type);
  const type = await unwrapPromise(checker, annotated);
  if (!type.isUnionType()) return undefined;

  let target = skipParentheses(declaration.type);
  const isPromise = type.id !== annotated.id;
  const firstArgument = isPromise && isTypeReferenceNode(target) ? target.typeArguments?.[0] : undefined;
  const argument =
    firstArgument && (await checker.getTypeAtLocation(firstArgument)).id === type.id ? firstArgument : undefined;
  if (argument) target = skipParentheses(argument);

  if (isUnionTypeNode(target)) {
    const members = await checker.getTypeAtLocation([...target.types]);
    const names = await Promise.all(members.map((member) => getDisplayName(checker, member)));
    const surviving = target.types.filter((_, index) => !removed.has(names[index]!));
    if (surviving.length === target.types.length || !surviving.length) return undefined;
    return { start: target.getStart(), end: target.end, text: surviving.map((member) => member.getText()).join(" | ") };
  }

  // A type alias names the union as a whole. Narrow this annotation without rewriting the alias.
  const members = await type.getTypes();
  const names = await Promise.all(members.map((member) => getDisplayName(checker, member)));
  const surviving = members.filter((_, index) => !removed.has(names[index]!));
  if (surviving.length === members.length || !surviving.length) return undefined;
  const texts = await Promise.all(surviving.map((member) => checker.typeToString(member, declaration)));
  const text = texts.join(" | ");
  return {
    start: target.getStart(),
    end: target.end,
    text: isPromise && !argument ? `Promise<${text}>` : text,
  };
}
