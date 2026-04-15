import {
  appendUserText,
  changedCodexAuth,
  codex,
  copilot,
  createToolRegistry,
  createSession,
  createSessionStore,
  file as authFile,
  get,
  resolveRuntimeModel,
  sessionMessages,
  set,
  type CodexAuth,
  type CopilotAuth,
  type Part,
  type ProviderID,
  type SessionTurn,
  type ToolPlugin,
} from "../../src/index"

const exampleWeatherPlugin: ToolPlugin = {
  name: "browser-sample-weather",
  tools: [
    {
      name: "weather",
      description: "Example-only weather tool wired by the browser sample.",
      schema: {
        type: "object",
        properties: { city: { type: "string" } },
        required: ["city"],
      },
      async call(input) {
        const city =
          input && typeof input === "object" && "city" in input && typeof input.city === "string" ? input.city : "unknown"
        return JSON.stringify({ city, forecast: "sunny" })
      },
    },
  ],
}

export const exampleToolRegistry = createToolRegistry({ plugins: [exampleWeatherPlugin] })

// Example-only wiring for a future loop endpoint:
// await loop({ ...input, tools: exampleToolRegistry.list() })
// The package still does not ship any built-in tools.

type PromptRequest = {
  provider: ProviderID
  model?: string
  system?: string
  sessionId?: string
  prompt: string
  history: SessionTurn[]
}

type AppDeps = {
  env: NodeJS.ProcessEnv
  readIndex(): Promise<string>
  getAuth(id: "copilot"): Promise<CopilotAuth | undefined>
  getAuth(id: "codex"): Promise<CodexAuth | undefined>
  setCodexAuth(auth: CodexAuth): Promise<void>
  copilotModels(auth: CopilotAuth): Promise<string[]>
  copilotPrompt: typeof copilot.prompt
  codexPrompt: typeof codex.prompt
  sessionStore: ReturnType<typeof createSessionStore>
}

const encoder = new TextEncoder()

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function provider(value: unknown, env: NodeJS.ProcessEnv) {
  if (value === "copilot" || value === "codex") return value
  return env.RUNTIME_PROVIDER === "copilot" || env.RUNTIME_PROVIDER === "codex" ? env.RUNTIME_PROVIDER : undefined
}

function history(value: unknown) {
  if (value == null) return []
  if (!Array.isArray(value)) throw new Error("history must be an array")
  return value.map((item) => {
    if (!item || typeof item !== "object") throw new Error("history entries must be objects")
    if ((item.role !== "user" && item.role !== "assistant") || typeof item.content !== "string") {
      throw new Error("history entries must use user/assistant roles with string content")
    }
    return {
      role: item.role,
      content: item.content,
    } satisfies SessionTurn
  })
}

export async function parsePromptRequest(req: Request, env: NodeJS.ProcessEnv): Promise<PromptRequest> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    throw new Error("request body must be valid JSON")
  }

  if (!body || typeof body !== "object") throw new Error("request body must be an object")

  const input = body as Record<string, unknown>
  const id = provider(input.provider, env)
  if (!id) throw new Error("provider must be 'copilot' or 'codex'")

  const prompt = text(input.prompt)
  if (!prompt) throw new Error("prompt is required")

  const model = text(input.model) || undefined
  const system = text(input.system) || undefined
  const sessionId = text(input.sessionId) || undefined

  return {
    provider: id,
    model,
    system,
    sessionId,
    prompt,
    history: history(input.history),
  }
}

async function resolveModel(id: "copilot", env: NodeJS.ProcessEnv, auth: CopilotAuth, deps: AppDeps): Promise<string>
async function resolveModel(id: "codex", env: NodeJS.ProcessEnv, auth: CodexAuth, deps: AppDeps): Promise<string>
async function resolveModel(id: ProviderID, env: NodeJS.ProcessEnv, auth: CopilotAuth | CodexAuth, deps: AppDeps) {
  return resolveRuntimeModel(id, auth, { env, copilotModels: deps.copilotModels }, undefined)
}

function sse(event: string, data: unknown) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

function problem(status: number, message: string) {
  return Response.json({ error: message }, { status })
}

