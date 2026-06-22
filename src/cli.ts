#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { analyzeProject } from "./analyzeProject";
import { fixProject } from "./fixProject";
import { formatResults } from "./formatResults";
import { loadConfigSync } from "./loadConfig";

interface IParsedArgs {
  command: string;
  tsConfigPath: string;
  targetFilePath?: string;
  configPath?: string;
}

function parseArgs(args: string[]): IParsedArgs {
  let command = "check";
  let tsConfigArg = "";
  let configPath: string | undefined;

  const positionalArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";

    if (arg === "--config" || arg === "-c") {
      configPath = args[++i];
    } else if (arg.startsWith("--config=")) {
      configPath = arg.slice("--config=".length);
    } else if (arg === "check" || arg === "fix") {
      command = arg;
    } else {
      positionalArgs.push(arg);
    }
  }

  tsConfigArg = positionalArgs[0] ?? "";
  const targetFilePath = positionalArgs[1];

  let tsConfigPath = path.resolve(tsConfigArg);

  // If the path is a directory, look for tsconfig.json inside it
  if (fs.existsSync(tsConfigPath) && fs.statSync(tsConfigPath).isDirectory()) {
    tsConfigPath = path.join(tsConfigPath, "tsconfig.json");
  }

  return {
    command,
    tsConfigPath,
    targetFilePath: targetFilePath ? path.resolve(targetFilePath) : undefined,
    configPath,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log("Usage: ts-unused <command> <path-to-tsconfig.json> [file-path-to-check] [options]");
    console.log("");
    console.log("Commands:");
    console.log("  check  - Analyze and report unused exports/properties (default)");
    console.log("  fix    - Automatically remove unused exports/properties and delete unused files");
    console.log("");
    console.log("Options:");
    console.log("  --config, -c <path>  - Path to configuration file (default: unused.config.ts in project dir)");
    console.log("");
    console.log("Examples:");
    console.log("  ts-unused check tsconfig.json");
    console.log("  ts-unused check ./project-dir    # looks for tsconfig.json inside");
    console.log("  ts-unused fix tsconfig.json");
    console.log("  ts-unused check tsconfig.json --config ./unused.config.ts");
    process.exit(1);
  }

  const { command, tsConfigPath, targetFilePath, configPath } = parseArgs(args);
  const tsConfigDir = path.dirname(path.resolve(tsConfigPath));

  // Load configuration from the project directory
  const config = loadConfigSync(tsConfigDir, configPath);

  if (command === "fix") {
    console.log(`Fixing TypeScript project: ${tsConfigPath}`);
    console.log("");

    const results = await fixProject(tsConfigPath, (message) => {
      console.log(message);
    });

    console.log("");
    console.log("Summary:");
    console.log(`  Fixed exports: ${results.fixedExports}`);
    console.log(`  Fixed properties: ${results.fixedProperties}`);
    console.log(`  Deleted files: ${results.deletedFiles}`);
    console.log(`  Skipped files: ${results.skippedFiles.length}`);

    if (results.errors.length > 0) {
      console.log("");
      console.log("Errors:");
      for (const error of results.errors) {
        console.log(`  ${error.file}: ${error.error}`);
      }
    }

    if (results.skippedFiles.length > 0) {
      console.log("");
      console.log("Skipped files (have local git changes):");
      for (const file of results.skippedFiles) {
        console.log(`  ${file}`);
      }
    }
  } else {
    console.log(`Analyzing TypeScript project: ${tsConfigPath}`);
    if (targetFilePath) {
      console.log(`Checking only: ${targetFilePath}`);
    }
    console.log("");

    const results = await analyzeProject(
      tsConfigPath,
      (current, total, filePath) => {
        const percentage = Math.min(100, Math.floor((current / total) * 100));
        const barLength = 40;
        const filledLength = Math.min(barLength, Math.max(0, Math.floor((current / total) * barLength)));
        const emptyLength = Math.max(0, barLength - filledLength);
        const bar = "█".repeat(filledLength) + "░".repeat(emptyLength);
        const fileName = path.basename(filePath);
        process.stdout.write(`\r\x1b[KProgress: [${bar}] ${percentage}% (${current}/${total}) ${fileName}`);
      },
      targetFilePath,
      { config },
    );

    // Clear the progress bar line
    process.stdout.write("\r\x1b[K");

    const output = formatResults(results, tsConfigDir);

    console.log(output);

    // Exit with 1 if there are any error-level violations
    const unusedExportNames = new Set<string>();
    for (const exportItem of results.unusedExports) {
      unusedExportNames.add(exportItem.exportName);
    }
    const propertiesToReport = results.unusedProperties.filter((prop) => !unusedExportNames.has(prop.typeName));

    const unusedFileSet = new Set(results.unusedFiles);
    const exportsToReport = results.unusedExports.filter((exp) => !unusedFileSet.has(exp.filePath));

    const hasErrors =
      results.unusedFiles.length > 0 ||
      exportsToReport.some((exp) => exp.severity === "error") ||
      propertiesToReport.some((prop) => prop.severity === "error") ||
      (results.neverReturnedTypes || []).some((item) => item.severity === "error");

    if (hasErrors) {
      process.exit(1);
    }
  }
}

main();
