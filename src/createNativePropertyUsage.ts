import { isComputedPropertyName } from "typescript/ast";
import type { Project } from "typescript/async";
import { USAGE_SOURCE } from "./constants.js";
import { findNativePropertyAccesses } from "./findNativePropertyAccesses.js";
import { createNativePropertyRelations } from "./findNativePropertyRelations.js";
import { declarationLocation } from "./findNativeUsedImports.js";
import type { ClassifyUsageSourceFn, IPropertyUsageResult, PropertyUsageLookup, UsageSource } from "./types.js";
import { getLowerUsageSource, isUsageSourceAtLeast } from "./usageSourceUtils.js";

interface IReachedProperty {
  property: string;
  usage: UsageSource;
}

const used: IPropertyUsageResult = { isUnusedOrTestOnly: false, onlyUsedInTests: false, onlyUsedInStories: false };

export async function createNativePropertyUsage(
  project: Project,
  classify: ClassifyUsageSourceFn,
): Promise<PropertyUsageLookup> {
  const accesses = await findNativePropertyAccesses(project);
  const getRelations = createNativePropertyRelations(project);
  return async (prop) => {
    const file = prop.getSourceFile();
    const declarationSource = classify(file.fileName);
    const key = declarationLocation(file.fileName, prop.getStart());
    const usageSources = new Set<UsageSource>();
    for (const source of accesses.get(key) ?? []) {
      const usage = classify(source);
      if (isUsageSourceAtLeast(usage, declarationSource)) return used;
      usageSources.add(usage);
    }

    const name =
      (isComputedPropertyName(prop.name) ? (await project.checker.getSymbolOfNode(prop))?.name : undefined) ??
      prop.name.getText(file);
    const relations = await getRelations(name);
    const reached = new Map<string, UsageSource>([[key, USAGE_SOURCE.PRODUCTION]]);
    const queue: IReachedProperty[] = [{ property: key, usage: USAGE_SOURCE.PRODUCTION }];
    for (const current of queue) {
      for (const edge of relations.get(current.property) ?? []) {
        const usage = getLowerUsageSource(current.usage, classify(edge.file));
        const previous = reached.get(edge.property);
        if (previous !== undefined && isUsageSourceAtLeast(previous, usage)) continue;
        reached.set(edge.property, usage);
        queue.push({ property: edge.property, usage });
        for (const source of accesses.get(edge.property) ?? []) {
          const relative = getLowerUsageSource(usage, classify(source));
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
