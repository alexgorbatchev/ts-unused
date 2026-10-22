import { Node, Scope, type SourceFile, type Symbol, type ts, type Type, type TypeChecker } from "ts-morph";

interface IPublicApiWalker {
  checker: TypeChecker;
  projectFiles: Set<SourceFile>;
  declarations: Set<Node>;
  queue: Node[];
  visitedTypes: Set<ts.Type>;
}

function addDeclaration(walker: IPublicApiWalker, declaration: Node): void {
  if (walker.declarations.has(declaration) || !walker.projectFiles.has(declaration.getSourceFile())) {
    return;
  }
  walker.declarations.add(declaration);
  walker.queue.push(declaration);
}

function addSymbol(walker: IPublicApiWalker, symbol: Symbol | undefined): void {
  const target = symbol?.isAlias() ? (symbol.getAliasedSymbol() ?? symbol) : symbol;
  for (const declaration of target?.getDeclarations() ?? []) {
    addDeclaration(walker, declaration);
  }
}

/**
 * Follows an inferred type to the project declarations it is built from: alias and named types, their type
 * arguments, union and intersection members, and the members of anonymous object and function types declared
 * in the project. Members of named types are covered by walking their declarations instead.
 */
function visitType(walker: IPublicApiWalker, type: Type, location: Node): void {
  if (walker.visitedTypes.has(type.compilerType)) {
    return;
  }
  walker.visitedTypes.add(type.compilerType);

  addSymbol(walker, type.getAliasSymbol());
  for (const argument of type.getAliasTypeArguments()) {
    visitType(walker, argument, location);
  }

  for (const member of [...type.getUnionTypes(), ...type.getIntersectionTypes()]) {
    visitType(walker, member, location);
  }

  const symbol = type.getSymbol();
  addSymbol(walker, symbol);
  for (const argument of type.getTypeArguments()) {
    visitType(walker, argument, location);
  }

  const isProjectAnonymousType =
    type.isAnonymous() &&
    (symbol?.getDeclarations() ?? []).some((declaration) => walker.projectFiles.has(declaration.getSourceFile()));
  if (!isProjectAnonymousType) {
    return;
  }

  for (const property of type.getProperties()) {
    visitType(walker, walker.checker.getTypeOfSymbolAtLocation(property, location), location);
  }
  for (const signature of [...type.getCallSignatures(), ...type.getConstructSignatures()]) {
    for (const parameter of signature.getParameters()) {
      visitType(walker, walker.checker.getTypeOfSymbolAtLocation(parameter, location), location);
    }
    visitType(walker, signature.getReturnType(), location);
  }
}

/**
 * Whether a node is left out of the emitted declaration file: function bodies, initializers (the declared or
 * inferred type is emitted instead), private class members, overload implementations, and non-exported
 * namespace members.
 */
function isOmittedFromDeclarationEmit(node: Node): boolean {
  const parent = node.getParent();
  if (parent && (Node.isBodyable(parent) || Node.isBodied(parent)) && parent.getBody() === node) {
    return true;
  }
  if (parent && Node.isInitializerExpressionGetable(parent) && parent.getInitializer() === node) {
    return true;
  }
  if ((Node.isScoped(node) || Node.isScopeable(node)) && node.getScope() === Scope.Private) {
    return true;
  }
  if (Node.isPropertyNamed(node) && Node.isPrivateIdentifier(node.getNameNode())) {
    return true;
  }
  if (Node.isOverloadable(node) && node.isImplementation() && node.getOverloads().length > 0) {
    return true;
  }
  return parent !== undefined && Node.isModuleBlock(parent) && Node.isExportGetable(node) && !node.hasExportKeyword();
}

/** Walks the parts of a declaration that its emitted declaration file exposes, collecting referenced declarations. */
function walkSignature(walker: IPublicApiWalker, node: Node): void {
  if (isOmittedFromDeclarationEmit(node)) {
    return;
  }

  if (Node.isTypeReference(node)) {
    addSymbol(walker, node.getTypeName().getSymbol());
  } else if (Node.isExpressionWithTypeArguments(node)) {
    addSymbol(walker, node.getExpression().getSymbol());
  } else if (Node.isTypeQuery(node)) {
    addSymbol(walker, node.getExprName().getSymbol());
  } else if (Node.isImportTypeNode(node)) {
    visitType(walker, node.getType(), node);
  }

  if (Node.isReturnTyped(node) && !node.getReturnTypeNode()) {
    visitType(walker, node.getReturnType(), node);
  }
  const hasInferredType =
    (Node.isVariableDeclaration(node) || Node.isPropertyDeclaration(node) || Node.isParameterDeclaration(node)) &&
    !node.getTypeNode();
  if (hasInferredType) {
    visitType(walker, node.getType(), node);
  }

  node.forEachChild((child) => {
    walkSignature(walker, child);
  });
}

/**
 * Collects the declarations whose shape package consumers can see: the declarations exported from package entry
 * points plus every project declaration their emitted signatures reference, directly or through inferred types.
 * A type that is not exported by name but appears in a public signature (for example the parameter type of an
 * exported function) is part of the public API, because the declaration emit includes it and consumers read and
 * write its properties.
 */
export function collectPublicApiDeclarations(
  exportedDeclarations: Set<Node>,
  projectFiles: SourceFile[],
  checker: TypeChecker,
): Set<Node> {
  const walker: IPublicApiWalker = {
    checker,
    projectFiles: new Set(projectFiles),
    declarations: new Set(),
    queue: [],
    visitedTypes: new Set(),
  };

  for (const declaration of exportedDeclarations) {
    addDeclaration(walker, declaration);
  }

  for (const declaration of walker.queue) {
    if (Node.isSourceFile(declaration)) {
      continue;
    }
    if (Node.isExpression(declaration)) {
      visitType(walker, declaration.getType(), declaration);
      continue;
    }
    walkSignature(walker, declaration);
  }

  return walker.declarations;
}
