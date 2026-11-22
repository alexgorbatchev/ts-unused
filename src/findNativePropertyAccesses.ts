import {
  isArrayLiteralExpression,
  isBinaryExpression,
  isBindingElement,
  isCallExpression,
  isClassLikeDeclaration,
  isComputedPropertyName,
  isElementAccessExpression,
  isForOfStatement,
  isGetAccessorDeclaration,
  isIdentifier,
  isIndexedAccessTypeNode,
  isInterfaceDeclaration,
  isJsxAttribute,
  isJsxAttributes,
  isJsxNamespacedName,
  isLiteralTypeNode,
  isMappedTypeNode,
  isMethodDeclaration,
  isNoSubstitutionTemplateLiteral,
  isNumericLiteral,
  isObjectBindingPattern,
  isObjectLiteralExpression,
  isPrivateIdentifier,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isPropertyDeclaration,
  isPropertySignatureDeclaration,
  isQualifiedName,
  isSetAccessorDeclaration,
  isShorthandPropertyAssignment,
  isStringLiteral,
  isTypeQueryNode,
  SyntaxKind,
  type Expression,
  type Node,
} from "typescript/ast";
import {
  CheckFlags,
  IndexKind,
  ObjectFlags,
  type NodeHandle,
  type Project,
  type Symbol,
  SymbolFlags,
  type Type,
  TypeFlags,
} from "typescript/async";
import { declarationLocation } from "./findNativeUsedImports.js";
import { getRelevantProgramFileNames } from "./getRelevantProgramFileNames.js";
import { toComparablePath } from "./mapBuildOutputsToSources.js";

const reflectMethods = new Set(["get", "set", "has", "deleteProperty", "getOwnPropertyDescriptor", "defineProperty"]);
const NULLISH_OR_EMPTY_FLAGS = TypeFlags.Undefined | TypeFlags.Null | TypeFlags.Void | TypeFlags.Never;
const CONTEXTUAL_BATCH_SIZE = 32;

export type NativePropertyAccesses = Map<string, Set<string>>;

type ReflectAccess = readonly [Node, Node];
type MappedDeclarations = Map<number, Promise<readonly NodeHandle[]>>;
type KeyRemappedCache = Map<number, Promise<boolean>>;

interface IKeyAccess {
  receiver: Node;
  key: Node;
  computed: boolean;
}

interface IContextualAccessGroup {
  expression: Expression;
  names: Node[];
}

interface IRecordContext {
  project: Project;
  accesses: NativePropertyAccesses;
  mappedDeclarations: MappedDeclarations;
  keyRemappedCache: KeyRemappedCache;
  relevantPaths: ReadonlySet<string>;
}

export function handleLocation(handle: NodeHandle): string {
  return `handle:${handle.path}:${handle.index}`;
}

async function getIterableElement(project: Project, type: Type): Promise<Type | undefined> {
  const checker = project.checker;
  const element = await checker.getIndexTypeOfType(type, IndexKind.Number);
  if (element) return element;
  const iterator = (await type.getProperties()).find(({ name }) => /^__@(?:asyncIterator|iterator)@/.test(name));
  if (!iterator) return undefined;
  const [signature] = await (await checker.getTypeOfSymbol(iterator)).getCallSignatures();
  if (!signature) return undefined;
  const next = await checker.getPropertyOfType(await signature.getReturnType(), "next");
  if (!next) return undefined;
  const [read] = await (await checker.getTypeOfSymbol(next)).getCallSignatures();
  if (!read) return undefined;
  const result = await checker.getAwaitedType(await read.getReturnType());
  const branches = result?.isUnionType() ? await result.getTypes() : result ? [result] : [];
  for (const branch of branches) {
    const done = await checker.getPropertyOfType(branch, "done");
    if (done && (await checker.typeToString(await checker.getTypeOfSymbol(done))) === "true") continue;
    const value = await checker.getPropertyOfType(branch, "value");
    if (value) return checker.getTypeOfSymbol(value);
  }
  return undefined;
}

