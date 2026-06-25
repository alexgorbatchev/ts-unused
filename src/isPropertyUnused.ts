import { Node, SyntaxKind } from "ts-morph";
import type { Project, PropertyDeclaration, PropertySignature, ReferencedSymbol, SourceFile } from "ts-morph";
import { findStructurallyEquivalentProperties } from "./findStructurallyEquivalentProperties";
import type { IsTestFileFn } from "./types";

type PropertyNode = PropertySignature | PropertyDeclaration;

interface IPropertyReferenceCount {
  totalReferences: number;
  testReferences: number;
  nonTestReferences: number;
}

const reflectAccessCache = new WeakMap<Project, Map<string, Set<SourceFile>>>();

function getReflectAccesses(project: Project): Map<string, Set<SourceFile>> {
  let cache = reflectAccessCache.get(project);
  if (!cache) {
    cache = new Map<string, Set<SourceFile>>();

    for (const sourceFile of project.getSourceFiles()) {
      const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
      for (const callExpr of callExpressions) {
        const expr = callExpr.getExpression();
        let isReflect = false;
        let methodName: string | undefined;

        if (Node.isPropertyAccessExpression(expr)) {
          const expression = expr.getExpression();
          if (Node.isIdentifier(expression) && expression.getText() === "Reflect") {
            isReflect = true;
            methodName = expr.getName();
          }
        } else if (Node.isElementAccessExpression(expr)) {
          const expression = expr.getExpression();
          if (Node.isIdentifier(expression) && expression.getText() === "Reflect") {
            const argument = expr.getArgumentExpression();
            if (argument && (Node.isStringLiteral(argument) || Node.isNoSubstitutionTemplateLiteral(argument))) {
              isReflect = true;
              methodName = argument.getLiteralValue();
            }
          }
        }

        if (isReflect && methodName) {
          const validMethods = ["get", "set", "has", "deleteProperty", "getOwnPropertyDescriptor", "defineProperty"];
          if (validMethods.includes(methodName)) {
            const args = callExpr.getArguments();
            if (args.length >= 2) {
              const keyArg = args[1];
              let propName: string | undefined;

              if (Node.isStringLiteral(keyArg) || Node.isNoSubstitutionTemplateLiteral(keyArg)) {
                propName = keyArg.getLiteralValue();
              }

              if (propName) {
                let files = cache.get(propName);
                if (!files) {
                  files = new Set<SourceFile>();
                  cache.set(propName, files);
                }
                files.add(sourceFile);
              }
            }
          }
        }
      }
    }
    reflectAccessCache.set(project, cache);
  }
  return cache;
}

function countPropertyReferences(
  prop: PropertyNode,
  isTestFile: IsTestFileFn,
  project: Project,
): IPropertyReferenceCount {
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

  // Add Reflect-based references
  const propName = prop.getName();
  const reflectAccesses = getReflectAccesses(project).get(propName);
  if (reflectAccesses) {
    for (const refSourceFile of reflectAccesses) {
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
  const counts: IPropertyReferenceCount = countPropertyReferences(prop, isTestFile, project);

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
    const equivalentCounts: IPropertyReferenceCount = countPropertyReferences(equivalentProp, isTestFile, project);
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
