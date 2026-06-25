import path from "node:path";
import type { InterfaceDeclaration, Project, SourceFile } from "ts-morph";
import { extractTodoComment, hasUnusedIgnoreComment } from "./extractTodoComment";
import { isPropertyUnused, type IPropertyUsageResult } from "./isPropertyUnused";
import { matchesPattern } from "./patternMatcher";
import type { IsTestFileFn, Severity, IUnusedPropertyResult } from "./types";

export interface IAnalyzeInterfacesOptions {
  ignoreProperties?: string[];
  ignoreTypes?: string[];
}

export function analyzeInterfaces(
  sourceFile: SourceFile,
  tsConfigDir: string,
  isTestFile: IsTestFileFn,
  results: IUnusedPropertyResult[],
  project: Project,
  options: IAnalyzeInterfacesOptions = {},
): void {
  const { ignoreProperties = [], ignoreTypes = [] } = options;
  const interfaces: InterfaceDeclaration[] = sourceFile.getInterfaces();

  for (const iface of interfaces) {
    const interfaceName: string = iface.getName();

    // Skip ignored types
    if (ignoreTypes.length > 0 && matchesPattern(interfaceName, ignoreTypes)) {
      continue;
    }

    for (const prop of iface.getProperties()) {
      const propertyName: string = prop.getName();

      // Skip ignored properties
      if (ignoreProperties.length > 0 && matchesPattern(propertyName, ignoreProperties)) {
        continue;
      }

      // Skip if has @ts-unused-ignore comment
      if (hasUnusedIgnoreComment(prop)) {
        continue;
      }

      const usage: IPropertyUsageResult = isPropertyUnused(prop, isTestFile, project);

      if (usage.isUnusedOrTestOnly) {
        const relativePath: string = path.relative(tsConfigDir, sourceFile.getFilePath());
        const todoComment: string | undefined = extractTodoComment(prop);

        // Determine severity: warning for TODO, info for test-only, error for completely unused
        let severity: Severity = "error";
        if (todoComment) {
          severity = "warning";
        } else if (usage.onlyUsedInTests) {
          severity = "info";
        }

        const startPos: number = prop.getStart();
        const lineStartPos: number = prop.getStartLinePos();
        const character: number = startPos - lineStartPos + 1;
        const endCharacter: number = character + propertyName.length;
        const result: IUnusedPropertyResult = {
          filePath: relativePath,
          typeName: interfaceName,
          propertyName,
          line: prop.getStartLineNumber(),
          character,
          endCharacter,
          todoComment,
          severity,
          onlyUsedInTests: usage.onlyUsedInTests,
        };
        results.push(result);
      }
    }
  }
}
