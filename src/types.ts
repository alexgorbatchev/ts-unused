import type {
  InterfaceDeclaration,
  PropertyDeclaration,
  PropertySignature,
  SourceFile,
  TypeAliasDeclaration,
} from "ts-morph";
import { COMMENT_KIND, EXPORT_KIND, RULE_NAME, RULE_SEVERITY, SEVERITY } from "./constants";

export interface IAnalyzePropertiesOptions {
  ignoreProperties?: string[];
  ignoreTypes?: string[];
}

export type PropertyNode = PropertySignature | PropertyDeclaration;
export type TypeDeclaration = InterfaceDeclaration | TypeAliasDeclaration;

export type Severity = (typeof SEVERITY)[keyof typeof SEVERITY];
export type RuleSeverity = (typeof RULE_SEVERITY)[keyof typeof RULE_SEVERITY];
export type RuleName = (typeof RULE_NAME)[keyof typeof RULE_NAME];
export type CommentKind = (typeof COMMENT_KIND)[keyof typeof COMMENT_KIND];
export type ExportKind = (typeof EXPORT_KIND)[keyof typeof EXPORT_KIND];

export interface IUnusedExportResult {
  filePath: string;
  exportName: string;
  line: number;
  character: number;
  endCharacter: number;
  kind: ExportKind;
  todoComment?: string;
  commentKind?: CommentKind;
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
  commentKind?: CommentKind;
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
  /** Severity shared by completely unused files; omitted means error. */
  unusedFileSeverity?: Severity;
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
