import path from "node:path";
import {
  isArrayTypeNode,
  isExpressionWithTypeArguments,
  isIndexedAccessTypeNode,
  isInterfaceDeclaration,
  isIntersectionTypeNode,
  isParenthesizedTypeNode,
  isTupleTypeNode,
  isTypeAliasDeclaration,
  isTypeLiteralNode,
  isTypeOperatorNode,
  isTypeQueryNode,
  isTypeReferenceNode,
  isUnionTypeNode,
  type InterfaceDeclaration,
  type Node,
  type TypeAliasDeclaration,
} from "typescript/ast";
import { type Project, type Type, SymbolFlags } from "typescript/async";
import { SEVERITY } from "./constants.js";
import { NativeTypeComparison } from "./NativeTypeComparison.js";
import { matchesPattern } from "./patternMatcher.js";
import type { IDuplicateTypeResult, ITypeLocation } from "./types.js";

type TypeDeclaration = InterfaceDeclaration | TypeAliasDeclaration;
type IsNodeOfType<T extends Node> = (node: Node) => node is T;

interface ICandidate {
  declaration: TypeDeclaration;
  type: Type;
  location: ITypeLocation;
}

function getLocation(declaration: TypeDeclaration, tsConfigDir: string): ITypeLocation {
  const source = declaration.getSourceFile();
  const { line, character } = source.getLineAndCharacterOfPosition(declaration.name.getStart(source));
  return {
    filePath: path.relative(tsConfigDir, source.fileName),
    typeName: declaration.name.text,
    line: line + 1,
    character: character + 1,
    endCharacter: character + 1 + declaration.name.getWidth(),
  };
}

async function getBucketKey({ declaration, type }: ICandidate): Promise<string> {
  const category = type.isObjectType() || type.isIntersectionType() ? "object" : String(type.flags);
  const [properties, calls, constructs] = await Promise.all([
    type.getProperties(),
    type.getCallSignatures(),
    type.getConstructSignatures(),
  ]);
  return JSON.stringify([
    declaration.typeParameters?.length ?? 0,
    category,
    properties.map(({ name }) => name).sort(),
    calls.length,
    constructs.length,
  ]);
}

function descendants<T extends Node>(root: Node, predicate: IsNodeOfType<T>): T[] {
  const nodes: T[] = [];
  const visit = (node: Node): void => {
    if (predicate(node)) nodes.push(node);
    node.forEachChild(visit);
  };
  root.forEachChild(visit);
  return nodes;
}

async function referencesDefinition(
  project: Project,
  declaration: TypeDeclaration,
  target: TypeDeclaration,
  visited = new Set<TypeDeclaration>(),
): Promise<boolean> {
  if (visited.has(declaration)) return false;
  visited.add(declaration);
  const references: Node[] = descendants(declaration, isTypeReferenceNode).map(({ typeName }) => typeName);
  if (isInterfaceDeclaration(declaration)) {
    references.push(
      ...(declaration.heritageClauses ?? []).flatMap((clause) =>
        clause.types.filter(isExpressionWithTypeArguments).map(({ expression }) => expression),
      ),
    );
  }
  for (const symbol of await project.checker.getSymbolAtLocation(references)) {
    if (!symbol) continue;
    const original = symbol.flags & SymbolFlags.Alias ? await project.checker.getAliasedSymbol(symbol) : symbol;
    for (const handle of original.declarations) {
      const source = await handle.resolve();
      if (source === target) return true;
      if (
        source &&
        (isTypeAliasDeclaration(source) || isInterfaceDeclaration(source)) &&
        (await referencesDefinition(project, source, target, visited))
      )
        return true;
    }
  }
  return false;
}

function ownsDefinition(declaration: TypeDeclaration, node: Node): boolean {
  return (
    node.getSourceFile() === declaration.getSourceFile() &&
    node.getStart() >= declaration.getStart() &&
    node.end <= declaration.end
  );
}

