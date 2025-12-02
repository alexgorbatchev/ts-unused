// Test cases for never-returned types detection

export interface SuccessResult {
  success: true;
  data: string;
}

export interface ErrorResult {
  success: false;
  error: string;
}

export type ResultType = SuccessResult | ErrorResult;

// Case 1: ErrorResult is never returned
export function alwaysSucceeds(): ResultType {
  return { success: true, data: "test" };
}

// Case 2: SuccessResult is never returned
export function alwaysFails(): ResultType {
  if (Math.random() > 0.5) {
    return { success: false, error: "error1" };
  }
  return { success: false, error: "error2" };
}

// Case 3: Both types are returned (should NOT be flagged)
export function sometimesSucceeds(condition: boolean): ResultType {
  if (condition) {
    return { success: true, data: "success" };
  }
  return { success: false, error: "failed" };
}

// Case 4: Promise with union type
export type AsyncResult = Promise<SuccessResult | ErrorResult>;

export async function asyncAlwaysSucceeds(): AsyncResult {
  return { success: true, data: "async test" };
}

// Case 5: Three-way union with one never returned
export interface WarningResult {
  success: "warning";
  message: string;
}

export type ExtendedResult = SuccessResult | ErrorResult | WarningResult;

export function neverWarns(): ExtendedResult {
  if (Math.random() > 0.5) {
    return { success: true, data: "ok" };
  }
  return { success: false, error: "bad" };
}

// Case 6: Named type reference that's never returned
export type SimpleUnion = string | number | boolean;

export function onlyReturnsString(): SimpleUnion {
  return "always a string";
}

// Case 7: All types returned (should NOT be flagged)
export function returnsAll(): SimpleUnion {
  const rand = Math.random();
  if (rand > 0.66) return "string";
  if (rand > 0.33) return 42;
  return true;
}
