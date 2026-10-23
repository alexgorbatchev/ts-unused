import { expect, test } from "bun:test";
import { Project } from "ts-morph";
import { checkExportUsage } from "../checkExportUsage";
import { isPropertyUnused } from "../isPropertyUnused";
import { isTestFile } from "../isTestFile";
import { createClassifyUsageSource } from "../usageSourceUtils";

test("locates uses of generic values without expanding their inferred types for display", () => {
  const project = new Project({ useInMemoryFileSystem: true, skipLoadingLibFiles: true });
  const keys = Array.from({ length: 160 }, (_, index) => JSON.stringify(`key${index}`)).join(" | ");
  const file = project.createSourceFile(
    "/reference.ts",
    `
      declare function create<T extends string>(): { [P in T]: { [Q in T]: { [R in T]: P | Q | R } } };
      export const value = create<${keys}>();
      value;
    `,
  );
  const declaration = file.getVariableDeclarationOrThrow("value");

  expect(
    checkExportUsage("value", [declaration], file, "/", createClassifyUsageSource(isTestFile, [], "/")),
  ).toBeNull();
  expect(project.getLanguageService().compilerObject.getProgram()?.getInstantiationCount()).toBe(0);
});

test("does not expand unrelated mapped types when tracing a property's value flows", () => {
  const project = new Project({ useInMemoryFileSystem: true, skipLoadingLibFiles: true });
  const keys = Array.from({ length: 160 }, (_, index) => JSON.stringify(`key${index}`)).join(" | ");
  const file = project.createSourceFile(
    "/reference.ts",
    `
      interface Unused { untouched: string; }
      type Keys = ${keys};
      type Expanded = { [P in Keys]: { [Q in Keys]: P | Q } };
      const unrelated: Expanded = {};
    `,
  );
  const property = file.getInterfaceOrThrow("Unused").getPropertyOrThrow("untouched");
  project.getTypeChecker();
  const program = project.getProgram().compilerObject;
  const initialSymbols = program.getSymbolCount();

  expect(isPropertyUnused(property, createClassifyUsageSource(isTestFile, [], "/"), project)).toEqual({
    isUnusedOrTestOnly: true,
    onlyUsedInTests: false,
    onlyUsedInStories: false,
  });
  expect(program.getSymbolCount() - initialSymbols).toBeLessThan(160);
});

test("checks contextual property writes without instantiating a second semantic program", () => {
  const project = new Project({ useInMemoryFileSystem: true, skipLoadingLibFiles: true });
  const file = project.createSourceFile(
    "/reference.ts",
    `
      interface Props { value: string; }
      declare function Component(props: Props): void;
      type Args<F> = F extends (props: infer P) => void ? P : never;
      type Meta<F> = { args: Args<F> };
      const story: Meta<typeof Component> = { args: { value: "used" } };
    `,
  );

  expect(
    isPropertyUnused(
      file.getInterfaceOrThrow("Props").getPropertyOrThrow("value"),
      createClassifyUsageSource(isTestFile, [], "/"),
      project,
    ).isUnusedOrTestOnly,
  ).toBe(false);
  expect(project.getLanguageService().compilerObject.getProgram()?.getInstantiationCount()).toBe(0);
});
