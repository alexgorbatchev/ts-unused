set dotenv-load := false
set positional-arguments

default:
    @just --list

# Install the locked development dependencies
setup:
    bun install --frozen-lockfile

# Run the CLI from source
run *args:
    bun src/cli.ts "$@"

run-ai *args:
    AGENT=1 bun src/cli.ts "$@"

fmt:
    just --fmt
    bun run oxfmt .

fmt-check:
    just --fmt --check
    bun run oxfmt --check .

lint:
    bun run oxlint --deny-warnings .

fix: fmt
    bun run typescript-ai-policy fix-semantic src

typecheck:
    bun run tsgo --noEmit

unused:
    bun src/cli.ts check tsconfig.json

test:
    bun scripts/test.ts

# Validate source without applying fixes or rebuilding the package
check: fmt-check lint typecheck unused test

clean:
    rm -rf dist

build-cli:
    bun build src/cli.ts --outdir dist --target node --external ts-morph --external yargs --minify --sourcemap=external

build-lib *args:
    bun run tsgo --project tsconfig.build.json "$@"

build: clean build-cli build-lib

# Exercise the built fix command against the tracked fixture and restore it
sanity-check *args:
    bun run scripts/sanity-check.ts "$@"

pack-check:
    npm pack --dry-run
