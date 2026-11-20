import {
  isConditionalTypeNode,
  isInferTypeNode,
  isMappedTypeNode,
  isParameterDeclaration,
  isTypeAliasDeclaration,
  SyntaxKind,
  type Node,
  type TypeParameterDeclaration,
} from "typescript/ast";
import { type Checker, type Signature, type Symbol, SymbolFlags, type Type, TypeFlags } from "typescript/async";

type TypePair = readonly [Type, Type];
const maximumExpansionDepth = 3;

export class NativeTypeComparison {
  private readonly parameters = new Map<number, number>();
  private readonly parameterSymbols = new Map<number, number>();
  private readonly active: TypePair[] = [];
  private readonly expanding: TypePair[] = [];

  constructor(private readonly checker: Checker) {}

  async compareDeclarations(
    left: Type,
    right: Type,
    leftParameters: readonly TypeParameterDeclaration[],
    rightParameters: readonly TypeParameterDeclaration[],
  ): Promise<boolean> {
    return (await this.compareParameters(leftParameters, rightParameters)) && this.compare(left, right);
  }

  private async compareParameters(
    left: readonly TypeParameterDeclaration[],
    right: readonly TypeParameterDeclaration[],
  ): Promise<boolean> {
    if (left.length !== right.length) return false;
    const [leftTypes, rightTypes] = await Promise.all([
      this.checker.getTypeAtLocation(left.map(({ name }) => name)),
      this.checker.getTypeAtLocation(right.map(({ name }) => name)),
    ]);
    await Promise.all(leftTypes.map((type, index) => this.bindParameter(type, rightTypes[index]!)));
    for (const [index, parameter] of left.entries()) {
      const other = right[index]!;
      if (
        parameter.modifiers?.map(({ kind }) => kind).join() !== other.modifiers?.map(({ kind }) => kind).join() ||
        !(await this.compareNodes(parameter.constraint, other.constraint)) ||
        !(await this.compareNodes(parameter.defaultType, other.defaultType))
      )
        return false;
    }
    return true;
  }

  private async compareNodes(left: Node | undefined, right: Node | undefined): Promise<boolean> {
    if (!left || !right) return left === right;
    const [first, second] = await this.checker.getTypeAtLocation([left, right]);
    return this.compare(first!, second!);
  }

  private async compareOptional(left: Type | undefined, right: Type | undefined): Promise<boolean> {
    return left && right ? this.compare(left, right) : left === right;
  }

  private async bindParameter(left: Type, right: Type): Promise<void> {
    this.parameters.set(left.id, right.id);
    const [first, second] = await Promise.all([left.getSymbol(), right.getSymbol()]);
    if (first && second) this.parameterSymbols.set(first.id, second.id);
  }

  private async compareParameter(left: Type, right: Type): Promise<boolean> {
    if (!left.isTypeParameter() || !right.isTypeParameter()) return false;
    if (this.parameters.get(left.id) === right.id) return true;
    const [first, second] = await Promise.all([left.getSymbol(), right.getSymbol()]);
    return !!first && !!second && this.parameterSymbols.get(first.id) === second.id;
  }

  private async compare(left: Type, right: Type): Promise<boolean> {
    if (left.id === right.id) return !left.isErrorType();
    if (left.isTypeParameter() || right.isTypeParameter()) return this.compareParameter(left, right);
    if (this.active.some(([a, b]) => a.id === left.id && b.id === right.id)) return true;
    this.active.push([left, right]);
    try {
      const [leftAlias, rightAlias] = await Promise.all([left.getAliasSymbol(), right.getAliasSymbol()]);
      if (leftAlias && leftAlias.id === rightAlias?.id) {
        const [first, second] = await Promise.all([left.getAliasTypeArguments(), right.getAliasTypeArguments()]);
        if (first.length || second.length) return await this.compareTypeLists(first, second);
      }
      if (left.isUnionType() || right.isUnionType()) {
        return (
          left.isUnionType() &&
          right.isUnionType() &&
          (await this.compareUnions(await left.getTypes(), await right.getTypes()))
        );
      }
      const deferred = await this.compareDeferred(left, right);
      if (deferred !== undefined) return deferred;
      if ((left.isObjectType() || left.isIntersectionType()) && (right.isObjectType() || right.isIntersectionType())) {
        return await this.compareObjects(left, right);
      }
      return (
        left.isLiteralType() &&
        right.isLiteralType() &&
        left.flags === right.flags &&
        !(left.flags & TypeFlags.EnumLiteral) &&
        left.value === right.value
      );
    } finally {
      this.active.pop();
    }
  }

