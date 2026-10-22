#!/usr/bin/env bun

import { $ } from "bun";
import { existsSync } from "fs";
import { readdir } from "node:fs/promises";
import { join, resolve, sep } from "path";
import { checkGitStatus } from "../src/checkGitStatus";

const REPO_ROOT = resolve(import.meta.dir, "..");
const TEST_PROJECT_DIR = resolve(REPO_ROOT, "test-project");
const SNAPSHOT_SKIPPED_PATHS = new Set([
  TEST_PROJECT_DIR,
  ...[".git", "node_modules", ".tmp", ".workspaces", ".pi"].map((directoryName) => join(REPO_ROOT, directoryName)),
]);

type FileSnapshot = Map<string, number | bigint>;

/**
 * Checks whether a path is inside test-project.
 */
function isInsideTestProject(filePath: string): boolean {
  return filePath.startsWith(TEST_PROJECT_DIR + sep);
}

/**
 * Records a content hash for every repository file outside test-project and other generated directories.
 */
async function snapshotFilesOutsideTestProject(
  directoryPath = REPO_ROOT,
  snapshot: FileSnapshot = new Map(),
): Promise<FileSnapshot> {
  for (const entry of await readdir(directoryPath, { withFileTypes: true })) {
    const entryPath = join(directoryPath, entry.name);
    if (SNAPSHOT_SKIPPED_PATHS.has(entryPath)) continue;
    if (entry.isDirectory()) {
      await snapshotFilesOutsideTestProject(entryPath, snapshot);
    } else if (entry.isFile()) {
      snapshot.set(entryPath, Bun.hash(await Bun.file(entryPath).bytes()));
    }
  }
  return snapshot;
}

/**
 * Lists files outside test-project that were added, removed, or changed since the snapshot.
 */
async function findChangesOutsideTestProject(before: FileSnapshot): Promise<string[]> {
  const after = await snapshotFilesOutsideTestProject();
  const filePaths = new Set([...before.keys(), ...after.keys()]);
  return [...filePaths].filter((filePath) => before.get(filePath) !== after.get(filePath)).toSorted();
}

async function main() {
  const args = process.argv.slice(2);
  const skipBuild = args.includes("--no-build");

  console.log("🔍 Running sanity check...\n");

  try {
    // Step 1: Build the project
    if (!skipBuild) {
      console.log("📦 Step 1: Building project...");
      await $`bun run build`.quiet();
      console.log("✅ Build successful\n");
    } else {
      console.log("⏭️  Step 1: Skipping build (--no-build flag provided)\n");
    }

    // Step 2: Check for git changes in test-project
    console.log("📋 Step 2: Checking test-project has no uncommitted changes...");
    if ([...checkGitStatus(REPO_ROOT)].some(isInsideTestProject)) {
      console.error("❌ FAILED: test-project has uncommitted changes");
      console.error("Please commit or restore test-project before running sanity check");
      process.exit(1);
    }
    console.log("✅ Test-project is clean\n");
    const outsideBeforeFix = await snapshotFilesOutsideTestProject();

    // Step 3: TypeScript check before fix
    console.log("🔎 Step 3: Running TypeScript check (before fix)...");
    await $`tsgo --noEmit --project ${TEST_PROJECT_DIR}/tsconfig.json`.quiet();
    console.log("✅ TypeScript check passed (before fix)\n");

    // Step 4: Run fix command
    console.log("🔧 Step 4: Running fix command...");
    const distCli = resolve(import.meta.dir, "../dist/cli.js");
    if (!existsSync(distCli)) {
      console.error("❌ FAILED: dist/cli.js not found");
      process.exit(1);
    }
    await $`bun run ${distCli} fix ${TEST_PROJECT_DIR}`;
    console.log();

    // Step 5: Verify fix changed nothing outside test-project
    console.log("🛡️  Step 5: Verifying fix changed nothing outside test-project...");
    const outsideChanges = await findChangesOutsideTestProject(outsideBeforeFix);
    if (outsideChanges.length > 0) {
      console.error("❌ FAILED: fix command changed files outside test-project:");
      for (const filePath of outsideChanges) {
        console.error(`  ${filePath}`);
      }
      await $`git -C ${TEST_PROJECT_DIR} restore .`.quiet();
      process.exit(1);
    }
    console.log("✅ No changes outside test-project\n");

    // Step 6: Verify changes were made
    console.log("🔍 Step 6: Verifying changes were made...");
    const gitDiff = await $`git -C ${TEST_PROJECT_DIR} diff --quiet .`.nothrow().quiet();
    if (gitDiff.exitCode === 0) {
      console.error("❌ FAILED: No changes were made by fix command");
      console.error("Expected fix command to modify files, but nothing changed");
      await $`git -C ${TEST_PROJECT_DIR} restore .`.quiet();
      process.exit(1);
    }
    console.log("✅ Changes detected\n");

    // Step 7: TypeScript check after fix
    console.log("🔎 Step 7: Running TypeScript check (after fix)...");
    const tscAfter = await $`tsgo --noEmit --project ${TEST_PROJECT_DIR}/tsconfig.json`.nothrow().quiet();
    if (tscAfter.exitCode !== 0) {
      console.error("❌ FAILED: TypeScript errors after fix");
      console.error("Fix command should not leave TypeScript errors");
      console.error("\nTypeScript output:");
      // tsgo outputs to stdout, not stderr
      const output = tscAfter.stdout.toString() || tscAfter.stderr.toString();
      console.error(output);
      await $`git -C ${TEST_PROJECT_DIR} restore .`.quiet();
      process.exit(1);
    }
    console.log("✅ TypeScript check passed (after fix)\n");

    // Step 8: Restore test-project
    console.log("♻️  Step 8: Restoring test-project...");
    await $`git -C ${TEST_PROJECT_DIR} restore .`.quiet();
    console.log("✅ Test-project restored\n");

    console.log("✨ Sanity check completed successfully!");
  } catch (error) {
    console.error("\n❌ Sanity check failed with error:");
    console.error(error);

    // Try to restore test-project on error
    try {
      await $`git -C ${TEST_PROJECT_DIR} restore .`.quiet();
      console.log("\n♻️  Test-project restored");
    } catch {
      console.error("⚠️  Warning: Could not restore test-project");
    }

    process.exit(1);
  }
}

main();
