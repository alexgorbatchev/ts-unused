import { Node, SyntaxKind } from "ts-morph";
import type { Project, ReferencedSymbol, SourceFile } from "ts-morph";
import { findRelatedProperties } from "./findRelatedProperties";
import type { IsTestFileFn, PropertyNode } from "./types";

interface IPropertyReferenceCount {
  testReferences: number;
  nonTestReferences: number;
}

const reflectAccessCache = new WeakMap<Project, Map<PropertyNode, Set<SourceFile>>>();

function getReflectAccesses(project: Project): Map<PropertyNode, Set<SourceFile>> {
  let cache = reflectAccessCache.get(project);
  if (!cache) {
    cache = new Map<PropertyNode, Set<SourceFile>>();

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

              const receiver = args[0];
              if (propName && receiver) {
                const declarations = receiver.getType().getProperty(propName)?.getDeclarations() ?? [];
                for (const declaration of declarations) {
                  if (!Node.isPropertySignature(declaration) && !Node.isPropertyDeclaration(declaration)) {
                    continue;
                  }
                  const files = cache.get(declaration) ?? new Set<SourceFile>();
                  files.add(sourceFile);
                  cache.set(declaration, files);
                }
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

  // Add Reflect-based references
  const reflectAccesses = getReflectAccesses(project).get(prop);
  if (reflectAccesses) {
    for (const refSourceFile of reflectAccesses) {
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
