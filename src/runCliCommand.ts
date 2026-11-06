import { SEVERITY } from "./constants.js";

import fs from "node:fs";
import path from "node:path";
import { formatResults } from "./formatResults.js";
import { loadConfigSync } from "./loadConfig.js";

interface ICommandArgs {
  project?: string;
  file?: string;
  config?: string;
}

type Command = "check" | "fix";

export async function runCliCommand(command: Command, args: ICommandArgs): Promise<number> {
  let tsConfigPath = path.resolve(args.project ?? "");
  if (fs.existsSync(tsConfigPath) && fs.statSync(tsConfigPath).isDirectory()) {
    tsConfigPath = path.join(tsConfigPath, "tsconfig.json");
  }
  const targetFilePath = args.file ? path.resolve(args.file) : undefined;
  const tsConfigDir = path.dirname(path.resolve(tsConfigPath));

  // Load configuration from the project directory
  const config = loadConfigSync(tsConfigDir, args.config);

  if (command === "fix") {
    const { fixProject } = await import("./fixProject.js");
    console.log(`Fixing TypeScript project: ${tsConfigPath}`);
    console.log("");

    const results = await fixProject(
      tsConfigPath,
      (message) => {
        console.log(message);
      },
      { config },
    );

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
    const { analyzeProject } = await import("./analyzeProject.js");
    console.log(`Analyzing TypeScript project: ${tsConfigPath}`);
    if (targetFilePath) {
      console.log(`Checking only: ${targetFilePath}`);
    }
    console.log("");

    const showProgress =
      process.env.CLAUDECODE !== "1" && process.env.REPL_ID === undefined && process.env.AGENT !== "1";

    const progressCallback = showProgress
      ? (current: number, total: number, filePath: string) => {
          const percentage = Math.min(100, Math.floor((current / total) * 100));
          const barLength = 40;
          const filledLength = Math.min(barLength, Math.max(0, Math.floor((current / total) * barLength)));
          const emptyLength = Math.max(0, barLength - filledLength);
          const bar = "█".repeat(filledLength) + "░".repeat(emptyLength);
          const fileName = path.basename(filePath);
          process.stdout.write(`\r\x1b[KProgress: [${bar}] ${percentage}% (${current}/${total}) ${fileName}`);
        }
      : undefined;

    const results = await analyzeProject(tsConfigPath, progressCallback, targetFilePath, { config });

    // Clear the progress bar line
    if (showProgress) {
      process.stdout.write("\r\x1b[K");
    }

    const output = formatResults(results, tsConfigDir);

    console.log(output);

    // Exit with 1 if there are any error-level violations
    const hasErrors =
      (results.unusedFiles.length > 0 && results.unusedFileSeverity === SEVERITY.ERROR) ||
      results.unusedExports.some((item) => item.severity === SEVERITY.ERROR) ||
      results.unusedProperties.some((item) => item.severity === SEVERITY.ERROR) ||
      (results.neverReturnedTypes ?? []).some((item) => item.severity === SEVERITY.ERROR) ||
      (results.duplicateTypes ?? []).some((item) => item.severity === SEVERITY.ERROR);

    if (hasErrors) {
      return 1;
    }
  }
  return 0;
}
