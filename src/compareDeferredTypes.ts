import { ts } from "ts-morph";

type CompareTypes = (left: ts.Type, right: ts.Type) => boolean;

function isConditional(type: ts.Type): type is ts.ConditionalType {
  return Boolean(type.flags & ts.TypeFlags.Conditional);
}

function isIndexedAccess(type: ts.Type): type is ts.IndexedAccessType {
  return Boolean(type.flags & ts.TypeFlags.IndexedAccess);
}

function isTemplate(type: ts.Type): type is ts.TemplateLiteralType {
  return Boolean(type.flags & ts.TypeFlags.TemplateLiteral);
}

function isStringMapping(type: ts.Type): type is ts.StringMappingType {
  return Boolean(type.flags & ts.TypeFlags.StringMapping);
}

function isSubstitution(type: ts.Type): type is ts.SubstitutionType {
  return Boolean(type.flags & ts.TypeFlags.Substitution);
}

function getMappedDeclaration(type: ts.Type): ts.MappedTypeNode | undefined {
  const declarations = [...(type.getSymbol()?.getDeclarations() ?? []), ...(type.aliasSymbol?.getDeclarations() ?? [])];
  for (const declaration of declarations) {
    if (ts.isMappedTypeNode(declaration)) {
      return declaration;
    }
    if (ts.isTypeAliasDeclaration(declaration) && ts.isMappedTypeNode(declaration.type)) {
      return declaration.type;
    }
  }
  return undefined;
}

/** Compare types whose structure still depends on generic parameters. */
export function compareDeferredTypes(
  left: ts.Type,
  right: ts.Type,
  checker: ts.TypeChecker,
  parameters: Map<ts.Type, ts.Type>,
  compare: CompareTypes,
): boolean | undefined {
  if (isSubstitution(left) || isSubstitution(right)) {
    return (
      isSubstitution(left) &&
      isSubstitution(right) &&
      compare(left.baseType, right.baseType) &&
      compare(left.constraint, right.constraint)
    );
  }
  if (isIndexedAccess(left) || isIndexedAccess(right)) {
    return (
      isIndexedAccess(left) &&
      isIndexedAccess(right) &&
      compare(left.objectType, right.objectType) &&
      compare(left.indexType, right.indexType)
    );
  }
  if (left.isIndexType() || right.isIndexType()) {
    return left.isIndexType() && right.isIndexType() && compare(left.type, right.type);
  }
  if (isTemplate(left) || isTemplate(right)) {
    return (
      isTemplate(left) &&
      isTemplate(right) &&
      left.texts.join("\0") === right.texts.join("\0") &&
      left.types.length === right.types.length &&
      left.types.every((type, index) => {
        const other = right.types[index];
        return other !== undefined && compare(type, other);
      })
    );
  }
  if (isStringMapping(left) || isStringMapping(right)) {
    return (
      isStringMapping(left) && isStringMapping(right) && left.symbol === right.symbol && compare(left.type, right.type)
    );
  }
  if (isConditional(left) || isConditional(right)) {
    if (!isConditional(left) || !isConditional(right) || left.root.isDistributive !== right.root.isDistributive) {
      return false;
    }
    const inferred = left.root.inferTypeParameters ?? [];
    const otherInferred = right.root.inferTypeParameters ?? [];
    if (inferred.length !== otherInferred.length) {
      return false;
    }
    const previous = new Map(parameters);
    try {
      for (const [index, parameter] of inferred.entries()) {
        const other = otherInferred[index];
        if (other) {
          parameters.set(parameter, other);
        }
      }
      return (
        compare(left.checkType, right.checkType) &&
        compare(left.extendsType, right.extendsType) &&
        compare(
          checker.getTypeAtLocation(left.root.node.trueType),
          checker.getTypeAtLocation(right.root.node.trueType),
        ) &&
        compare(
          checker.getTypeAtLocation(left.root.node.falseType),
          checker.getTypeAtLocation(right.root.node.falseType),
        )
      );
    } finally {
      parameters.clear();
      for (const [source, target] of previous) {
        parameters.set(source, target);
      }
    }
  }
  const leftNode = checker.typeToTypeNode(left, undefined, ts.NodeBuilderFlags.InTypeAlias);
  const rightNode = checker.typeToTypeNode(right, undefined, ts.NodeBuilderFlags.InTypeAlias);
  if ((leftNode && ts.isMappedTypeNode(leftNode)) || (rightNode && ts.isMappedTypeNode(rightNode))) {
    const original = getMappedDeclaration(left);
    const other = getMappedDeclaration(right);
    if (
      !original ||
      !other ||
      original.readonlyToken?.kind !== other.readonlyToken?.kind ||
      original.questionToken?.kind !== other.questionToken?.kind
    ) {
      return false;
    }
    parameters.set(
      checker.getTypeAtLocation(original.typeParameter.name),
      checker.getTypeAtLocation(other.typeParameter.name),
    );
    const compareNodes = (a: ts.Node | undefined, b: ts.Node | undefined): boolean =>
      a && b ? compare(checker.getTypeAtLocation(a), checker.getTypeAtLocation(b)) : a === b;
    return (
      compareNodes(original.typeParameter.constraint, other.typeParameter.constraint) &&
      compareNodes(original.nameType, other.nameType) &&
      compareNodes(original.type, other.type)
    );
  }
  return undefined;
}
