import { Node } from "ts-morph";
import type { Project, ReferencedSymbol, SourceFile } from "ts-morph";
import { findRelatedProperties } from "./findRelatedProperties.js";
import { getKeyedPropertyAccesses } from "./getKeyedPropertyAccesses.js";
import type { IsTestFileFn, PropertyNode } from "./types.js";

interface IPropertyReferenceCount {
  testReferences: number;
  nonTestReferences: number;
}

function countPropertyReferences(
  prop: PropertyNode,
  isTestFile: IsTestFileFn,
  project: Project,
): IPropertyReferenceCount {
  const references: ReferencedSymbol[] = prop.findReferences();
  let testReferences = 0;
  let nonTestReferences = 0;

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

      if (isTestFile(refSourceFile)) {
        testReferences++;
      } else {
        nonTestReferences++;
      }
    }
  }

  // Add keyed reads (Reflect calls, literal/computed destructuring keys) that findReferences does not report
  const keyedAccesses = getKeyedPropertyAccesses(project).get(prop.compilerNode);
  if (keyedAccesses) {
    for (const refSourceFile of keyedAccesses) {
      if (isTestFile(refSourceFile)) {
        testReferences++;
      } else {
        nonTestReferences++;
      }
    }
  }

  const result: IPropertyReferenceCount = {
    testReferences,
    nonTestReferences,
  };
  return result;
}

export interface IPropertyUsageResult {
  isUnusedOrTestOnly: boolean;
  onlyUsedInTests: boolean;
}

export function isPropertyUnused(prop: PropertyNode, isTestFile: IsTestFileFn, project: Project): IPropertyUsageResult {
  const counts: IPropertyReferenceCount = countPropertyReferences(prop, isTestFile, project);

  // Declarations and redeclarations are excluded; only actual references count as usage.
  const onlyUsedInTests: boolean = counts.nonTestReferences === 0 && counts.testReferences > 0;

  if (counts.nonTestReferences > 0) {
    const result: IPropertyUsageResult = { isUnusedOrTestOnly: false, onlyUsedInTests: false };
    return result; // Used in production code
  }

  let hasTestUsage = onlyUsedInTests;
  for (const related of findRelatedProperties(prop, project, isTestFile)) {
    const relatedCounts = countPropertyReferences(related.property, isTestFile, project);
    const hasProductionUsage = relatedCounts.nonTestReferences > 0;
    if (hasProductionUsage && !related.onlyUsedInTests) {
      const result: IPropertyUsageResult = { isUnusedOrTestOnly: false, onlyUsedInTests: false };
      return result;
    }
    hasTestUsage ||= relatedCounts.testReferences > 0 || (hasProductionUsage && related.onlyUsedInTests);
  }

  const result: IPropertyUsageResult = { isUnusedOrTestOnly: true, onlyUsedInTests: hasTestUsage };
  return result;
}
