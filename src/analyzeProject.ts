import { RULE_NAME, RULE_SEVERITY } from "./constants.js";
import path from "node:path";
import { type Node, type SourceFile, SyntaxKind } from "ts-morph";
import { analyzeFunctionReturnTypes } from "./analyzeFunctionReturnTypes.js";
import { analyzeDuplicateTypes } from "./analyzeDuplicateTypes.js";
import { analyzeInterfaces } from "./analyzeInterfaces.js";
import { analyzeTypeAliases } from "./analyzeTypeAliases.js";
import { checkExportUsage } from "./checkExportUsage.js";
import { collectPublicApiDeclarations } from "./collectPublicApiDeclarations.js";
import { mergeConfig, type IUnusedConfig } from "./config.js";
import { applyRuleSeverities } from "./applyRuleSeverities.js";
import { hasNoCheck } from "./hasNoCheck.js";
import { isImportedForSideEffects } from "./isImportedForSideEffects.js";
import { createIsTestFile, isTestFile as defaultIsTestFile } from "./isTestFile.js";
import { loadProject } from "./loadProject.js";
import { findPackageJson, resolvePackageEntryPoints } from "./packageEntryPoints.js";
import { matchesFilePattern } from "./patternMatcher.js";
import { tracePublicExports } from "./tracePublicExports.js";
import type {
  IAnalysisResults,
  IsTestFileFn,
  INeverReturnedTypeResult,
  IUnusedExportResult,
  IUnusedPropertyResult,
} from "./types.js";

export type ProgressCallback = (current: number, total: number, filePath: string) => void;

export interface IAnalyzeProjectOptions {
  /**
   * Configuration options for the analysis.
   */
  config?: IUnusedConfig;

  /**
   * Custom test file detection function (overrides config.testFilePatterns).
   */
  isTestFile?: IsTestFileFn;
}

export type IsTestFileFnOrOptions = IsTestFileFn | IAnalyzeProjectOptions;

