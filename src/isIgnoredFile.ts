import path from "node:path";
import { matchesFilePattern } from "./patternMatcher.js";

/**
 * Whether a file matches `ignoreFilePatterns`. Patterns match the path relative to the tsconfig directory, so they
 * never match the directories that contain the project.
 */
export function isIgnoredFile(filePath: string, tsConfigDir: string, ignoreFilePatterns: string[]): boolean {
  return matchesFilePattern(path.relative(tsConfigDir, filePath), ignoreFilePatterns);
}
