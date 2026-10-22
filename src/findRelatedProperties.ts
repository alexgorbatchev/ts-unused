import { Node } from "ts-morph";
import type { ObjectLiteralExpression, Project, SourceFile, Type } from "ts-morph";
import type { IsTestFileFn, PropertyNode } from "./types.js";

interface IPropertyRelation {
  property: PropertyNode;
  sourceFile: SourceFile;
}

interface IRelatedProperty {
  property: PropertyNode;
  onlyUsedInTests: boolean;
}

type PropertyRelations = Map<PropertyNode, IPropertyRelation[]>;

const relationCache = new WeakMap<Project, PropertyRelations>();

function getProperties(type: Type, name: string): PropertyNode[] {
  return (type.getProperty(name)?.getDeclarations() ?? []).filter(
    (node): node is PropertyNode => Node.isPropertySignature(node) || Node.isPropertyDeclaration(node),
  );
}

function connectTypes(source: Type, target: Type, sourceFile: SourceFile, relations: PropertyRelations): void {
  for (const symbol of target.getProperties()) {
    const name = symbol.getName();
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
}

function connectSpreads(object: ObjectLiteralExpression, relations: PropertyRelations): void {
  const properties = object.getProperties();
  const target = object.getContextualType() ?? object.getType();
  for (const [index, member] of properties.entries()) {
    if (!Node.isSpreadAssignment(member)) {
      continue;
    }
    const source = member.getExpression().getType();
    for (const symbol of source.getProperties()) {
      const name = symbol.getName();
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
      for (const original of getProperties(source, name)) {
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
}

function buildRelations(project: Project): PropertyRelations {
  const relations: PropertyRelations = new Map();
  const checker = project.getTypeChecker();
  for (const file of project.getSourceFiles()) {
    for (const iface of file.getInterfaces()) {
      for (const base of iface.getBaseTypes()) {
        connectTypes(base, iface.getType(), file, relations);
        connectTypes(iface.getType(), base, file, relations);
      }
    }
    if (file.isDeclarationFile()) {
      continue;
    }
    file.forEachDescendant((node) => {
      if (Node.isObjectLiteralExpression(node)) {
        connectSpreads(node, relations);
      }
      if (!Node.isExpression(node) || Node.isSpreadAssignment(node.getParent())) {
        return;
      }
      const contextualType = checker.getContextualType(node);
      if (contextualType) {
        connectTypes(node.getType(), contextualType, file, relations);
      }
    });
  }
  return relations;
}

/** Follow explicit inheritance and contextual value flows rather than coincidentally matching shapes. */
export function findRelatedProperties(
  prop: PropertyNode,
  project: Project,
  isTestFile: IsTestFileFn,
): IRelatedProperty[] {
  let relations = relationCache.get(project);
  if (!relations) {
    relations = buildRelations(project);
    relationCache.set(project, relations);
  }
  const reached = new Map<PropertyNode, boolean>([[prop, false]]);
  const queue: IRelatedProperty[] = [{ property: prop, onlyUsedInTests: false }];
  for (const current of queue) {
    for (const edge of relations.get(current.property) ?? []) {
      const testOnly = current.onlyUsedInTests || isTestFile(edge.sourceFile);
      const previous = reached.get(edge.property);
      if (previous === false || previous === testOnly) {
        continue;
      }
      reached.set(edge.property, testOnly);
      queue.push({ property: edge.property, onlyUsedInTests: testOnly });
    }
  }
  reached.delete(prop);
  return Array.from(reached, ([property, onlyUsedInTests]) => ({ property, onlyUsedInTests }));
}
