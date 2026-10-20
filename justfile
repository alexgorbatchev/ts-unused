default:
    @just --list

# Install the locked development dependencies
setup:
    bun install --frozen-lockfile

# Run the CLI from source
run *args:
    bun run cli {{ args }}
