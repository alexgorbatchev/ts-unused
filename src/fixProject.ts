import { SEVERITY } from "./constants.js";
import fs from "node:fs";
import path from "node:path";
import { type NamespaceImport, Node, type Project, type SourceFile, SyntaxKind } from "ts-morph";
import { analyzeProject, type IsTestFileFnOrOptions } from "./analyzeProject.js";
import { checkGitStatus } from "./checkGitStatus.js";
import { classifyExportReferences } from "./classifyExportReferences.js";
import { mergeConfig } from "./config.js";
import { isIgnoredFile } from "./isIgnoredFile.js";
import { loadProject } from "./loadProject.js";
import { type RemovableSpecifier, removeSpecifier } from "./removeSpecifier.js";
import type { IAnalysisResults, IUnusedExportResult } from "./types.js";

export type FixProgressCallback = (message: string) => void;

export interface IFixResults {
  fixedExports: number;
  fixedProperties: number;
  fixedNeverReturnedTypes: number;
  deletedFiles: number;
  skippedFiles: string[];
  errors: Array<{ file: string; error: string }>;
}

export async function fixProject(
  tsConfigPath: string,
  onProgress?: FixProgressCallback,
  isTestFileOrOptions?: IsTestFileFnOrOptions,
): Promise<IFixResults> {
  const results: IFixResults = {
    fixedExports: 0,
    fixedProperties: 0,
    fixedNeverReturnedTypes: 0,
    deletedFiles: 0,
    skippedFiles: [],
    errors: [],
  };

  // Analyze the project to find unused items
  const analysis: IAnalysisResults = await analyzeProject(tsConfigPath, undefined, undefined, isTestFileOrOptions);

  // Get the directory containing tsconfig
  const tsConfigDir = path.dirname(path.resolve(tsConfigPath));

  // Check git status to avoid modifying files with local changes
  const filesWithChanges = checkGitStatus(tsConfigDir);

  // Create ts-morph project for making fixes
  const { project, projectFiles } = loadProject(tsConfigPath);

  // Ignored files are never edited or deleted, like files outside the analyzed tsconfig
  const { ignoreFilePatterns } = mergeConfig(
    typeof isTestFileOrOptions === "object" ? (isTestFileOrOptions.config ?? {}) : {},
  );
  const ignoredFiles = new Set(
    projectFiles.filter((sourceFile) => isIgnoredFile(sourceFile, tsConfigDir, ignoreFilePatterns)),
  );
  const editableFiles = projectFiles.filter((sourceFile) => !ignoredFiles.has(sourceFile));

  const deletionCandidates = analysis.unusedFileSeverity === SEVERITY.ERROR ? analysis.unusedFiles : [];

  // Collect the specifiers that name the exports and files about to be removed before any edit changes the references
  const removalCandidates = analysis.unusedExports.filter(
    (unusedExport) => deletionCandidates.includes(unusedExport.filePath) || isFixableExport(unusedExport),
  );
  const specifierGroups = collectSpecifierGroups(
    removalCandidates,
    findExhaustedFiles(removalCandidates, tsConfigDir, project),
    tsConfigDir,
    filesWithChanges,
    project,
  );

  // Keep every export and file that is named in a file fix cannot edit, so no import or re-export is left dangling
  const blockedGroups = findBlockedGroups(
    specifierGroups,
    new Set(editableFiles),
    ignoredFiles,
    filesWithChanges,
    tsConfigDir,
    onProgress,
    results,
  );
  const removableGroups = specifierGroups.filter((group) => !blockedGroups.includes(group));
  const filesToDelete = deletionCandidates.filter(
    (relativeFilePath) => !blockedGroups.some((group) => group.filePath === relativeFilePath),
  );
  const isRemovableExport = (unusedExport: IUnusedExportResult): boolean =>
    isFixableExport(unusedExport) &&
    !blockedGroups.some(
      (group) =>
        group.filePath === unusedExport.filePath &&
        (group.exportName === undefined || group.exportName === unusedExport.exportName),
    );

  // Fix unused files first (delete them)
  const deletedFiles = new Set<string>();
  for (const relativeFilePath of filesToDelete) {
    const absoluteFilePath = path.resolve(tsConfigDir, relativeFilePath);

    if (filesWithChanges.has(absoluteFilePath)) {
      onProgress?.(`Skipped: ${relativeFilePath} (has local git changes)`);
      results.skippedFiles.push(relativeFilePath);
      continue;
    }

    try {
      onProgress?.(`Deleting: ${relativeFilePath} (all exports unused)`);
      fs.unlinkSync(absoluteFilePath);
      deletedFiles.add(relativeFilePath);
      results.deletedFiles++;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      results.errors.push({ file: relativeFilePath, error: errorMessage });
      onProgress?.(`Error deleting ${relativeFilePath}: ${errorMessage}`);
    }
  }

  // Clean up files that only contain broken imports after deletions
  const deletedBrokenFiles =
    deletedFiles.size > 0
      ? cleanupBrokenImports(editableFiles, tsConfigDir, deletedFiles, filesWithChanges, onProgress, results)
      : new Set<string>();

  // Group never-returned types by file (process BEFORE exports to avoid removing functions)
  const neverReturnedByFile = new Map<string, typeof analysis.neverReturnedTypes>();
  for (const neverReturned of analysis.neverReturnedTypes || []) {
    // Only fix ERROR severity items
    if (neverReturned.severity !== SEVERITY.ERROR) {
      continue;
    }
    if (!neverReturnedByFile.has(neverReturned.filePath)) {
      neverReturnedByFile.set(neverReturned.filePath, []);
    }
    neverReturnedByFile.get(neverReturned.filePath)?.push(neverReturned);
  }

  // Create a set of unused export names for quick lookup (only ERROR severity)
  const unusedExportNames = new Set<string>();
  for (const unusedExport of analysis.unusedExports) {
    if (isRemovableExport(unusedExport)) {
      unusedExportNames.add(`${unusedExport.filePath}:${unusedExport.exportName}`);
    }
  }

  // Fix never-returned types first (before removing exports)
  for (const [relativeFilePath, neverReturnedItems] of neverReturnedByFile.entries()) {
    const absoluteFilePath = path.resolve(tsConfigDir, relativeFilePath);

    // Skip if file was deleted
    if (filesToDelete.includes(relativeFilePath)) {
      continue;
    }

    if (filesWithChanges.has(absoluteFilePath)) {
      if (!results.skippedFiles.includes(relativeFilePath)) {
        onProgress?.(`Skipped: ${relativeFilePath} (has local git changes)`);
        results.skippedFiles.push(relativeFilePath);
      }
      continue;
    }

    try {
      const sourceFile = project.getSourceFile(absoluteFilePath);
      if (!sourceFile) {
        continue;
      }

      onProgress?.(`Fixing: ${relativeFilePath}`);

      if (neverReturnedItems) {
        for (const neverReturned of neverReturnedItems) {
          // Skip if the function itself is unused (will be removed)
          const exportKey = `${relativeFilePath}:${neverReturned.functionName}`;
          if (unusedExportNames.has(exportKey)) {
            continue;
          }

          if (removeNeverReturnedType(sourceFile, neverReturned.functionName, neverReturned.neverReturnedType)) {
            onProgress?.(
              `  ✓ Removed never-returned type '${neverReturned.neverReturnedType}' from ${neverReturned.functionName}`,
            );
            results.fixedNeverReturnedTypes++;
          }
        }
      }

      sourceFile.saveSync();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      results.errors.push({ file: relativeFilePath, error: errorMessage });
      onProgress?.(`Error fixing ${relativeFilePath}: ${errorMessage}`);
    }
  }

  // Group unused exports by file (only ERROR severity)
  const exportsByFile = new Map<string, typeof analysis.unusedExports>();
  for (const unusedExport of analysis.unusedExports) {
    // Only fix ERROR severity items (skip INFO for test-only and story-only, WARNING for TODOs) that nothing
    // uneditable names
    if (!isRemovableExport(unusedExport)) {
      continue;
    }
    if (!exportsByFile.has(unusedExport.filePath)) {
      exportsByFile.set(unusedExport.filePath, []);
    }
    exportsByFile.get(unusedExport.filePath)?.push(unusedExport);
  }

  // Fix unused exports
  for (const [relativeFilePath, exports] of exportsByFile.entries()) {
    const absoluteFilePath = path.resolve(tsConfigDir, relativeFilePath);

    // Skip if file was deleted
    if (filesToDelete.includes(relativeFilePath)) {
      continue;
    }

    if (filesWithChanges.has(absoluteFilePath)) {
      if (!results.skippedFiles.includes(relativeFilePath)) {
        onProgress?.(`Skipped: ${relativeFilePath} (has local git changes)`);
        results.skippedFiles.push(relativeFilePath);
      }
      continue;
    }

    try {
      const sourceFile = project.getSourceFile(absoluteFilePath);
      if (!sourceFile) {
        continue;
      }

      // Only log if we haven't already logged for this file (from never-returned types)
      if (!neverReturnedByFile.has(relativeFilePath)) {
        onProgress?.(`Fixing: ${relativeFilePath}`);
      }

      for (const unusedExport of exports) {
        if (removeExport(sourceFile, unusedExport.exportName)) {
          onProgress?.(`  ✓ Removed unused export: ${unusedExport.exportName}`);
          results.fixedExports++;
        }
      }

      sourceFile.saveSync();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      results.errors.push({ file: relativeFilePath, error: errorMessage });
      onProgress?.(`Error fixing ${relativeFilePath}: ${errorMessage}`);
    }
  }

  // Remove the imports and re-exports of the declarations and files that are gone so importers keep compiling
  const removedFiles = new Set(
    [...deletedFiles, ...deletedBrokenFiles].map((relativeFilePath) => path.resolve(tsConfigDir, relativeFilePath)),
  );
  removeSpecifiers(removableGroups, removedFiles, tsConfigDir, onProgress, results);

  // Group unused properties by file (only ERROR severity)
  const propertiesByFile = new Map<string, typeof analysis.unusedProperties>();
  for (const unusedProperty of analysis.unusedProperties) {
    // Only fix ERROR severity items (skip INFO for test-only and story-only, WARNING for TODOs)
    if (
      unusedProperty.severity !== SEVERITY.ERROR ||
      unusedProperty.onlyUsedInTests ||
      unusedProperty.onlyUsedInStories ||
      unusedProperty.todoComment !== undefined
    ) {
      continue;
    }
    if (!propertiesByFile.has(unusedProperty.filePath)) {
      propertiesByFile.set(unusedProperty.filePath, []);
    }
    propertiesByFile.get(unusedProperty.filePath)?.push(unusedProperty);
  }

  // Fix unused properties
  for (const [relativeFilePath, properties] of propertiesByFile.entries()) {
    const absoluteFilePath = path.resolve(tsConfigDir, relativeFilePath);

    // Skip if file was deleted
    if (filesToDelete.includes(relativeFilePath)) {
      continue;
    }

    if (filesWithChanges.has(absoluteFilePath)) {
      // Only add to skipped list if not already added
      if (!results.skippedFiles.includes(relativeFilePath)) {
        onProgress?.(`Skipped: ${relativeFilePath} (has local git changes)`);
        results.skippedFiles.push(relativeFilePath);
      }
      continue;
    }

    try {
      const sourceFile = project.getSourceFile(absoluteFilePath);
      if (!sourceFile) {
        continue;
      }

      // Only log if we haven't already logged for this file (from exports or never-returned)
      if (!exportsByFile.has(relativeFilePath) && !neverReturnedByFile.has(relativeFilePath)) {
        onProgress?.(`Fixing: ${relativeFilePath}`);
      }

      for (const unusedProperty of properties) {
        if (removeProperty(sourceFile, unusedProperty.typeName, unusedProperty.propertyName)) {
          onProgress?.(`  ✓ Removed unused property: ${unusedProperty.typeName}.${unusedProperty.propertyName}`);
          results.fixedProperties++;
        }
      }

      sourceFile.saveSync();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      results.errors.push({ file: relativeFilePath, error: errorMessage });
      onProgress?.(`Error fixing ${relativeFilePath}: ${errorMessage}`);
    }
  }

  return results;
}

