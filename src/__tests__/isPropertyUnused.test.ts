import { describe, expect, test } from "bun:test";
import { getUsage } from "./helpers";

describe("property usage relationships", () => {
  test("does not borrow usage from an unrelated interface with an identical shape", async () => {
    const files: Record<string, string> = {};
    files["/types.ts"] = `
      interface Unused { value: string; }
      interface Used { value: string; }
      function read(item: Used) { return item.value; }
    `;

    const usage = await getUsage(files);
    expect(usage.get("Unused")!.get("value")!).toEqual({
      isUnusedOrTestOnly: true,
      onlyUsedInTests: false,
      onlyUsedInStories: false,
    });
  });

  test("does not borrow usage from an unrelated object type alias", async () => {
    const files: Record<string, string> = {};
    files["/types.ts"] = `
      type Unused = { value: string };
      type Used = { value: string };
      function read(item: Used) { return item.value; }
    `;

    const usage = await getUsage(files);
    expect(usage.get("Unused")!.get("value")!).toEqual({
      isUnusedOrTestOnly: true,
      onlyUsedInTests: false,
      onlyUsedInStories: false,
    });
  });

  test("does not borrow Reflect access from an unrelated receiver", async () => {
    const files: Record<string, string> = {};
    files["/types.ts"] = `
      interface Unused { value: string; }
      interface Used { value: string; }
      function read(item: Used) { return Reflect.get(item, "value"); }
    `;

    const usage = await getUsage(files);
    expect(usage.get("Unused")!.get("value")!.isUnusedOrTestOnly).toBe(true);
  });

  test("preserves usage through interface inheritance and redeclaration", async () => {
    const files: Record<string, string> = {};
    files["/types.ts"] = `
      interface Base { value: string; }
      interface Child extends Base { value: string; }
      function read(item: Child) { return item.value; }
    `;

    const usage = await getUsage(files);
    expect(usage.get("Base")!.get("value")!.isUnusedOrTestOnly).toBe(false);
  });

  test("does not count a related property redeclaration as a read", async () => {
    const files: Record<string, string> = {};
    files["/types.ts"] = `
      interface Base { value: string; }
      interface Child extends Base { value: string; }
    `;

    const usage = await getUsage(files);
    expect(usage.get("Base")!.get("value")!).toEqual({
      isUnusedOrTestOnly: true,
      onlyUsedInTests: false,
      onlyUsedInStories: false,
    });
  });

  test("preserves usage through an implementing class", async () => {
    const files: Record<string, string> = {};
    files["/types.ts"] = `
      interface Options { value: string; }
      class Implementation implements Options {
        value = "used";
        read() { return this.value; }
      }
    `;

    const usage = await getUsage(files);
    expect(usage.get("Options")!.get("value")!.isUnusedOrTestOnly).toBe(false);
  });

  test("preserves usage through object spreads", async () => {
    const files: Record<string, string> = {};
    files["/types.ts"] = `
      interface Source { value: string; unused: number; }
      interface Target { value: string; }
      function read(source: Source) {
        const target: Target = { ...source };
        return target.value;
      }
    `;

    const usage = await getUsage(files);
    expect(usage.get("Source")!.get("value")!.isUnusedOrTestOnly).toBe(false);
    expect(usage.get("Source")!.get("unused")!.isUnusedOrTestOnly).toBe(true);
  });

  test("does not propagate usage for an overwritten spread property", async () => {
    const files: Record<string, string> = {};
    files["/types.ts"] = `
      interface Source { value: string; }
      interface Target { value: string; }
      function read(source: Source) {
        const target: Target = { ...source, value: "replacement" };
        return target.value;
      }
    `;

    const usage = await getUsage(files);
    expect(usage.get("Source")!.get("value")!.isUnusedOrTestOnly).toBe(true);
  });

  test("preserves usage through assignment and function arguments", async () => {
    const files: Record<string, string> = {};
    files["/types.ts"] = `
      interface Source { value: string; }
      interface Target { value: string; }
      function read(target: Target) { return target.value; }
      function pass(source: Source) {
        const target: Target = source;
        return read(target);
      }
    `;

    const usage = await getUsage(files);
    expect(usage.get("Source")!.get("value")!.isUnusedOrTestOnly).toBe(false);
  });

  test("preserves unique symbol keys across contextual assignments", async () => {
    const files: Record<string, string> = {};
    files["/types.ts"] = `
      declare const key: unique symbol;
      interface Source { [key]: string; "overwritten": string; }
      interface Target { [key]: string; overwritten: string; }
      function read(target: Target) { return target[key] + target.overwritten; }
      function pass(source: Source) { return read({ ...source, "overwritten": "replacement" }); }
    `;

    const usage = await getUsage(files);
    expect(usage.get("Source")!.get("[key]")!.isUnusedOrTestOnly).toBe(false);
    expect(usage.get("Source")!.get('"overwritten"')!.isUnusedOrTestOnly).toBe(true);
  });

  test("tracks usage through spreads that occur only in tests as test-only", async () => {
    const files: Record<string, string> = {};
    files["/types.ts"] = `
      export interface Source { value: string; }
      export interface Target { value: string; }
      export function read(target: Target) { return target.value; }
    `;
    files["/usage.test.ts"] = `
      import { read, type Source, type Target } from "./types";
      function check(source: Source) {
        const target: Target = { ...source };
        return read(target);
      }
    `;

    const usage = await getUsage(files);
    expect(usage.get("Source")!.get("value")!).toEqual({
      isUnusedOrTestOnly: true,
      onlyUsedInTests: true,
      onlyUsedInStories: false,
    });
  });
});

