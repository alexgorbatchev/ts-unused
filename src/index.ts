export type { AnalyzeProjectOptions } from "./analyzeProject";
export { analyzeProject } from "./analyzeProject";
export type { UnusedConfig } from "./config";
export { defaultConfig, defineConfig, mergeConfig } from "./config";
export { findUnusedExports } from "./findUnusedExports";
export { findUnusedProperties } from "./findUnusedProperties";
export type { FixResults } from "./fixProject";
export { fixProject } from "./fixProject";
export { formatResults } from "./formatResults";
export type { PropertyUsageResult } from "./isPropertyUnused";
export { createIsTestFile, isTestFile } from "./isTestFile";
export { loadConfig, loadConfigSync } from "./loadConfig";
export { matchesFilePattern, matchesPattern, patternToRegex } from "./patternMatcher";
export type {
  AnalysisResults,
  ExportKind,
  IsTestFileFn,
  NeverReturnedTypeResult,
  Severity,
  UnusedExportResult,
  UnusedPropertyResult,
} from "./types";
