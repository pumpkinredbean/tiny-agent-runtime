import path from "node:path"
import { appendFile, mkdir, readFile } from "node:fs/promises"
import type { Msg, ProviderID } from "./contracts"

export type SessionMeta = {
  id: string
  createdAt: string
  updatedAt: string
}

export type SessionRun = {
  id: string
  at: string
  provider: ProviderID
  model: string
  system?: string
}

export type SessionRunInput = {
  provider: ProviderID
  model: string
  system?: string
}

export type StoredSession = SessionMeta & {
  transcript: Msg[]
  runs: SessionRun[]
}

export type SessionStoreInput = {
  root?: string
  now?: () => string
  createId?: () => string
}

function parseCall(input: unknown) {
  if (!input || typeof input !== "object") return
  if (!("id" in input) || typeof input.id !== "string") return
  if (!("name" in input) || typeof input.name !== "string") return
  if (!("input" in input) || typeof input.input !== "string") return
  return { id: input.id, name: input.name, input: input.input }
}

function parseMsg(input: unknown): Msg | undefined {
  if (!input || typeof input !== "object" || !("role" in input) || typeof input.role !== "string") return

  if (input.role === "system" || input.role === "user") {
    if (!("content" in input) || typeof input.content !== "string") return
    return { role: input.role, content: input.content }
  }

  if (input.role === "assistant") {
    if ("content" in input && typeof input.content === "string") return { role: "assistant", content: input.content }
    if (!("calls" in input) || !Array.isArray(input.calls)) return
    const calls = input.calls.map(parseCall)
    if (calls.some((call) => !call)) return
    return { role: "assistant", calls: calls as NonNullable<typeof calls[number]>[] }
  }

  if (input.role === "tool") {
    if (!("id" in input) || typeof input.id !== "string") return
    if (!("name" in input) || typeof input.name !== "string") return
    if (!("content" in input) || typeof input.content !== "string") return
    return {
      role: "tool",
      id: input.id,
      name: input.name,
      content: input.content,
      error: "error" in input && typeof input.error === "boolean" ? input.error : undefined,
    }
  }
}

function parseMeta(input: unknown, id: string): SessionMeta | undefined {
  if (!input || typeof input !== "object") return
  if (!("id" in input) || input.id !== id) return
  if (!("createdAt" in input) || typeof input.createdAt !== "string") return
  if (!("updatedAt" in input) || typeof input.updatedAt !== "string") return
  return {
    id,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  }
}

function parseRun(input: unknown): SessionRun | undefined {
  if (!input || typeof input !== "object") return
  if (!("id" in input) || typeof input.id !== "string") return
  if (!("at" in input) || typeof input.at !== "string") return
  if (!("provider" in input) || (input.provider !== "copilot" && input.provider !== "codex")) return
  if (!("model" in input) || typeof input.model !== "string") return
  return {
    id: input.id,
    at: input.at,
    provider: input.provider,
    model: input.model,
    system: "system" in input && typeof input.system === "string" ? input.system : undefined,
  }
}

async function readJson<T>(file: string, parse: (input: unknown) => T | undefined) {
  try {
    return parse(JSON.parse(await readFile(file, "utf8")) as unknown)
  } catch {
    return undefined
  }
}

async function readJsonl<T>(file: string, parse: (input: unknown) => T | undefined) {
  try {
    const lines = (await readFile(file, "utf8"))
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)

    return lines.flatMap((line) => {
      try {
        const value = parse(JSON.parse(line) as unknown)
        return value ? [value] : []
      } catch {
        return []
      }
    })
  } catch {
    return [] as T[]
  }
}

async function writeJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true })
  await Bun.write(file, `${JSON.stringify(value, null, 2)}\n`)
}

async function appendJsonl(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true })
  await appendFile(file, `${JSON.stringify(value)}\n`)
}

export function sessionRoot() {
  return process.env.RUNTIME_SESSION_PATH ?? path.join(process.cwd(), ".tmp", "sessions")
}

function paths(root: string, id: string) {
  const dir = path.join(root, id)
  return {
    dir,
    meta: path.join(dir, "meta.json"),
    transcript: path.join(dir, "transcript.jsonl"),
    runs: path.join(dir, "runs.jsonl"),
  }
}

export function createSessionStore(input: SessionStoreInput = {}) {
  const root = input.root ?? sessionRoot()
  const now = input.now ?? (() => new Date().toISOString())
  const createId = input.createId ?? (() => crypto.randomUUID())

  async function touch(id: string, meta?: SessionMeta) {
    const current = meta ?? (await get(id))
    if (!current) return
    await writeJson(paths(root, id).meta, {
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: now(),
    })
  }

  async function create(id = createId()): Promise<StoredSession> {
    const existing = await get(id)
    if (existing) return existing
    const createdAt = now()
    const meta = { id, createdAt, updatedAt: createdAt }
    await writeJson(paths(root, id).meta, meta)
    return { ...meta, transcript: [], runs: [] }
  }

  async function get(id: string): Promise<StoredSession | undefined> {
    const file = paths(root, id)
    const meta = await readJson(file.meta, (value) => parseMeta(value, id))
    if (!meta) return undefined
    return {
      ...meta,
      transcript: await readJsonl(file.transcript, parseMsg),
      runs: await readJsonl(file.runs, parseRun),
    }
  }

  async function appendMessage(id: string, msg: Msg) {
    const current = await create(id)
    await appendJsonl(paths(root, id).transcript, msg)
    await touch(id, current)
  }

  async function appendRun(id: string, run: SessionRunInput) {
    const current = await create(id)
    await appendJsonl(paths(root, id).runs, { id: createId(), at: now(), ...run })
    await touch(id, current)
  }

  return {
    root,
    create,
    get,
    appendMessage,
    appendRun,
  }
}
