import { type Node as NativeNode } from "typescript/ast";
import { ObjectFlags, type Project, type Symbol, SymbolFlags, type Type } from "typescript/async";
import { Node, Scope, type SourceFile } from "ts-morph";
import { getNativeExports } from "./getNativeExports.js";

interface IPackageApi {
  publicDeclarations: Set<Node>;
  publicApiDeclarations: Set<Node>;
}

interface IPublicApiWalker {
  project: Project;
  files: Map<string, SourceFile>;
  declarations: Set<Node>;
  visitedTypes: Set<number>;
}

function addDeclaration(walker: IPublicApiWalker, declaration: Node): void {
  if (walker.files.has(declaration.getSourceFile().getFilePath())) walker.declarations.add(declaration);
}

async function addSymbol(walker: IPublicApiWalker, symbol: Symbol | undefined): Promise<void> {
  if (!symbol) return;
  const target = symbol.flags & SymbolFlags.Alias ? await walker.project.checker.getAliasedSymbol(symbol) : symbol;
  for (const handle of target.declarations) {
    const declaration = await handle.resolve();
    if (!declaration) continue;
    const source = walker.files.get(declaration.getSourceFile().fileName);
    if (!source) continue;
    const node = source.getDescendantAtStartWithWidth(declaration.getStart(), declaration.getWidth());
    if (node) addDeclaration(walker, node);
  }
}

async function visitType(walker: IPublicApiWalker, type: Type, location: NativeNode): Promise<void> {
  if (walker.visitedTypes.has(type.id)) return;
  walker.visitedTypes.add(type.id);
  const checker = walker.project.checker;
  const symbol = await type.getSymbol();
  await addSymbol(walker, symbol);
  await addSymbol(walker, await type.getAliasSymbol());

  const nested = [...(await type.getAliasTypeArguments())];
  if (type.isUnionType() || type.isIntersectionType()) nested.push(...(await type.getTypes()));
  if (type.isTypeReference()) nested.push(...(await checker.getTypeArguments(type)));
  if (type.isConditionalType()) {
    nested.push(
      ...(await Promise.all([type.getCheckType(), type.getExtendsType(), type.getTrueType(), type.getFalseType()])),
    );
  }
  const origins =
    type.isObjectType() && type.objectFlags & ObjectFlags.Anonymous
      ? await Promise.all((symbol?.declarations ?? []).map((declaration) => declaration.resolve()))
      : [];
  if (origins.some((declaration) => declaration && walker.files.has(declaration.getSourceFile().fileName))) {
    for (const property of await type.getProperties()) {
      nested.push(await checker.getTypeOfSymbolAtLocation(property, location));
    }
    for (const signature of [...(await type.getCallSignatures()), ...(await type.getConstructSignatures())]) {
      for (const parameter of await signature.getParameters()) {
        nested.push(await checker.getTypeOfSymbolAtLocation(parameter, location));
      }
      nested.push(await checker.getReturnTypeOfSignature(signature));
    }
  }
  for (const member of nested) await visitType(walker, member, location);
}

function omittedFromDeclaration(node: Node): boolean {
  const parent = node.getParent();
  if (parent && (Node.isBodyable(parent) || Node.isBodied(parent)) && parent.getBody() === node) return true;
  if (parent && Node.isInitializerExpressionGetable(parent) && parent.getInitializer() === node) return true;
  if ((Node.isScoped(node) || Node.isScopeable(node)) && node.getScope() === Scope.Private) return true;
  if (Node.isPropertyNamed(node) && Node.isPrivateIdentifier(node.getNameNode())) return true;
  if (Node.isOverloadable(node) && node.isImplementation() && node.getOverloads().length > 0) return true;
  return Boolean(parent && Node.isModuleBlock(parent) && Node.isExportGetable(node) && !node.hasExportKeyword());
}

async function getNativeNode(project: Project, syntax: Node): Promise<NativeNode | undefined> {
  const source = await project.program.getSourceFile(syntax.getSourceFile().getFilePath());
  if (!source) return undefined;
  const start = syntax.getStart();
  const end = syntax.getEnd();
  function find(node: NativeNode): NativeNode | undefined {
    if (node.getStart() > start || node.end < end) return undefined;
    if (node.getStart() === start && node.end === end) return node;
    let result: NativeNode | undefined;
    node.forEachChild((child) => {
      result ??= find(child);
    });
    return result;
  }
  return find(source);
}

async function walkSignature(walker: IPublicApiWalker, node: Node): Promise<void> {
  if (omittedFromDeclaration(node)) return;
  const project = walker.project;
  const checker = project.checker;
  const path = node.getSourceFile().getFilePath();
  const reference = Node.isTypeReference(node)
    ? node.getTypeName()
    : Node.isExpressionWithTypeArguments(node)
      ? node.getExpression()
      : Node.isTypeQuery(node)
        ? node.getExprName()
        : undefined;
  if (reference) {
    const position = Node.isQualifiedName(reference) ? reference.getRight().getStart() : reference.getStart();
    await addSymbol(walker, await checker.getSymbolAtPosition(path, position));
  }
  const hasInferredType =
    (Node.isVariableDeclaration(node) || Node.isPropertyDeclaration(node) || Node.isParameterDeclaration(node)) &&
    !node.getTypeNode();
  if (Node.isImportTypeNode(node) || hasInferredType) {
    const native = await getNativeNode(project, node);
    if (native) await visitType(walker, await checker.getTypeAtLocation(native), native);
  }
  if (Node.isReturnTyped(node) && !node.getReturnTypeNode()) {
    const native = await getNativeNode(project, node);
    if (native) {
      const signature = await checker.getSignatureFromDeclaration(native);
      await visitType(walker, await checker.getReturnTypeOfSignature(signature), native);
    }
  }
  const children: Node[] = [];
  node.forEachChild((child) => {
    children.push(child);
  });
  for (const child of children) await walkSignature(walker, child);
}

export async function collectNativePublicApiDeclarations(
  project: Project,
  entryPoints: SourceFile[],
  projectFiles: SourceFile[],
): Promise<IPackageApi> {
  const publicDeclarations = new Set<Node>();
  const modules = new Set(entryPoints);
  for (const module of modules) {
    const exports = await getNativeExports(project, module);
    for (const declarations of exports.values()) {
      for (const declaration of declarations) {
        publicDeclarations.add(declaration);
        if (Node.isSourceFile(declaration)) modules.add(declaration);
      }
    }
  }
  const walker: IPublicApiWalker = {
    project,
    files: new Map(projectFiles.map((source) => [source.getFilePath(), source])),
    declarations: new Set(),
    visitedTypes: new Set(),
  };
  for (const declaration of publicDeclarations) addDeclaration(walker, declaration);
  for (const declaration of walker.declarations) {
    if (Node.isSourceFile(declaration)) continue;
    if (Node.isExpression(declaration)) {
      const native = await getNativeNode(project, declaration);
      if (native) await visitType(walker, await project.checker.getTypeAtLocation(native), native);
    } else {
      await walkSignature(walker, declaration);
    }
  }
  return { publicDeclarations, publicApiDeclarations: walker.declarations };
}
