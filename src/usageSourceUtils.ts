import path from "node:path";
import { USAGE_SOURCE } from "./constants.js";
import { matchesFilePattern } from "./patternMatcher.js";
import type { ClassifyUsageSourceFn, IsTestFileFn, UsageSource } from "./types.js";

const USAGE_SOURCE_RANKS: Record<UsageSource, number> = {
  [USAGE_SOURCE.TEST]: 0,
  [USAGE_SOURCE.STORY]: 1,
  [USAGE_SOURCE.PRODUCTION]: 2,
};

/**
 * Creates the classifier for where references come from. Test-file rules win over story-file rules; story patterns
 * match the path relative to the tsconfig directory, like `ignoreFilePatterns`.
 */
export function createClassifyUsageSource(
  isTestFile: IsTestFileFn,
  storyFilePatterns: string[],
  tsConfigDir: string,
): ClassifyUsageSourceFn {
  return (sourceFile) => {
    if (isTestFile(sourceFile)) {
      return USAGE_SOURCE.TEST;
    }
    if (matchesFilePattern(path.relative(tsConfigDir, sourceFile.getFilePath()), storyFilePatterns)) {
      return USAGE_SOURCE.STORY;
    }
    return USAGE_SOURCE.PRODUCTION;
  };
}

/**
 * Whether usage from `source` keeps alive a declaration that lives in a `declarationSource` file. Production code
 * keeps everything alive, stories keep story and test code alive, and tests keep only test code alive.
 */
export function isUsageSourceAtLeast(source: UsageSource, declarationSource: UsageSource): boolean {
  return USAGE_SOURCE_RANKS[source] >= USAGE_SOURCE_RANKS[declarationSource];
}

/** The source of usage that only reaches a declaration through both sources, such as a value flow inside a test. */
export function getLowerUsageSource(first: UsageSource, second: UsageSource): UsageSource {
  return isUsageSourceAtLeast(first, second) ? second : first;
}
