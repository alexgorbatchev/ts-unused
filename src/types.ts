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

export interface IUnusedExportResult {
  filePath: string;
  exportName: string;
  line: number;
  character: number;
  endCharacter: number;
  kind: ExportKind;
  todoComment?: string;
  severity: Severity;
  onlyUsedInTests: boolean;
}

export interface IUnusedPropertyResult {
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

export interface INeverReturnedTypeResult {
  filePath: string;
  functionName: string;
  neverReturnedType: string;
  line: number;
  character: number;
  endCharacter: number;
  severity: Severity;
}

export interface IAnalysisResults {
  unusedExports: IUnusedExportResult[];
  unusedProperties: IUnusedPropertyResult[];
  unusedFiles: string[];
  neverReturnedTypes?: INeverReturnedTypeResult[];
}

export type IsTestFileFn = (sourceFile: SourceFile) => boolean;
