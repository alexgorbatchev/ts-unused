import {
  type ExportSpecifier,
  type ImportClause,
  type ImportSpecifier,
  Node,
  type ReferenceEntry,
  type ReferenceFindableNode,
  SyntaxKind,
} from "ts-morph";

/** An import specifier or default import clause that binds an imported declaration locally. */
type ImportBinding = ImportSpecifier | ImportClause;

/** An export or import specifier that names a declaration without using it. */
export type NamingSpecifier = ExportSpecifier | ImportBinding;

/** An exported declaration whose references the language service can find. */
export type ReferenceFindableDeclaration = ReferenceFindableNode & Node;

export interface IClassifiedExportReferences {
  /** References that count as usage, including the declaration itself. */
  usages: ReferenceEntry[];
  /** Unique export and import specifiers that name the declaration without using it. */
  specifiers: NamingSpecifier[];
}

/**
 * Returns the export specifier a reference belongs to, covering `export { a }`, `export { a as b }`,
 * `export { a } from "./a"`, and `export type { A } from "./a"`.
 */
function getExportSpecifier(node: Node): ExportSpecifier | undefined {
  return Node.isExportSpecifier(node) ? node : node.getParentIfKind(SyntaxKind.ExportSpecifier);
}

/**
 * Returns the import specifier or default import clause a reference belongs to, covering `import { a }`,
 * `import { a as b }`, `import { type A }`, `import type { A }`, and `import a`.
 */
function getImportBinding(node: Node): ImportBinding | undefined {
  return node.getParentIfKind(SyntaxKind.ImportSpecifier) ?? node.getParentIfKind(SyntaxKind.ImportClause);
}

/**
 * Splits the references of an exported declaration into usages and naming specifiers.
 *
 * Export and import specifiers only name the declaration. Re-exports are not usage by themselves, matching
 * `export *`, which creates no reference at all, and an import is not usage by itself either: the language
 * service also reports every reference to the local binding it creates (calls, type positions, JSX, `typeof`,
 * decorators), and those are what count. An import that is never referenced, or only listed in `export { ... }`,
 * keeps nothing alive.
 */
export function classifyExportReferences(declaration: ReferenceFindableDeclaration): IClassifiedExportReferences {
  const usages: ReferenceEntry[] = [];
  const specifiers = new Set<NamingSpecifier>();

  for (const referencedSymbol of declaration.findReferences()) {
    for (const reference of referencedSymbol.getReferences()) {
      const node = reference.getNode();
      const specifier = getExportSpecifier(node) ?? getImportBinding(node);
      if (specifier) {
        specifiers.add(specifier);
      } else {
        usages.push(reference);
      }
    }
  }

  return { usages, specifiers: [...specifiers] };
}
