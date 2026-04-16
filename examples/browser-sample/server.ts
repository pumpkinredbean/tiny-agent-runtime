import {
  appendUserText,
  changedCodexAuth,
  codex,
  copilot,
  isReasoningEffort,
  createToolRegistry,
  createSession,
  createSessionStore,
  authFile,
  getAuth,
  normalizeRuntimeReasoning,
  resolveRuntimeModel,
  runtimeReasoningEfforts,
  runtimeDefaultModel,
  sessionMessages,
  setAuth,
  type CodexAuth,
  type CopilotAuth,
  type Part,
  type PromptReasoning,
  type ProviderID,
  type ReasoningEffort,
  type SessionTurn,
  type ToolPlugin,
} from "@tiny-agent/tiny-agent-runtime"

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
  reasoning?: PromptReasoning
  system?: string
  sessionId?: string
  prompt: string
  history: SessionTurn[]
}

type SessionRequest = {
  sessionId: string
}

type TruncateRequest = {
  sessionId: string
  keepCount: number
}

type SessionListRequest = Record<string, never>

type ModelsRequest = {
  provider: ProviderID
}

type ModelsDevCatalog = Record<string, { models?: Record<string, { id?: string; name?: string }> }>
type ModelCatalogEntry = { id?: string; name?: string }

export type ModelOption = {
  id: string
  label: string
  name?: string
  reasoningEfforts: ReasoningEffort[]
}

type AppDeps = {
  env: NodeJS.ProcessEnv
  readIndex(): Promise<string>
  getAuth(id: "copilot"): Promise<CopilotAuth | undefined>
  getAuth(id: "codex"): Promise<CodexAuth | undefined>
  setCodexAuth(auth: CodexAuth): Promise<void>
  copilotModels(auth: CopilotAuth): Promise<string[]>
  codexModels(): string[]
  copilotPrompt: typeof copilot.prompt
  codexPrompt: typeof codex.prompt
  sessionStore: ReturnType<typeof createSessionStore>
  fetchModelsCatalog(): Promise<ModelsDevCatalog | undefined>
}

const encoder = new TextEncoder()
const MODELS_DEV_URL = "https://models.dev/api.json"
const MODELS_DEV_TTL_MS = 5 * 60_000
const MODELS_DEV_FAILURE_TTL_MS = 30_000

let modelsDevCache:
  | {
      expiresAt: number
      value?: ModelsDevCatalog
      pending?: Promise<ModelsDevCatalog | undefined>
    }
  | undefined

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

function reasoning(value: unknown): PromptReasoning | undefined {
  if (value == null || value === "") return undefined
  if (typeof value === "string") {
    const effort = text(value)
    if (!effort) return undefined
    if (!isReasoningEffort(effort)) throw new Error("reasoning effort must be 'low', 'medium', 'high', or 'xhigh'")
    return { effort }
  }
  if (typeof value !== "object") throw new Error("reasoning must be an object or effort string")

  const effort = text((value as { effort?: unknown }).effort)
  if (!effort) return undefined
  if (!isReasoningEffort(effort)) throw new Error("reasoning effort must be 'low', 'medium', 'high', or 'xhigh'")
  return { effort }
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
  const normalizedReasoning = model ? normalizeRuntimeReasoning(id, model, reasoning(input.reasoning)) : reasoning(input.reasoning)
  const system = text(input.system) || undefined
  const sessionId = text(input.sessionId) || undefined

  return {
    provider: id,
    model,
    reasoning: normalizedReasoning,
    system,
    sessionId,
    prompt,
    history: history(input.history),
  }
}

export function parseSessionRequest(req: Request): SessionRequest {
  const sessionId = text(new URL(req.url).searchParams.get("sessionId"))
  if (!sessionId) throw new Error("sessionId is required")
  return { sessionId }
}

export function parseDeleteSessionRequest(req: Request): SessionRequest {
  const sessionId = text(new URL(req.url).searchParams.get("sessionId"))
  if (!sessionId) throw new Error("sessionId is required")
  return { sessionId }
}

export async function parseTruncateRequest(req: Request): Promise<TruncateRequest> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    throw new Error("request body must be valid JSON")
  }
  if (!body || typeof body !== "object") throw new Error("request body must be an object")
  const input = body as Record<string, unknown>
  const sessionId = text(input.sessionId)
  if (!sessionId) throw new Error("sessionId is required")
  const keepCount = typeof input.keepCount === "number" ? input.keepCount : Number(input.keepCount)
  if (!Number.isInteger(keepCount) || keepCount < 0) throw new Error("keepCount must be a non-negative integer")
  return { sessionId, keepCount }
}