/**
 * Whether fix removes an unused export: only ERROR severity, never test-only or story-only usage or TODO/ignore
 * comments
 */
function isFixableExport(unusedExport: IUnusedExportResult): boolean {
  return (
    unusedExport.severity === SEVERITY.ERROR &&
    !unusedExport.onlyUsedInTests &&
    !unusedExport.onlyUsedInStories &&
    unusedExport.todoComment === undefined
  );
}

/** Specifiers that dangle once fix removes the declaration they name, or every export of the file they import. */
interface ISpecifierGroup {
  /** Path, relative to the tsconfig directory, of the file that declares the target. */
  filePath: string;
  /** The unused export the specifiers name, or undefined for the namespace imports of the whole file. */
  exportName?: string;
  /** The declaration, or the source file, whose removal leaves the specifiers dangling. */
  target: Node;
  specifiers: RemovableSpecifier[];
}

/**
 * Find the files, relative to the tsconfig directory, that fix removes every export from: files it deletes and
 * files it keeps only because something imports them for side effects. A namespace import of such a file would
 * no longer resolve to a module.
 */
function findExhaustedFiles(removalCandidates: IUnusedExportResult[], tsConfigDir: string, project: Project): string[] {
  const candidateCounts = new Map<string, number>();
  for (const unusedExport of removalCandidates) {
    candidateCounts.set(unusedExport.filePath, (candidateCounts.get(unusedExport.filePath) ?? 0) + 1);
  }

  return [...candidateCounts].flatMap(([relativeFilePath, count]) => {
    const sourceFile = project.getSourceFile(path.resolve(tsConfigDir, relativeFilePath));
    return sourceFile?.getExportedDeclarations().size === count ? [relativeFilePath] : [];
  });
}

