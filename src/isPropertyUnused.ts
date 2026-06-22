import type { Project, PropertyDeclaration, PropertySignature, ReferencedSymbol, SourceFile } from "ts-morph";
import { findStructurallyEquivalentProperties } from "./findStructurallyEquivalentProperties";
import type { IsTestFileFn } from "./types";

type PropertyNode = PropertySignature | PropertyDeclaration;

interface IPropertyReferenceCount {
  totalReferences: number;
  testReferences: number;
  nonTestReferences: number;
}

function countPropertyReferences(prop: PropertyNode, isTestFile: IsTestFileFn): IPropertyReferenceCount {
  const references: ReferencedSymbol[] = prop.findReferences();
  let totalReferences = 0;
  let testReferences = 0;
  let nonTestReferences = 0;

  for (const refGroup of references) {
    const refs = refGroup.getReferences();
    for (const ref of refs) {
      const refSourceFile: SourceFile = ref.getSourceFile();
      totalReferences++;

      if (isTestFile(refSourceFile)) {
        testReferences++;
      } else {
        nonTestReferences++;
      }
    }
  }

  const result: IPropertyReferenceCount = {
    totalReferences,
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
  const counts: IPropertyReferenceCount = countPropertyReferences(prop, isTestFile);

  // A property is unused if it only has 1 reference (the definition itself)
  // A property is test-only if it has references only from tests
  const onlyUsedInTests: boolean = counts.nonTestReferences === 1 && counts.testReferences > 0;

  if (counts.totalReferences > 1 && !onlyUsedInTests) {
    const result: IPropertyUsageResult = { isUnusedOrTestOnly: false, onlyUsedInTests: false };
    return result; // Used in production code
  }

  // Check structurally equivalent properties
  const equivalentProps: PropertyNode[] = findStructurallyEquivalentProperties(prop, project);

  for (const equivalentProp of equivalentProps) {
    const equivalentCounts: IPropertyReferenceCount = countPropertyReferences(equivalentProp, isTestFile);
    const equivalentOnlyUsedInTests: boolean =
      equivalentCounts.nonTestReferences === 1 && equivalentCounts.testReferences > 0;

    if (equivalentCounts.totalReferences > 1 && !equivalentOnlyUsedInTests) {
      const result: IPropertyUsageResult = { isUnusedOrTestOnly: false, onlyUsedInTests: false };
      return result;
    }
  }

  const result: IPropertyUsageResult = { isUnusedOrTestOnly: true, onlyUsedInTests };
  return result;
}
