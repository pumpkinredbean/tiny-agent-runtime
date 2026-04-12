# tiny-agent-runtime

Standalone runtime package extracted from the opencode runtime package.

## Package

- Repository: `tiny-agent-runtime`
- Package: `@pumpkinredbean/tiny-agent-runtime`

## Scripts

- `bun run login:codex`
- `bun run login:copilot`
- `bun run typecheck`
- `bun test src`
- `bun run smoke`
- `bun run smoke:copilot`
- `bun run smoke:codex`

## Auth

- Runtime auth is owned by the runtime store at `.tmp/auth.json` by default, or `RUNTIME_AUTH_PATH` when set.
- Runtime-owned auth is canonicalized under top-level provider keys such as `copilot` and `codex`.
- `bun run login:copilot` is the primary native login path for GitHub Copilot; it runs the device flow and persists successful auth into the runtime store.
- `bun run login:codex` is the primary native login path for Codex; it runs the headless device flow and persists successful auth into the runtime store.
- Pass an enterprise host as the first CLI argument, or set `RUNTIME_COPILOT_ENTERPRISE_URL`, when targeting GitHub Enterprise Copilot.
- Smoke commands read the runtime store first.
- The opencode auth bridge at `OPENCODE_AUTH_PATH` or the default opencode auth path is optional compatibility infrastructure only.
- Legacy bridge-shaped provider keys remain readable for migration, but runtime-owned entries are normalized back to canonical top-level keys.
- Codex smoke persists refreshed auth back into the runtime store.
- Current auth scope in the repo includes native Copilot login, native Codex headless login, and optional bridge compatibility support.

## Execution management

- [`ROADMAP.md`](./ROADMAP.md) tracks the phase-based path from the validated prototype to a practically usable runtime.
- [`TASKS.md`](./TASKS.md) tracks the ordered implementation work needed to execute that roadmap.
