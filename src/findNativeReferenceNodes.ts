import { getTouchingToken } from "typescript/ast";
import type { Project } from "typescript/async";
import type { Node } from "ts-morph";
import { getReferenceLocation } from "./findReferenceNodes.js";

export async function findNativeReferenceNodes(project: Project, declaration: Node): Promise<Node[]> {
  const location = getReferenceLocation(declaration);
  const filePath = location.getSourceFile().getFilePath();
  const sourceFile = await project.program.getSourceFile(filePath);
  if (!sourceFile) {
    throw new Error(`TypeScript could not load reference source: ${filePath}`);
  }

  const position = location.getStart();
  const token = getTouchingToken(sourceFile, position);
  const groups = await project.languageService.getReferencedSymbolsForNode(token, position);
  const references = await Promise.all(
    groups.flatMap(({ references }) => references.map((handle) => handle.resolve())),
  );

  const syntaxProject = declaration.getProject();
  return syntaxProject.forgetNodesCreatedInBlock((remember) => {
    const nodes = new Set<Node>();
    for (const reference of references) {
      if (!reference) continue;
      const source = syntaxProject.addSourceFileAtPathIfExists(reference.getSourceFile().fileName);
      if (!source) continue;
      const node = source.getDescendantAtPos(reference.getStart()) ?? source;
      nodes.add(node);
      remember(node);
    }
    return [...nodes];
  });
}