async function getAssignmentType(project: Project, expression: Expression): Promise<Type | undefined> {
  const parent = expression.parent;
  if (
    isBinaryExpression(parent) &&
    parent.left === expression &&
    parent.operatorToken.kind === SyntaxKind.EqualsToken
  ) {
    return project.checker.getTypeAtLocation(parent.right);
  }
  if (isForOfStatement(parent) && parent.initializer === expression) {
    return getIterableElement(project, await project.checker.getTypeAtLocation(parent.expression));
  }
  if (isPropertyAssignment(parent) && parent.initializer === expression && isObjectLiteralExpression(parent.parent)) {
    const owner = await getAssignmentType(project, parent.parent);
    if (!owner) return undefined;
    const [property] = await getKeySymbols(project, owner, parent.name, false);
    return property && project.checker.getTypeOfSymbolAtLocation(property, parent);
  }
  if (isArrayLiteralExpression(parent)) {
    const owner = await getAssignmentType(project, parent);
    if (!owner) return undefined;
    const item = await project.checker.getPropertyOfType(
      owner,
      String(parent.elements.findIndex((node) => node === expression)),
    );
    return item ? project.checker.getTypeOfSymbol(item) : getIterableElement(project, owner);
  }
  return undefined;
}

function literalKey(node: Node): string | undefined {
  return isStringLiteral(node) || isNoSubstitutionTemplateLiteral(node) || isNumericLiteral(node)
    ? node.text
    : undefined;
}

function declaredName(node: Node): string | undefined {
  if (isIdentifier(node) || isPrivateIdentifier(node)) return node.text;
  if (isJsxNamespacedName(node)) return `${node.namespace.text}:${node.name.text}`;
  return literalKey(node);
}

export async function getKeySymbols(project: Project, type: Type, key: Node, computed: boolean): Promise<Symbol[]> {
  const checker = project.checker;
  const name = computed ? literalKey(key) : declaredName(key);
  if (name !== undefined) {
    const property = await checker.getPropertyOfType(type, name);
    return property ? [property] : [];
  }
  const keyType = await checker.getTypeAtLocation(isComputedPropertyName(key) ? key.expression : key);
  const types = keyType.isUnionType() ? await keyType.getTypes() : [keyType];
  const symbols: Symbol[] = [];
  for (const part of types) {
    if (part.isStringLiteralType() || part.isNumberLiteralType()) {
      const symbol = await checker.getPropertyOfType(type, String(part.value));
      if (symbol) symbols.push(symbol);
    } else if (part.flags & TypeFlags.UniqueESSymbol) {
      const keySymbol = await part.getSymbol();
      if (!keySymbol) continue;
      for (const member of await checker.getPropertiesOfType(type)) {
        const declarations = await Promise.all(member.declarations.map((handle) => handle.resolve()));
        const computedNames = declarations.flatMap((declaration) =>
          declaration &&
          (isPropertySignatureDeclaration(declaration) || isPropertyDeclaration(declaration)) &&
          isComputedPropertyName(declaration.name)
            ? [declaration.name.expression]
            : [],
        );
        const keys = await checker.getSymbolAtLocation(computedNames);
        if (keys.some((symbol) => symbol?.id === keySymbol.id)) symbols.push(member);
      }
    }
  }
  return symbols;
}

function resolveReflectAccess(node: Node): ReflectAccess | undefined {
  if (!isCallExpression(node)) return undefined;
  const callee = node.expression;
  if (!isPropertyAccessExpression(callee) && !isElementAccessExpression(callee)) return undefined;
  if (!isIdentifier(callee.expression) || callee.expression.text !== "Reflect") return undefined;
  const method = isPropertyAccessExpression(callee) ? callee.name.text : literalKey(callee.argumentExpression);
  const [receiver, key] = node.arguments;
  if (!method || !reflectMethods.has(method) || !receiver || !key) return undefined;
  return isStringLiteral(key) || isNoSubstitutionTemplateLiteral(key) ? [receiver, key] : undefined;
}