describe("story usage", () => {
  const TYPES_SOURCE = `
    export interface Source { value: string; }
    export interface Target { value: string; }
    export function read(target: Target) { return target.value; }
  `;
  const SPREAD_USAGE_SOURCE = `
    import { read, type Source, type Target } from "./types";
    export function check(source: Source) {
      const target: Target = { ...source };
      return read(target);
    }
  `;

  test("tracks usage through spreads that occur only in stories as story-only", async () => {
    const files: Record<string, string> = {};
    files["/types.ts"] = TYPES_SOURCE;
    files["/usage.stories.ts"] = SPREAD_USAGE_SOURCE;

    const usage = await getUsage(files, ["**/*.stories.ts"]);
    expect(usage.get("Source")!.get("value")!).toEqual({
      isUnusedOrTestOnly: true,
      onlyUsedInTests: false,
      onlyUsedInStories: true,
    });
  });

  test("prefers a story flow over a test flow when both reach the property", async () => {
    const files: Record<string, string> = {};
    files["/types.ts"] = TYPES_SOURCE;
    files["/usage.test.ts"] = SPREAD_USAGE_SOURCE;
    files["/view.stories.ts"] = SPREAD_USAGE_SOURCE;

    const usage = await getUsage(files, ["**/*.stories.ts"]);
    expect(usage.get("Source")!.get("value")!).toEqual({
      isUnusedOrTestOnly: true,
      onlyUsedInTests: false,
      onlyUsedInStories: true,
    });
  });

  test("counts story usage of a property declared in a story file as usage, and test usage as test-only", async () => {
    const files: Record<string, string> = {};
    files["/button.stories.ts"] = `
      export interface IStoryState { isOpen: boolean; label?: string; }
      const state: IStoryState = { isOpen: true };
      export const Primary = { render: () => state.isOpen };
    `;
    files["/button.test.ts"] = `
      import type { IStoryState } from "./button.stories";
      declare const state: IStoryState;
      console.log(state.label);
    `;

    const usage = await getUsage(files, ["**/*.stories.ts"]);
    expect(usage.get("IStoryState")!.get("isOpen")!).toEqual({
      isUnusedOrTestOnly: false,
      onlyUsedInTests: false,
      onlyUsedInStories: false,
    });
    expect(usage.get("IStoryState")!.get("label")!).toEqual({
      isUnusedOrTestOnly: true,
      onlyUsedInTests: true,
      onlyUsedInStories: false,
    });
  });
});

