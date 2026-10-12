import type {
  InterfaceDeclaration,
  PropertyDeclaration,
  PropertySignature,
  SourceFile,
  TypeAliasDeclaration,
} from "ts-morph";

export type PropertyNode = PropertySignature | PropertyDeclaration;
export type TypeDeclaration = InterfaceDeclaration | TypeAliasDeclaration;

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
  duplicateTypes?: IDuplicateTypeResult[];
}

export interface ITypeLocation {
  filePath: string;
  typeName: string;
  line: number;
  character: number;
  endCharacter: number;
}

export interface IDuplicateTypeResult extends ITypeLocation {
  duplicateOf: ITypeLocation;
  severity: Severity;
}

export type IsTestFileFn = (sourceFile: SourceFile) => boolean;
