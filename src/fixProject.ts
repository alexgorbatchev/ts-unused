import fs from "node:fs";
import path from "node:path";
import { Project, type SourceFile, SyntaxKind } from "ts-morph";
import { analyzeProject } from "./analyzeProject";
import { checkGitStatus } from "./checkGitStatus";
import { isTestFile as defaultIsTestFile } from "./isTestFile";
import type { AnalysisResults, IsTestFileFn } from "./types";

export interface FixResults {
  fixedExports: number;
  fixedProperties: number;
  deletedFiles: number;
  skippedFiles: string[];
  errors: Array<{ file: string; error: string }>;
}

export function fixProject(
  tsConfigPath: string,
  onProgress?: (message: string) => void,
  isTestFile: IsTestFileFn = defaultIsTestFile
): FixResults {
  const results: FixResults = {
    fixedExports: 0,
    fixedProperties: 0,
    deletedFiles: 0,
    skippedFiles: [],
    errors: [],
  };

  // Analyze the project to find unused items
  const analysis: AnalysisResults = analyzeProject(tsConfigPath, undefined, undefined, isTestFile);

  // Get the directory containing tsconfig
  const tsConfigDir = path.dirname(path.resolve(tsConfigPath));

  // Check git status to avoid modifying files with local changes
  const filesWithChanges = checkGitStatus(tsConfigDir);

  // Create ts-morph project for making fixes
  const project = new Project({
    tsConfigFilePath: tsConfigPath,
  });

  // Fix unused files first (delete them)
  const deletedFiles = new Set<string>();
  for (const relativeFilePath of analysis.unusedFiles) {
    const absoluteFilePath = path.resolve(tsConfigDir, relativeFilePath);

    if (filesWithChanges.has(absoluteFilePath)) {
      onProgress?.(`⚠️  Skipped: ${relativeFilePath} (has local git changes)`);
      results.skippedFiles.push(relativeFilePath);
      continue;
    }

    try {
      onProgress?.(`🗑️  Deleting: ${relativeFilePath} (all exports unused)`);
      fs.unlinkSync(absoluteFilePath);
      deletedFiles.add(relativeFilePath);
      results.deletedFiles++;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      results.errors.push({ file: relativeFilePath, error: errorMessage });
      onProgress?.(`❌ Error deleting ${relativeFilePath}: ${errorMessage}`);
    }
  }

  // Clean up files that only contain broken imports after deletions
  if (deletedFiles.size > 0) {
    cleanupBrokenImports(project, tsConfigDir, deletedFiles, filesWithChanges, onProgress, results);
  }

  // Group unused exports by file
  const exportsByFile = new Map<string, typeof analysis.unusedExports>();
  for (const unusedExport of analysis.unusedExports) {
    if (!exportsByFile.has(unusedExport.filePath)) {
      exportsByFile.set(unusedExport.filePath, []);
    }
    exportsByFile.get(unusedExport.filePath)?.push(unusedExport);
  }

  // Fix unused exports
  for (const [relativeFilePath, exports] of exportsByFile.entries()) {
    const absoluteFilePath = path.resolve(tsConfigDir, relativeFilePath);

    // Skip if file was deleted
    if (analysis.unusedFiles.includes(relativeFilePath)) {
      continue;
    }

    if (filesWithChanges.has(absoluteFilePath)) {
      onProgress?.(`⚠️  Skipped: ${relativeFilePath} (has local git changes)`);
      results.skippedFiles.push(relativeFilePath);
      continue;
    }

    try {
      const sourceFile = project.getSourceFile(absoluteFilePath);
      if (!sourceFile) {
        continue;
      }

      onProgress?.(`🔧 Fixing: ${relativeFilePath}`);

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
      onProgress?.(`❌ Error fixing ${relativeFilePath}: ${errorMessage}`);
    }
  }

  // Group unused properties by file
  const propertiesByFile = new Map<string, typeof analysis.unusedProperties>();
  for (const unusedProperty of analysis.unusedProperties) {
    if (!propertiesByFile.has(unusedProperty.filePath)) {
      propertiesByFile.set(unusedProperty.filePath, []);
    }
    propertiesByFile.get(unusedProperty.filePath)?.push(unusedProperty);
  }

  // Fix unused properties
  for (const [relativeFilePath, properties] of propertiesByFile.entries()) {
    const absoluteFilePath = path.resolve(tsConfigDir, relativeFilePath);

    // Skip if file was deleted
    if (analysis.unusedFiles.includes(relativeFilePath)) {
      continue;
    }

    if (filesWithChanges.has(absoluteFilePath)) {
      // Only add to skipped list if not already added
      if (!results.skippedFiles.includes(relativeFilePath)) {
        onProgress?.(`⚠️  Skipped: ${relativeFilePath} (has local git changes)`);
        results.skippedFiles.push(relativeFilePath);
      }
      continue;
    }

    try {
      const sourceFile = project.getSourceFile(absoluteFilePath);
      if (!sourceFile) {
        continue;
      }

      // Only log if we haven't already logged for this file (from exports)
      if (!exportsByFile.has(relativeFilePath)) {
        onProgress?.(`🔧 Fixing: ${relativeFilePath}`);
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
      onProgress?.(`❌ Error fixing ${relativeFilePath}: ${errorMessage}`);
    }
  }

  return results;
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
 * Clean up files that have broken imports after file deletions
 * If a file only contains re-exports from deleted files, remove those exports or delete the file
 */
function cleanupBrokenImports(
  project: Project,
  tsConfigDir: string,
  deletedFiles: Set<string>,
  filesWithChanges: Set<string>,
  onProgress?: (message: string) => void,
  results?: FixResults
): void {
  // Refresh the project to detect errors after deletions
  const sourceFiles = project.getSourceFiles();

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
        onProgress?.(`🗑️  Deleting: ${relativePath} (only re-exports from deleted files)`);
        fs.unlinkSync(absolutePath);
        if (results) {
          results.deletedFiles++;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (results) {
          results.errors.push({ file: relativePath, error: errorMessage });
        }
        onProgress?.(`❌ Error deleting ${relativePath}: ${errorMessage}`);
      }
    }
    // Otherwise, just remove the broken export declarations
    else if (brokenExports.length > 0) {
      try {
        onProgress?.(`🔧 Fixing: ${relativePath}`);
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
        onProgress?.(`❌ Error fixing ${relativePath}: ${errorMessage}`);
      }
    }
  }
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
