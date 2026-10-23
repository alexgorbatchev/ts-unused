import { Node } from "ts-morph";

function getReferenceLocation(node: Node): Node {
  if (Node.isIdentifier(node) || Node.isStringLiteral(node)) {
    return node;
  }
  if (
    Node.isNamed(node) ||
    Node.isNameable(node) ||
    Node.isBindingNamed(node) ||
    Node.isPropertyNamed(node) ||
    Node.isModuleNamed(node)
  ) {
    const name = node.getNameNode();
    if (name) {
      return name;
    }
  }
  return Node.isExportable(node) ? (node.getDefaultKeyword() ?? node) : node;
}

/** Finds reference nodes without asking the language service to format their symbols' inferred types. */
export function findReferenceNodes(declaration: Node): Node[] {
  const project = declaration.getProject();
  const location = getReferenceLocation(declaration);
  const references =
    project
      .getLanguageService()
      .compilerObject.getReferencesAtPosition(location.getSourceFile().getFilePath(), location.getStart()) ?? [];
  return project.forgetNodesCreatedInBlock((remember) =>
    references.map((reference) => {
      const source = project.getSourceFileOrThrow(reference.fileName);
      const node = source.getDescendantAtPos(reference.textSpan.start) ?? source;
      remember(node);
      return node;
    }),
  );
}
