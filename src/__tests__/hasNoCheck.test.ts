import { describe, expect, test } from "bun:test";
import { hasNoCheck } from "../hasNoCheck";

describe("hasNoCheck", () => {
  test('returns true when first line is exactly "// @ts-nocheck"', () => {
    const sourceFile = "// @ts-nocheck\nexport const foo = 123;";

    const result: boolean = hasNoCheck(sourceFile);

    expect(result).toBe(true);
  });

  test("returns false when first line is not @ts-nocheck", () => {
    const sourceFile = "export const foo = 123;";

    const result: boolean = hasNoCheck(sourceFile);

    expect(result).toBe(false);
  });

  test("returns false when @ts-nocheck is on second line", () => {
    const sourceFile = "// Some comment\n// @ts-nocheck\nexport const foo = 123;";

    const result: boolean = hasNoCheck(sourceFile);

    expect(result).toBe(false);
  });

  test("returns true when first line has whitespace before @ts-nocheck", () => {
    const sourceFile = "   // @ts-nocheck\nexport const foo = 123;";

    const result: boolean = hasNoCheck(sourceFile);

    expect(result).toBe(true);
  });

  test("returns true when first line has whitespace after @ts-nocheck", () => {
    const sourceFile = "// @ts-nocheck   \nexport const foo = 123;";

    const result: boolean = hasNoCheck(sourceFile);

    expect(result).toBe(true);
  });

  test("returns false when first line has text after @ts-nocheck", () => {
    const sourceFile = "// @ts-nocheck - some reason\nexport const foo = 123;";

    const result: boolean = hasNoCheck(sourceFile);

    expect(result).toBe(false);
  });

  test("returns false for empty file", () => {
    const sourceFile = "";

    const result: boolean = hasNoCheck(sourceFile);

    expect(result).toBe(false);
  });
});