async function promptResponse(input: PromptRequest, deps: AppDeps) {
  const stored = input.sessionId ? await deps.sessionStore.create(input.sessionId) : await deps.sessionStore.create()
  const transcript = input.sessionId ? stored.transcript : input.history

  if (!input.sessionId) {
    for (const msg of input.history) await deps.sessionStore.appendMessage(stored.id, msg)
  }

  await deps.sessionStore.appendMessage(stored.id, { role: "user", content: input.prompt })
  const session = appendUserText(createSession({ id: stored.id, transcript }), input.prompt)

  if (input.provider === "copilot") {
    const auth = await deps.getAuth("copilot")
    if (!auth) return problem(401, `missing copilot oauth in ${deps.env.RUNTIME_AUTH_PATH ?? authFile()}`)

    const model = input.model ?? (await resolveModel("copilot", deps.env, auth, deps))

    const run = await deps.copilotPrompt(auth, {
      model,
      msg: sessionMessages(session, { system: input.system }),
    })

    return new Response(
      streamParts(run.events, {
        sessionId: stored.id,
        onComplete: async (text) => {
          if (text) await deps.sessionStore.appendMessage(stored.id, { role: "assistant", content: text })
          await deps.sessionStore.appendRun(stored.id, { provider: input.provider, model, system: input.system })
        },
      }),
      { headers: sseHeaders() },
    )
  }

  const auth = await deps.getAuth("codex")
  if (!auth) return problem(401, `missing codex oauth in ${deps.env.RUNTIME_AUTH_PATH ?? authFile()}`)

  const model = input.model ?? (await resolveModel("codex", deps.env, auth, deps))

  const run = await deps.codexPrompt(auth, {
    model,
    msg: sessionMessages(session, { system: input.system }),
  })

  if (changedCodexAuth(run.auth, auth)) await deps.setCodexAuth(run.auth)
  return new Response(
    streamParts(run.events, {
      sessionId: stored.id,
      onComplete: async (text) => {
        if (text) await deps.sessionStore.appendMessage(stored.id, { role: "assistant", content: text })
        await deps.sessionStore.appendRun(stored.id, { provider: input.provider, model, system: input.system })
      },
    }),
    { headers: sseHeaders() },
  )
}

function sseHeaders() {
  return {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  }
}

function streamParts(events: AsyncIterable<Part>, input: { sessionId: string; onComplete?: (text: string) => Promise<void> }) {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let text = ""
      try {
        controller.enqueue(sse("session", { id: input.sessionId }))
        for await (const part of events) {
          if (part.type === "text") text += part.text
          controller.enqueue(sse("part", part))
        }
      } catch (err) {
        controller.enqueue(sse("part", { type: "error", text: err instanceof Error ? err.message : String(err) }))
      } finally {
        if (input.onComplete) await input.onComplete(text)
        controller.close()
      }
    },
  })
}

export function createSampleApp(input: Partial<AppDeps> = {}) {
  async function getAuthById(id: "copilot"): Promise<CopilotAuth | undefined>
  async function getAuthById(id: "codex"): Promise<CodexAuth | undefined>
  async function getAuthById(id: ProviderID) {
    return id === "copilot" ? get("copilot") : get("codex")
  }

  const deps: AppDeps = {
    env: process.env,
    readIndex: () => Bun.file(new URL("./index.html", import.meta.url)).text(),
    getAuth: getAuthById,
    setCodexAuth: (auth) => set("codex", auth),
    copilotModels: (auth) => copilot.models(auth),
    copilotPrompt: (auth, req) => copilot.prompt(auth, req),
    codexPrompt: (auth, req) => codex.prompt(auth, req),
    sessionStore: createSessionStore(),
    ...input,
  }

  return {
    port: Number(deps.env.PORT ?? 3000),
    async fetch(req: Request) {
      const url = new URL(req.url)

      if (req.method === "GET" && url.pathname === "/") {
        return new Response(await deps.readIndex(), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        })
      }

      if (req.method === "POST" && url.pathname === "/api/prompt") {
        try {
          return await promptResponse(await parsePromptRequest(req, deps.env), deps)
        } catch (err) {
          return problem(400, err instanceof Error ? err.message : String(err))
        }
      }

      return problem(404, "not found")
    },
  }
}

export function startSampleServer() {
  return Bun.serve(createSampleApp())
}

if (import.meta.main) {
  const server = startSampleServer()
  console.log(`tiny-agent-runtime sample listening on http://localhost:${server.port}`)
}
