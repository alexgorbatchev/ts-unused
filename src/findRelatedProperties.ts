import { Node, ts } from "ts-morph";
import type { Expression, ObjectLiteralExpression, Project, SourceFile, Type } from "ts-morph";
import { USAGE_SOURCE } from "./constants.js";
import type { ClassifyUsageSourceFn, PropertyNode, UsageSource } from "./types.js";
import { getLowerUsageSource, isUsageSourceAtLeast } from "./usageSourceUtils.js";

interface IPropertyRelation {
  property: PropertyNode;
  sourceFile: SourceFile;
}

interface IRelatedProperty {
  property: PropertyNode;
  /** The closest-to-production source of the value flows that reach the property, such as test for flows in tests. */
  usageSource: UsageSource;
}

type PropertyRelations = Map<PropertyNode, IPropertyRelation[]>;

const relationCache = new WeakMap<Project, Map<string, PropertyRelations>>();

function getProperties(type: Type, name: string): PropertyNode[] {
  return (type.getProperty(name)?.getDeclarations() ?? []).filter(
    (node): node is PropertyNode => Node.isPropertySignature(node) || Node.isPropertyDeclaration(node),
  );
}

function connectTypes(
  source: Type,
  target: Type,
  sourceFile: SourceFile,
  relations: PropertyRelations,
  name: string,
): void {
  for (const original of getProperties(source, name)) {
    for (const destination of getProperties(target, name)) {
      if (original === destination) {
        continue;
      }
      const edges = relations.get(original) ?? [];
      edges.push({ property: destination, sourceFile });
      relations.set(original, edges);
    }
  }
}

function connectSpreads(object: ObjectLiteralExpression, relations: PropertyRelations, name: string): void {
  const properties = object.getProperties();
  for (const [index, member] of properties.entries()) {
    if (!Node.isSpreadAssignment(member)) {
      continue;
    }
    const source = member.getExpression().getType();
    const originals = getProperties(source, name);
    if (originals.length === 0) {
      continue;
    }
    const isOverwritten = properties.slice(index + 1).some((later) => {
      if (Node.isSpreadAssignment(later)) {
        const laterProperty = later.getExpression().getType().getProperty(name);
        return laterProperty !== undefined && !laterProperty.isOptional();
      }
      return later.getName() === name;
    });
    if (isOverwritten) {
      continue;
    }
    const target = object.getContextualType() ?? object.getType();
    for (const original of originals) {
      for (const destination of getProperties(target, name)) {
        if (original === destination) {
          continue;
        }
        const edges = relations.get(original) ?? [];
        edges.push({ property: destination, sourceFile: object.getSourceFile() });
        relations.set(original, edges);
      }
    }
  }
}

function isValueExpression(node: Node): node is Expression {
  if (!Node.isExpression(node) || ts.isPartOfTypeNode(node.compilerNode)) {
    return false;
  }
  const parent = node.compilerNode.parent;
  if (ts.isShorthandPropertyAssignment(parent)) {
    return true;
  }
  if ("name" in parent && parent.name === node.compilerNode) {
    return false;
  }
  return true;
}

function buildRelations(project: Project, name: string): PropertyRelations {
  const relations: PropertyRelations = new Map();
  const checker = project.getTypeChecker();
  for (const file of project.getSourceFiles()) {
    for (const iface of file.getInterfaces()) {
      if (getProperties(iface.getType(), name).length === 0) {
        continue;
      }
      for (const base of iface.getBaseTypes()) {
        connectTypes(base, iface.getType(), file, relations, name);
        connectTypes(iface.getType(), base, file, relations, name);
      }
    }
    if (file.isDeclarationFile()) {
      continue;
    }
    file.forEachDescendant((node) => {
      if (Node.isObjectLiteralExpression(node)) {
        connectSpreads(node, relations, name);
        // Fresh literal members are assignments, not the declarations whose usage is tracked.
        if (!node.getProperties().some(Node.isSpreadAssignment)) {
          return;
        }
      }
      if (!isValueExpression(node) || Node.isSpreadAssignment(node.getParent())) {
        return;
      }
      // Unannotated exports have no contextual type; avoid resolving their potentially large inferred type.
      if (Node.isExportAssignment(node.getParent()) && !checker.getContextualType(node)) {
        return;
      }
      const source = node.getType();
      if (getProperties(source, name).length === 0) {
        return;
      }
      const contextualType = checker.getContextualType(node);
      if (contextualType) {
        connectTypes(source, contextualType, file, relations, name);
      }
    });
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
  const name = prop.getSymbol()?.getName() ?? prop.getName();
  let byName = relationCache.get(project);
  if (!byName) {
    byName = new Map();
    relationCache.set(project, byName);
  }
  let relations = byName.get(name);
  if (!relations) {
    // Every edge preserves the property name, so unrelated names cannot be reached from this property.
    relations = buildRelations(project, name);
    byName.set(name, relations);
  }
  const reached = new Map<PropertyNode, UsageSource>([[prop, USAGE_SOURCE.PRODUCTION]]);
  const queue: IRelatedProperty[] = [{ property: prop, usageSource: USAGE_SOURCE.PRODUCTION }];
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
  reached.delete(prop);
  return Array.from(reached, ([property, usageSource]) => ({ property, usageSource }));
}
