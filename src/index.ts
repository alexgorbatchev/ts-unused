export type { IAnalyzeProjectOptions } from "./analyzeProject";
export { analyzeProject } from "./analyzeProject";
export type { IUnusedConfig } from "./config";
export { defaultConfig, defineConfig, mergeConfig } from "./config";
export type { IFixResults } from "./fixProject";
export { fixProject } from "./fixProject";
export { formatResults } from "./formatResults";
export type { IPropertyUsageResult } from "./isPropertyUnused";
export { createIsTestFile, isTestFile } from "./isTestFile";
export { loadConfig, loadConfigSync } from "./loadConfig";
export { matchesFilePattern, matchesPattern, patternToRegex } from "./patternMatcher";
export type {
  IAnalysisResults,
  ExportKind,
  IsTestFileFn,
  INeverReturnedTypeResult,
  Severity,
  IUnusedExportResult,
  IUnusedPropertyResult,
} from "./types";
