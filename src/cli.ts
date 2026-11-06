#!/usr/bin/env node
import { SEVERITY } from "./constants.js";

import fs from "node:fs";
import path from "node:path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { formatResults } from "./formatResults.js";
import { loadConfigSync } from "./loadConfig.js";

interface ICommandArgs {
  project?: string;
  file?: string;
  config?: string;
}

type Command = "check" | "fix";

async function runCommand(command: Command, args: ICommandArgs): Promise<void> {
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
      process.exit(1);
    }
  }
}

async function main(): Promise<void> {
  const args = hideBin(process.argv);
  const cli = yargs(args)
    .scriptName("ts-unused")
    .usage("Usage: $0 [command] [project] [file] [options]")
    .parserConfiguration({
      "boolean-negation": false,
      "camel-case-expansion": false,
      "duplicate-arguments-array": false,
      "parse-positional-numbers": false,
      "populate--": true,
    })
    .option("config", {
      alias: "c",
      type: "string",
      requiresArg: true,
      description: "Configuration file (default: unused.config.ts in project directory)",
    })
    .command(
      ["check [project] [file]", "$0"],
      "Report unused code without modifying files",
      (command) =>
        command
          .positional("project", {
            type: "string",
            description: "tsconfig.json or project directory (default: current directory)",
          })
          .positional("file", { type: "string", description: "Limit check results to this file" }),
      (argv) => runCommand("check", argv),
    )
    .command(
      "fix [project]",
      "Remove unused code and delete unused files; respects Git safety checks",
      (command) =>
        command.positional("project", {
          type: "string",
          description: "tsconfig.json or project directory (default: current directory)",
        }),
      (argv) => runCommand("fix", argv),
    )
    .check((argv) => {
      if (argv.help === true) return true;
      if (argv.config === "") {
        throw new Error("--config requires a nonempty path");
      }
      if (Array.isArray(argv["--"]) && argv["--"].length > 0) {
        throw new Error("Operands after -- are not supported; use ./ before paths beginning with -");
      }
      return true;
    })
    .example("$0 check tsconfig.json", "Check an explicit project")
    .example("$0 ./project-dir", "Check a directory containing tsconfig.json")
    .example("$0 check tsconfig.json src/file.ts", "Report findings only for one file")
    .example("$0 fix tsconfig.json", "Remove unused code")
    .example("$0 check tsconfig.json --config ./custom.config.ts", "Use custom configuration")
    .version(false)
    .help()
    .alias("help", "h")
    .strict()
    .showHelpOnFail(false, "Run ts-unused --help for usage.");

  if (args.length === 0) {
    cli.showHelp("log");
    process.exitCode = 1;
    return;
  }
  await cli.parseAsync();
}

main();
