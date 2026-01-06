import { describe, expect, test } from "bun:test";
import { Project } from "ts-morph";

describe("fix inline object types", () => {
  test("should preserve inline object type text when removing never-returned union branches", async () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile(
      "/test.ts",
      `
      export function processData():
        | { status: "success"; value: string }
        | { status: "error"; reason: string } {
        return { status: "success", value: "ok" };
      }
      `
    );

    // Simulate what fixProject does
    const func = sourceFile.getFunctions()[0];
    if (!func) throw new Error("Function not found");

    const returnTypeNode = func.getReturnTypeNode();
    if (!returnTypeNode) throw new Error("Return type not found");

    const returnType = returnTypeNode.getType();
    const unionTypes = returnType.getUnionTypes();

    // Get the types as they would be collected
    const typesToKeep: string[] = [];
    for (const ut of unionTypes) {
      const symbol = ut.getSymbol();
      const typeName = symbol?.getName() || ut.getText();

      // This is the current buggy behavior - it uses symbol name which could be __type
      if (typeName !== '{ status: "error"; reason: string; }') {
        typesToKeep.push(typeName);
      }
    }

    // This test documents the bug: typeName for inline objects is __type
    expect(typesToKeep[0]).toBe("__type");

    // When we use setReturnType with __type, it creates invalid code
    func.setReturnType(typesToKeep[0] || "never");

    const fixedCode = sourceFile.getText();
    expect(fixedCode).toContain("__type");
  });

  test("should use getText() instead of symbol name for inline objects", async () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile(
      "/test.ts",
      `
      export function processData():
        | { status: "success"; value: string }
        | { status: "error"; reason: string } {
        return { status: "success", value: "ok" };
      }
      `
    );

    const func = sourceFile.getFunctions()[0];
    if (!func) throw new Error("Function not found");

    const returnTypeNode = func.getReturnTypeNode();
    if (!returnTypeNode) throw new Error("Return type not found");

    const returnType = returnTypeNode.getType();
    const unionTypes = returnType.getUnionTypes();

    // Get the types using getText() - the correct approach
    const typesToKeep: string[] = [];
    for (const ut of unionTypes) {
      const typeText = ut.getText();

      // Use getText() which gives us the actual type structure
      if (typeText !== '{ status: "error"; reason: string; }') {
        typesToKeep.push(typeText);
      }
    }

    // getText() gives us the actual type text
    expect(typesToKeep[0]).toBe('{ status: "success"; value: string; }');

    // When we use setReturnType with the correct text, it works
    func.setReturnType(typesToKeep[0] || "never");

    const fixedCode = sourceFile.getText();
    // Note: ts-morph may add semicolons in the type
    expect(fixedCode).toMatch(/status: "success"/);
    expect(fixedCode).not.toContain("__type");

    // Should compile without errors
    const diagnostics = project.getPreEmitDiagnostics();
    expect(diagnostics).toHaveLength(0);
  });
});
