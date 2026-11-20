import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { applySourceEdits } from "../sourceEdits";

test("combines overlapping removals and applies retained replacements from their original offsets", () => {
  expect(
    applySourceEdits("abcdefghij", [
      { start: 7, end: 9, text: "HI" },
      { start: 3, end: 5, text: "" },
      { start: 1, end: 4, text: "" },
    ]),
  ).toBe("afgHIj");
});

test("refuses overlapping replacements before modifying the source", () => {
  assert.throws(
    () =>
      applySourceEdits("abcdef", [
        { start: 1, end: 4, text: "new" },
        { start: 3, end: 5, text: "" },
      ]),
    /Overlapping source edits at 3 and 4/,
  );
});