  private async compareTypeLists(left: readonly Type[], right: readonly Type[]): Promise<boolean> {
    if (left.length !== right.length) return false;
    for (const [index, type] of left.entries()) {
      if (!(await this.compare(type, right[index]!))) return false;
    }
    return true;
  }

  private async compareUnions(left: readonly Type[], right: readonly Type[]): Promise<boolean> {
    if (left.length !== right.length) return false;
    const remaining = [...right];
    for (const type of left) {
      let match = -1;
      for (const [index, candidate] of remaining.entries()) {
        if (await this.compare(type, candidate)) {
          match = index;
          break;
        }
      }
      if (match < 0) return false;
      remaining.splice(match, 1);
    }
    return true;
  }

  /** Compare types that still depend on generic parameters. */
  private async compareDeferred(left: Type, right: Type): Promise<boolean | undefined> {
    if (left.isSubstitutionType() || right.isSubstitutionType()) {
      return (
        left.isSubstitutionType() &&
        right.isSubstitutionType() &&
        (await this.compare(await left.getBaseType(), await right.getBaseType())) &&
        this.compareOptional(await left.getConstraint(), await right.getConstraint())
      );
    }
    if (left.isIndexedAccessType() || right.isIndexedAccessType()) {
      return (
        left.isIndexedAccessType() &&
        right.isIndexedAccessType() &&
        (await this.compare(await left.getObjectType(), await right.getObjectType())) &&
        this.compare(await left.getIndexType(), await right.getIndexType())
      );
    }
    if (left.isIndexType() || right.isIndexType()) {
      return left.isIndexType() && right.isIndexType() && this.compare(await left.getTarget(), await right.getTarget());
    }
    if (left.isTemplateLiteralType() || right.isTemplateLiteralType()) {
      return (
        left.isTemplateLiteralType() &&
        right.isTemplateLiteralType() &&
        left.texts.join("\0") === right.texts.join("\0") &&
        this.compareTypeLists(await left.getTypes(), await right.getTypes())
      );
    }
    if (left.isStringMappingType() || right.isStringMappingType()) {
      return (
        left.isStringMappingType() &&
        right.isStringMappingType() &&
        (await left.getSymbol())?.id === (await right.getSymbol())?.id &&
        this.compare(await left.getTarget(), await right.getTarget())
      );
    }
    if (left.isConditionalType() || right.isConditionalType()) {
      if (!left.isConditionalType() || !right.isConditionalType()) return false;
      const [first, second] = await Promise.all([this.conditionalSyntax(left), this.conditionalSyntax(right)]);
      const previous = new Map(this.parameters);
      const previousSymbols = new Map(this.parameterSymbols);
      try {
        if (first.length !== second.length || !(await this.compareParameters(first, second))) return false;
        return (
          (await this.compare(await left.getCheckType(), await right.getCheckType())) &&
          (await this.compare(await left.getExtendsType(), await right.getExtendsType())) &&
          (await this.compare(await left.getTrueType(), await right.getTrueType())) &&
          (await this.compare(await left.getFalseType(), await right.getFalseType()))
        );
      } finally {
        this.restoreParameters(previous, previousSymbols);
      }
    }
    if (left.isMappedType() || right.isMappedType()) {
      if (!left.isMappedType() || !right.isMappedType()) {
        return undefined;
      }
      const [first, second] = await Promise.all([this.mappedSyntax(left), this.mappedSyntax(right)]);
      if (!first || !second) return undefined;
      if (
        first.readonlyToken?.kind !== second.readonlyToken?.kind ||
        first.questionToken?.kind !== second.questionToken?.kind
      ) {
        return false;
      }
      const previous = new Map(this.parameters);
      const previousSymbols = new Map(this.parameterSymbols);
      try {
        await this.bindParameter(await left.getTypeParameter(), await right.getTypeParameter());
        return (
          (await this.compare(await left.getConstraintType(), await right.getConstraintType())) &&
          (await this.compareOptional(await left.getNameType(), await right.getNameType())) &&
          (await this.compare(await left.getTemplateType(), await right.getTemplateType()))
        );
      } finally {
        this.restoreParameters(previous, previousSymbols);
      }
    }
    return undefined;
  }

  private async *declarations(type: Type): AsyncIterable<Node> {
    const types = await Promise.all([type.getSymbol(), type.getAliasSymbol()]);
    for (const symbol of types) {
      for (const handle of symbol?.declarations ?? []) {
        const declaration = await handle.resolve();
        if (declaration) yield declaration;
      }
    }
  }

