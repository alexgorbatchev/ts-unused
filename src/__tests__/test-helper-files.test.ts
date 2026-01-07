import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { analyzeProject } from "../analyzeProject";

const TEMP_DIR = path.join(import.meta.dir, "../../temp-test-helper-files");

function createTempDir() {
  if (fs.existsSync(TEMP_DIR)) {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

function cleanupTempDir() {
  if (fs.existsSync(TEMP_DIR)) {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }
}

function createTsConfig(include: string[] = ["src/**/*.ts"]) {
  const tsconfigFile = path.join(TEMP_DIR, "tsconfig.json");
  fs.writeFileSync(
    tsconfigFile,
    JSON.stringify({
      compilerOptions: {
        target: "ES2020",
        module: "ESNext",
        moduleResolution: "bundler",
        strict: true,
      },
      include,
    })
  );
  return tsconfigFile;
}

setDefaultTimeout(30000);

beforeEach(() => {
  createTempDir();
});

afterEach(() => {
  cleanupTempDir();
});

describe("Test Helper Files", () => {
  test("helper functions used only in test files should be marked as onlyUsedInTests, not completely unused", async () => {
    // Create a test helper file that is NOT in __tests__ directory
    // This simulates a dedicated testing-helpers package or utils/test-helpers.ts file
    fs.mkdirSync(path.join(TEMP_DIR, "src", "testing-utils"), { recursive: true });
    fs.mkdirSync(path.join(TEMP_DIR, "src", "__tests__"), { recursive: true });

    // Create a test helper function in a non-test directory
    fs.writeFileSync(
      path.join(TEMP_DIR, "src", "testing-utils", "createMockFileRegistry.ts"),
      `
        export interface MockFileRegistry {
          files: Map<string, string>;
          addFile(path: string, content: string): void;
          getFile(path: string): string | undefined;
        }

        export function createMockFileRegistry(): MockFileRegistry {
          const files = new Map<string, string>();
          return {
            files,
            addFile(path: string, content: string) {
              files.set(path, content);
            },
            getFile(path: string) {
              return files.get(path);
            }
          };
        }
      `
    );

    // Create a test file that uses the helper
    fs.writeFileSync(
      path.join(TEMP_DIR, "src", "__tests__", "registry.test.ts"),
      `
        import { createMockFileRegistry } from '../testing-utils/createMockFileRegistry';

        describe('File Registry', () => {
          test('should create a mock registry', () => {
            const registry = createMockFileRegistry();
            registry.addFile('/test.ts', 'content');
            expect(registry.getFile('/test.ts')).toBe('content');
          });
        });
      `
    );

    // Create a regular source file (so the project has non-test files)
    fs.writeFileSync(
      path.join(TEMP_DIR, "src", "index.ts"),
      `
        export function realFunction(): string {
          return 'production code';
        }
      `
    );

    const tsconfigFile = createTsConfig();
    const results = await analyzeProject(tsconfigFile);

    // Find the createMockFileRegistry export
    const createMockFileRegistry = results.unusedExports.find(
      (item) => item.exportName === "createMockFileRegistry"
    );

    // This should be marked as onlyUsedInTests with severity "info"
    // NOT as completely unused with severity "error"
    expect(createMockFileRegistry).toBeDefined();
    expect(createMockFileRegistry?.onlyUsedInTests).toBe(true);
    expect(createMockFileRegistry?.severity).toBe("info");

    // The helper file should NOT be in unusedFiles list since it has test-only exports
    const helperFileInUnusedFiles = results.unusedFiles.find((file) =>
      file.includes("createMockFileRegistry.ts")
    );
    expect(helperFileInUnusedFiles).toBeUndefined();
  });

  test("helper functions in testing-helpers directory used only in tests should be correctly identified", async () => {
    // Simulate a monorepo structure with a dedicated testing-helpers package
    fs.mkdirSync(path.join(TEMP_DIR, "src", "packages", "testing-helpers", "src"), { recursive: true });
    fs.mkdirSync(path.join(TEMP_DIR, "src", "packages", "app", "src", "__tests__"), { recursive: true });

    // Create helper function in testing-helpers package
    fs.writeFileSync(
      path.join(TEMP_DIR, "src", "packages", "testing-helpers", "src", "createMockUser.ts"),
      `
        export interface MockUser {
          id: number;
          name: string;
          email: string;
        }

        export function createMockUser(overrides: Partial<MockUser> = {}): MockUser {
          return {
            id: Math.random(),
            name: 'Test User',
            email: 'test@example.com',
            ...overrides
          };
        }
      `
    );

    // Index file for the testing-helpers package
    fs.writeFileSync(
      path.join(TEMP_DIR, "src", "packages", "testing-helpers", "src", "index.ts"),
      `
        export { createMockUser, type MockUser } from './createMockUser';
      `
    );

    // Test file that uses the helper
    fs.writeFileSync(
      path.join(TEMP_DIR, "src", "packages", "app", "src", "__tests__", "user.test.ts"),
      `
        import { createMockUser } from '../../../testing-helpers/src';

        describe('User', () => {
          test('should work with mock user', () => {
            const user = createMockUser({ name: 'Alice' });
            expect(user.name).toBe('Alice');
          });
        });
      `
    );

    // Regular app code
    fs.writeFileSync(
      path.join(TEMP_DIR, "src", "packages", "app", "src", "index.ts"),
      `
        export function getUsers(): string[] {
          return [];
        }
      `
    );

    const tsconfigFile = createTsConfig(["src/**/*.ts"]);
    const results = await analyzeProject(tsconfigFile);

    // Find the createMockUser export from the source file
    const createMockUser = results.unusedExports.find(
      (item) =>
        item.exportName === "createMockUser" &&
        item.filePath.includes("createMockUser.ts")
    );

    // BUG: The helper is either:
    // 1. Not found at all because test files using it are filtered out
    // 2. Found but marked as severity "error" (completely unused) instead of "info" (test-only)
    //
    // Expected behavior: Helper functions used exclusively in test files should be
    // detected as "onlyUsedInTests: true" with "severity: info", not completely unused.
    //
    // This reproduces the issue where helper functions in packages like
    // "testing-helpers" are incorrectly reported as unused when they're
    // actually used in test files.

    // The helper should be marked as test-only, not completely unused
    expect(createMockUser).toBeDefined();
    expect(createMockUser?.onlyUsedInTests).toBe(true);
    expect(createMockUser?.severity).toBe("info");
  });
});
