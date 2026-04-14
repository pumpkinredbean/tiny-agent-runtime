import { file as authFile, get, set } from "../../src/auth/store"
import type { CodexAuth, CopilotAuth } from "../../src/auth/contracts"
import type { Msg, Part, ProviderID } from "../../src/core/contracts"
import { codex } from "../../src/provider/codex"
import { copilot } from "../../src/provider/copilot"

type PromptHistory = {
  role: "user" | "assistant"
  content: string
}

type PromptRequest = {
  provider: ProviderID
  model?: string
  system?: string
  prompt: string
  history: PromptHistory[]
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
    } satisfies PromptHistory
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

  return {
    provider: id,
    model,
    system,
    prompt,
    history: history(input.history),
  }
}

function changed(a: CodexAuth, b: CodexAuth) {
  return a.refresh !== b.refresh || a.access !== b.access || a.expires !== b.expires || a.accountId !== b.accountId
}

async function resolveModel(id: "copilot", env: NodeJS.ProcessEnv, auth: CopilotAuth, deps: AppDeps): Promise<string>
async function resolveModel(id: "codex", env: NodeJS.ProcessEnv, auth: CodexAuth, deps: AppDeps): Promise<string>
async function resolveModel(id: ProviderID, env: NodeJS.ProcessEnv, auth: CopilotAuth | CodexAuth, deps: AppDeps) {
  if (env.RUNTIME_MODEL) return env.RUNTIME_MODEL
  if (id === "codex") return "gpt-5.4-mini"
  const models = await deps.copilotModels(auth as CopilotAuth)
  const model = models[0]
  if (!model) throw new Error("no copilot model available")
  return model
}

function msg(input: PromptRequest): Msg[] {
  return [
    ...(input.system ? [{ role: "system", content: input.system } satisfies Msg] : []),
    ...input.history,
    { role: "user", content: input.prompt },
  ]
}

function sse(event: string, data: unknown) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

function problem(status: number, message: string) {
  return Response.json({ error: message }, { status })
}

async function promptResponse(input: PromptRequest, deps: AppDeps) {
  if (input.provider === "copilot") {
    const auth = await deps.getAuth("copilot")
    if (!auth) return problem(401, `missing copilot oauth in ${deps.env.RUNTIME_AUTH_PATH ?? authFile()}`)

    const run = await deps.copilotPrompt(auth, {
      model: input.model ?? (await resolveModel("copilot", deps.env, auth, deps)),
      msg: msg(input),
    })

    return new Response(streamParts(run.events), { headers: sseHeaders() })
  }

  const auth = await deps.getAuth("codex")
  if (!auth) return problem(401, `missing codex oauth in ${deps.env.RUNTIME_AUTH_PATH ?? authFile()}`)

  const run = await deps.codexPrompt(auth, {
    model: input.model ?? (await resolveModel("codex", deps.env, auth, deps)),
    msg: msg(input),
  })

  if (changed(run.auth, auth)) await deps.setCodexAuth(run.auth)
  return new Response(streamParts(run.events), { headers: sseHeaders() })
}

function sseHeaders() {
  return {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  }
}

function streamParts(events: AsyncIterable<Part>) {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const part of events) controller.enqueue(sse("part", part))
      } catch (err) {
        controller.enqueue(sse("part", { type: "error", text: err instanceof Error ? err.message : String(err) }))
      } finally {
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
