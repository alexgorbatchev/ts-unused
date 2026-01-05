/**
 * Converts a glob-like pattern to a RegExp.
 * Supports:
 * - `*` matches any characters except `/`
 * - `**` matches any characters including `/`
 * - `?` matches any single character
 */
export function patternToRegex(pattern: string): RegExp {
  // Escape special regex characters except * and ?
  let regexStr = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");

  // Use placeholders to handle ** before * to avoid conflicts
  // Replace ** with a unique placeholder first
  const DOUBLE_STAR_PLACEHOLDER = "<<DOUBLESTAR>>";
  regexStr = regexStr.replace(/\*\*/g, DOUBLE_STAR_PLACEHOLDER);

  // Convert single * to match anything except /
  regexStr = regexStr.replace(/\*/g, "[^/]*");

  // Convert ** placeholder back to match anything including /
  regexStr = regexStr.split(DOUBLE_STAR_PLACEHOLDER).join(".*");

  // Convert ? to match any single character
  regexStr = regexStr.replace(/\?/g, ".");

  return new RegExp(`^${regexStr}$`);
}

/**
 * Checks if a string matches any of the given patterns.
 * Patterns can be exact strings or glob-like patterns.
 *
 * @param value - The string to test
 * @param patterns - Array of patterns to match against
 * @returns true if the value matches any pattern
 */
export function matchesPattern(value: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    // Check exact match first
    if (pattern === value) {
      return true;
    }

    // Check glob pattern
    if (pattern.includes("*") || pattern.includes("?")) {
      const regex = patternToRegex(pattern);
      if (regex.test(value)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Checks if a file path matches any of the given patterns.
 * Normalizes the path before matching.
 *
 * @param filePath - The file path to test (can be absolute or relative)
 * @param patterns - Array of glob patterns to match against
 * @returns true if the file matches any pattern
 */
export function matchesFilePattern(filePath: string, patterns: string[]): boolean {
  // Normalize path separators
  const normalizedPath = filePath.replace(/\\/g, "/");

  for (const pattern of patterns) {
    const normalizedPattern = pattern.replace(/\\/g, "/");

    // Check if pattern matches anywhere in the path
    if (normalizedPattern.startsWith("**/")) {
      // Pattern like **/*.test.ts should match any path ending with .test.ts
      const suffixPattern = normalizedPattern.slice(3);
      const regex = patternToRegex(`**/${suffixPattern}`);
      if (regex.test(normalizedPath)) {
        return true;
      }
      // Also check if just the suffix matches the end
      const suffixRegex = patternToRegex(suffixPattern);
      const fileName = normalizedPath.split("/").pop() ?? "";
      if (suffixRegex.test(fileName)) {
        return true;
      }
    } else {
      const regex = patternToRegex(normalizedPattern);
      if (regex.test(normalizedPath)) {
        return true;
      }
    }
  }

  return false;
}
