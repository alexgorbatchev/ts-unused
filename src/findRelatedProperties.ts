import { ts, type Project, type SourceFile } from "ts-morph";
import { getKeyProperties } from "./getKeyProperties.js";
import { USAGE_SOURCE } from "./constants.js";
import type { ClassifyUsageSourceFn, PropertyNode, UsageSource } from "./types.js";
import { getLowerUsageSource, isUsageSourceAtLeast } from "./usageSourceUtils.js";

type PropertyDeclaration = ts.PropertySignature | ts.PropertyDeclaration;

interface IPropertyRelation {
  property: PropertyDeclaration;
  sourceFile: SourceFile;
}

interface IRelatedProperty {
  property: PropertyDeclaration;
  /** The closest-to-production source of the value flows that reach the property, such as test for flows in tests. */
  usageSource: UsageSource;
}

type PropertyRelations = Map<PropertyDeclaration, IPropertyRelation[]>;

interface IContextualFlow {
  expression: ts.Expression;
  file: SourceFile;
}

interface ISpreadFlow {
  object: ts.ObjectLiteralExpression;
  file: SourceFile;
}

interface IHeritageFlow {
  derived: ts.Type;
  base: ts.Type;
  file: SourceFile;
}

interface IRelationIndex {
  contextual: Map<ts.Type, IContextualFlow[]>;
  spreads: ISpreadFlow[];
  heritage: IHeritageFlow[];
  byName: Map<string, PropertyRelations>;
}

const relationCache = new WeakMap<Project, IRelationIndex>();

function getProperty(type: ts.Type, name: string): ts.Symbol | undefined {
  // The compiler escapes string keys on lookup. Unique symbols already have an internal escaped name.
  return name.startsWith("__@")
    ? type.getProperties().find((property) => property.getName() === name)
    : type.getProperty(name);
}

function getProperties(type: ts.Type, name: string): PropertyDeclaration[] {
  return (getProperty(type, name)?.declarations ?? []).filter(
    (node): node is PropertyDeclaration => ts.isPropertySignature(node) || ts.isPropertyDeclaration(node),
  );
}

function connect(
  originals: PropertyDeclaration[],
  destinations: PropertyDeclaration[],
  sourceFile: SourceFile,
  relations: PropertyRelations,
): void {
  for (const original of originals) {
    for (const destination of destinations) {
      if (original !== destination) {
        const edges = relations.get(original) ?? [];
        edges.push({ property: destination, sourceFile });
        relations.set(original, edges);
      }
    }
  }
}

function connectSpreads(
  object: ts.ObjectLiteralExpression,
  checker: ts.TypeChecker,
  file: SourceFile,
  relations: PropertyRelations,
  name: string,
): void {
  for (const [index, member] of object.properties.entries()) {
    if (!ts.isSpreadAssignment(member)) {
      continue;
    }
    const source = checker.getTypeAtLocation(member.expression);
    const originals = getProperties(source, name);
    if (originals.length === 0) {
      continue;
    }
    const isOverwritten = object.properties.slice(index + 1).some((later) => {
      if (ts.isSpreadAssignment(later)) {
        const property = getProperty(checker.getTypeAtLocation(later.expression), name);
        return property !== undefined && !(property.flags & ts.SymbolFlags.Optional);
      }
      if (!later.name) {
        return false;
      }
      if (!ts.isComputedPropertyName(later.name)) {
        return later.name.text === name;
      }
      const key = checker.getTypeAtLocation(later.name.expression);
      return (
        !key.isUnion() && getKeyProperties(later.name, source, checker).some((property) => property.getName() === name)
      );
    });
    if (!isOverwritten) {
      const target = checker.getContextualType(object) ?? checker.getTypeAtLocation(object);
      connect(originals, getProperties(target, name), file, relations);
    }
  }
}