export async function analyzeProject(
  tsConfigPath: string,
  onProgress?: ProgressCallback,
  targetFilePath?: string,
  isTestFileOrOptions?: IsTestFileFnOrOptions,
): Promise<IAnalysisResults> {
  // Handle backward compatibility: can pass IsTestFileFn directly or options object
  let options: IAnalyzeProjectOptions = {};
  if (typeof isTestFileOrOptions === "function") {
    options = { isTestFile: isTestFileOrOptions };
  } else if (isTestFileOrOptions) {
    options = isTestFileOrOptions;
  }

  const config = mergeConfig(options.config ?? {});

  // Determine the isTestFile function
  const isTestFile: IsTestFileFn = options.isTestFile
    ? options.isTestFile
    : config.testFilePatterns
      ? createIsTestFile(config.testFilePatterns)
      : defaultIsTestFile;

  const { project, projectFiles } = loadProject(tsConfigPath);

  const tsConfigDir: string = path.dirname(tsConfigPath);

  // Handle package mode
  let publicDeclarations: Set<Node> | undefined;
  let publicApiDeclarations: Set<Node> | undefined;
  if (config.packageMode) {
    const packageJsonPath = findPackageJson(tsConfigDir);
    if (!packageJsonPath) {
      throw new Error(`Package mode is enabled but no package.json was found. ` + `Searched from: ${tsConfigDir}`);
    }

    const { targets, sourceFiles } = resolvePackageEntryPoints(packageJsonPath, project, projectFiles);
    if (targets.length === 0) {
      throw new Error(
        `Package mode is enabled but package.json has no entry points. ` +
          `Expected 'main', 'module', 'types', or 'exports' field in: ${packageJsonPath}`,
      );
    }
    if (sourceFiles.length === 0) {
      throw new Error(
        `Package mode is enabled but no package.json entry point resolves to a project source file: ${targets.join(", ")}`,
      );
    }

    publicDeclarations = tracePublicExports(sourceFiles);
    publicApiDeclarations = collectPublicApiDeclarations(publicDeclarations, projectFiles, project.getTypeChecker());
  }

  // Get total file count for progress reporting
  const filesToAnalyze = projectFiles.filter((sf) => {
    if (isTestFile(sf)) {
      return false;
    }
    if (hasNoCheck(sf)) {
      return false;
    }
    // Check if file should be ignored based on patterns
    if (config.ignoreFilePatterns.length > 0 && matchesFilePattern(sf.getFilePath(), config.ignoreFilePatterns)) {
      return false;
    }
    return true;
  });
  const targetFiles = targetFilePath
    ? filesToAnalyze.filter((sf) => sf.getFilePath() === targetFilePath)
    : filesToAnalyze;
  const totalFiles: number = targetFiles.length;

  let currentFile = 0;

  // Build options for analysis
  const exportCheckOptions = {
    ignoreExports: config.ignoreExports,
    ignoreModuleAugmentations: config.ignoreModuleAugmentations,
    publicDeclarations,
  };

  const propertyAnalyzeOptions = {
    ignoreProperties: config.ignoreProperties,
    ignoreTypes: config.ignoreTypes,
    publicApiDeclarations,
  };

  // Results arrays
  const unusedExports: IUnusedExportResult[] = [];
  const unusedProperties: IUnusedPropertyResult[] = [];
  const neverReturnedTypes: INeverReturnedTypeResult[] = [];
  const hasCommentRules =
    config.rules[RULE_NAME.TODO_COMMENTS] !== RULE_SEVERITY.OFF ||
    config.rules[RULE_NAME.IGNORE_COMMENTS] !== RULE_SEVERITY.OFF;

  // Analyze per-file exports, properties, and function return types.
  for (const sourceFile of targetFiles) {
    const filePath = sourceFile.getFilePath();
    const relativePath = path.relative(tsConfigDir, filePath);

    // Report progress
    if (onProgress) {
      currentFile++;
      onProgress(currentFile, totalFiles, relativePath);
    }

    // Analyze exports
    if (
      config.analyzeExports &&
      (config.rules[RULE_NAME.UNUSED_EXPORTS] !== RULE_SEVERITY.OFF ||
        hasCommentRules ||
        (config.detectUnusedFiles && config.rules[RULE_NAME.UNUSED_FILES] !== RULE_SEVERITY.OFF))
    ) {
      const exports = sourceFile.getExportedDeclarations();
      for (const [exportName, declarations] of exports.entries()) {
        const unusedExport = checkExportUsage(
          exportName,
          declarations,
          sourceFile,
          tsConfigDir,
          isTestFile,
          exportCheckOptions,
        );
        if (unusedExport) {
          unusedExports.push(unusedExport);
        }
      }
    }

    // Analyze properties
    if (
      config.analyzeProperties &&
      (config.rules[RULE_NAME.UNUSED_PROPERTIES] !== RULE_SEVERITY.OFF || hasCommentRules)
    ) {
      analyzeInterfaces(sourceFile, tsConfigDir, isTestFile, unusedProperties, project, propertyAnalyzeOptions);
      analyzeTypeAliases(sourceFile, tsConfigDir, isTestFile, unusedProperties, project, propertyAnalyzeOptions);
    }

    // Analyze never-returned types
    if (config.analyzeNeverReturnedTypes && config.rules[RULE_NAME.NEVER_RETURNED_TYPES] !== RULE_SEVERITY.OFF) {
      const functions = sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration);
      for (const func of functions) {
        const funcResults = analyzeFunctionReturnTypes(func, sourceFile, tsConfigDir);
        neverReturnedTypes.push(...funcResults);
      }
    }
  }

  interface IFileExportCount {
    sourceFile: SourceFile;
    total: number;
    unused: number;
    protectedExports: number;
  }

  // Identify completely unused files (where all exports are unused)
  const unusedFiles: string[] = [];

  if (config.detectUnusedFiles && config.rules[RULE_NAME.UNUSED_FILES] !== RULE_SEVERITY.OFF) {
    const fileExportCounts = new Map<string, IFileExportCount>();

    // Count total exports per file
    for (const sourceFile of targetFiles) {
      const filePath = path.relative(tsConfigDir, sourceFile.getFilePath());
      const exports = sourceFile.getExportedDeclarations();
      const totalExports = exports.size;

      if (totalExports > 0) {
        fileExportCounts.set(filePath, { sourceFile, total: totalExports, unused: 0, protectedExports: 0 });
      }
    }

    // Count unused exports per file
    for (const unusedExport of unusedExports) {
      const counts = fileExportCounts.get(unusedExport.filePath);
      if (counts) {
        counts.unused++;
        if (unusedExport.onlyUsedInTests || unusedExport.todoComment !== undefined) {
          counts.protectedExports++;
        }
      }
    }

    // Keep TODO/ignore and test-only exports, and files imported for side effects, out of deletion candidates.
    for (const [filePath, counts] of fileExportCounts.entries()) {
      const allExportsUnused = counts.total > 0 && counts.unused === counts.total;
      const hasProtectedExports = counts.protectedExports > 0;

      if (allExportsUnused && !hasProtectedExports && !isImportedForSideEffects(counts.sourceFile)) {
        unusedFiles.push(filePath);
      }
    }
  }

  const results: IAnalysisResults = {
    unusedExports,
    unusedProperties,
    unusedFiles,
    neverReturnedTypes,
    duplicateTypes:
      config.analyzeDuplicateTypes && config.rules[RULE_NAME.DUPLICATE_TYPES] !== RULE_SEVERITY.OFF
        ? analyzeDuplicateTypes(filesToAnalyze, tsConfigDir, config.ignoreTypes, targetFilePath)
        : [],
  };

  return applyRuleSeverities(results, config.rules);
}
