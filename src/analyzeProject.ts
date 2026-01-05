import path from "node:path";
import { Project } from "ts-morph";
import { defaultConfig, type UnusedConfig } from "./config";
import { findNeverReturnedTypes } from "./findNeverReturnedTypes";
import { findUnusedExports } from "./findUnusedExports";
import { findUnusedProperties } from "./findUnusedProperties";
import { hasNoCheck } from "./hasNoCheck";
import { createIsTestFile, isTestFile as defaultIsTestFile } from "./isTestFile";
import { matchesFilePattern } from "./patternMatcher";
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

export function analyzeProject(
  tsConfigPath: string,
  onProgress?: (current: number, total: number, filePath: string) => void,
  targetFilePath?: string,
  isTestFileOrOptions?: IsTestFileFn | AnalyzeProjectOptions
): AnalysisResults {
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
  const filesProcessed = new Set<string>();
  const progressCallback = onProgress
    ? (filePath: string) => {
        // Only increment once per file (called from both exports and properties analysis)
        if (!filesProcessed.has(filePath)) {
          filesProcessed.add(filePath);
          currentFile++;
          onProgress(currentFile, totalFiles, filePath);
        }
      }
    : undefined;

  // Build options for child functions
  const exportOptions = {
    ignoreFilePatterns: config.ignoreFilePatterns,
    ignoreExports: config.ignoreExports,
    ignoreModuleAugmentations: config.ignoreModuleAugmentations,
  };

  const propertyOptions = {
    ignoreFilePatterns: config.ignoreFilePatterns,
    ignoreProperties: config.ignoreProperties,
    ignoreTypes: config.ignoreTypes,
  };

  const neverReturnedOptions = {
    ignoreFilePatterns: config.ignoreFilePatterns,
  };

  // Analyze based on config flags
  const unusedExports: UnusedExportResult[] = config.analyzeExports
    ? findUnusedExports(project, tsConfigDir, isTestFile, progressCallback, targetFilePath, exportOptions)
    : [];

  const unusedProperties: UnusedPropertyResult[] = config.analyzeProperties
    ? findUnusedProperties(project, tsConfigDir, isTestFile, progressCallback, targetFilePath, propertyOptions)
    : [];

  const neverReturnedTypes: NeverReturnedTypeResult[] = config.analyzeNeverReturnedTypes
    ? findNeverReturnedTypes(project, tsConfigDir, isTestFile, progressCallback, targetFilePath, neverReturnedOptions)
    : [];

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
