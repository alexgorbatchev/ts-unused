#!/usr/bin/env bun

import { $ } from "bun";
import { existsSync } from "fs";
import { resolve } from "path";

const TEST_PROJECT_DIR = resolve(import.meta.dir, "../test-project");

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
    const gitStatus = await $`git -C ${TEST_PROJECT_DIR} diff --exit-code .`.nothrow().quiet();
    if (gitStatus.exitCode !== 0) {
      console.error("❌ FAILED: test-project has uncommitted changes");
      console.error("Please commit or restore test-project before running sanity check");
      process.exit(1);
    }
    console.log("✅ Test-project is clean\n");

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

    // Step 5: Verify changes were made
    console.log("🔍 Step 5: Verifying changes were made...");
    const gitDiff = await $`git -C ${TEST_PROJECT_DIR} diff --quiet .`.nothrow().quiet();
    if (gitDiff.exitCode === 0) {
      console.error("❌ FAILED: No changes were made by fix command");
      console.error("Expected fix command to modify files, but nothing changed");
      await $`git -C ${TEST_PROJECT_DIR} restore .`.quiet();
      process.exit(1);
    }
    console.log("✅ Changes detected\n");

    // Step 6: TypeScript check after fix
    console.log("🔎 Step 6: Running TypeScript check (after fix)...");
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

    // Step 7: Restore test-project
    console.log("♻️  Step 7: Restoring test-project...");
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
