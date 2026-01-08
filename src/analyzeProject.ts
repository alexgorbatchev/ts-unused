import path from "node:path";
import { Project, SyntaxKind } from "ts-morph";
import { analyzeFunctionReturnTypes } from "./analyzeFunctionReturnTypes";
import { analyzeInterfaces } from "./analyzeInterfaces";
import { analyzeTypeAliases } from "./analyzeTypeAliases";
import { checkExportUsage } from "./checkExportUsage";
import { defaultConfig, type UnusedConfig } from "./config";
import { hasNoCheck } from "./hasNoCheck";
import { createIsTestFile, isTestFile as defaultIsTestFile } from "./isTestFile";
import { findPackageJson, getPackageEntryPoints } from "./packageEntryPoints";
import { matchesFilePattern } from "./patternMatcher";
import { tracePublicExports } from "./tracePublicExports";
import type {
  AnalysisResults,
  IsTestFileFn,
  NeverReturnedTypeResult,
  UnusedExportResult,
  UnusedPropertyResult,
} from "./types";

export interface AnalyzeProjectOptions {
  /**
   * Configuration options for the analysis.
   */
  config?: UnusedConfig;

  /**
   * Custom test file detection function (overrides config.testFilePatterns).
   */
  isTestFile?: IsTestFileFn;
}

export async function analyzeProject(
  tsConfigPath: string,
  onProgress?: (current: number, total: number, filePath: string) => void,
  targetFilePath?: string,
  isTestFileOrOptions?: IsTestFileFn | AnalyzeProjectOptions
): Promise<AnalysisResults> {
  // Handle backward compatibility: can pass IsTestFileFn directly or options object
  let options: AnalyzeProjectOptions = {};
  if (typeof isTestFileOrOptions === "function") {
    options = { isTestFile: isTestFileOrOptions };
  } else if (isTestFileOrOptions) {
    options = isTestFileOrOptions;
  }

  const config: Required<UnusedConfig> = {
    ...defaultConfig,
    ...options.config,
  };

  // Determine the isTestFile function
  const isTestFile: IsTestFileFn = options.isTestFile
    ? options.isTestFile
    : config.testFilePatterns
      ? createIsTestFile(config.testFilePatterns)
      : defaultIsTestFile;

  const project: Project = new Project({
    tsConfigFilePath: tsConfigPath,
  });

  const tsConfigDir: string = path.dirname(tsConfigPath);

  // Handle package mode
  let publicExports: Set<string> | undefined;
  if (config.packageMode) {
    const packageJsonPath = findPackageJson(tsConfigDir);
    if (!packageJsonPath) {
      throw new Error(
        `Package mode is enabled but no package.json was found. ` +
          `Searched from: ${tsConfigDir}`
      );
    }

    const entryPoints = getPackageEntryPoints(packageJsonPath);
    if (entryPoints.length === 0) {
      throw new Error(
        `Package mode is enabled but package.json has no entry points. ` +
          `Expected 'main', 'module', or 'exports' field in: ${packageJsonPath}`
      );
    }

    const packageDir = path.dirname(packageJsonPath);
    const entryPointFiles = entryPoints.map((ep) => ep.sourceFile);
    publicExports = tracePublicExports(project, entryPointFiles, packageDir);
  }

  // Get total file count for progress reporting
  const allSourceFiles = project.getSourceFiles();
  const filesToAnalyze = allSourceFiles.filter((sf) => {
    if (isTestFile(sf)) {
      return false;
    }
    if (hasNoCheck(sf)) {
      return false;
    }
    if (targetFilePath && sf.getFilePath() !== targetFilePath) {
      return false;
    }
    // Check if file should be ignored based on patterns
    if (config.ignoreFilePatterns.length > 0 && matchesFilePattern(sf.getFilePath(), config.ignoreFilePatterns)) {
      return false;
    }
    return true;
  });
  const totalFiles: number = filesToAnalyze.length;

  let currentFile = 0;

  // Build options for analysis
  const exportCheckOptions = {
    ignoreExports: config.ignoreExports,
    ignoreModuleAugmentations: config.ignoreModuleAugmentations,
    publicExports: publicExports,
  };

  const propertyAnalyzeOptions = {
    ignoreProperties: config.ignoreProperties,
    ignoreTypes: config.ignoreTypes,
  };

  // Results arrays
  const unusedExports: UnusedExportResult[] = [];
  const unusedProperties: UnusedPropertyResult[] = [];
  const neverReturnedTypes: NeverReturnedTypeResult[] = [];

  // Single pass over all files - much more efficient than 3 separate passes
  for (const sourceFile of filesToAnalyze) {
    const filePath = sourceFile.getFilePath();
    const relativePath = path.relative(tsConfigDir, filePath);

    // Report progress
    if (onProgress) {
      currentFile++;
      onProgress(currentFile, totalFiles, relativePath);
    }

    // Analyze exports
    if (config.analyzeExports) {
      const exports = sourceFile.getExportedDeclarations();
      for (const [exportName, declarations] of exports.entries()) {
        const unusedExport = checkExportUsage(
          exportName,
          declarations,
          sourceFile,
          tsConfigDir,
          isTestFile,
          exportCheckOptions
        );
        if (unusedExport) {
          unusedExports.push(unusedExport);
        }
      }
    }

    // Analyze properties
    if (config.analyzeProperties) {
      analyzeInterfaces(sourceFile, tsConfigDir, isTestFile, unusedProperties, project, propertyAnalyzeOptions);
      analyzeTypeAliases(sourceFile, tsConfigDir, isTestFile, unusedProperties, project, propertyAnalyzeOptions);
    }

    // Analyze never-returned types
    if (config.analyzeNeverReturnedTypes) {
      const functions = sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration);
      for (const func of functions) {
        const funcResults = analyzeFunctionReturnTypes(func, sourceFile, tsConfigDir);
        neverReturnedTypes.push(...funcResults);
      }
    }
  }

  // Identify completely unused files (where all exports are unused)
  const unusedFiles: string[] = [];

  if (config.detectUnusedFiles) {
    const fileExportCounts = new Map<string, { total: number; unused: number; testOnly: number }>();

    // Count total exports per file
    for (const sourceFile of filesToAnalyze) {
      const filePath = path.relative(tsConfigDir, sourceFile.getFilePath());
      const exports = sourceFile.getExportedDeclarations();
      const totalExports = exports.size;

      if (totalExports > 0) {
        fileExportCounts.set(filePath, { total: totalExports, unused: 0, testOnly: 0 });
      }
    }

    // Count unused exports per file
    for (const unusedExport of unusedExports) {
      const counts = fileExportCounts.get(unusedExport.filePath);
      if (counts) {
        counts.unused++;
        if (unusedExport.onlyUsedInTests) {
          counts.testOnly++;
        }
      }
    }

    // Identify files where all exports are unused AND not just test-only
    // Files with any test-only exports should show individual exports with [INFO], not be listed as completely unused
    for (const [filePath, counts] of fileExportCounts.entries()) {
      // Only add to unusedFiles if:
      // 1. All exports are "unused" (in the unusedExports list)
      // 2. NONE of the exports are test-only (all are completely unused with severity: error)
      const allExportsUnused = counts.total > 0 && counts.unused === counts.total;
      const hasAnyTestOnlyExports = counts.testOnly > 0;

      if (allExportsUnused && !hasAnyTestOnlyExports) {
        unusedFiles.push(filePath);
      }
    }
  }

  const results: AnalysisResults = {
    unusedExports,
    unusedProperties,
    unusedFiles,
    neverReturnedTypes,
  };

  return results;
}
