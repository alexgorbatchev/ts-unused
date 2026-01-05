// This file should be treated as a test file when using pattern "**/Test*.ts"
// This demonstrates custom test file patterns

import { usedFunction } from "./sample";

export function formatLogMessage(message: string): string {
  return `[TEST] ${message}`;
}

export class TestLogger {
  private messages: string[] = [];

  log(message: string): void {
    this.messages.push(formatLogMessage(message));
  }

  logUsed(): void {
    // Uses the production function
    usedFunction();
  }

  getMessages(): string[] {
    return this.messages;
  }
}

// Used 3 times within this file
formatLogMessage("test 1");
formatLogMessage("test 2");
formatLogMessage("test 3");
