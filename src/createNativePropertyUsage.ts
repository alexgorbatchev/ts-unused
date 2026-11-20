import { isComputedPropertyName, isPropertyDeclaration, isPropertySignatureDeclaration } from "typescript/ast";
import type { Project } from "typescript/async";
import type { Project as SyntaxProject } from "ts-morph";
import { Node } from "ts-morph";
import { USAGE_SOURCE } from "./constants.js";
import { findNativePropertyAccesses } from "./findNativePropertyAccesses.js";
import { createNativePropertyRelations } from "./findNativePropertyRelations.js";
import { declarationLocation } from "./findNativeUsedImports.js";
import type { IPropertyUsageResult } from "./isPropertyUnused.js";
import type { ClassifyUsageSourceFn, PropertyNode, PropertyUsageLookup, UsageSource } from "./types.js";
import { getLowerUsageSource, isUsageSourceAtLeast } from "./usageSourceUtils.js";

interface IReachedProperty {
  property: string;
  usage: UsageSource;
}

const used: IPropertyUsageResult = { isUnusedOrTestOnly: false, onlyUsedInTests: false, onlyUsedInStories: false };

async function getPropertyName(project: Project, prop: PropertyNode): Promise<string> {
  if (!Node.isComputedPropertyName(prop.getNameNode())) return prop.getName();
  const path: string = prop.getSourceFile().getFilePath();
  const start = prop.getNameNode().getStart();
  const symbol = await project.checker.getSymbolAtPosition(path, start);
  if (symbol) return symbol.name;
  const owner = prop.getParent();
  const type = await project.checker.getTypeAtPosition(path, owner.getStart());
  if (type) {
    for (const member of await type.getProperties()) {
      for (const handle of member.declarations) {
        const node = await handle.resolve();
        if (
          node &&
          (isPropertyDeclaration(node) || isPropertySignatureDeclaration(node)) &&
          isComputedPropertyName(node.name) &&
          node.name.getStart() === start &&
          node.getSourceFile().fileName === path
        ) {
          return member.name;
        }
      }
    }
  }
  return prop.getName();
}

export async function createNativePropertyUsage(
  project: Project,
  syntax: SyntaxProject,
  classify: ClassifyUsageSourceFn,
): Promise<PropertyUsageLookup> {
  const accesses = await findNativePropertyAccesses(project);
  const getRelations = createNativePropertyRelations(project);
  const fileSources = new Map<string, UsageSource>();
  function classifyFile(file: string): UsageSource {
    const known = fileSources.get(file);
    if (known !== undefined) return known;
    const source = syntax.addSourceFileAtPathIfExists(file);
    const usage = source ? classify(source) : USAGE_SOURCE.PRODUCTION;
    fileSources.set(file, usage);
    return usage;
  }

  return async (prop) => {
    const file = prop.getSourceFile();
    const declarationSource = classify(file);
    const key = declarationLocation(file.getFilePath(), prop.getStart());
    const usageSources = new Set<UsageSource>();
    for (const source of accesses.get(key) ?? []) {
      const usage = classifyFile(source);
      if (isUsageSourceAtLeast(usage, declarationSource)) return used;
      usageSources.add(usage);
    }

    const name = await getPropertyName(project, prop);
    const relations = await getRelations(name);
    const reached = new Map<string, UsageSource>([[key, USAGE_SOURCE.PRODUCTION]]);
    const queue: IReachedProperty[] = [{ property: key, usage: USAGE_SOURCE.PRODUCTION }];
    for (const current of queue) {
      for (const edge of relations.get(current.property) ?? []) {
        const usage = getLowerUsageSource(current.usage, classifyFile(edge.file));
        const previous = reached.get(edge.property);
        if (previous !== undefined && isUsageSourceAtLeast(previous, usage)) continue;
        reached.set(edge.property, usage);
        queue.push({ property: edge.property, usage });
        for (const source of accesses.get(edge.property) ?? []) {
          const relative = getLowerUsageSource(usage, classifyFile(source));
          if (isUsageSourceAtLeast(relative, declarationSource)) return used;
          usageSources.add(relative);
        }
      }
    }
    return {
      isUnusedOrTestOnly: true,
      onlyUsedInTests: usageSources.size === 1 && usageSources.has(USAGE_SOURCE.TEST),
      onlyUsedInStories: usageSources.has(USAGE_SOURCE.STORY),
    };
  };
}