  private async mappedSyntax(type: Type) {
    for await (const declaration of this.declarations(type)) {
      if (isMappedTypeNode(declaration)) return declaration;
      if (isTypeAliasDeclaration(declaration) && isMappedTypeNode(declaration.type)) return declaration.type;
    }
    return undefined;
  }

  private async conditionalSyntax(type: Type): Promise<TypeParameterDeclaration[]> {
    for await (const declaration of this.declarations(type)) {
      const node = isTypeAliasDeclaration(declaration) ? declaration.type : declaration;
      if (!isConditionalTypeNode(node)) continue;
      const parameters: TypeParameterDeclaration[] = [];
      const visit = (child: Node): void => {
        if (isInferTypeNode(child)) parameters.push(child.typeParameter);
        child.forEachChild(visit);
      };
      visit(node.extendsType);
      return parameters;
    }
    return [];
  }

  private restoreParameters(previous: Map<number, number>, previousSymbols: Map<number, number>): void {
    this.parameters.clear();
    this.parameterSymbols.clear();
    for (const entry of previous) this.parameters.set(...entry);
    for (const entry of previousSymbols) this.parameterSymbols.set(...entry);
  }

  private async compareObjects(left: Type, right: Type): Promise<boolean> {
    if (
      left.isTypeReference() &&
      right.isTypeReference() &&
      (await left.getTarget()).id === (await right.getTarget()).id
    ) {
      return this.compareTypeLists(
        await this.checker.getTypeArguments(left),
        await this.checker.getTypeArguments(right),
      );
    }
    if (await this.isExpandingRecursively(left, right)) return true;
    this.expanding.push([left, right]);
    try {
      return await this.compareMembers(left, right);
    } finally {
      this.expanding.pop();
    }
  }

  private async getIdentities(type: Type): Promise<Set<string>> {
    const alias = await type.getAliasSymbol();
    if (alias) return new Set([`s${alias.id}`]);
    if (type.isIntersectionType()) {
      const parts = await Promise.all((await type.getTypes()).map((part) => this.getIdentities(part)));
      return new Set(parts.flatMap((part) => [...part]));
    }
    const symbol = await type.getSymbol();
    return new Set([symbol ? `s${symbol.id}` : `t${type.id}`]);
  }

  private async isExpandingRecursively(left: Type, right: Type): Promise<boolean> {
    if (this.expanding.length < maximumExpansionDepth) return false;
    const [leftIds, rightIds] = await Promise.all([this.getIdentities(left), this.getIdentities(right)]);
    let count = 0;
    for (const [outerLeft, outerRight] of this.expanding) {
      const [a, b] = await Promise.all([this.getIdentities(outerLeft), this.getIdentities(outerRight)]);
      if (a.size !== leftIds.size || b.size !== rightIds.size) continue;
      if (![...a].every((id) => leftIds.has(id)) || ![...b].every((id) => rightIds.has(id))) continue;
      if ((await this.isArgumentOf(left, outerLeft)) && (await this.isArgumentOf(right, outerRight))) continue;
      if (++count >= maximumExpansionDepth) return true;
    }
    return false;
  }

  private async isArgumentOf(type: Type, outer: Type, visited = new Set<number>()): Promise<boolean> {
    if (visited.has(outer.id)) return false;
    visited.add(outer.id);
    const types = [...(await outer.getAliasTypeArguments())];
    if (outer.isTypeReference()) types.push(...(await this.checker.getTypeArguments(outer)));
    if (outer.isUnionType() || outer.isIntersectionType()) types.push(...(await outer.getTypes()));
    for (const argument of types) {
      if (argument.id === type.id || (await this.isArgumentOf(type, argument, visited))) return true;
    }
    return false;
  }