/**
 * Find the import and export specifiers that name each declaration of the given unused exports, and the namespace
 * imports of each file that fix removes every export from. Namespace imports of such a file are unreferenced,
 * because a referenced one would count as usage of every export. Exports and files with local git changes are
 * skipped because fix never removes them.
 */
function collectSpecifierGroups(
  unusedExports: IUnusedExportResult[],
  exhaustedFiles: string[],
  tsConfigDir: string,
  filesWithChanges: Set<string>,
  project: Project,
): ISpecifierGroup[] {
  const groups: ISpecifierGroup[] = [];

  for (const unusedExport of unusedExports) {
    const absoluteFilePath = path.resolve(tsConfigDir, unusedExport.filePath);
    const sourceFile = project.getSourceFile(absoluteFilePath);
    if (!sourceFile || filesWithChanges.has(absoluteFilePath)) {
      continue;
    }

    for (const declaration of sourceFile.getExportedDeclarations().get(unusedExport.exportName) ?? []) {
      if (declaration.getSourceFile() !== sourceFile || !Node.isReferenceFindable(declaration)) {
        continue;
      }
      const { specifiers } = classifyExportReferences(declaration);
      if (specifiers.length > 0) {
        groups.push({
          filePath: unusedExport.filePath,
          exportName: unusedExport.exportName,
          target: declaration,
          specifiers,
        });
      }
    }
  }

  for (const relativeFilePath of exhaustedFiles) {
    const absoluteFilePath = path.resolve(tsConfigDir, relativeFilePath);
    const sourceFile = project.getSourceFile(absoluteFilePath);
    if (!sourceFile || filesWithChanges.has(absoluteFilePath)) {
      continue;
    }

    const namespaceImports: NamespaceImport[] = [];
    for (const node of sourceFile.getReferencingNodesInOtherSourceFiles()) {
      const namedBindings = Node.isImportDeclaration(node) ? node.getImportClause()?.getNamedBindings() : undefined;
      if (namedBindings && Node.isNamespaceImport(namedBindings)) {
        namespaceImports.push(namedBindings);
      }
    }
    if (namespaceImports.length > 0) {
      groups.push({ filePath: relativeFilePath, target: sourceFile, specifiers: namespaceImports });
    }
  }

  return groups;
}