function isInsideTypeQuery(node: Node): boolean {
  let current = node;
  while (isQualifiedName(current.parent)) {
    current = current.parent;
  }
  return isTypeQueryNode(current.parent);
}

function mayNameProperty(node: Node): boolean {
  const parent = node.parent;
  if (isPropertyAccessExpression(parent)) return parent.name === node;
  if (isQualifiedName(parent)) return parent.right === node && isInsideTypeQuery(parent);
  if (isElementAccessExpression(parent)) {
    return parent.argumentExpression === node && (isStringLiteral(node) || isNumericLiteral(node));
  }
  if (isBindingElement(parent)) {
    return (
      isObjectBindingPattern(parent.parent) &&
      (parent.propertyName ? parent.propertyName === node : parent.name === node)
    );
  }
  if (isLiteralTypeNode(parent)) {
    return isIndexedAccessTypeNode(parent.parent) && parent.parent.indexType === parent;
  }
  return false;
}

function getOwnerNodeForUse(use: Node): Node | undefined {
  const parent = use.parent;
  if (isPropertyAccessExpression(parent) && parent.name === use) return parent.expression;
  if (isElementAccessExpression(parent) && parent.argumentExpression === use) return parent.expression;
  if (isBindingElement(parent) && isObjectBindingPattern(parent.parent)) return parent.parent;
  if (isLiteralTypeNode(parent) && isIndexedAccessTypeNode(parent.parent) && parent.parent.indexType === parent) {
    return parent.parent.objectType;
  }
  return undefined;
}

async function computeHasKeyRemappedType(type: Type, cache: KeyRemappedCache, visited: Set<number>): Promise<boolean> {
  if (visited.has(type.id)) return false;
  visited.add(type.id);
  if (type.isUnionType() || type.isIntersectionType()) {
    for (const part of await type.getTypes()) {
      if (await hasKeyRemappedType(part, cache, visited)) return true;
    }
    return false;
  }
  if (!type.isObjectType() || !(type.objectFlags & ObjectFlags.Mapped)) return false;
  const alias = await type.getAliasSymbol();
  if (alias?.name === "Record") return false;
  const symbol = await type.getSymbol();
  for (const handle of symbol?.declarations ?? []) {
    if (handle.kind !== SyntaxKind.MappedType) continue;
    const declaration = await handle.resolve();
    if (declaration && isMappedTypeNode(declaration) && declaration.nameType !== undefined) {
      return true;
    }
  }
  return false;
}

function hasKeyRemappedType(type: Type, cache: KeyRemappedCache, visited = new Set<number>()): Promise<boolean> {
  const cached = cache.get(type.id);
  if (cached) return cached;
  const result = computeHasKeyRemappedType(type, cache, visited);
  cache.set(type.id, result);
  return result;
}

function isPropertyNameToken(node: Node): boolean {
  if (isIdentifier(node)) {
    return !(isElementAccessExpression(node.parent) && node.parent.argumentExpression === node);
  }
  return (
    isPrivateIdentifier(node) ||
    isStringLiteral(node) ||
    isNumericLiteral(node) ||
    isNoSubstitutionTemplateLiteral(node)
  );
}

async function shouldLookupMappedDeclarations(context: IRecordContext, use: Node, ownerType?: Type): Promise<boolean> {
  if (!isPropertyNameToken(use)) return false;
  let type = ownerType;
  if (!type) {
    const ownerNode = getOwnerNodeForUse(use);
    if (!ownerNode) return true;
    type = await context.project.checker.getTypeAtLocation(ownerNode);
  }
  return hasKeyRemappedType(type, context.keyRemappedCache);
}

