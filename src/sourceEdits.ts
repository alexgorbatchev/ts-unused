import { type Node, type SourceFile } from "typescript/ast";

export interface ISourceEdit {
  start: number;
  end: number;
  text: string;
}

function edit(start: number, end: number): ISourceEdit {
  return { start, end, text: "" };
}

/** Remove a statement or member and its leading trivia without removing the previous line's comment. */
export function removeSourceNode(node: Node, source: SourceFile): ISourceEdit {
  const text = source.text;
  const fullStart = node.getFullStart();
  const start = node.getStart(source);
  const firstNewline = text.indexOf("\n", fullStart);
  const lastNewline = text.indexOf("\n", node.end);
  const trailing = text.slice(node.end, lastNewline < 0 ? text.length : lastNewline);
  if (lastNewline >= 0 && !trailing.trim() && (fullStart === 0 || (firstNewline >= 0 && firstNewline < start))) {
    const end = lastNewline + 1;
    const emptyLine = /^[ \t]*\r?\n/.exec(text.slice(end));
    return edit(fullStart === 0 ? 0 : firstNewline + 1, end + (emptyLine?.[0].length ?? 0));
  }
  return edit(firstNewline >= 0 && firstNewline < start ? firstNewline + 1 : start, node.end);
}

/** Remove groups of comma-separated elements, keeping each retained element's text and order. */
export function removeListElements(
  nodes: readonly Node[],
  removed: ReadonlySet<Node>,
  source: SourceFile,
): ISourceEdit[] {
  const edits: ISourceEdit[] = [];
  let first = 0;
  while (first < nodes.length) {
    const node = nodes[first]!;
    if (!removed.has(node)) {
      first++;
      continue;
    }
    let next = first + 1;
    while (next < nodes.length && removed.has(nodes[next]!)) next++;

    const after = nodes[next];
    if (after) {
      edits.push(edit(node.getStart(source), after.getStart(source)));
    } else {
      const before = nodes[first - 1];
      edits.push(edit(before?.end ?? node.getStart(source), nodes[next - 1]!.end));
    }
    first = next;
  }
  return edits;
}

/** Apply offsets from a single source snapshot. A containing removal supersedes edits inside it. */
export function applySourceEdits(source: string, edits: ISourceEdit[]): string {
  const parts: string[] = [];
  const ordered = edits.toSorted((first, second) => first.start - second.start || second.end - first.end);
  let position = 0;
  let previous: ISourceEdit | undefined;
  for (const current of ordered) {
    if (current.start < position) {
      if (previous?.text === "" && current.end <= previous.end) continue;
      if (previous?.text === "" && current.text === "") {
        position = current.end;
        previous = { ...previous, end: position };
        continue;
      }
      throw new Error(`Overlapping source edits at ${current.start} and ${position}`);
    }
    parts.push(source.slice(position, current.start), current.text);
    position = current.end;
    previous = current;
  }
  parts.push(source.slice(position));
  return parts.join("");
}