export function parseModelsRequest(req: Request, env: NodeJS.ProcessEnv): ModelsRequest {
  const id = provider(new URL(req.url).searchParams.get("provider"), env)
  if (!id) throw new Error("provider must be 'copilot' or 'codex'")
  return { provider: id }
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

async function fetchModelsCatalog(): Promise<ModelsDevCatalog | undefined> {
  const now = Date.now()
  if (modelsDevCache && modelsDevCache.expiresAt > now) {
    if (modelsDevCache.pending) return modelsDevCache.pending
    return modelsDevCache.value
  }

  const pending = (async () => {
    try {
      const res = await fetch(MODELS_DEV_URL, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(3_000),
      })
      if (!res.ok) throw new Error(`models.dev failed: ${res.status}`)
      return (await res.json()) as ModelsDevCatalog
    } catch {
      return undefined
    }
  })()

  modelsDevCache = { expiresAt: now + MODELS_DEV_TTL_MS, pending }
  const value = await pending
  modelsDevCache = {
    expiresAt: now + (value ? MODELS_DEV_TTL_MS : MODELS_DEV_FAILURE_TTL_MS),
    value,
  }
  return value
}

function uniqueModels(models: string[]) {
  return [...new Set(models.filter(Boolean))]
}

function metadataModels(models: string[], catalog?: Record<string, ModelCatalogEntry>) {
  const available = uniqueModels(models)
  if (!catalog) return { models: available, source: "runtime" as const }

  const availableSet = new Set(available)
  const ordered = Object.keys(catalog).filter((id) => availableSet.has(id))
  const unknown = available.filter((id) => !(id in catalog))
  return {
    models: [...ordered, ...unknown],
    source: "models.dev" as const,
  }
}

function formatModelLabel(id: string) {
  const formatPart = (part: string) => {
    if (/^\d+(?:\.\d+)?$/.test(part)) return part
    if (part === "gpt") return "GPT"
    return part.charAt(0).toUpperCase() + part.slice(1)
  }

  return id
    .split("-")
    .map(formatPart)
    .join("-")
}

function modelName(id: string, catalog?: Record<string, ModelCatalogEntry>) {
  return text(catalog?.[id]?.name) || formatModelLabel(id)
}

export function buildModelOptions(
  provider: ProviderID,
  models: string[],
  catalog?: Record<string, ModelCatalogEntry>,
): ModelOption[] {
  return uniqueModels(models).map((id) => ({
    id,
    label: modelName(id, catalog),
    name: text(catalog?.[id]?.name) || undefined,
    reasoningEfforts: runtimeReasoningEfforts(provider, id),
  }))
}

