# tiny-agent-runtime

Minimal Bun-first runtime for AI agent providers and loop orchestration.

Supports **GitHub Copilot** and **OpenAI Codex** as provider backends with a shared loop, persistent sessions, and a thin tool/plugin layer.

## Requirements

- **[Bun](https://bun.sh) ≥ 1.3.5** — this package is built and tested exclusively with Bun.

## Install

```sh
bun add @tiny-agent/tiny-agent-runtime
```

## Quickstart

```ts
import { copilot, loop, createSession, sessionMessages } from "@tiny-agent/tiny-agent-runtime"
import { get } from "@tiny-agent/tiny-agent-runtime"

// Load auth (populated via `bunx tart login copilot`)
const auth = await get("copilot")
if (!auth) throw new Error("run: bunx tart login copilot")

const session = createSession()
const result = await loop({
  adapter: copilot,
  auth,
  model: "gpt-4.1",
  msg: sessionMessages(session, { prompt: "Hello, world!" }),
})

console.log(result.text)
```

## CLI

Log in to a provider:

```sh
bunx tart login copilot
bunx tart login codex
```

Send a single prompt:

```sh
bunx tart prompt copilot "Explain closures in one sentence"
bunx tart prompt codex --model gpt-5.4-mini "Write a haiku"
```

Start a persistent multi-turn chat:

```sh
bunx tart chat copilot
bunx tart chat codex --session my-session
```

For GitHub Enterprise Copilot, pass the enterprise host:

```sh
bunx tart login copilot github.example.com
```

or set `RUNTIME_COPILOT_ENTERPRISE_URL=github.example.com`.

## Auth

Auth tokens are stored in `.tmp/auth.json` by default.  
Set `RUNTIME_AUTH_PATH` to override the storage path.

```ts
import { get, set, file } from "@tiny-agent/tiny-agent-runtime"

const auth = await get("copilot")   // read
await set("copilot", auth)           // write
console.log(file())                  // default path
```

## Sessions

Sessions provide persistent multi-turn transcripts backed by JSONL files.

```ts
import {
  createSession,
  createSessionStore,
  appendUserText,
  sessionMessages,
} from "@tiny-agent/tiny-agent-runtime"

const store = createSessionStore()
const stored = await store.create()

const session = appendUserText(createSession({ id: stored.id }), "What is 2+2?")
// pass sessionMessages(session) to loop(...) or copilot.prompt(...)
```

## Tool plugins

The runtime ships no built-in tools. Wire app-owned tools via `ToolPlugin` or `LoopTool`:

```ts
import { createToolRegistry, loop, type ToolPlugin } from "@tiny-agent/tiny-agent-runtime"

const weatherPlugin: ToolPlugin = {
  name: "weather-example",
  tools: [
    {
      name: "weather",
      description: "Look up weather for a city",
      schema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
      async call(input) {
        return JSON.stringify({ forecast: "sunny" })
      },
    },
  ],
}

const result = await loop({
  adapter: copilot,
  auth,
  model: "gpt-4.1",
  msg,
  toolPlugins: [weatherPlugin],
})
```

Set `toolTimeoutMs` on `loop(...)` to bound per-tool execution time.

## Usage observability

`loop(...)` aggregates token usage across all steps and returns it on `LoopResult.usage`.  
`Part` streams include `{ type: "usage", usage }` records when a provider emits them.  
The CLI emits usage summaries on stderr only, keeping stdout clean for scripting.

## Browser sample

A minimal Bun HTTP server with SSE streaming is included in `examples/browser-sample/`.

```sh
bun run login:copilot   # or login:codex
bun run sample          # starts http://localhost:3000
```

## Development

```sh
bun run typecheck
bun run test
bun run build
```

Live provider validation scripts (require real credentials):

```sh
RUNTIME_LIVE_VALIDATION=1 bun run validate:live:copilot:multiturn
RUNTIME_LIVE_VALIDATION=1 bun run validate:live:codex:loop
```

## License

MIT
