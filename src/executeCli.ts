import yargs from "yargs";
import { runCliCommand } from "./runCliCommand.js";

export async function executeCli(args: readonly string[]): Promise<number> {
  let exitCode = 0;
  const cli = yargs([...args])
    .exitProcess(false)
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
      async (argv) => {
        exitCode = await runCliCommand("check", argv);
      },
    )
    .command(
      "fix [project]",
      "Remove unused code and delete unused files; respects Git safety checks",
      (command) =>
        command.positional("project", {
          type: "string",
          description: "tsconfig.json or project directory (default: current directory)",
        }),
      async (argv) => {
        exitCode = await runCliCommand("fix", argv);
      },
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
    .fail((message, error) => {
      throw new Error(message || error?.message || "Command failed");
    });

  if (args.length === 0) {
    cli.showHelp("log");
    return 1;
  }
  try {
    await cli.parseAsync();
    return exitCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${message}\n\nRun ts-unused --help for usage.`);
    return 1;
  }
}
