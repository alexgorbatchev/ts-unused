import {
  type ExportSpecifier,
  type ImportClause,
  type ImportSpecifier,
  Node,
  type ReferenceEntry,
  type ReferenceFindableNode,
  type SourceFile,
  SyntaxKind,
} from "ts-morph";

/** An import specifier or default import clause that binds an imported declaration locally. */
type ImportBinding = ImportSpecifier | ImportClause;

/** A module-syntax node that only passes a declaration on to another module. */
export type ForwardingNode = ExportSpecifier | ImportBinding;

/** An exported declaration whose references the language service can find. */
export type ReferenceFindableDeclaration = ReferenceFindableNode & Node;

export interface IClassifiedExportReferences {
  /** References that count as usage, including the declaration itself. */
  usages: ReferenceEntry[];
  /** Unique specifiers that forward the declaration without using it. */
  forwarders: ForwardingNode[];
}

/**
 * Returns the export specifier a reference belongs to, covering `export { a }`, `export { a as b }`,
 * `export { a } from "./a"`, and `export type { A } from "./a"`.
 */
function getExportSpecifier(node: Node): ExportSpecifier | undefined {
  return Node.isExportSpecifier(node) ? node : node.getParentIfKind(SyntaxKind.ExportSpecifier);
}

/** Returns the import specifier or default import clause a reference belongs to. */
function getImportBinding(node: Node): ImportBinding | undefined {
  return node.getParentIfKind(SyntaxKind.ImportSpecifier) ?? node.getParentIfKind(SyntaxKind.ImportClause);
}

/**
 * Splits the references of an exported declaration into usages and forwarders.
 *
 * Re-exports are not usage by themselves, matching `export *`, which creates no reference at all.
 * An import counts as usage unless its file also re-exports the declaration, so importing a name
 * only to list it in `export { ... }` is forwarding too. Any other reference in that file, such as
 * a call, still counts.
 */
export function classifyExportReferences(declaration: ReferenceFindableDeclaration): IClassifiedExportReferences {
  const references = declaration.findReferences().flatMap((referencedSymbol) => referencedSymbol.getReferences());
  const exportSpecifiers = new Map<ReferenceEntry, ExportSpecifier>();
  const forwardingFiles = new Set<SourceFile>();

  for (const reference of references) {
    const exportSpecifier = getExportSpecifier(reference.getNode());
    if (exportSpecifier) {
      exportSpecifiers.set(reference, exportSpecifier);
      forwardingFiles.add(reference.getSourceFile());
    }
  }

  const usages: ReferenceEntry[] = [];
  const forwarders = new Set<ForwardingNode>();
  for (const reference of references) {
    const exportSpecifier = exportSpecifiers.get(reference);
    const importBinding = forwardingFiles.has(reference.getSourceFile())
      ? getImportBinding(reference.getNode())
      : undefined;
    const forwarder = exportSpecifier ?? importBinding;
    if (forwarder) {
      forwarders.add(forwarder);
    } else {
      usages.push(reference);
    }
  }

  return { usages, forwarders: [...forwarders] };
}
