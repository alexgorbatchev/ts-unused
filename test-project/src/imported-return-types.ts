// Test case for imported type names in never-returned types detection
import type { LocalError, LocalResult, LocalSuccess } from "./imported-types";

// This function uses imported types and never returns LocalError
export function processWithImportedTypes(): LocalResult {
  return { success: true, data: "test" };
}

// This function also uses imported types with Promise
export async function asyncProcessWithImportedTypes(): Promise<LocalResult> {
  return { success: true, data: "async test" };
}

// This function returns explicit imported type (not type alias)
export function explicitImportedType(): LocalSuccess | LocalError {
  return { success: true, data: "explicit" };
}

// This function uses inline object types that might show full paths
export function inlineObjectReturn():
  | { status: "success"; value: LocalSuccess }
  | { status: "error"; reason: LocalError } {
  return { status: "success", value: { success: true, data: "inline" } };
}

// This function has a very long inline object type that should be truncated
export function veryLongInlineType():
  | {
      name: string;
      config: {
        enabled: boolean;
        settings: {
          theme: "light" | "dark";
          fontSize: number;
          fontFamily: string;
          lineHeight: number;
        };
        advanced: {
          caching: boolean;
          compression: "gzip" | "brotli" | "none";
          timeout: number;
          retries: number;
        };
      };
      metadata: {
        version: string;
        author: string;
        tags: string[];
      };
    }
  | { error: string; code: number } {
  return { error: "not implemented", code: 501 };
}

// This mimics the real createBaseResolvedConfig issue: explicit return type but inferred type from destructuring
export function configWithDestructuring(): LocalResult {
  const fullConfig = {
    success: true as const,
    data: "test",
    extraField: "should be removed",
  };
  
  // The inferred type from destructuring is anonymous, not LocalSuccess
  const { extraField, ...result } = fullConfig;
  return result;
}