export function resolveModelSelection(models: ModelOption[], model?: string) {
  const resolvedModel = models.some((item) => item.id === model) ? model : models[0]?.id
  return resolvedModel ? { model: resolvedModel } : undefined
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
      reasoning: input.reasoning,
    })

    return new Response(
      streamParts(run.events, {
        sessionId: stored.id,
        onComplete: async (text, parts) => {
          if (text) await deps.sessionStore.appendMessage(stored.id, { role: "assistant", content: text })
          await deps.sessionStore.appendRun(stored.id, { provider: input.provider, model, system: input.system, parts })
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
    reasoning: input.reasoning,
  })

  if (changedCodexAuth(run.auth, auth)) await deps.setCodexAuth(run.auth)
  return new Response(
    streamParts(run.events, {
      sessionId: stored.id,
      onComplete: async (text, parts) => {
        if (text) await deps.sessionStore.appendMessage(stored.id, { role: "assistant", content: text })
        await deps.sessionStore.appendRun(stored.id, { provider: input.provider, model, system: input.system, parts })
      },
    }),
    { headers: sseHeaders() },
  )
}

async function sessionResponse(input: SessionRequest, deps: AppDeps) {
  const session = await deps.sessionStore.get(input.sessionId)
  if (!session) return problem(404, "session not found")
  return Response.json(session)
}

async function deleteSessionResponse(input: SessionRequest, deps: AppDeps) {
  const deleted = await deps.sessionStore.remove(input.sessionId)
  if (!deleted) return problem(404, "session not found")
  return Response.json({ id: input.sessionId })
}

async function truncateSessionResponse(input: TruncateRequest, deps: AppDeps) {
  const session = await deps.sessionStore.truncateTranscript(input.sessionId, input.keepCount)
  if (!session) return problem(404, "session not found")
  return Response.json(session)
}

async function sessionListResponse(_input: SessionListRequest, deps: AppDeps) {
  return Response.json(await deps.sessionStore.list())
}

async function modelListResponse(input: ModelsRequest, deps: AppDeps) {
  // A transient models.dev failure must not propagate as a 400/500 — the
  // runtime-derived list is always sufficient to populate the picker.
  let catalog: ModelsDevCatalog | undefined
  try {
    catalog = await deps.fetchModelsCatalog()
  } catch {
    catalog = undefined
  }

  if (input.provider === "copilot") {
    const auth = await deps.getAuth("copilot")
    if (!auth) return problem(401, `missing copilot oauth in ${deps.env.RUNTIME_AUTH_PATH ?? authFile()}`)
    const metadata = metadataModels(await deps.copilotModels(auth), catalog?.["github-copilot"]?.models)
    const models = buildModelOptions(input.provider, metadata.models, catalog?.["github-copilot"]?.models)
    const defaultModel = await resolveRuntimeModel("copilot", auth, deps)
    return Response.json({
      provider: input.provider,
      defaultModel,
      models,
      selection: resolveModelSelection(models, defaultModel),
      source: metadata.source,
    })
  }

  const metadata = metadataModels(deps.codexModels(), catalog?.openai?.models)
  const models = buildModelOptions(input.provider, metadata.models, catalog?.openai?.models)
  const defaultModel = runtimeDefaultModel("codex", deps.env)

  return Response.json({
    provider: input.provider,
    defaultModel,
    models,
    selection: resolveModelSelection(models, defaultModel),
    source: metadata.source,
  })
}

function sseHeaders() {
  return {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  }
}

function streamParts(events: AsyncIterable<Part>, input: { sessionId: string; onComplete?: (text: string, parts: Part[]) => Promise<void> }) {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let text = ""
      const collected: Part[] = []
      try {
        controller.enqueue(sse("session", { id: input.sessionId }))
        for await (const part of events) {
          if (part.type === "text") text += part.text
          collected.push(part)
          controller.enqueue(sse("part", part))
        }
      } catch (err) {
        const errorPart: Part = { type: "error", text: err instanceof Error ? err.message : String(err) }
        collected.push(errorPart)
        controller.enqueue(sse("part", errorPart))
      } finally {
        if (input.onComplete) await input.onComplete(text, collected)
        controller.close()
      }
    },
  })
}

export function createSampleApp(input: Partial<AppDeps> = {}) {
  async function getAuthById(id: "copilot"): Promise<CopilotAuth | undefined>
  async function getAuthById(id: "codex"): Promise<CodexAuth | undefined>
  async function getAuthById(id: ProviderID) {
    return id === "copilot" ? getAuth("copilot") : getAuth("codex")
  }

  const deps: AppDeps = {
    env: process.env,
    readIndex: () => Bun.file(new URL("./index.html", import.meta.url)).text(),
    getAuth: getAuthById,
    setCodexAuth: (auth) => setAuth("codex", auth),
    copilotModels: (auth) => copilot.models(auth),
    codexModels: () => codex.models(),
    copilotPrompt: (auth, req) => copilot.prompt(auth, req),
    codexPrompt: (auth, req) => codex.prompt(auth, req),
    sessionStore: createSessionStore(),
    fetchModelsCatalog,
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

      if (req.method === "GET" && url.pathname === "/api/session") {
        try {
          return await sessionResponse(parseSessionRequest(req), deps)
        } catch (err) {
          return problem(400, err instanceof Error ? err.message : String(err))
        }
      }

      if (req.method === "DELETE" && url.pathname === "/api/session") {
        try {
          return await deleteSessionResponse(parseDeleteSessionRequest(req), deps)
        } catch (err) {
          return problem(400, err instanceof Error ? err.message : String(err))
        }
      }

      if (req.method === "POST" && url.pathname === "/api/session/truncate") {
        try {
          return await truncateSessionResponse(await parseTruncateRequest(req), deps)
        } catch (err) {
          return problem(400, err instanceof Error ? err.message : String(err))
        }
      }

      if (req.method === "GET" && url.pathname === "/api/sessions") {
        return await sessionListResponse({}, deps)
      }

      if (req.method === "GET" && url.pathname === "/api/models") {
        try {
          return await modelListResponse(parseModelsRequest(req, deps.env), deps)
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
