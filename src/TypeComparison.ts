import { ts } from "ts-morph";
import { compareDeferredTypes } from "./compareDeferredTypes.js";
import type { TypeDeclaration } from "./types.js";

type TypePair = readonly [ts.Type, ts.Type];
type RecursionIdentity = ts.Symbol | ts.Type;

/** Nested member expansions of one declaration pair after which the pair is assumed to match, as in TypeScript. */
const MAX_EXPANSION_DEPTH = 3;

/** Compare resolved structures, including modifiers deliberately ignored by assignability. */
export class TypeComparison {
  private readonly parameters = new Map<ts.Type, ts.Type>();
  private readonly active: TypePair[] = [];
  private readonly expanding: TypePair[] = [];

  constructor(private readonly checker: ts.TypeChecker) {}

  compareDeclarations(left: TypeDeclaration, right: TypeDeclaration): boolean {
    return (
      this.compareParameters(left.compilerNode.typeParameters ?? [], right.compilerNode.typeParameters ?? []) &&
      this.compare(left.getType().compilerType, right.getType().compilerType)
    );
  }

  private compareParameters(
    left: readonly ts.TypeParameterDeclaration[],
    right: readonly ts.TypeParameterDeclaration[],
  ): boolean {
    if (left.length !== right.length) {
      return false;
    }
    for (const [index, parameter] of left.entries()) {
      const other = right[index];
      if (!other) {
        return false;
      }
      this.parameters.set(this.checker.getTypeAtLocation(parameter.name), this.checker.getTypeAtLocation(other.name));
    }
    return left.every((parameter, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        parameter.modifiers?.map((modifier) => modifier.kind).join() ===
          other.modifiers?.map((modifier) => modifier.kind).join() &&
        this.compareOptional(this.getNodeType(parameter.constraint), this.getNodeType(other.constraint)) &&
        this.compareOptional(this.getNodeType(parameter.default), this.getNodeType(other.default))
      );
    });
  }

  private getNodeType(node: ts.Node | undefined): ts.Type | undefined {
    return node ? this.checker.getTypeAtLocation(node) : undefined;
  }

  private compareOptional(left: ts.Type | undefined, right: ts.Type | undefined): boolean {
    return left && right ? this.compare(left, right) : left === right;
  }

  private compare(left: ts.Type, right: ts.Type): boolean {
    if (left === right) {
      // Unresolved names become error-flavored any; those are not verified duplicates.
      return !(left.flags & ts.TypeFlags.Any) || this.checker.typeToString(left) === "any";
    }
    if (left.flags & ts.TypeFlags.TypeParameter || right.flags & ts.TypeFlags.TypeParameter) {
      return this.parameters.get(left) === right;
    }
    if (this.active.some(([a, b]) => a === left && b === right)) {
      return true;
    }
    this.active.push([left, right]);
    try {
      // Instantiations of one alias match when their arguments do; expanding them can recurse without end.
      if (
        left.aliasSymbol !== undefined &&
        left.aliasSymbol === right.aliasSymbol &&
        left.aliasTypeArguments !== undefined &&
        right.aliasTypeArguments !== undefined
      ) {
        return this.compareTypeLists(left.aliasTypeArguments, right.aliasTypeArguments);
      }
      if (left.isUnion() || right.isUnion()) {
        return left.isUnion() && right.isUnion() && this.compareUnions(left.types, right.types);
      }
      const deferred = compareDeferredTypes(left, right, this.checker, this.parameters, (a, b) => this.compare(a, b));
      if (deferred !== undefined) {
        return deferred;
      }
      const objectFlags = ts.TypeFlags.Object | ts.TypeFlags.Intersection;
      if (left.flags & objectFlags && right.flags & objectFlags) {
        return this.compareObjects(left, right);
      }
      return (
        left.isLiteral() &&
        right.isLiteral() &&
        left.flags === right.flags &&
        !(left.flags & ts.TypeFlags.EnumLiteral) &&
        this.checker.typeToString(left) === this.checker.typeToString(right)
      );
    } finally {
      this.active.pop();
    }
  }

  private compareUnions(left: readonly ts.Type[], right: readonly ts.Type[]): boolean {
    const remaining = [...right];
    for (const branch of left) {
      const index = remaining.findIndex((other) => this.compare(branch, other));
      if (index === -1) {
        return false;
      }
      remaining.splice(index, 1);
    }
    return remaining.length === 0;
  }

  private compareTypeLists(left: readonly ts.Type[], right: readonly ts.Type[]): boolean {
    return (
      left.length === right.length &&
      left.every((type, index) => {
        const other = right[index];
        return other !== undefined && this.compare(type, other);
      })
    );
  }

  private compareObjects(left: ts.Type, right: ts.Type): boolean {
    if (this.isReference(left) && this.isReference(right) && left.target === right.target) {
      return this.compareTypeLists(this.checker.getTypeArguments(left), this.checker.getTypeArguments(right));
    }
    if (this.isExpandingRecursively(left, right)) {
      return true;
    }
    this.expanding.push([left, right]);
    try {
      return this.compareMembers(left, right);
    } finally {
      this.expanding.pop();
    }
  }

  /**
   * Whether comparing the members of this pair would expand the same pair of declarations for the
   * MAX_EXPANSION_DEPTH-th nested time with new type arguments, which TypeScript's isDeeplyNestedType
   * also treats as a match. Instantiations nested in the type arguments of an enclosing pair are finite
   * and do not count.
   */
  private isExpandingRecursively(left: ts.Type, right: ts.Type): boolean {
    const leftIdentities = this.getRecursionIdentities(left);
    const rightIdentities = this.getRecursionIdentities(right);
    const expansions = this.expanding.filter(
      ([outerLeft, outerRight]) =>
        this.hasSameIdentities(this.getRecursionIdentities(outerLeft), leftIdentities) &&
        this.hasSameIdentities(this.getRecursionIdentities(outerRight), rightIdentities) &&
        !(this.isTypeArgumentOf(left, outerLeft) && this.isTypeArgumentOf(right, outerRight)),
    );
    return expansions.length >= MAX_EXPANSION_DEPTH;
  }

  /** The declarations a type is instantiated from: its alias, its symbol, or those of its intersected parts. */
  private getRecursionIdentities(type: ts.Type): Set<RecursionIdentity> {
    if (type.aliasSymbol) {
      return new Set([type.aliasSymbol]);
    }
    if (type.isIntersection()) {
      return new Set(type.types.flatMap((part) => [...this.getRecursionIdentities(part)]));
    }
    return new Set([type.getSymbol() ?? type]);
  }

  private hasSameIdentities(left: Set<RecursionIdentity>, right: Set<RecursionIdentity>): boolean {
    return left.size === right.size && [...left].every((identity) => right.has(identity));
  }

  private isTypeArgumentOf(type: ts.Type, outer: ts.Type, visited = new Set<ts.Type>()): boolean {
    if (visited.has(outer)) {
      return false;
    }
    visited.add(outer);
    const typeArguments = [
      ...(outer.aliasTypeArguments ?? []),
      ...(this.isReference(outer) ? this.checker.getTypeArguments(outer) : []),
      ...(outer.isUnionOrIntersection() ? outer.types : []),
    ];
    return typeArguments.some((argument) => argument === type || this.isTypeArgumentOf(type, argument, visited));
  }

  private compareMembers(left: ts.Type, right: ts.Type): boolean {
    if (
      this.parameters.size === 0 &&
      (!this.checker.isTypeAssignableTo(left, right) || !this.checker.isTypeAssignableTo(right, left))
    ) {
      return false;
    }
    const properties = left.getProperties();
    if (properties.length !== right.getProperties().length || !this.compareTuples(left, right)) {
      return false;
    }
    const leftReadonly = this.getReadonlyProperties(left);
    const rightReadonly = this.getReadonlyProperties(right);
    for (const property of properties) {
      const other = right.getProperty(property.getName());
      if (
        !other ||
        (property.flags & ts.SymbolFlags.Optional) !== (other.flags & ts.SymbolFlags.Optional) ||
        leftReadonly.has(property.getName()) !== rightReadonly.has(other.getName()) ||
        !this.compareSymbols(property, other)
      ) {
        return false;
      }
    }
    const indices = this.checker.getIndexInfosOfType(left);
    const otherIndices = this.checker.getIndexInfosOfType(right);
    return (
      indices.length === otherIndices.length &&
      indices.every((index) =>
        otherIndices.some(
          (other) =>
            index.isReadonly === other.isReadonly &&
            this.compare(index.keyType, other.keyType) &&
            this.compare(index.type, other.type),
        ),
      ) &&
      this.compareSignatures(left.getCallSignatures(), right.getCallSignatures()) &&
      this.compareSignatures(left.getConstructSignatures(), right.getConstructSignatures())
    );
  }

  private isReference(type: ts.Type): type is ts.TypeReference {
    return (
      Boolean(type.flags & ts.TypeFlags.Object) &&
      "objectFlags" in type &&
      typeof type.objectFlags === "number" &&
      Boolean(type.objectFlags & ts.ObjectFlags.Reference)
    );
  }

  private compareTuples(left: ts.Type, right: ts.Type): boolean {
    const leftNode = this.checker.typeToTypeNode(left, undefined, ts.NodeBuilderFlags.InTypeAlias);
    const rightNode = this.checker.typeToTypeNode(right, undefined, ts.NodeBuilderFlags.InTypeAlias);
    const isLeftReadonly =
      leftNode !== undefined && ts.isTypeOperatorNode(leftNode) && leftNode.operator === ts.SyntaxKind.ReadonlyKeyword;
    const isRightReadonly =
      rightNode !== undefined &&
      ts.isTypeOperatorNode(rightNode) &&
      rightNode.operator === ts.SyntaxKind.ReadonlyKeyword;
    if (isLeftReadonly !== isRightReadonly || this.checker.isTupleType(left) !== this.checker.isTupleType(right)) {
      return false;
    }
    const leftTuple = isLeftReadonly ? leftNode.type : leftNode;
    const rightTuple = isRightReadonly ? rightNode.type : rightNode;
    if (leftTuple && rightTuple && ts.isTupleTypeNode(leftTuple) && ts.isTupleTypeNode(rightTuple)) {
      return (
        leftTuple.elements.length === rightTuple.elements.length &&
        leftTuple.elements.every((element, index) => {
          const other = rightTuple.elements[index];
          const optional =
            ts.isOptionalTypeNode(element) || (ts.isNamedTupleMember(element) && element.questionToken !== undefined);
          const rest =
            ts.isRestTypeNode(element) || (ts.isNamedTupleMember(element) && element.dotDotDotToken !== undefined);
          return (
            other !== undefined &&
            optional ===
              (ts.isOptionalTypeNode(other) || (ts.isNamedTupleMember(other) && other.questionToken !== undefined)) &&
            rest === (ts.isRestTypeNode(other) || (ts.isNamedTupleMember(other) && other.dotDotDotToken !== undefined))
          );
        })
      );
    }
    return true;
  }

  private getReadonlyProperties(type: ts.Type, visited = new Set<ts.Type>()): Set<string> {
    const names = new Set<string>();
    if (visited.has(type)) {
      return names;
    }
    visited.add(type);
    const node = this.checker.typeToTypeNode(
      type,
      undefined,
      ts.NodeBuilderFlags.NoTruncation | ts.NodeBuilderFlags.InTypeAlias,
    );
    const members = node && ts.isTypeLiteralNode(node) ? node.members : [];
    for (const member of members) {
      if (
        ts.isPropertySignature(member) &&
        member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword) &&
        (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name) || ts.isNumericLiteral(member.name))
      ) {
        names.add(member.name.text);
      }
    }
    if (node && ts.isTypeLiteralNode(node)) {
      return names;
    }
    for (const property of type.getProperties()) {
      if (
        property
          .getDeclarations()
          ?.some(
            (declaration) =>
              (ts.isPropertySignature(declaration) || ts.isPropertyDeclaration(declaration)) &&
              declaration.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword),
          )
      ) {
        names.add(property.getName());
      }
    }
    for (const base of type.getBaseTypes() ?? []) {
      for (const name of this.getReadonlyProperties(base, visited)) {
        names.add(name);
      }
    }
    return names;
  }

  private compareSymbols(left: ts.Symbol, right: ts.Symbol): boolean {
    const declaration = left.valueDeclaration ?? left.getDeclarations()?.[0];
    const other = right.valueDeclaration ?? right.getDeclarations()?.[0];
    if (
      declaration &&
      ts.canHaveModifiers(declaration) &&
      ts
        .getModifiers(declaration)
        ?.some(
          (modifier) =>
            modifier.kind === ts.SyntaxKind.PrivateKeyword || modifier.kind === ts.SyntaxKind.ProtectedKeyword,
        )
    ) {
      return declaration === other;
    }
    return (
      declaration !== undefined &&
      other !== undefined &&
      this.compare(
        this.checker.getTypeOfSymbolAtLocation(left, declaration),
        this.checker.getTypeOfSymbolAtLocation(right, other),
      )
    );
  }

  private compareSignatures(left: readonly ts.Signature[], right: readonly ts.Signature[]): boolean {
    return (
      left.length === right.length &&
      left.every((signature, index) => {
        const other = right[index];
        if (!other) {
          return false;
        }
        const previous = new Map(this.parameters);
        try {
          if (
            !this.compareParameters(
              signature.getDeclaration()?.typeParameters ?? [],
              other.getDeclaration()?.typeParameters ?? [],
            )
          ) {
            return false;
          }
          const parameters = signature.getParameters();
          const otherParameters = other.getParameters();
          const predicate = this.checker.getTypePredicateOfSignature(signature);
          const otherPredicate = this.checker.getTypePredicateOfSignature(other);
          return (
            parameters.length === otherParameters.length &&
            parameters.every((parameter, position) => {
              const otherParameter = otherParameters[position];
              return otherParameter !== undefined && this.compareParameter(parameter, otherParameter);
            }) &&
            this.compareThisParameters(signature.thisParameter, other.thisParameter) &&
            predicate?.kind === otherPredicate?.kind &&
            predicate?.parameterIndex === otherPredicate?.parameterIndex &&
            this.compareOptional(predicate?.type, otherPredicate?.type) &&
            this.compare(this.checker.getReturnTypeOfSignature(signature), this.checker.getReturnTypeOfSignature(other))
          );
        } finally {
          this.parameters.clear();
          for (const [source, target] of previous) {
            this.parameters.set(source, target);
          }
        }
      })
    );
  }

  private compareThisParameters(left: ts.Symbol | undefined, right: ts.Symbol | undefined): boolean {
    return left && right ? this.compareSymbols(left, right) : left === right;
  }

  private compareParameter(left: ts.Symbol, right: ts.Symbol): boolean {
    const declaration = left.getDeclarations()?.[0];
    const other = right.getDeclarations()?.[0];
    return (
      declaration !== undefined &&
      other !== undefined &&
      ts.isParameter(declaration) &&
      ts.isParameter(other) &&
      Boolean(declaration.questionToken || declaration.initializer) ===
        Boolean(other.questionToken || other.initializer) &&
      Boolean(declaration.dotDotDotToken) === Boolean(other.dotDotDotToken) &&
      this.compareSymbols(left, right)
    );
  }
}