/** Whether fix removed what a group names: the declaration, the deleted file, or every export of the file. */
function isGroupTargetRemoved(group: ISpecifierGroup, removedFiles: Set<string>): boolean {
  const { target } = group;
  if (target.wasForgotten() || removedFiles.has(target.getSourceFile().getFilePath())) {
    return true;
  }
  return Node.isSourceFile(target) && target.getExportedDeclarations().size === 0;
}

/**
 * Find the groups with a specifier in a file fix does not edit: a file outside the analyzed tsconfig, an ignored
 * file, or one with local git changes. Fix keeps what such a group names (the export, or the file and all of its
 * exports), because removing it would leave that specifier dangling.
 */
function findBlockedGroups(
  groups: ISpecifierGroup[],
  editableFiles: Set<SourceFile>,
  ignoredFiles: Set<SourceFile>,
  filesWithChanges: Set<string>,
  tsConfigDir: string,
  onProgress: FixProgressCallback | undefined,
  results: IFixResults,
): ISpecifierGroup[] {
  const blockedGroups: ISpecifierGroup[] = [];

  for (const group of groups) {
    const blockingFiles = new Set(
      group.specifiers
        .map((specifier) => specifier.getSourceFile())
        .filter((sourceFile) => !editableFiles.has(sourceFile) || filesWithChanges.has(sourceFile.getFilePath())),
    );
    if (blockingFiles.size === 0) {
      continue;
    }

    blockedGroups.push(group);
    const target = group.exportName ? `${group.filePath}:${group.exportName}` : group.filePath;
    for (const sourceFile of blockingFiles) {
      const relativeFilePath = path.relative(tsConfigDir, sourceFile.getFilePath());
      if (ignoredFiles.has(sourceFile)) {
        onProgress?.(`Skipped: ${target} (named in ${relativeFilePath}, which matches ignoreFilePatterns)`);
        continue;
      }
      if (!editableFiles.has(sourceFile)) {
        onProgress?.(`Skipped: ${target} (named in ${relativeFilePath}, outside the analyzed tsconfig)`);
        continue;
      }
      onProgress?.(`Skipped: ${target} (named in ${relativeFilePath}, which has local git changes)`);
      if (!results.skippedFiles.includes(relativeFilePath)) {
        results.skippedFiles.push(relativeFilePath);
      }
    }
  }

  return blockedGroups;
}

