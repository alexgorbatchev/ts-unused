import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { defaultConfig, mergeConfig, type IUnusedConfig } from "./config.js";

const CONFIG_FILE_NAME = "unused.config.ts";
const require = createRequire(import.meta.url);

/**
 * Loads configuration from the target directory.
 * Looks for `unused.config.ts` in the specified directory.
 * If not found, returns default configuration.
 *
 * @param targetDir - The directory to look for the config file
 * @param configPath - Optional explicit path to config file
 * @returns The merged configuration
 */
export async function loadConfig(targetDir: string, configPath?: string): Promise<Required<IUnusedConfig>> {
  const resolvedConfigPath = configPath ? path.resolve(configPath) : path.join(targetDir, CONFIG_FILE_NAME);

  if (!fs.existsSync(resolvedConfigPath)) {
    return { ...defaultConfig };
  }

  try {
    // Use dynamic import to load the TypeScript config file
    // Bun natively supports TypeScript imports
    const configModule = await import(resolvedConfigPath);
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
 *
 * @param targetDir - The directory to look for the config file
 * @param configPath - Optional explicit path to config file
 * @returns The merged configuration
 */
export function loadConfigSync(targetDir: string, configPath?: string): Required<IUnusedConfig> {
  const resolvedConfigPath = configPath ? path.resolve(configPath) : path.resolve(targetDir, CONFIG_FILE_NAME);

  if (!fs.existsSync(resolvedConfigPath)) {
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
