import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { defaultConfig, mergeConfig, type IUnusedConfig } from "./config.js";

const CONFIG_FILE_NAME = "unused.config.ts";
const require = createRequire(import.meta.url);

function resolveConfigPath(targetDir: string, configPath?: string): string | undefined {
  if (configPath === "") {
    throw new Error("Configuration path must not be empty");
  }

  const resolvedConfigPath =
    configPath === undefined ? path.resolve(targetDir, CONFIG_FILE_NAME) : path.resolve(configPath);
  if (fs.existsSync(resolvedConfigPath)) {
    return resolvedConfigPath;
  }
  if (configPath !== undefined) {
    throw new Error(`Configuration file not found: ${resolvedConfigPath}`);
  }
  return undefined;
}

/**
 * Loads configuration from the target directory.
 * Missing implicit `unused.config.ts` files use defaults; explicit paths must exist.
 *
 * @param targetDir - The directory to look for the config file
 * @param configPath - Optional explicit path to config file
 * @returns The merged configuration
 */
export async function loadConfig(targetDir: string, configPath?: string): Promise<Required<IUnusedConfig>> {
  const resolvedConfigPath = resolveConfigPath(targetDir, configPath);

  if (resolvedConfigPath === undefined) {
    return { ...defaultConfig };
  }

  try {
    const configModule = await import(pathToFileURL(resolvedConfigPath).href);
    const userConfig: IUnusedConfig = configModule.default ?? configModule;

    return mergeConfig(userConfig);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load config from ${resolvedConfigPath}: ${errorMessage}`);
  }
}

/**
 * Synchronous version of loadConfig using the runtime's module loader.
 * Supports Node.js and Bun configurations without top-level await.
 * Missing implicit `unused.config.ts` files use defaults; explicit paths must exist.
 *
 * @param targetDir - The directory to look for the config file
 * @param configPath - Optional explicit path to config file
 * @returns The merged configuration
 */
export function loadConfigSync(targetDir: string, configPath?: string): Required<IUnusedConfig> {
  const resolvedConfigPath = resolveConfigPath(targetDir, configPath);

  if (resolvedConfigPath === undefined) {
    return { ...defaultConfig };
  }

  try {
    const configModule = require(resolvedConfigPath);
    const userConfig: IUnusedConfig = configModule.default ?? configModule;

    return mergeConfig(userConfig);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load config from ${resolvedConfigPath}: ${errorMessage}`);
  }
}
