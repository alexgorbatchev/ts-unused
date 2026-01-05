// This file demonstrates properties and exports that can be ignored via config

export interface ShellConfig {
  // These properties are accessed dynamically via Object.keys() or spread
  shell: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  
  // Internal property that should be ignored
  _internal: boolean;
}

export interface ErrorInfo {
  // The 'message' property is commonly accessed on caught errors
  // but TypeScript can't always track this
  message: string;
  code: number;
  stack?: string;
}

export interface GitHubApiResponse {
  // API methods that are called but may not be fully typed
  getData: () => Promise<unknown>;
  getStatus: () => number;
  getHeaders: () => Record<string, string>;
}

// Internal functions that should be ignored with "internal*" pattern
export function internalSetup(): void {
  console.log("Internal setup");
}

export function internalCleanup(): void {
  console.log("Internal cleanup");
}

// Regular function that IS used
export function processConfig(config: ShellConfig): void {
  console.log("Processing config:", config.shell);
}