function indexRelations(project: Project): IRelationIndex {
  const index: IRelationIndex = { contextual: new Map(), spreads: [], heritage: [], byName: new Map() };
  const program = project.getProgram().compilerObject;
  const checker = program.getTypeChecker();
  for (const file of project.getSourceFiles()) {
    const source = program.getSourceFile(file.getFilePath());
    if (!source) {
      continue;
    }
    for (const statement of source.statements) {
      if (ts.isInterfaceDeclaration(statement) && statement.heritageClauses) {
        const derived = checker.getTypeAtLocation(statement);
        for (const base of derived.getBaseTypes() ?? []) {
          index.heritage.push({ derived, base, file });
        }
      }
    }
    if (file.isDeclarationFile()) {
      continue;
    }
    const visit = (node: ts.Node): void => {
      ts.forEachChild(node, visit);
      if (!ts.isExpression(node) || ts.isPartOfTypeNode(node)) {
        return;
      }
      if (ts.isObjectLiteralExpression(node)) {
        if (!node.properties.some(ts.isSpreadAssignment)) {
          return;
        }
        index.spreads.push({ object: node, file });
      }
      const parent = node.parent;
      if (
        ts.isSpreadAssignment(parent) ||
        (!ts.isShorthandPropertyAssignment(parent) && "name" in parent && parent.name === node)
      ) {
        return;
      }
      // Only expressions flowing into a property of the target type can create an edge.
      const target = checker.getContextualType(node);
      if (target) {
        const flows = index.contextual.get(target);
        if (flows) {
          flows.push({ expression: node, file });
        } else {
          index.contextual.set(target, [{ expression: node, file }]);
        }
      }
    };
    ts.forEachChild(source, visit);
  }
  return index;
}

function buildRelations(index: IRelationIndex, checker: ts.TypeChecker, name: string): PropertyRelations {
  const relations: PropertyRelations = new Map();
  for (const { derived, base, file } of index.heritage) {
    const properties = getProperties(derived, name);
    const inherited = getProperties(base, name);
    connect(inherited, properties, file, relations);
    connect(properties, inherited, file, relations);
  }
  for (const { object, file } of index.spreads) {
    connectSpreads(object, checker, file, relations, name);
  }
  for (const [target, flows] of index.contextual) {
    const destinations = getProperties(target, name);
    if (destinations.length === 0) {
      continue;
    }
    for (const { expression, file } of flows) {
      const source = checker.getTypeAtLocation(expression);
      connect(getProperties(source, name), destinations, file, relations);
    }
  }
  return relations;
}

/**
 * Follow explicit inheritance and contextual value flows rather than coincidentally matching shapes. A flow through a
 * story or test file lowers the usage source of everything it reaches; each property keeps its best path.
 */
export function findRelatedProperties(
  prop: PropertyNode,
  project: Project,
  classifyUsageSource: ClassifyUsageSourceFn,
): IRelatedProperty[] {
  const declaration = prop.compilerNode;
  const symbol = ts.isComputedPropertyName(declaration.name)
    ? prop
        .getParent()
        .getType()
        .compilerType.getProperties()
        .find((member) => member.declarations?.includes(declaration))
    : prop.getSymbol()?.compilerSymbol;
  const name = symbol?.getName() ?? prop.getName();
  let index = relationCache.get(project);
  if (!index) {
    index = indexRelations(project);
    relationCache.set(project, index);
  }
  let relations = index.byName.get(name);
  if (!relations) {
    // Every edge preserves the property name, so unrelated names cannot be reached from this property.
    relations = buildRelations(index, project.getTypeChecker().compilerObject, name);
    index.byName.set(name, relations);
  }
  const reached = new Map<PropertyDeclaration, UsageSource>([[prop.compilerNode, USAGE_SOURCE.PRODUCTION]]);
  const queue: IRelatedProperty[] = [{ property: prop.compilerNode, usageSource: USAGE_SOURCE.PRODUCTION }];
  for (const current of queue) {
    for (const edge of relations.get(current.property) ?? []) {
      const usageSource = getLowerUsageSource(current.usageSource, classifyUsageSource(edge.sourceFile));
      const previous = reached.get(edge.property);
      if (previous !== undefined && isUsageSourceAtLeast(previous, usageSource)) {
        continue;
      }
      reached.set(edge.property, usageSource);
      queue.push({ property: edge.property, usageSource });
    }
  }
  reached.delete(prop.compilerNode);
  return Array.from(reached, ([property, usageSource]) => ({ property, usageSource }));
}
