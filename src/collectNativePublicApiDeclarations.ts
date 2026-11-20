import {
  isFunctionLikeDeclaration,
  isSignatureDeclaration,
  isModuleBlock,
  isClassLikeDeclaration,
  isPrivateIdentifier,
  isTypeReferenceNode,
  isExpressionWithTypeArguments,
  isTypeQueryNode,
  isQualifiedName,
  isVariableDeclaration,
  isPropertyDeclaration,
  isParameterDeclaration,
  isImportTypeNode,
  isSourceFile,
  isExpression,
  SyntaxKind,
  type Node,
  type SourceFile,
  type ModifierLike,
} from "typescript/ast";
import { ObjectFlags, type Project, type Symbol, SymbolFlags, type Type } from "typescript/async";
import { getNativeExports } from "./getNativeExports.js";

interface IPackageApi {
  publicDeclarations: Set<Node>;
  publicApiDeclarations: Set<Node>;
}

interface IPublicApiWalker {
  project: Project;
  files: Set<string>;
  declarations: Set<Node>;
  visitedTypes: Set<number>;
}

function addDeclaration(walker: IPublicApiWalker, declaration: Node): void {
  if (walker.files.has(declaration.getSourceFile().fileName)) walker.declarations.add(declaration);
}

async function addSymbol(walker: IPublicApiWalker, symbol: Symbol | undefined): Promise<void> {
  if (!symbol) return;
  const target = symbol.flags & SymbolFlags.Alias ? await walker.project.checker.getAliasedSymbol(symbol) : symbol;
  for (const handle of target.declarations) {
    const declaration = await handle.resolve();
    if (!declaration) continue;
    addDeclaration(walker, declaration);
  }
}

async function visitType(walker: IPublicApiWalker, type: Type, location: Node): Promise<void> {
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
  const parent = node.parent;
  if (
    parent &&
    (("body" in parent && parent.body === node) || ("initializer" in parent && parent.initializer === node))
  ) {
    return true;
  }
  const modifiers = ("modifiers" in node ? node.modifiers : undefined) as readonly ModifierLike[] | undefined;
  if (modifiers?.some((modifier) => modifier.kind === SyntaxKind.PrivateKeyword)) return true;
  if ("name" in node && node.name && isPrivateIdentifier(node.name as Node)) return true;
  if (isFunctionLikeDeclaration(node) && node.body && parent) {
    const name = "name" in node ? node.name?.getText() : undefined;
    const siblings =
      isSourceFile(parent) || isModuleBlock(parent)
        ? parent.statements
        : isClassLikeDeclaration(parent)
          ? parent.members
          : [];
    if (
      siblings.some(
        (sibling) =>
          sibling.kind === node.kind &&
          isFunctionLikeDeclaration(sibling) &&
          !sibling.body &&
          ("name" in sibling ? sibling.name?.getText() : undefined) === name,
      )
    )
      return true;
  }
  return Boolean(
    parent && isModuleBlock(parent) && !modifiers?.some((modifier) => modifier.kind === SyntaxKind.ExportKeyword),
  );
}

async function walkSignature(walker: IPublicApiWalker, node: Node): Promise<void> {
  if (omittedFromDeclaration(node)) return;
  const project = walker.project;
  const checker = project.checker;
  const path = node.getSourceFile().fileName;
  const reference = isTypeReferenceNode(node)
    ? node.typeName
    : isExpressionWithTypeArguments(node)
      ? node.expression
      : isTypeQueryNode(node)
        ? node.exprName
        : undefined;
  if (reference) {
    const position = isQualifiedName(reference) ? reference.right.getStart() : reference.getStart();
    await addSymbol(walker, await checker.getSymbolAtPosition(path, position));
  }
  const hasInferredType =
    (isVariableDeclaration(node) || isPropertyDeclaration(node) || isParameterDeclaration(node)) && !node.type;
  if (isImportTypeNode(node) || hasInferredType) {
    await visitType(walker, await checker.getTypeAtLocation(node), node);
  }
  if (isSignatureDeclaration(node) && !node.type) {
    const signature = await checker.getSignatureFromDeclaration(node);
    await visitType(walker, await checker.getReturnTypeOfSignature(signature), node);
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
        if (isSourceFile(declaration)) modules.add(declaration);
      }
    }
  }
  const walker: IPublicApiWalker = {
    project,
    files: new Set(projectFiles.map((source) => source.fileName)),
    declarations: new Set(),
    visitedTypes: new Set(),
  };
  for (const declaration of publicDeclarations) addDeclaration(walker, declaration);
  for (const declaration of walker.declarations) {
    if (isSourceFile(declaration)) continue;
    if (isExpression(declaration)) {
      await visitType(walker, await project.checker.getTypeAtLocation(declaration), declaration);
    } else {
      await walkSignature(walker, declaration);
    }
  }
  return { publicDeclarations, publicApiDeclarations: walker.declarations };
}
