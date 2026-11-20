import {
  isComputedPropertyName,
  isExpression,
  isInterfaceDeclaration,
  isObjectLiteralExpression,
  isPropertyDeclaration,
  isPropertySignatureDeclaration,
  isShorthandPropertyAssignment,
  isSpreadAssignment,
  isTypeNode,
  type Expression,
  type Node,
  type ObjectLiteralExpression,
} from "typescript/ast";
import { type Project, type Symbol, SymbolFlags, type Type } from "typescript/async";
import { declarationLocation } from "./findNativeUsedImports.js";
import { getKeySymbols } from "./findNativePropertyAccesses.js";

interface IContextualFlow {
  expression: Expression;
  file: string;
}

interface ISpreadFlow {
  object: ObjectLiteralExpression;
  file: string;
}

interface IHeritageFlow {
  derived: Type;
  base: Type;
  file: string;
}

interface IRelationIndex {
  contextual: Map<Type, IContextualFlow[]>;
  spreads: ISpreadFlow[];
  heritage: IHeritageFlow[];
}

export interface IPropertyRelation {
  property: string;
  file: string;
}

type NativeRelations = Map<string, IPropertyRelation[]>;
type TypeAtNode = (node: Node) => Promise<Type>;
type ContextualTypeAt = (expression: Expression) => Promise<Type | undefined>;
type PropertyAtType = (type: Type, name: string) => Promise<Symbol | undefined>;
type PropertyLocations = (type: Type, name: string) => Promise<string[]>;
type RelationsByName = (name: string) => Promise<NativeRelations>;

interface IRelationQueries {
  typeAt: TypeAtNode;
  getProperty: PropertyAtType;
  getProperties: PropertyLocations;
  getContextualType: ContextualTypeAt;
}

async function getDeclarationLocations(property: Symbol): Promise<string[]> {
  const declarations = await Promise.all(property.declarations.map((handle) => handle.resolve()));
  return declarations.flatMap((node) =>
    node && (isPropertySignatureDeclaration(node) || isPropertyDeclaration(node))
      ? [declarationLocation(node.getSourceFile().fileName, node.getStart())]
      : [],
  );
}

function connect(originals: string[], destinations: string[], file: string, relations: NativeRelations): void {
  for (const original of originals) {
    for (const destination of destinations) {
      if (original === destination) continue;
      const edges = relations.get(original) ?? [];
      edges.push({ property: destination, file });
      relations.set(original, edges);
    }
  }
}

async function connectSpreads(
  project: Project,
  { object, file }: ISpreadFlow,
  name: string,
  relations: NativeRelations,
  { typeAt, getProperty, getProperties, getContextualType }: IRelationQueries,
): Promise<void> {
  const properties = object.properties;
  for (const [index, member] of properties.entries()) {
    if (!isSpreadAssignment(member)) continue;
    const source = await typeAt(member.expression);
    const originals = await getProperties(source, name);
    if (!originals.length) continue;
    let overwritten = false;
    for (const later of properties.slice(index + 1)) {
      if (isSpreadAssignment(later)) {
        const property = await getProperty(await typeAt(later.expression), name);
        overwritten = property !== undefined && !(property.flags & SymbolFlags.Optional);
      } else if (later.name) {
        if (isComputedPropertyName(later.name)) {
          const type = await typeAt(later.name.expression);
          overwritten =
            !type.isUnionType() &&
            (await getKeySymbols(project, source, later.name, true)).some((property) => property.name === name);
        } else {
          overwritten = later.name.text === name;
        }
      }
      if (overwritten) break;
    }
    if (!overwritten) {
      const target = (await getContextualType(object)) ?? (await typeAt(object));
      connect(originals, await getProperties(target, name), file, relations);
    }
  }
}

