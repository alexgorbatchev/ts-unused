// This file uses the exports from config-patterns.ts to show they are used

import { processConfig, type ShellConfig, type ErrorInfo } from "./config-patterns";
import { setupAugmentations } from "./module-augmentation";

// Use the ShellConfig type
const myConfig: ShellConfig = {
  shell: "/bin/bash",
  args: ["-c", "echo hello"],
  env: { PATH: "/usr/bin" },
  cwd: "/home/user",
  _internal: false,
};

processConfig(myConfig);

// Use ErrorInfo in error handling
function handleError(error: ErrorInfo): void {
  console.error(`Error ${error.code}: ${error.message}`);
  if (error.stack) {
    console.error(error.stack);
  }
}

// Demonstrate error handling
try {
  throw new Error("Something went wrong");
} catch (e) {
  const errorInfo: ErrorInfo = {
    message: (e as Error).message,
    code: 500,
    stack: (e as Error).stack,
  };
  handleError(errorInfo);
}

// Use the module augmentation setup
setupAugmentations();

export { handleError };