/**
 * Remove the specifiers of the declarations that fix removed and the namespace imports of the files it emptied or deleted.
 * Every specifier is in an editable file, because findBlockedGroups kept the targets of all others.
 */
function removeSpecifiers(
  groups: ISpecifierGroup[],
  removedFiles: Set<string>,
  tsConfigDir: string,
  onProgress: FixProgressCallback | undefined,
  results: IFixResults,
): void {
  const editedFiles = new Set<SourceFile>();

  for (const group of groups) {
    if (!isGroupTargetRemoved(group, removedFiles)) {
      continue;
    }

    for (const specifier of group.specifiers) {
      if (specifier.wasForgotten()) {
        continue;
      }
      const sourceFile = specifier.getSourceFile();
      if (removedFiles.has(sourceFile.getFilePath())) {
        continue;
      }

      const specifierText = specifier.getText();
      const specifierKind = Node.isExportSpecifier(specifier) ? "re-export" : "import";
      const targetKind = group.exportName ? "unused export" : "file without exports";
      removeSpecifier(specifier);
      editedFiles.add(sourceFile);
      onProgress?.(
        `  ✓ Removed ${specifierKind} of ${targetKind}: ${specifierText} (${path.relative(tsConfigDir, sourceFile.getFilePath())})`,
      );
    }
  }

  for (const sourceFile of editedFiles) {
    try {
      sourceFile.saveSync();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const relativeFilePath = path.relative(tsConfigDir, sourceFile.getFilePath());
      results.errors.push({ file: relativeFilePath, error: errorMessage });
      onProgress?.(`Error fixing ${relativeFilePath}: ${errorMessage}`);
    }
  }
}

