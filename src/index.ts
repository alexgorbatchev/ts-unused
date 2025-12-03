export { analyzeProject } from "./analyzeProject";
export { fixProject } from "./fixProject";
export { formatResults } from "./formatResults";
export { findUnusedExports } from "./findUnusedExports";
export { findUnusedProperties } from "./findUnusedProperties";
export { isTestFile } from "./isTestFile";

export type {
  AnalysisResults,
  ExportKind,
  IsTestFileFn,
  NeverReturnedTypeResult,
  Severity,
  UnusedExportResult,
  UnusedPropertyResult,
} from "./types";

export type { FixResults } from "./fixProject";
export type { PropertyUsageResult } from "./isPropertyUnused";
