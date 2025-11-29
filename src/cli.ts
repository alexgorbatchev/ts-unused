#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { analyzeProject } from "./analyzeProject";
import { fixProject } from "./fixProject";
import { formatResults } from "./formatResults";

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log("Usage: ts-unused <command> <path-to-tsconfig.json> [file-path-to-check]");
    console.log("");
    console.log("Commands:");
    console.log("  check  - Analyze and report unused exports/properties (default)");
    console.log("  fix    - Automatically remove unused exports/properties and delete unused files");
    console.log("");
    console.log("Examples:");
    console.log("  ts-unused check tsconfig.json");
    console.log("  ts-unused check ./project-dir    # looks for tsconfig.json inside");
    console.log("  ts-unused fix tsconfig.json");
    process.exit(1);
  }

  // Check if first arg is a command or a path
  const firstArg = args[0] ?? "";
  let command = "check";
  let configIndex = 0;

  if (firstArg === "check" || firstArg === "fix") {
    command = firstArg;
    configIndex = 1;
  }

  let tsConfigPath = path.resolve(args[configIndex] ?? "");
  
  // If the path is a directory, look for tsconfig.json inside it
  if (fs.existsSync(tsConfigPath) && fs.statSync(tsConfigPath).isDirectory()) {
    tsConfigPath = path.join(tsConfigPath, "tsconfig.json");
  }

  const targetFilePath = args[configIndex + 1] ? path.resolve(args[configIndex + 1]!) : undefined;

  if (command === "fix") {
    console.log(`🔧 Fixing TypeScript project: ${tsConfigPath}`);
    console.log("");

    const results = fixProject(tsConfigPath, (message) => {
      console.log(message);
    });

    console.log("");
    console.log("📊 Summary:");
    console.log(`  Fixed exports: ${results.fixedExports}`);
    console.log(`  Fixed properties: ${results.fixedProperties}`);
    console.log(`  Deleted files: ${results.deletedFiles}`);
    console.log(`  Skipped files: ${results.skippedFiles.length}`);

    if (results.errors.length > 0) {
      console.log("");
      console.log("❌ Errors:");
      for (const error of results.errors) {
        console.log(`  ${error.file}: ${error.error}`);
      }
    }

    if (results.skippedFiles.length > 0) {
      console.log("");
      console.log("⚠️  Skipped files (have local git changes):");
      for (const file of results.skippedFiles) {
        console.log(`  ${file}`);
      }
    }
  } else {
    console.log(`🔍 Analyzing TypeScript project: ${tsConfigPath}`);
    if (targetFilePath) {
      console.log(`📄 Checking only: ${targetFilePath}`);
    }
    console.log("");

    const results = analyzeProject(
      tsConfigPath,
      (current, total, filePath) => {
        const percentage = Math.min(100, Math.floor((current / total) * 100));
        const barLength = 40;
        const filledLength = Math.min(barLength, Math.max(0, Math.floor((current / total) * barLength)));
        const emptyLength = Math.max(0, barLength - filledLength);
        const bar = "█".repeat(filledLength) + "░".repeat(emptyLength);
        const fileName = path.basename(filePath);
        process.stdout.write(`\r\x1b[K📊 Progress: [${bar}] ${percentage}% (${current}/${total}) ${fileName}`);
      },
      targetFilePath
    );

    // Clear the progress bar line
    process.stdout.write("\r\x1b[K");

    const output = formatResults(results);

    console.log(output);
  }
}

main();
