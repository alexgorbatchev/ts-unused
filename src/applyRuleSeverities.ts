import { COMMENT_KIND, RULE_NAME, RULE_SEVERITY, SEVERITY } from "./constants.js";
import type { IUnusedConfig, RuleSeverity } from "./config.js";
import type { CommentKind, IAnalysisResults, Severity } from "./types.js";

interface ISeverityResult {
  severity: Severity;
  todoComment?: string;
  commentKind?: CommentKind;
}

function applySeverity<T extends ISeverityResult>(
  items: T[],
  severity: RuleSeverity | undefined,
  rules?: IUnusedConfig["rules"],
): T[] {
  return items.flatMap((item) => {
    let effectiveSeverity = severity;
    if (item.commentKind === COMMENT_KIND.IGNORE) {
      effectiveSeverity = rules?.[RULE_NAME.IGNORE_COMMENTS] ?? SEVERITY.WARNING;
    } else if (item.todoComment !== undefined) {
      effectiveSeverity = rules?.[RULE_NAME.TODO_COMMENTS] ?? SEVERITY.WARNING;
    }
    if (effectiveSeverity === RULE_SEVERITY.OFF) {
      return [];
    }
    return [{ ...item, severity: effectiveSeverity ?? item.severity }];
  });
}

/** Apply policy after analysis so disabling export reports does not disable unused-file detection. */
export function applyRuleSeverities(results: IAnalysisResults, rules: IUnusedConfig["rules"]): IAnalysisResults {
  const unusedFileSeverity = rules?.[RULE_NAME.UNUSED_FILES] ?? SEVERITY.ERROR;
  return {
    ...results,
    unusedExports: applySeverity(results.unusedExports, rules?.[RULE_NAME.UNUSED_EXPORTS], rules),
    unusedProperties: applySeverity(results.unusedProperties, rules?.[RULE_NAME.UNUSED_PROPERTIES], rules),
    unusedFiles: unusedFileSeverity === RULE_SEVERITY.OFF ? [] : results.unusedFiles,
    unusedFileSeverity: unusedFileSeverity === RULE_SEVERITY.OFF ? undefined : unusedFileSeverity,
    neverReturnedTypes: applySeverity(results.neverReturnedTypes ?? [], rules?.[RULE_NAME.NEVER_RETURNED_TYPES]),
    duplicateTypes: applySeverity(results.duplicateTypes ?? [], rules?.[RULE_NAME.DUPLICATE_TYPES]),
  };
}