async function indexRelations(project: Project, getContextualType: ContextualTypeAt): Promise<IRelationIndex> {
  const index: IRelationIndex = { contextual: new Map(), spreads: [], heritage: [] };
  const checker = project.checker;
  for (const file of await project.program.getSourceFileNames()) {
    const source = await project.program.getSourceFile(file);
    if (!source) continue;
    for (const statement of source.statements) {
      if (!isInterfaceDeclaration(statement) || !statement.heritageClauses) continue;
      const derived = await checker.getTypeAtLocation(statement);
      for (const base of (await derived.getBaseTypes()) ?? []) {
        index.heritage.push({ derived, base, file: source.fileName });
      }
    }
    if (source.isDeclarationFile) continue;
    const expressions: Expression[] = [];
    const visit = (node: Node): void => {
      if (isTypeNode(node)) return;
      node.forEachChild(visit);
      if (!isExpression(node)) return;
      if (isObjectLiteralExpression(node)) {
        if (!node.properties.some(isSpreadAssignment)) return;
        index.spreads.push({ object: node, file: source.fileName });
      }
      const parent = node.parent;
      if (
        isSpreadAssignment(parent) ||
        (!isShorthandPropertyAssignment(parent) && "name" in parent && parent.name === node)
      ) {
        return;
      }
      expressions.push(node);
    };
    source.forEachChild(visit);
    const targets = await Promise.all(expressions.map(getContextualType));
    for (const [position, expression] of expressions.entries()) {
      const target = targets[position];
      if (!target) continue;
      const flows = index.contextual.get(target) ?? [];
      flows.push({ expression, file: source.fileName });
      index.contextual.set(target, flows);
    }
  }
  return index;
}

/** Indexes explicit inheritance and property value flows once and loads edges on demand. */
export function createNativePropertyRelations(project: Project): RelationsByName {
  let indexPromise: Promise<IRelationIndex> | undefined;
  const names = new Map<string, Promise<NativeRelations>>();
  const typeAtNode = new WeakMap<Node, Promise<Type>>();
  const contextualTypeAt = new WeakMap<Expression, Promise<Type | undefined>>();
  const propertiesOfType = new WeakMap<Type, Promise<Map<string, Symbol>>>();
  const locationsOfProperty = new WeakMap<Symbol, Promise<string[]>>();
  const typeAt = (node: Node): Promise<Type> => {
    const cached = typeAtNode.get(node);
    if (cached) return cached;
    const type = project.checker.getTypeAtLocation(node);
    typeAtNode.set(node, type);
    return type;
  };
  const getContextualType = (expression: Expression): Promise<Type | undefined> => {
    const cached = contextualTypeAt.get(expression);
    if (cached) return cached;
    const type = project.checker.getContextualType(expression);
    contextualTypeAt.set(expression, type);
    return type;
  };
  const getProperty = async (type: Type, name: string): Promise<Symbol | undefined> => {
    let properties = propertiesOfType.get(type);
    if (!properties) {
      properties = type.getProperties().then((symbols) => new Map(symbols.map((symbol) => [symbol.name, symbol])));
      propertiesOfType.set(type, properties);
    }
    return (await properties).get(name);
  };
  const getProperties = async (type: Type, name: string): Promise<string[]> => {
    const property = await getProperty(type, name);
    if (!property) return [];
    const cached = locationsOfProperty.get(property);
    if (cached) return cached;
    const locations = getDeclarationLocations(property);
    locationsOfProperty.set(property, locations);
    return locations;
  };
  const build = async (name: string): Promise<NativeRelations> => {
    const index = await (indexPromise ??= indexRelations(project, getContextualType));
    const relations: NativeRelations = new Map();
    for (const { derived, base, file } of index.heritage) {
      const [properties, inherited] = await Promise.all([getProperties(derived, name), getProperties(base, name)]);
      connect(inherited, properties, file, relations);
      connect(properties, inherited, file, relations);
    }
    for (const spread of index.spreads) {
      await connectSpreads(project, spread, name, relations, { typeAt, getProperty, getProperties, getContextualType });
    }
    for (const [target, flows] of index.contextual) {
      const destinations = await getProperties(target, name);
      if (!destinations.length) continue;
      for (const flow of flows) {
        connect(await getProperties(await typeAt(flow.expression), name), destinations, flow.file, relations);
      }
    }
    return relations;
  };
  return (name) => {
    const previous = names.get(name);
    if (previous) return previous;
    const result = build(name);
    names.set(name, result);
    return result;
  };
}
