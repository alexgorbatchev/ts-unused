---
created_on: 2026-10-23 04:43
last_modified: 2026-10-23 04:43
status: current
---

# Consumer memory analysis

For maintainers diagnosing high memory use when ts-unused analyzes a consumer project. It explains what sets peak memory outside ts-unused's own analysis caches, how to measure each factor, and what consumers can change. For the analyzer's internal caches, see [performance.md](./performance.md).

## Summary

ts-unused's peak memory roughly matches the TypeScript checker's peak for the same program. Two factors outside ts-unused multiply it:

1. **TypeScript relation-cache saturation in the consumer.** Some type patterns fill one of the checker's relation caches with millions of entries. In the reference consumer, the identity cache reached 16.3 million entries, and once it is full every further comparison fails with `TS2859`.
2. **The JavaScript runtime.** On Bun (JavaScriptCore), the same TypeScript workload peaks at roughly 3–4× the memory it needs on Node (V8).

## Reference measurements

The reference consumer is the `@alexgorbatchev/shadcn` component catalog: 970 project source files, 4,081 program files, and Storybook stories for most components.

Environment:

- Linux x64 host with 124 GiB of RAM
- Bun 1.4.3 and Node 26.12
- TypeScript 6.0.3, as bundled by ts-morph 28

Peak memory is the maximum resident set size reported by `/usr/bin/time -v`.

| Workload                                                | Node peak     | Bun peak                |
| ------------------------------------------------------- | ------------- | ----------------------- |
| `ts-unused check` (3.7.1), all rules, package mode      | 3.8 GiB, 2:12 | 13.0 GiB, 2:13          |
| Plain TypeScript type check, no ts-morph                | 3.8 GiB, 96 s | 12.1–15.6 GiB, 98–121 s |
| Plain type check, stories rewritten to `satisfies Meta` | 1.9 GiB, 18 s | 5.4 GiB, 18 s           |

Both runtimes produce identical ts-unused findings.

## Relation-cache saturation

The TypeScript 6 checker keeps one cache per relation: identity, assignability, subtype, and strict subtype. Cache keys are strings, so every entry costs a string plus a map slot. Each comparison has a complexity budget of `(16_000_000 - relation.size) >> 3` checks. When a cache approaches 16 million entries, the budget reaches zero and every new comparison through that relation reports `TS2859: Excessive complexity comparing types`.

In the reference consumer, Storybook files fill the identity cache:

```tsx
const meta: Meta<typeof Spinner> = { title: "…", component: Spinner };
export default meta;
type Story = StoryObj<typeof meta>;
```

Annotating `meta` with `Meta<…>` gives it the full component-annotations type, including `args?: Partial<Props>`. `StoryObj<typeof meta>` then infers default args from that type and maps over every component prop. The identity work scales with the size of the props type. Each variant below was checked alone:

| Story shape                                                     | Identity entries |
| --------------------------------------------------------------- | ---------------- |
| Component with one optional prop                                | 34               |
| `ComponentProps<"div">`                                         | 117,493          |
| `ComponentProps<"svg">`                                         | 357,005          |
| `Meta<typeof Spinner>` without `StoryObj`                       | 6                |
| `… satisfies Meta<typeof Spinner>` with `StoryObj<typeof meta>` | 27               |

In a full program check, most story files add about 85,000 entries each to the shared cache. Story files account for 16.32 million of the 16.33 million identity entries; the rest of the project adds about 5,000. The cache saturates after about 900 checked files, so the last stories in program order report 327,034 `TS2859` errors.

Leaving out the files that report the errors does not reduce memory: the cache is already full when they are checked. Rewriting every story to Storybook's `satisfies` form removes the saturation. The identity cache falls to 13,060 entries, `TS2859` disappears, and peak memory falls by about half on both runtimes. With `satisfies`, TypeScript reports required component args that neither `meta.args` nor the story provides, so the rewrite also surfaces missing story args as ordinary type errors (139 in the reference consumer).

### TypeScript 7 hides the saturation

TypeScript 7's `tsc` spreads the program across several checkers by default, each with its own relation caches, so no single cache reaches the cap and `tsc --noEmit` passes. Forcing one checker brings back the same errors: `tsc --noEmit --checkers 1` reports 326,878 `TS2859` errors on the reference consumer. A project can therefore pass its TypeScript 7 type check while ts-unused, which runs one TypeScript 6 checker through ts-morph, hits the saturated cache.

