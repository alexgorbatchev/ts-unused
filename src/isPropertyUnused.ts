import { Node } from "ts-morph";
import type { Project, ReferencedSymbol, SourceFile } from "ts-morph";
import { USAGE_SOURCE } from "./constants.js";
import { findRelatedProperties } from "./findRelatedProperties.js";
import { getKeyedPropertyAccesses } from "./getKeyedPropertyAccesses.js";
import type { ClassifyUsageSourceFn, PropertyNode, UsageSource } from "./types.js";
import { getLowerUsageSource, isUsageSourceAtLeast } from "./usageSourceUtils.js";

function getReferenceSources(
  prop: PropertyNode,
  classifyUsageSource: ClassifyUsageSourceFn,
  project: Project,
): Set<UsageSource> {
  const references: ReferencedSymbol[] = prop.findReferences();
  const sources = new Set<UsageSource>();

  for (const refGroup of references) {
    const refs = refGroup.getReferences();
    for (const ref of refs) {
      const node = ref.getNode();
      const parent = node.getParent();
      if (
        ref.isDefinition() ||
        ((Node.isPropertySignature(parent) || Node.isPropertyDeclaration(parent)) && parent.getNameNode() === node)
      ) {
        continue;
      }
      const refSourceFile: SourceFile = ref.getSourceFile();
      sources.add(classifyUsageSource(refSourceFile));
    }
  }

  // Add keyed reads (Reflect calls, literal/computed destructuring keys) that findReferences does not report
  const keyedAccesses = getKeyedPropertyAccesses(project).get(prop.compilerNode);
  if (keyedAccesses) {
    for (const refSourceFile of keyedAccesses) {
      sources.add(classifyUsageSource(refSourceFile));
    }
  }

  return sources;
}

export interface IPropertyUsageResult {
  /** Unused, or used only by code that does not keep it alive: tests, or stories for a property outside story files. */
  isUnusedOrTestOnly: boolean;
  onlyUsedInTests: boolean;
  onlyUsedInStories: boolean;
}

/**
 * Checks whether a property is used. Usage from files at least as close to production as the declaring file keeps the
 * property alive, directly or through related properties: stories keep story-file properties alive, not production
 * ones. Otherwise the closest-to-production remaining usage makes it story-only or test-only.
 */
export function isPropertyUnused(
  prop: PropertyNode,
  classifyUsageSource: ClassifyUsageSourceFn,
  project: Project,
): IPropertyUsageResult {
  const declarationSource = classifyUsageSource(prop.getSourceFile());
  const used: IPropertyUsageResult = { isUnusedOrTestOnly: false, onlyUsedInTests: false, onlyUsedInStories: false };

  // Declarations and redeclarations are excluded; only actual references count as usage.
  const usageSources = [...getReferenceSources(prop, classifyUsageSource, project)];
  if (usageSources.some((usageSource) => isUsageSourceAtLeast(usageSource, declarationSource))) {
    return used;
  }

  for (const related of findRelatedProperties(prop, project, classifyUsageSource)) {
    for (const referenceSource of getReferenceSources(related.property, classifyUsageSource, project)) {
      const usageSource = getLowerUsageSource(referenceSource, related.usageSource);
      if (isUsageSourceAtLeast(usageSource, declarationSource)) {
        return used;
      }
      usageSources.push(usageSource);
    }
  }

  return {
    isUnusedOrTestOnly: true,
    onlyUsedInTests: usageSources.length > 0 && usageSources.every((usageSource) => usageSource === USAGE_SOURCE.TEST),
    onlyUsedInStories: usageSources.includes(USAGE_SOURCE.STORY),
  };
}
