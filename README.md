# tiny-agent-runtime

Standalone minimal runtime package for agent providers and loop orchestration.

## Package

- Repository: `tiny-agent-runtime`
- Package: `@pumpkinredbean/tiny-agent-runtime`

## Scripts

- `bun run build`
- `bun run login:codex`
- `bun run login:copilot`
- `bun run typecheck`
- `bun test src examples`
- `bun run test`
- `RUNTIME_LIVE_VALIDATION=1 bun run validate:live:copilot:multiturn`
- `RUNTIME_LIVE_VALIDATION=1 bun run validate:live:codex:loop`
- `bun run sample`

## Published usage

- Install with `bun add @pumpkinredbean/tiny-agent-runtime`.
- The published package exposes built `dist/` artifacts only; `examples/` stay out of the package tarball.
- Use the thin CLI with `bunx tart login codex` or `bunx tart login copilot [enterprise-host]`.
- Use `bunx tart prompt <copilot|codex> [--system TEXT] [--model MODEL] <prompt...>` for a single direct prompt.
- Use `bunx tart chat <copilot|codex> [--system TEXT] [--model MODEL] [--session ID] [opening prompt...]` for a minimal persistent multi-turn shell.

## Auth

- Runtime auth is owned by the runtime store at `.tmp/auth.json` by default, or `RUNTIME_AUTH_PATH` when set.
- Runtime-owned auth is stored under top-level provider keys such as `copilot` and `codex`.
- `bun run login:copilot` routes through `tart login copilot`; it runs the device flow and persists successful auth into the runtime store.
- `bun run login:codex` routes through `tart login codex`; it runs the headless device flow and persists successful auth into the runtime store.
- Pass an enterprise host as the first CLI argument, or set `RUNTIME_COPILOT_ENTERPRISE_URL`, when targeting GitHub Enterprise Copilot.
- Current auth scope in the repo includes native Copilot login, native Codex headless login, and the runtime-owned auth store.

## Browser sample

- Log in first with `bun run login:codex` or `bun run login:copilot`.
- Start the local sample server with `bun run sample` (`examples/browser-sample/server.ts`).
- Open `http://localhost:3000` and submit a direct prompt.
- The browser sample reuses the same SDK session path as the CLI and emits/reuses a session id for resumable transcript-backed prompts.
- Provider auth stays in the runtime auth store on the server.
- The sample now includes an example-only `createToolRegistry(...)` block to show how app-owned plugins can be wired before calling `loop`; the package still ships no built-in tools.

## Validation matrix

- Default repo validation: `bun run typecheck`, `bun run test`, and `bun run build`.
- `bun run test` now covers both `src/**/*.test.ts` and `examples/browser-sample/server.test.ts`.
- Deterministic in-repo coverage currently proves:
  - provider request-shape regressions for Copilot and Codex,
  - CLI auth refresh persistence for `tart prompt` and `tart chat`,
  - CLI stderr-only usage summaries for direct prompt runs,
  - CLI persistent multi-turn transcript + `--session` resume behavior,
  - browser-sample SSE/session persistence, session resume, failure-recovery transcript reuse, and usage-part passthrough,
  - loop/tool regression behavior under local deterministic stubs,
  - SSE usage normalization for chat/responses streams and loop-level usage aggregation.
- Live/provider-backed validations proven in this repo today:
  - Copilot live prompt,
  - Copilot live multi-turn session continuity across three turns with shared transcript + session id,
  - Copilot loop end-to-end with a local tool round-trip,
  - Codex live prompt after the instructions fix,
  - Codex live loop/tool round-trip through the shared loop.
- Intentionally still unproven live paths:
  - any claim of full provider parity between local regressions and provider production behavior.

## Known limitations

- The repo does not claim full live parity for Copilot and Codex; only the live paths listed above are actually proven.
- Live validations are opt-in only; set `RUNTIME_LIVE_VALIDATION=1` before running the provider-backed validation scripts.
- Browser-sample recovery coverage is deterministic and transcript-focused; it does not prove provider-side retry semantics.
- Tool execution now supports optional per-call timeout handling in the shared loop, but cancellation remains bounded waiting only.
- Usage/cost observability is best-effort and provider-tolerant: the runtime only forwards metadata that providers actually stream, and cost fields remain passthrough-only.
- The package ships no built-in tools; example tool wiring in `examples/browser-sample` is app-owned only.

## Practical-usability exit bar

Call the runtime practically usable only when all of the following stay true together:

- default repo validation keeps passing (`bun run typecheck`, `bun run test`, `bun run build`),
- the repo docs stay aligned with the exact proven validation surface and known limits,
- at least one live prompt path per supported provider remains proven,
- persistent session resume and failure-recovery behavior stay covered on both CLI and browser sample surfaces,
- new claims about parity or support are added only after matching validation exists.

## Tool and plugin skeleton

- `src/tools` exposes a thin extension layer: `ToolPlugin`, `createToolRegistry(...)`, and `composeTools(...)`.
- Existing direct loop tools remain supported via `tools?: LoopTool[]`.
- The loop also accepts `toolPlugins?: ToolPlugin[]` and resolves them through the registry without changing provider/session/runtime behavior.
- Plugin contracts are intentionally static and minimal for now: plugins only contribute tool definitions.
- Concrete tools remain app-owned. The browser sample demonstrates wiring, but the package does not own or bundle any built-in tools.
- Loop-owned tool failure handling is intentionally narrow: missing tools, malformed JSON input, thrown tool errors, timed-out tool calls, and invalid return values are reinjected as `role: "tool"` error messages; aborts still stop the loop with `stop: "abort"`.
- Set `toolTimeoutMs` on `loop(...)` to bound how long each individual tool call may block orchestration. On timeout, the loop emits a tool error message for that call and continues; the underlying tool is not forcibly cancelled.

```ts
import { createToolRegistry, loop, type ToolPlugin } from "@pumpkinredbean/tiny-agent-runtime"

const weatherPlugin: ToolPlugin = {
  name: "weather-example",
  tools: [
    {
      name: "weather",
      async call(input) {
        return JSON.stringify({ input, forecast: "sunny" })
      },
    },
  ],
}

await loop({
  adapter,
  auth,
  model,
  msg,
  toolPlugins: [weatherPlugin],
})

const tools = createToolRegistry({ plugins: [weatherPlugin] }).list()
```

## Sessions and prompt assembly

- `src/core/session.ts` is the canonical SDK path for assembling current run config plus transcript into runtime `Msg[]` state.
- `src/core/session-store.ts` provides JSONL-backed session persistence with transcript and run metadata stored separately.
- Session identity is provider/model/system agnostic; those values can be recorded per run, but prompt assembly only uses transcript plus the current run config.
- `src/core/variants.ts` is the canonical transform layer for provider-facing chat/responses request variants.
- Codex top-level `instructions` shaping remains preserved via the shared variant helpers.

## Runtime observability

- `Part` streams can now include `{ type: "usage", usage }` records with normalized token fields plus passthrough `cost` metadata when a provider emits it.
- `loop(...)` aggregates usage across all model steps and returns it on `LoopResult.usage` without changing loop behavior when usage metadata is absent.
- `tart prompt` and `tart chat` keep assistant text on stdout and emit usage summaries on stderr only.
- The browser sample forwards usage parts over SSE unchanged so app UIs can observe them without parsing provider-native payloads.

## Execution management

- [`ROADMAP.md`](./ROADMAP.md) tracks the phase-based path from the validated prototype to a practically usable runtime.
- [`TASKS.md`](./TASKS.md) tracks the ordered implementation work needed to execute that roadmap.
