import type { SourceFile } from "ts-morph";

export type Severity = "error" | "warning" | "info";

export type ExportKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "const"
  | "variable"
  | "enum"
  | "namespace"
  | "export";

export interface UnusedExportResult {
  filePath: string;
  exportName: string;
  line: number;
  character: number;
  endCharacter: number;
  kind: ExportKind;
  severity: Severity;
  onlyUsedInTests: boolean;
}

export interface UnusedPropertyResult {
  filePath: string;
  typeName: string;
  propertyName: string;
  line: number;
  character: number;
  endCharacter: number;
  todoComment?: string;
  severity: Severity;
  onlyUsedInTests: boolean;
}

export interface NeverReturnedTypeResult {
  filePath: string;
  functionName: string;
  neverReturnedType: string;
  line: number;
  character: number;
  endCharacter: number;
  severity: Severity;
}

export interface AnalysisResults {
  unusedExports: UnusedExportResult[];
  unusedProperties: UnusedPropertyResult[];
  unusedFiles: string[];
  neverReturnedTypes?: NeverReturnedTypeResult[];
}

export type IsTestFileFn = (sourceFile: SourceFile) => boolean;