async function recordSymbols(
  context: IRecordContext,
  seenSymbolsInFile: Set<number>,
  symbols: readonly Symbol[],
  use: Node,
  ownerType?: Type,
): Promise<void> {
  const { project, accesses, mappedDeclarations, relevantPaths } = context;
  const checker = project.checker;
  const file = use.getSourceFile().fileName;
  for (const symbol of symbols) {
    if (!(symbol.flags & SymbolFlags.Property)) continue;
    if (seenSymbolsInFile.has(symbol.id)) continue;
    seenSymbolsInFile.add(symbol.id);
    const target = symbol.checkFlags & CheckFlags.Instantiated ? await checker.getTargetSymbol(symbol) : symbol;
    const declarations: NodeHandle[] = [...target.declarations];
    if (symbol.checkFlags & CheckFlags.Mapped && declarations.length === 0) {
      let originals = mappedDeclarations.get(symbol.id);
      if (!originals) {
        originals = (async () => {
          if (!(await shouldLookupMappedDeclarations(context, use, ownerType))) return [];
          const references = await project.languageService.getReferencedSymbolsForNode(use, use.getStart());
          return references.map(({ definition }) => definition);
        })();
        mappedDeclarations.set(symbol.id, originals);
      }
      declarations.push(...(await originals));
    }
    for (const handle of declarations) {
      if (handle.kind !== SyntaxKind.PropertySignature && handle.kind !== SyntaxKind.PropertyDeclaration) continue;
      if (!relevantPaths.has(toComparablePath(handle.path))) {
        const key = handleLocation(handle);
        const files = accesses.get(key) ?? new Set<string>();
        files.add(file);
        accesses.set(key, files);
        continue;
      }
      const declaration = await handle.resolve();
      if (!declaration || (!isPropertySignatureDeclaration(declaration) && !isPropertyDeclaration(declaration)))
        continue;
      const key = declarationLocation(declaration.getSourceFile().fileName, declaration.getStart());
      const files = accesses.get(key) ?? new Set<string>();
      if (files.has(file)) continue;
      files.add(file);
      accesses.set(key, files);
      const owner = declaration.parent;
      if (!isInterfaceDeclaration(owner) && !isClassLikeDeclaration(owner)) continue;
      for (const clause of owner.heritageClauses ?? []) {
        const baseTypes = await checker.getTypeAtLocation(clause.types);
        for (const base of baseTypes) {
          const property = await checker.getPropertyOfType(base, target.name);
          if (property) {
            await recordSymbols(context, seenSymbolsInFile, [property], use, base);
          }
        }
      }
    }
  }
}

async function recordContextualGroup(
  context: IRecordContext,
  seenSymbolsInFile: Set<number>,
  { expression, names }: IContextualAccessGroup,
): Promise<void> {
  const { project } = context;
  const contextual =
    (await project.checker.getContextualType(expression)) ??
    (isObjectLiteralExpression(expression) ? await getAssignmentType(project, expression) : undefined);
  if (!contextual) return;
  const apparent = await contextual.getApparentType();
  const rawBranches = apparent.isUnionType() ? await apparent.getTypes() : [apparent];
  const branches = rawBranches.filter((branch) => !(branch.flags & NULLISH_OR_EMPTY_FLAGS));
  if (branches.length === 0) return;

  let activeBranches = branches;
  let hasResolvedCompatibility = false;

  const resolveCompatibleBranches = async (): Promise<Type[]> => {
    if (hasResolvedCompatibility) return activeBranches;
    hasResolvedCompatibility = true;
    const actual = await project.checker.getTypeAtLocation(expression);
    const compatibility = await Promise.all(
      branches.map((branch) => project.checker.isTypeAssignableTo(actual, branch)),
    );
    const compatible = branches.filter((_, index) => compatibility[index]);
    if (compatible.length) activeBranches = compatible;
    return activeBranches;
  };

  for (const name of names) {
    const targets = await Promise.all(
      activeBranches.map(async (branch) => ({ branch, properties: await getKeySymbols(project, branch, name, false) })),
    );
    const roots = new Set(targets.flatMap(({ properties }) => properties.map((property) => property.id)));
    if (!roots.size) continue;
    let selection = targets;
    if (
      !hasResolvedCompatibility &&
      activeBranches.length > 1 &&
      (roots.size > 1 || targets.some(({ properties }) => !properties.length))
    ) {
      const compatible = new Set(await resolveCompatibleBranches());
      selection = targets.filter(({ branch }) => compatible.has(branch));
    }
    await recordSymbols(
      context,
      seenSymbolsInFile,
      selection.flatMap(({ properties }) => properties),
      name,
      apparent,
    );
  }
}