async function hasOwnResolvedDefinition(
  project: Project,
  declaration: TypeDeclaration,
  type: Type,
  visited = new Set<number>(),
): Promise<boolean> {
  if (type.isTypeParameter() || visited.has(type.id)) return false;
  visited.add(type.id);
  const [symbol, properties, calls, constructs] = await Promise.all([
    type.getSymbol(),
    type.getProperties(),
    type.getCallSignatures(),
    type.getConstructSignatures(),
  ]);
  const handles = [
    ...(symbol?.declarations ?? []),
    ...properties.flatMap((property) => property.declarations),
    ...[...calls, ...constructs].flatMap(({ declaration }) => (declaration ? [declaration] : [])),
  ];
  for (const handle of handles) {
    const definition = await handle.resolve();
    if (definition && ownsDefinition(declaration, definition)) return true;
  }
  if (type.isUnionType()) {
    const resolved = new Set((await type.getTypes()).map(({ id }) => id));
    for (const union of await project.checker.getTypeAtLocation(descendants(declaration, isUnionTypeNode))) {
      if (!union.isUnionType()) continue;
      const authored = await union.getTypes();
      if (authored.length === resolved.size && authored.every(({ id }) => resolved.has(id))) return true;
    }
  }

  const nested = (await type.getAliasTypeArguments()).filter((part) => !part.isUnionType());
  const intersection = type.isIntersectionType() ? await type.getTypes() : [];
  for (const part of [...intersection, ...nested]) {
    if (await hasOwnResolvedDefinition(project, declaration, part, visited)) return true;
  }
  return false;
}

async function isDerived(project: Project, { declaration, type }: ICandidate): Promise<boolean> {
  if (isInterfaceDeclaration(declaration))
    return !declaration.members.length && Boolean(declaration.heritageClauses?.length);
  let node = declaration.type;
  while (isParenthesizedTypeNode(node)) node = node.type;
  if (isTypeOperatorNode(node)) {
    const operand = node.type;
    if (isTupleTypeNode(operand) || isArrayTypeNode(operand) || isTypeLiteralNode(operand)) return false;
  }
  return (
    (isTypeReferenceNode(node) ||
      isIndexedAccessTypeNode(node) ||
      isTypeQueryNode(node) ||
      isTypeOperatorNode(node) ||
      isIntersectionTypeNode(node)) &&
    !(await hasOwnResolvedDefinition(project, declaration, type))
  );
}

async function isAliasOfDefinition(
  project: Project,
  candidate: ICandidate,
  definitions: ICandidate[],
): Promise<boolean> {
  const symbol = await candidate.type.getSymbol();
  for (const definition of definitions) {
    if (
      candidate.type.id === definition.type.id ||
      (symbol && symbol.id === (await definition.type.getSymbol())?.id) ||
      (await referencesDefinition(project, candidate.declaration, definition.declaration))
    )
      return true;
  }
  return false;
}

export async function analyzeNativeDuplicateTypes(
  project: Project,
  files: string[],
  tsConfigDir: string,
  ignoreTypes: string[],
  targetFilePath?: string,
): Promise<IDuplicateTypeResult[]> {
  const buckets = new Map<string, ICandidate[][]>();
  const derived = new Set<ICandidate>();
  for (const file of [...files].sort((left, right) => left.localeCompare(right))) {
    const source = await project.program.getSourceFile(file);
    if (!source) continue;
    const declarations = descendants(
      source,
      (node): node is TypeDeclaration => isInterfaceDeclaration(node) || isTypeAliasDeclaration(node),
    ).filter(({ name }) => !matchesPattern(name.text, ignoreTypes));
    const types = await project.checker.getTypeAtLocation(declarations.map(({ name }) => name));
    for (const [index, declaration] of declarations.entries()) {
      const candidate = { declaration, type: types[index]!, location: getLocation(declaration, tsConfigDir) };
      const key = await getBucketKey(candidate);
      const groups = buckets.get(key) ?? [];
      let matching = false;
      for (const group of groups) {
        const first = group[0]!;
        if (
          await new NativeTypeComparison(project.checker).compareDeclarations(
            first.type,
            candidate.type,
            first.declaration.typeParameters ?? [],
            declaration.typeParameters ?? [],
          )
        ) {
          group.push(candidate);
          matching = true;
          break;
        }
      }
      if (!matching) {
        groups.push([candidate]);
        buckets.set(key, groups);
      }
    }
  }

  const results: IDuplicateTypeResult[] = [];
  for (const groups of buckets.values()) {
    for (const group of groups) {
      if (group.length < 2) continue;
      for (const candidate of group) {
        if (await isDerived(project, candidate)) derived.add(candidate);
      }
      const definitions = group.filter((candidate) => !derived.has(candidate));
      const sources: ICandidate[] = [];
      for (const candidate of group) {
        if (!derived.has(candidate) || !(await isAliasOfDefinition(project, candidate, definitions))) {
          sources.push(candidate);
        }
      }
      for (const [index, candidate] of sources.entries()) {
        const source = candidate.declaration.getSourceFile().fileName;
        if (derived.has(candidate) || (targetFilePath ? targetFilePath !== source : index === 0)) continue;
        const original = sources.find(({ location }) => location.typeName !== candidate.location.typeName);
        if (original) results.push({ ...candidate.location, duplicateOf: original.location, severity: SEVERITY.ERROR });
      }
    }
  }
  return results;
}
