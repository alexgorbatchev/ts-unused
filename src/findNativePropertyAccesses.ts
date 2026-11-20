import {
  isArrayLiteralExpression,
  isBinaryExpression,
  isBindingElement,
  isClassLikeDeclaration,
  isComputedPropertyName,
  isElementAccessExpression,
  isForOfStatement,
  isIndexedAccessTypeNode,
  isIdentifier,
  isInterfaceDeclaration,
  isJsxAttribute,
  isJsxAttributes,
  isJsxNamespacedName,
  isNoSubstitutionTemplateLiteral,
  isNumericLiteral,
  isObjectBindingPattern,
  isPrivateIdentifier,
  isPropertyAccessExpression,
  isPropertyDeclaration,
  isPropertySignatureDeclaration,
  isQualifiedName,
  isLiteralTypeNode,
  isStringLiteral,
  isCallExpression,
  isObjectLiteralExpression,
  isPropertyAssignment,
  isShorthandPropertyAssignment,
  isMethodDeclaration,
  isGetAccessorDeclaration,
  isSetAccessorDeclaration,
  SyntaxKind,
  type Expression,
  type Node,
} from "typescript/ast";
import {
  CheckFlags,
  IndexKind,
  type NodeHandle,
  type Project,
  type Symbol,
  SymbolFlags,
  type Type,
  TypeFlags,
} from "typescript/async";
import { declarationLocation } from "./findNativeUsedImports.js";

const reflectMethods = new Set(["get", "set", "has", "deleteProperty", "getOwnPropertyDescriptor", "defineProperty"]);

export type NativePropertyAccesses = Map<string, Set<string>>;

type ReflectAccess = readonly [Node, Node];
type MappedDeclarations = Map<number, Promise<readonly NodeHandle[]>>;

interface IKeyAccess {
  receiver: Node;
  key: Node;
  computed: boolean;
}

interface IContextualAccess {
  expression: Expression;
  name: Node;
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

function mayNameProperty(node: Node): boolean {
  const parent = node.parent;
  if (isPropertyAccessExpression(parent)) return parent.name === node;
  if (isQualifiedName(parent)) return parent.right === node;
  if (isElementAccessExpression(parent)) return parent.argumentExpression === node;
  return isBindingElement(parent) || isLiteralTypeNode(parent);
}

async function recordSymbols(
  project: Project,
  accesses: NativePropertyAccesses,
  mappedDeclarations: MappedDeclarations,
  symbols: readonly Symbol[],
  use: Node,
): Promise<void> {
  const checker = project.checker;
  const file = use.getSourceFile().fileName;
  for (const symbol of symbols) {
    if (!(symbol.flags & SymbolFlags.Property)) continue;
    const target = symbol.checkFlags & CheckFlags.Instantiated ? await checker.getTargetSymbol(symbol) : symbol;
    const declarations: NodeHandle[] = [...target.declarations];
    if (symbol.checkFlags & CheckFlags.Mapped && declarations.length === 0) {
      let originals = mappedDeclarations.get(symbol.id);
      if (!originals) {
        originals = project.languageService
          .getReferencedSymbolsForNode(use, use.getStart())
          .then((references) => references.map(({ definition }) => definition));
        mappedDeclarations.set(symbol.id, originals);
      }
      declarations.push(...(await originals));
    }
    for (const handle of declarations) {
      if (handle.kind !== SyntaxKind.PropertySignature && handle.kind !== SyntaxKind.PropertyDeclaration) continue;
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
          if (property) await recordSymbols(project, accesses, mappedDeclarations, [property], use);
        }
      }
    }
  }
}

async function recordContextual(
  project: Project,
  accesses: NativePropertyAccesses,
  mappedDeclarations: MappedDeclarations,
  expression: Expression,
  name: Node,
): Promise<void> {
  const contextual =
    (await project.checker.getContextualType(expression)) ??
    (isObjectLiteralExpression(expression) ? await getAssignmentType(project, expression) : undefined);
  if (!contextual) return;
  const apparent = await contextual.getApparentType();
  const branches = apparent.isUnionType() ? await apparent.getTypes() : [apparent];
  const targets = await Promise.all(
    branches.map(async (branch) => ({ branch, properties: await getKeySymbols(project, branch, name, false) })),
  );
  const roots = new Set(targets.flatMap(({ properties }) => properties.map((property) => property.id)));
  if (!roots.size) return;
  let selection = targets;
  if (apparent.isUnionType() && (roots.size > 1 || targets.some(({ properties }) => !properties.length))) {
    const actual = await project.checker.getTypeAtLocation(expression);
    const compatibility = await Promise.all(
      targets.map(({ branch }) => project.checker.isTypeAssignableTo(actual, branch)),
    );
    const compatible = targets.filter((_, index) => compatibility[index]);
    if (compatible.length) selection = compatible;
  }
  await recordSymbols(
    project,
    accesses,
    mappedDeclarations,
    selection.flatMap(({ properties }) => properties),
    name,
  );
}

export async function findNativePropertyAccesses(project: Project): Promise<NativePropertyAccesses> {
  const accesses: NativePropertyAccesses = new Map();
  const mappedDeclarations: MappedDeclarations = new Map();
  const checker = project.checker;
  for (const fileName of await project.program.getSourceFileNames()) {
    const source = await project.program.getSourceFile(fileName);
    if (!source) continue;
    const tokens: Node[] = [];
    const keys: IKeyAccess[] = [];
    const contexts: IContextualAccess[] = [];
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
      } else if (isJsxAttribute(node) && isJsxAttributes(node.parent)) {
        contexts.push({ expression: node.parent, name: node.name });
      } else if (
        (isPropertyAssignment(node) ||
          isShorthandPropertyAssignment(node) ||
          isMethodDeclaration(node) ||
          isGetAccessorDeclaration(node) ||
          isSetAccessorDeclaration(node)) &&
        isObjectLiteralExpression(parent)
      ) {
        contexts.push({ expression: parent, name: node.name });
      }
      const reflect = resolveReflectAccess(node);
      if (reflect) keys.push({ receiver: reflect[0], key: reflect[1], computed: true });
      node.forEachChild(visit);
    };
    source.forEachChild(visit);

    const symbols = await checker.getSymbolAtLocation(tokens);
    await Promise.all(
      tokens.map((use, index) => {
        const symbol = symbols[index];
        return symbol && recordSymbols(project, accesses, mappedDeclarations, [symbol], use);
      }),
    );
    const receivers = await checker.getTypeAtLocation(keys.map(({ receiver }) => receiver));
    await Promise.all(
      keys.map(async ({ key, computed }, index) => {
        const type = receivers[index];
        if (type) {
          await recordSymbols(
            project,
            accesses,
            mappedDeclarations,
            await getKeySymbols(project, type, key, computed),
            key,
          );
        }
      }),
    );
    await Promise.all(
      contexts.map(({ expression, name }) => recordContextual(project, accesses, mappedDeclarations, expression, name)),
    );
  }
  return accesses;
}
