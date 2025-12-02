import { describe, expect, test } from "bun:test";
import { createTestUser, withMockServer } from "../test-helpers";

describe("User tests", () => {
  withMockServer();

  test("should create a test user", () => {
    const user = createTestUser("Alice");
    expect(user.name).toBe("Alice");
    expect(user.id).toBeGreaterThan(0);
  });
});