  private async compareMembers(left: Type, right: Type): Promise<boolean> {
    const checker = this.checker;
    if (
      !this.parameters.size &&
      (!(await checker.isTypeAssignableTo(left, right)) || !(await checker.isTypeAssignableTo(right, left)))
    ) {
      return false;
    }
    if (left.isTupleType() || right.isTupleType()) {
      if (!left.isTupleType() || !right.isTupleType()) return false;
      const [first, second] = await Promise.all([left.getTarget(), right.getTarget()]);
      if (first.readonly !== second.readonly || first.elementFlags.join() !== second.elementFlags.join()) return false;
    }
    const [properties, others] = await Promise.all([left.getProperties(), right.getProperties()]);
    if (properties.length !== others.length) return false;
    const byName = new Map(others.map((property) => [property.name, property]));
    for (const property of properties) {
      const other = byName.get(property.name);
      if (
        !other ||
        (property.flags & SymbolFlags.Optional) !== (other.flags & SymbolFlags.Optional) ||
        (await checker.isReadonlySymbol(property)) !== (await checker.isReadonlySymbol(other)) ||
        !(await this.compareSymbols(property, other))
      )
        return false;
    }
    const [indices, rightIndices] = await Promise.all([left.getIndexInfos(), right.getIndexInfos()]);
    if (indices.length !== rightIndices.length) return false;
    for (const index of indices) {
      let matches = false;
      for (const other of rightIndices) {
        if (
          index.isReadonly === other.isReadonly &&
          (await this.compare(index.keyType, other.keyType)) &&
          (await this.compare(index.valueType, other.valueType))
        ) {
          matches = true;
          break;
        }
      }
      if (!matches) return false;
    }
    return (
      (await this.compareSignatures(await left.getCallSignatures(), await right.getCallSignatures())) &&
      this.compareSignatures(await left.getConstructSignatures(), await right.getConstructSignatures())
    );
  }

  private async compareSymbols(left: Symbol, right: Symbol): Promise<boolean> {
    const first = await (left.valueDeclaration ?? left.declarations[0])?.resolve();
    const second = await (right.valueDeclaration ?? right.declarations[0])?.resolve();
    if (!first || !second) return false;
    if (
      "modifiers" in first &&
      Array.isArray(first.modifiers) &&
      first.modifiers.some(
        (modifier) => modifier.kind === SyntaxKind.PrivateKeyword || modifier.kind === SyntaxKind.ProtectedKeyword,
      )
    ) {
      return first === second;
    }
    return this.compare(
      await this.checker.getTypeOfSymbolAtLocation(left, first),
      await this.checker.getTypeOfSymbolAtLocation(right, second),
    );
  }

  private async compareSignatures(left: readonly Signature[], right: readonly Signature[]): Promise<boolean> {
    if (left.length !== right.length) return false;
    for (const [index, signature] of left.entries()) {
      const other = right[index]!;
      const previous = new Map(this.parameters);
      const previousSymbols = new Map(this.parameterSymbols);
      try {
        if (!(await this.compareSignature(signature, other))) return false;
      } finally {
        this.restoreParameters(previous, previousSymbols);
      }
    }
    return true;
  }

  private async compareSignature(left: Signature, right: Signature): Promise<boolean> {
    const [first, second] = await Promise.all([left.declaration?.resolve(), right.declaration?.resolve()]);
    const parameters = (node: Node | undefined): readonly TypeParameterDeclaration[] =>
      node && "typeParameters" in node && Array.isArray(node.typeParameters) ? node.typeParameters : [];
    if (!(await this.compareParameters(parameters(first), parameters(second)))) return false;
    const [leftParams, rightParams] = await Promise.all([left.getParameters(), right.getParameters()]);
    if (leftParams.length !== rightParams.length) return false;
    for (const [index, parameter] of leftParams.entries()) {
      const other = rightParams[index]!;
      const declaration = await parameter.declarations[0]?.resolve();
      const opposite = await other.declarations[0]?.resolve();
      if (
        !declaration ||
        !opposite ||
        !isParameterDeclaration(declaration) ||
        !isParameterDeclaration(opposite) ||
        Boolean(declaration.questionToken || declaration.initializer) !==
          Boolean(opposite.questionToken || opposite.initializer) ||
        Boolean(declaration.dotDotDotToken) !== Boolean(opposite.dotDotDotToken) ||
        !(await this.compareSymbols(parameter, other))
      )
        return false;
    }
    const [leftThis, rightThis] = await Promise.all([left.getThisParameter(), right.getThisParameter()]);
    if (leftThis && rightThis ? !(await this.compareSymbols(leftThis, rightThis)) : leftThis !== rightThis)
      return false;
    const [leftPredicate, rightPredicate] = await Promise.all([
      this.checker.getTypePredicateOfSignature(left),
      this.checker.getTypePredicateOfSignature(right),
    ]);
    const index = (predicate: typeof leftPredicate): number | undefined =>
      predicate && "parameterIndex" in predicate ? predicate.parameterIndex : undefined;
    return (
      leftPredicate?.kind === rightPredicate?.kind &&
      index(leftPredicate) === index(rightPredicate) &&
      (await this.compareOptional(leftPredicate?.type, rightPredicate?.type)) &&
      this.compare(await left.getReturnType(), await right.getReturnType())
    );
  }
}