export async function findNativePropertyAccesses(project: Project): Promise<NativePropertyAccesses> {
  const accesses: NativePropertyAccesses = new Map();
  const mappedDeclarations: MappedDeclarations = new Map();
  const keyRemappedCache: KeyRemappedCache = new Map();
  const checker = project.checker;
  const relevantFiles = await getRelevantProgramFileNames(project);
  const relevantPaths = new Set(relevantFiles.map(toComparablePath));
  const recordContext: IRecordContext = {
    project,
    accesses,
    mappedDeclarations,
    keyRemappedCache,
    relevantPaths,
  };

  for (const fileName of relevantFiles) {
    const source = await project.program.getSourceFile(fileName);
    if (!source) continue;
    const tokens: Node[] = [];
    const keys: IKeyAccess[] = [];
    const contexts: IContextualAccessGroup[] = [];
    const seenSymbolsInFile = new Set<number>();

    const visit = (node: Node): void => {
      const parent = node.parent;
      if (
        (isIdentifier(node) || isPrivateIdentifier(node) || isStringLiteral(node) || isNumericLiteral(node)) &&
        mayNameProperty(node)
      ) {
        tokens.push(node);
      }
      if (isBindingElement(node) && isObjectBindingPattern(parent)) {
        const key = node.propertyName ?? node.name;
        if (key && (isIdentifier(key) || node.propertyName)) keys.push({ receiver: parent, key, computed: false });
      } else if (isElementAccessExpression(node)) {
        keys.push({ receiver: node.expression, key: node.argumentExpression, computed: true });
      } else if (isIndexedAccessTypeNode(node)) {
        const key = isLiteralTypeNode(node.indexType) ? node.indexType.literal : node.indexType;
        keys.push({ receiver: node.objectType, key, computed: true });
      } else if (isJsxAttributes(node)) {
        const names: Node[] = [];
        for (const property of node.properties) {
          if (isJsxAttribute(property)) names.push(property.name);
        }
        if (names.length) contexts.push({ expression: node, names });
      } else if (isObjectLiteralExpression(node)) {
        const names: Node[] = [];
        for (const property of node.properties) {
          if (
            isPropertyAssignment(property) ||
            isShorthandPropertyAssignment(property) ||
            isMethodDeclaration(property) ||
            isGetAccessorDeclaration(property) ||
            isSetAccessorDeclaration(property)
          ) {
            names.push(property.name);
          }
        }
        if (names.length) contexts.push({ expression: node, names });
      }
      const reflect = resolveReflectAccess(node);
      if (reflect) keys.push({ receiver: reflect[0], key: reflect[1], computed: true });
      node.forEachChild(visit);
    };
    source.forEachChild(visit);

    if (tokens.length) {
      const symbols = await checker.getSymbolAtLocation(tokens);
      await Promise.all(
        tokens.map((use, index) => {
          const symbol = symbols[index];
          return symbol && recordSymbols(recordContext, seenSymbolsInFile, [symbol], use);
        }),
      );
    }
    if (keys.length) {
      const receivers = await checker.getTypeAtLocation(keys.map(({ receiver }) => receiver));
      await Promise.all(
        keys.map(async ({ key, computed }, index) => {
          const type = receivers[index];
          if (type) {
            await recordSymbols(
              recordContext,
              seenSymbolsInFile,
              await getKeySymbols(project, type, key, computed),
              key,
              type,
            );
          }
        }),
      );
    }
    for (let index = 0; index < contexts.length; index += CONTEXTUAL_BATCH_SIZE) {
      const batch = contexts.slice(index, index + CONTEXTUAL_BATCH_SIZE);
      await Promise.all(batch.map((group) => recordContextualGroup(recordContext, seenSymbolsInFile, group)));
    }
  }
  return accesses;
}
