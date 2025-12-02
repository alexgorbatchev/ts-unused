// Helper functions that are only used in tests
import { afterEach, beforeEach } from "bun:test";

export function createTestUser(name: string) {
  return { id: Math.random(), name };
}

export function createTestPost(title: string) {
  return { id: Math.random(), title, createdAt: new Date() };
}

// A function that's called within test lifecycle hooks (not directly in test body)
export function withMockServer(): void {
  let server: { stop: () => void } | null = null;

  beforeEach(() => {
    server = {
      stop: () => console.log("Server stopped"),
    };
  });

  afterEach(() => {
    if (server) {
      server.stop();
      server = null;
    }
  });
}