/**
 * Remove an export from a source file
 */
function removeExport(sourceFile: SourceFile, exportName: string): boolean {
  // Find all exported declarations with this name
  const exportedDeclarations = sourceFile.getExportedDeclarations();
  const declarations = exportedDeclarations.get(exportName);

  if (!declarations || declarations.length === 0) {
    return false;
  }

  for (const declaration of declarations) {
    // For variable declarations, we need to remove the VariableStatement
    if (declaration.getKind() === SyntaxKind.VariableDeclaration) {
      const variableStatement = declaration.getFirstAncestorByKind(SyntaxKind.VariableStatement);
      if (variableStatement) {
        variableStatement.remove();
        continue;
      }
    }

    // Remove the node if it has a remove method
    if ("remove" in declaration && typeof declaration.remove === "function") {
      declaration.remove();
    }
  }

  return true;
}

/**
 * Remove a property from an interface or type alias
 */
function removeProperty(sourceFile: SourceFile, typeName: string, propertyName: string): boolean {
  // Find interface declarations
  const interfaces = sourceFile.getInterfaces();
  for (const iface of interfaces) {
    if (iface.getName() === typeName) {
      const property = iface.getProperty(propertyName);
      if (property) {
        property.remove();
        return true;
      }
    }
  }

  // Find type alias declarations
  const typeAliases = sourceFile.getTypeAliases();
  for (const typeAlias of typeAliases) {
    if (typeAlias.getName() === typeName) {
      const typeNode = typeAlias.getTypeNode();
      if (typeNode && typeNode.getKind() === SyntaxKind.TypeLiteral) {
        const typeLiteral = typeNode.asKindOrThrow(SyntaxKind.TypeLiteral);
        const members = typeLiteral.getMembers();
        for (const member of members) {
          if (member.getKind() === SyntaxKind.PropertySignature) {
            const propSig = member.asKind(SyntaxKind.PropertySignature);
            if (propSig?.getName() === propertyName) {
              propSig.remove();
              return true;
            }
          }
        }
      }
    }
  }

  return false;
}

/**
 * Remove a never-returned type from a function's return type union
 */
