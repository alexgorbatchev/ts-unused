#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
just --justfile ./justfile setup
just --justfile ./justfile setup
mkdir -p .tmp
fixture="$(mktemp -d .tmp/lifecycle.XXXXXX)"
trap 'rm -rf "$fixture"' EXIT
printf '{"compilerOptions":{"strict":true},"include":["main.ts"]}\n' > "$fixture/tsconfig.json"
printf 'console.log("lifecycle fixture");\n' > "$fixture/main.ts"
just --justfile ./justfile run check "$fixture/tsconfig.json"
