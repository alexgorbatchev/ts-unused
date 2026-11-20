export function hasNoCheck(fullText: string): boolean {
  const firstLine: string | undefined = fullText.split("\n")[0];
  if (!firstLine) {
    return false;
  }
  return firstLine.trim() === "// @ts-nocheck";
}
