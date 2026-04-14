# tiny-agent-runtime

Standalone minimal runtime package for agent providers and loop orchestration.

## Package

- Repository: `tiny-agent-runtime`
- Package: `@pumpkinredbean/tiny-agent-runtime`

## Scripts

- `bun run login:codex`
- `bun run login:copilot`
- `bun run typecheck`
- `bun test src`
- `bun run sample`
- `bun run smoke`
- `bun run smoke:copilot`
- `bun run smoke:codex`

## Auth

- Runtime auth is owned by the runtime store at `.tmp/auth.json` by default, or `RUNTIME_AUTH_PATH` when set.
- Runtime-owned auth is stored under top-level provider keys such as `copilot` and `codex`.
- `bun run login:copilot` is the primary native login path for GitHub Copilot; it runs the device flow and persists successful auth into the runtime store.
- `bun run login:codex` is the primary native login path for Codex; it runs the headless device flow and persists successful auth into the runtime store.
- Pass an enterprise host as the first CLI argument, or set `RUNTIME_COPILOT_ENTERPRISE_URL`, when targeting GitHub Enterprise Copilot.
- Smoke commands read directly from the runtime store.
- Codex smoke persists refreshed auth back into the runtime store.
- Current auth scope in the repo includes native Copilot login, native Codex headless login, and the runtime-owned auth store.

## Browser sample

- Log in first with `bun run login:codex` or `bun run login:copilot`.
- Start the local sample server with `bun run sample` (`examples/browser-sample/server.ts`).
- Open `http://localhost:3000` and submit a direct prompt.
- This browser sample only sends prompt inputs; provider auth stays in the runtime auth store on the server.

## Execution management

- [`ROADMAP.md`](./ROADMAP.md) tracks the phase-based path from the validated prototype to a practically usable runtime.
- [`TASKS.md`](./TASKS.md) tracks the ordered implementation work needed to execute that roadmap.
