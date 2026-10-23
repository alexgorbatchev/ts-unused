import { ts } from "ts-morph";

/** A key that names one property by its text: `"a-b"`, `\`a-b\``, or `0`. */
type LiteralKey = ts.StringLiteralLike | ts.NumericLiteral;

function isLiteralKey(node: ts.Node): node is LiteralKey {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isNumericLiteral(node);
}

/** The type of a `const KEY = Symbol()` or `unique symbol` declaration, which keys exactly one property. */
function isUniqueSymbolType(type: ts.Type): type is ts.UniqueESSymbolType {
  return (type.flags & ts.TypeFlags.UniqueESSymbol) !== 0 && "escapedName" in type;
}

function getNamedProperty(objectType: ts.Type, name: string, checker: ts.TypeChecker): ts.Symbol[] {
  const property = checker.getPropertyOfType(objectType, name);
  return property ? [property] : [];
}

/**
 * Resolves the properties of `objectType` a key can stand for: the property named by a literal key, or one
 * property per string literal, number literal, or `unique symbol` in the type of a computed key. Keys of a wider
 * type (e.g. `string` or `symbol`) name no specific property.
 */
export function getKeyProperties(key: ts.Node, objectType: ts.Type, checker: ts.TypeChecker): ts.Symbol[] {
  if (isLiteralKey(key)) {
    return getNamedProperty(objectType, key.text, checker);
  }

  const keyType = checker.getTypeAtLocation(ts.isComputedPropertyName(key) ? key.expression : key);
  const keyTypes = keyType.isUnion() ? keyType.types : [keyType];
  return keyTypes.flatMap((type) => {
    if (type.isStringLiteral() || type.isNumberLiteral()) {
      return getNamedProperty(objectType, String(type.value), checker);
    }
    if (isUniqueSymbolType(type)) {
      return checker.getPropertiesOfType(objectType).filter((property) => property.escapedName === type.escapedName);
    }
    return [];
  });
}
