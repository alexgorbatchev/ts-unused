import { Node } from "ts-morph";

/**
 * Extracts TODO comment text from the leading comments of a node.
 * Returns undefined if no TODO comment is found.
 */
export function extractTodoComment(node: Node): string | undefined {
  const leadingComments = node.getLeadingCommentRanges();

  for (const comment of leadingComments) {
    const commentText: string = comment.getText();

    // Match single-line comments: // TODO ...
    const singleLineMatch = commentText.match(/\/\/\s*TODO\s+(.+)/i);
    if (singleLineMatch) {
      const todoText: string | undefined = singleLineMatch[1];
      if (todoText) {
        return todoText.trim();
      }
    }

    // Match multi-line comments: /* TODO ... */ or /** TODO ... */
    const multiLineMatch = commentText.match(/\/\*+\s*TODO\s+(.+?)\*\//is);
    if (multiLineMatch) {
      const todoText: string | undefined = multiLineMatch[1];
      if (todoText) {
        return todoText.trim().replace(/\s+/g, " ");
      }
    }
  }

  return undefined;
}

/**
 * Checks if a node is decorated with a @ts-unused-ignore comment with a reason.
 */
export function hasUnusedIgnoreComment(node: Node): boolean {
  const leadingComments = node.getLeadingCommentRanges();

  for (const comment of leadingComments) {
    const commentText: string = comment.getText();

    // Match single-line comments: // @ts-unused-ignore <reason>
    const singleLineMatch = commentText.match(/\/\/\s*@ts-unused-ignore\s+(.+)/i);
    if (singleLineMatch) {
      const reason = singleLineMatch[1];
      if (reason && reason.trim().length > 0) {
        return true;
      }
    }

    // Match multi-line comments: /* @ts-unused-ignore <reason> */ or /** @ts-unused-ignore <reason> */
    const multiLineMatch = commentText.match(/\/\*+\s*@ts-unused-ignore\s+(.+?)\*\//is);
    if (multiLineMatch) {
      const reason = multiLineMatch[1];
      if (reason && reason.trim().length > 0) {
        return true;
      }
    }
  }

  return false;
}