ts-unused cannot switch to the TypeScript 7 checker yet. TypeScript 7.0 ships no programmatic API, and ts-morph 28 is built on the TypeScript 6 API. The TypeScript team expects 7.1 to ship a new, different API ([Announcing TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)).

## Runtime multiplier

Bun runs the TypeScript checker on JavaScriptCore, and the same workload needs about 3–4× the memory it needs on Node. After a forced full collection at the end of the plain type check:

| Measure              | Node (V8) | Bun (JavaScriptCore) |
| -------------------- | --------- | -------------------- |
| Live heap            | 2.8 GiB   | 3.9 GiB              |
| Heap capacity        | 3.1 GiB   | 5.3–9.9 GiB          |
| Peak resident memory | 3.8 GiB   | 12.1–15.6 GiB        |

Live objects take about 40% more space on JavaScriptCore. Most of the difference is heap space reserved around them: JavaScriptCore sizes its collection thresholds from physical RAM. A heap below `smallHeapRAMFraction` (0.25) of RAM may grow by `smallHeapGrowthFactor` (2×) before the next full collection; on a 124 GiB host, that rule covers every heap below 31 GiB ([JavaScriptCore `OptionsList.h`](https://github.com/WebKit/WebKit/blob/main/Source/JavaScriptCore/runtime/OptionsList.h)). V8 collects against a fixed old-space limit.

JavaScriptCore options passed through `BUN_JSC_*` environment variables change the plain type check's peak only partly:

| Setting                                                                  | Bun peak                  |
| ------------------------------------------------------------------------ | ------------------------- |
| Default                                                                  | 12.1–15.6 GiB             |
| `--smol` (full ts-unused run)                                            | 14.3 GiB                  |
| `BUN_JSC_smallHeapGrowthFactor=1.24 BUN_JSC_mediumHeapGrowthFactor=1.24` | 12.5 GiB                  |
| `BUN_JSC_useConcurrentGC=false`                                          | 10.6 GiB                  |
| `BUN_JSC_forceRAMSize=4294967296`                                        | 8.1 GiB, about 60% slower |

None of these settings matches Node. The CLI declares `#!/usr/bin/env node`. `bun run ts-unused` respects that shebang and runs the CLI on Node; `bun run --bun ts-unused` and `bun dist/cli.js` force JavaScriptCore ([Bun runtime docs](https://bun.com/docs/runtime)).

## Consumer guidance

- Run the CLI on Node: `bun run ts-unused check tsconfig.json`, without `--bun`.
- Declare Storybook metadata with `const meta = { … } satisfies Meta<typeof Component>` and derive stories with `StoryObj<typeof meta>`, as [Storybook's TypeScript guide](https://storybook.js.org/docs/writing-stories/typescript) recommends.
- Projects that run TypeScript 6 and 7 side by side should install `typescript` as `npm:@typescript/typescript6` next to `@typescript/native`. The compatibility package exposes `tsc6`, so TypeScript 7 owns `tsc` ([Announcing TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)).

## Reproduction

Read a consumer's relation-cache sizes and checker memory with the TypeScript 6 CLI:

```sh
tsc6 --noEmit --extendedDiagnostics | grep -E "Identity cache|Assignability cache|Memory used|Check time"
```

Count saturation errors that TypeScript 7 hides behind its default checker count:

```sh
tsc --noEmit --checkers 1 | grep -c TS2859
```

Compare runtimes on the same consumer with the built CLI:

```sh
bun run build
/usr/bin/time -v node dist/cli.js check /absolute/path/to/consumer/tsconfig.json
/usr/bin/time -v bun dist/cli.js check /absolute/path/to/consumer/tsconfig.json
```

To separate live objects from reserved heap space on Bun, run a script that calls `fullGC()` and `heapStats()` from `bun:jsc` after the work finishes. Compare `heapSize` (live) and `heapCapacity` (reserved) with `process.memoryUsage().rss`. On Node, compare `used_heap_size` from `v8.getHeapStatistics()` after `--expose-gc` and `gc()`.
