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