function removeNeverReturnedType(sourceFile: SourceFile, functionName: string, neverReturnedType: string): boolean {
  // Find the function
  const functions = sourceFile.getFunctions();
  for (const func of functions) {
    if (func.getName() === functionName) {
      const returnTypeNode = func.getReturnTypeNode();
      if (!returnTypeNode) {
        return false;
      }

      // Get the actual type (resolved) to check if it's a union
      const returnType = returnTypeNode.getType();

      // For Promise types, unwrap to get inner type
      let typeToCheck = returnType;
      let isPromise = false;
      const symbol = returnType.getSymbol();
      if (symbol?.getName() === "Promise") {
        const typeArgs = returnType.getTypeArguments();
        if (typeArgs.length > 0 && typeArgs[0]) {
          typeToCheck = typeArgs[0];
          isPromise = true;
        }
      }

      // Check if it's a union type
      if (!typeToCheck.isUnion()) {
        return false;
      }

      const unionTypes = typeToCheck.getUnionTypes();

      // Check if any of the union branches is an inline object type or enum literal
      const hasInlineObjectType = unionTypes.some((ut) => ut.getSymbol()?.getName() === "__type");
      const hasEnumLiteral = unionTypes.some((ut) => ut.isEnumLiteral());

      if (hasInlineObjectType || hasEnumLiteral) {
        // Use source text manipulation for inline object types and enum literals
        const originalTypeText = returnTypeNode.getText();

        // For Promise types, we need to extract the inner type text
        let typeTextToModify = originalTypeText;
        let promiseWrapper = "";
        if (isPromise) {
          const promiseMatch = originalTypeText.match(/^Promise<(.+)>$/s);
          if (promiseMatch?.[1]) {
            typeTextToModify = promiseMatch[1];
            promiseWrapper = "Promise<>";
          }
        }

        // Split the union by | but handle nested structures
        const branches = splitUnionType(typeTextToModify);

        // Normalize the type to remove for comparison
        const normalizedRemove = normalizeTypeText(
          neverReturnedType === "true" || neverReturnedType === "false" ? "boolean" : neverReturnedType,
        );

        // Filter out the branch to remove
        const remainingBranches = branches.filter((branch) => {
          const trimmed = branch.trim();
          // Normalize boolean for comparison
          const normalized = normalizeTypeText(trimmed === "true" || trimmed === "false" ? "boolean" : trimmed);
          return normalized !== normalizedRemove;
        });

        if (remainingBranches.length === 0 || remainingBranches.length === branches.length) {
          // Either all removed (shouldn't happen) or nothing matched
          return false;
        }

        // Build the new return type
        let newReturnType = remainingBranches.join(" | ");

        // Wrap in Promise if needed
        if (promiseWrapper) {
          newReturnType = `Promise<${newReturnType}>`;
        }

        // Replace the return type
        func.setReturnType(newReturnType);
        return true;
      } else {
        // Use the old approach for named types (interfaces, type aliases, enums)
        const typesToKeep: string[] = [];
        for (const ut of unionTypes) {
          const symbol = ut.getSymbol();
          const typeName = symbol?.getName() || ut.getText();

          // Normalize boolean
          const normalizedName = typeName === "true" || typeName === "false" ? "boolean" : typeName;
          const normalizedRemove =
            neverReturnedType === "true" || neverReturnedType === "false" ? "boolean" : neverReturnedType;

          if (normalizedName !== normalizedRemove && !typesToKeep.includes(typeName)) {
            typesToKeep.push(typeName);
          }
        }

        // Build the new return type
        let newReturnType: string | undefined;
        if (typesToKeep.length === 1 && typesToKeep[0]) {
          newReturnType = typesToKeep[0];
        } else if (typesToKeep.length > 1) {
          newReturnType = typesToKeep.join(" | ");
        }

        if (!newReturnType) {
          // All types removed, shouldn't happen
          return false;
        }

        // Wrap in Promise if needed
        if (isPromise) {
          newReturnType = `Promise<${newReturnType}>`;
        }

        // Replace the return type
        func.setReturnType(newReturnType);
        return true;
      }
    }
  }

  return false;
}

/**
 * Split a union type string by | while respecting nested structures
 */
function splitUnionType(typeText: string): string[] {
  const branches: string[] = [];
  let current = "";
  let depth = 0;
  let inString = false;
  let stringChar = "";

  for (let i = 0; i < typeText.length; i++) {
    const char = typeText[i];
    const prevChar = i > 0 ? typeText[i - 1] : "";

    // Handle string literals
    if ((char === '"' || char === "'") && prevChar !== "\\") {
      if (!inString) {
        inString = true;
        stringChar = char;
      } else if (char === stringChar) {
        inString = false;
        stringChar = "";
      }
    }

    if (!inString) {
      // Track depth for nested structures
      if (char === "{" || char === "<" || char === "(") {
        depth++;
      } else if (char === "}" || char === ">" || char === ")") {
        depth--;
      } else if (char === "|" && depth === 0) {
        // Found a top-level union separator
        branches.push(current);
        current = "";
        continue;
      }
    }

    current += char;
  }

  // Add the last branch
  if (current) {
    branches.push(current);
  }

  return branches;
}

/**
 * Normalize type text for comparison by removing optional trailing semicolons
 */
function normalizeTypeText(typeText: string): string {
  // Remove semicolons before closing braces/brackets
  return typeText
    .replace(/;\s*([}\]>])/g, " $1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Clean up files that have broken imports after file deletions
 * If a file only contains re-exports from deleted files, remove those exports or delete the file
 * @returns Relative paths of the files it deleted
 */
