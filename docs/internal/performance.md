---
created_on: 2026-10-23 03:09
last_modified: 2026-10-23 04:43
status: current
---

# Semantic analysis memory

For maintainers, this reference describes the analysis caches and the checks that protect their memory behavior. For memory set by the consumer project and the JavaScript runtime, see [consumer-memory.md](./consumer-memory.md).

## Property access indexing

`getPropertyAccesses` scans the compiler program once and indexes source files by the property declarations they access. It uses the project's existing compiler checker, including native symbol origins for mapped types and explicit interface/class heritage. The index includes declaration files, contextual object writes, JSX attributes, binding patterns, assignment patterns, literal and computed keys, unique symbols, and supported Reflect calls.

Contextual writes into union types must resolve properties on their individual members. The union itself exposes only common properties. When members have different property origins, use the actual expression's assignability to select compatible members so a discriminated return literal does not count as writing an unrelated branch.

Property analysis does not request language-service references. ts-morph maintains a compiler program and a separate language-service program; resolving contextual property references through both retains separate semantic type and relation caches. Export and namespace reference analysis requests reference positions without the symbol display information that expands inferred types.

Walk the compiler program's actual source nodes. Duplicate installed packages can redirect to a canonical declaration tree that differs from ts-morph's cached source wrapper. Querying the checker with the unbound wrapper tree can fail while resolving a qualified name in an interface type-parameter constraint.

The access and relationship indexes use weak project keys. Each `analyzeProject` call loads a fresh, read-only project snapshot. Do not reuse an index across source mutations.

## Relationship traversal

Every property-flow edge preserves the property name. Build and cache relationship graphs on demand for the requested canonical symbol name. Skip declaration names and type positions, and defer contextual type resolution until the source can contribute a tracked property. Fresh object literals without spreads cannot contribute property-signature/declaration origins; their value expressions still participate in traversal.

Keep all analysis rules and project files enabled when measuring changes. Preserve actual usage through imports, inherited and overridden properties, contextual assignments, spreads, tests, and stories. Memory reductions must not change findings or suppress rules.

## Reproduction and validation

Build the ordinary CLI and measure a real consumer with Node:

```sh
bun run build
/usr/bin/time -v node dist/cli.js check /absolute/path/to/consumer/tsconfig.json
```

The command's maximum resident set size measures peak process memory, including the compiler's native allocations; it differs from V8's heap budget. Capture stdout from the published baseline and candidate, and compare the complete findings. Use the same Node version, consumer sources, locked dependencies, and analysis configuration. Profiling changes garbage-collection behavior, so validate the final result without the profiler.

`src/__tests__/reference-analysis.test.ts` checks that reference lookup does not instantiate inferred types merely for display, that unrelated mapped types stay unexpanded during relationship lookup, and that contextual property writes do not instantiate a second semantic program. `src/__tests__/property-accesses.test.ts` covers property syntax, inheritance, imported declarations, and duplicate-package redirects. Temporarily restoring the old lookup or wrapper-tree walk must reproduce the corresponding regression.
