import { ts } from "ts-morph";
import type { PropertyAccessName } from "./types.js";
import { getKeyProperties } from "./getKeyProperties.js";

/** Resolves a declared property name, including computed keys and JSX namespaces. */
export function getPropertyNameSymbols(
  name: PropertyAccessName,
  object: ts.Type,
  checker: ts.TypeChecker,
): ts.Symbol[] {
  if (ts.isComputedPropertyName(name)) {
    return getKeyProperties(name, object, checker);
  }
  const text = ts.isJsxNamespacedName(name) ? `${name.namespace.text}:${name.name.text}` : name.text;
  const property = checker.getPropertyOfType(object, text);
  return property ? [property] : [];
}