describe("keyed property reads", () => {
  test("counts destructuring with string, numeric, and computed keys as reads", async () => {
    const files: Record<string, string> = {};
    files["/types.ts"] = `
      export interface Props {
        'aria-required'?: boolean;
        'aria-describedby'?: string;
        'param-key'?: string;
        'nested-key'?: { 'inner-key'?: string };
        'computed-key'?: string;
        'template-key'?: string;
        0?: string;
        'never-read'?: string;
      }
      const COMPUTED_KEY = 'computed-key';
      export function Component(props: Props, { 'param-key': param }: Props) {
        const {
          'aria-required': ariaRequired,
          'aria-describedby': ariaDescribedBy,
          'nested-key': { 'inner-key': inner } = {},
          [COMPUTED_KEY]: computed,
          [\`template-key\`]: template,
          0: zero,
        } = props;
        return [ariaRequired, ariaDescribedBy, param, inner, computed, template, zero];
      }
    `;

    const usage = await getUsage(files);
    expect(
      Object.fromEntries([...usage.get("Props")!].map(([name, property]) => [name, property.isUnusedOrTestOnly])),
    ).toEqual({
      "'aria-required'": false,
      "'aria-describedby'": false,
      "'param-key'": false,
      "'nested-key'": false,
      "'computed-key'": false,
      "'template-key'": false,
      "0": false,
      "'never-read'": true,
    });
  });

  test("counts assignment destructuring with literal and computed keys as reads", async () => {
    const files: Record<string, string> = {};
    files["/types.ts"] = `
      export interface Props {
        'assigned-key'?: string;
        'computed-key'?: string;
        'for-of-key'?: string;
        1?: string;
        'never-read'?: string;
      }
      const COMPUTED_KEY = 'computed-key';
      let assigned: string | undefined;
      let computed: string | undefined;
      let numeric: string | undefined;
      let iterated: string | undefined;
      export function read(props: Props, list: Props[]) {
        ({ 'assigned-key': assigned, [COMPUTED_KEY]: computed, 1: numeric } = props);
        for ({ 'for-of-key': iterated } of list) {}
        return [assigned, computed, numeric, iterated];
      }
    `;

    const usage = await getUsage(files);
    expect(
      Object.fromEntries([...usage.get("Props")!].map(([name, property]) => [name, property.isUnusedOrTestOnly])),
    ).toEqual({
      "'assigned-key'": false,
      "'computed-key'": false,
      "'for-of-key'": false,
      "1": false,
      "'never-read'": true,
    });
  });

  test("counts element access with literal and literal-typed keys as reads", async () => {
    const files: Record<string, string> = {};
    files["/types.ts"] = `
      export interface Props {
        'literal-key'?: string;
        'constant-key'?: string;
        'union-a'?: string;
        'union-b'?: string;
        'never-read'?: string;
      }
      const CONSTANT_KEY = 'constant-key';
      export function read(props: Props, key: 'union-a' | 'union-b') {
        return [props['literal-key'], props[CONSTANT_KEY], props[key]];
      }
    `;

    const usage = await getUsage(files);
    expect(
      Object.fromEntries([...usage.get("Props")!].map(([name, property]) => [name, property.isUnusedOrTestOnly])),
    ).toEqual({
      "'literal-key'": false,
      "'constant-key'": false,
      "'union-a'": false,
      "'union-b'": false,
      "'never-read'": true,
    });
  });

  test("counts destructuring and element access with unique symbol keys as reads", async () => {
    const files: Record<string, string> = {};
    files["/types.ts"] = `
      const BINDING_KEY: unique symbol = Symbol("binding");
      const ASSIGNED_KEY = Symbol("assigned");
      const INDEXED_KEY = Symbol("indexed");
      const UNION_A = Symbol("a");
      const UNION_B = Symbol("b");
      const NEVER_KEY = Symbol("never");
      export interface Props {
        [BINDING_KEY]?: string;
        [ASSIGNED_KEY]?: string;
        [INDEXED_KEY]?: string;
        [UNION_A]?: string;
        [UNION_B]?: string;
        [NEVER_KEY]?: string;
      }
      let assigned: string | undefined;
      export function read(props: Props, key: typeof UNION_A | typeof UNION_B) {
        const { [BINDING_KEY]: binding } = props;
        ({ [ASSIGNED_KEY]: assigned } = props);
        return [binding, assigned, props[INDEXED_KEY], props[key]];
      }
    `;

    const usage = await getUsage(files);
    expect(
      Object.fromEntries([...usage.get("Props")!].map(([name, property]) => [name, property.isUnusedOrTestOnly])),
    ).toEqual({
      "[BINDING_KEY]": false,
      "[ASSIGNED_KEY]": false,
      "[INDEXED_KEY]": false,
      "[UNION_A]": false,
      "[UNION_B]": false,
      "[NEVER_KEY]": true,
    });
  });

  test("attributes unique symbol reads to the symbol that keys the property", async () => {
    const files: Record<string, string> = {};
    files["/types.ts"] = `
      const KEY = Symbol("key");
      const SAME_DESCRIPTION = Symbol("key");
      export interface Keyed { [KEY]?: string; [SAME_DESCRIPTION]?: string; }
      export function read(keyed: Keyed) {
        return keyed[KEY];
      }
    `;

    const usage = await getUsage(files);
    expect(
      Object.fromEntries([...usage.get("Keyed")!].map(([name, property]) => [name, property.isUnusedOrTestOnly])),
    ).toEqual({ "[KEY]": false, "[SAME_DESCRIPTION]": true });
  });

  test("attributes keyed reads to the destructured type only", async () => {
    const files: Record<string, string> = {};
    files["/types.ts"] = `
      export interface Unused { 'shared-key'?: string; }
      export interface Used { 'shared-key'?: string; }
      export function read(used: Used) {
        const { 'shared-key': value } = used;
        return value;
      }
    `;

    const usage = await getUsage(files);
    expect(
      Object.fromEntries([...usage.get("Unused")!].map(([name, property]) => [name, property.isUnusedOrTestOnly])),
    ).toEqual({ "'shared-key'": true });
    expect(
      Object.fromEntries([...usage.get("Used")!].map(([name, property]) => [name, property.isUnusedOrTestOnly])),
    ).toEqual({ "'shared-key'": false });
  });

  test("reports keyed reads that occur only in tests as test-only", async () => {
    const files: Record<string, string> = {};
    files["/types.ts"] = `export interface Props { 'test-key'?: string; }`;
    files["/usage.test.ts"] = `
      import type { Props } from "./types";
      export function check(props: Props) {
        const { 'test-key': value } = props;
        return value;
      }
    `;

    const usage = await getUsage(files);
    expect(usage.get("Props")!.get("'test-key'")!).toEqual({
      isUnusedOrTestOnly: true,
      onlyUsedInTests: true,
      onlyUsedInStories: false,
    });
  });
});

test("native property scanner counts union return writes only for branches compatible with the returned literal", async () => {
  const files: Record<string, string> = {};
  files["/union.ts"] = `
      interface Success { kind: "success"; data: string; shared: string; }
      interface Failure { kind: "failure"; error: string; shared: string; }
      function result(): Success | Failure {
        return { kind: "success", data: "written", shared: "selected" };
      }
    `;

  const usage = await getUsage(files);
  expect(usage.get("Success")!.get("data")!.isUnusedOrTestOnly).toBe(false);
  expect(usage.get("Success")!.get("shared")!.isUnusedOrTestOnly).toBe(false);
  expect(usage.get("Failure")!.get("shared")!.isUnusedOrTestOnly).toBe(true);
  expect(usage.get("Failure")!.get("error")!.isUnusedOrTestOnly).toBe(true);
});