function cleanupBrokenImports(
  sourceFiles: SourceFile[],
  tsConfigDir: string,
  deletedFiles: Set<string>,
  filesWithChanges: Set<string>,
  onProgress?: FixProgressCallback,
  results?: IFixResults,
): Set<string> {
  const deletedBrokenFiles = new Set<string>();
  for (const sourceFile of sourceFiles) {
    const relativePath = path.relative(tsConfigDir, sourceFile.getFilePath());
    const absolutePath = sourceFile.getFilePath();

    // Skip if file has git changes
    if (filesWithChanges.has(absolutePath)) {
      continue;
    }

    // Check for broken imports/exports
    const exportDeclarations = sourceFile.getExportDeclarations();
    let hasValidExports = false;
    const brokenExports: typeof exportDeclarations = [];

    for (const exportDecl of exportDeclarations) {
      const moduleSpecifier = exportDecl.getModuleSpecifierValue();
      if (moduleSpecifier) {
        // Resolve the import path
        const resolvedPath = resolveImportPath(sourceFile.getFilePath(), moduleSpecifier);
        const relativeResolvedPath = resolvedPath ? path.relative(tsConfigDir, resolvedPath) : null;

        // Check if it references a deleted file
        if (relativeResolvedPath && deletedFiles.has(relativeResolvedPath)) {
          brokenExports.push(exportDecl);
        } else {
          hasValidExports = true;
        }
      } else {
        // Export without module specifier (e.g., export { foo })
        hasValidExports = true;
      }
    }

    // Also check if file has any non-export declarations
    const hasOwnDeclarations =
      sourceFile.getFunctions().length > 0 ||
      sourceFile.getClasses().length > 0 ||
      sourceFile.getInterfaces().length > 0 ||
      sourceFile.getTypeAliases().length > 0 ||
      sourceFile.getVariableDeclarations().length > 0 ||
      sourceFile.getEnums().length > 0;

    if (hasOwnDeclarations) {
      hasValidExports = true;
    }

    // If file only has broken re-exports, delete it
    if (brokenExports.length > 0 && !hasValidExports) {
      try {
        onProgress?.(`Deleting: ${relativePath} (only re-exports from deleted files)`);
        fs.unlinkSync(absolutePath);
        deletedBrokenFiles.add(relativePath);
        if (results) {
          results.deletedFiles++;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (results) {
          results.errors.push({ file: relativePath, error: errorMessage });
        }
        onProgress?.(`Error deleting ${relativePath}: ${errorMessage}`);
      }
    }
    // Otherwise, just remove the broken export declarations
    else if (brokenExports.length > 0) {
      try {
        onProgress?.(`Fixing: ${relativePath}`);
        for (const exportDecl of brokenExports) {
          const moduleSpec = exportDecl.getModuleSpecifierValue();
          exportDecl.remove();
          onProgress?.(`  ✓ Removed broken re-export from: ${moduleSpec}`);
        }
        sourceFile.saveSync();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (results) {
          results.errors.push({ file: relativePath, error: errorMessage });
        }
        onProgress?.(`Error fixing ${relativePath}: ${errorMessage}`);
      }
    }
  }
  return deletedBrokenFiles;
}

/**
 * Resolve an import path to an absolute file path
 */
function resolveImportPath(fromFile: string, importPath: string): string | null {
  const fromDir = path.dirname(fromFile);

  // Handle relative imports
  if (importPath.startsWith(".")) {
    const resolved = path.resolve(fromDir, importPath);

    // Try with different extensions
    const extensions = [".ts", ".tsx", ".js", ".jsx"];
    for (const ext of extensions) {
      const withExt = resolved + ext;
      if (fs.existsSync(withExt)) {
        return withExt;
      }
    }

    // Try as index file
    for (const ext of extensions) {
      const indexFile = path.join(resolved, `index${ext}`);
      if (fs.existsSync(indexFile)) {
        return indexFile;
      }
    }

    // Return as-is if no extension found (might be a directory or invalid)
    return `${resolved}.ts`;
  }

  return null;
}
