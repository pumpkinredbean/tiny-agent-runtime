import path from "node:path"
import { mkdir } from "node:fs/promises"
import type { CodexAuth, CopilotAuth } from "./contracts"

type File = Partial<{
  copilot: CopilotAuth
  codex: CodexAuth
}>

function oauth(input: unknown) {
  if (!input || typeof input !== "object") return
  if (!("refresh" in input) || typeof input.refresh !== "string") return
  if (!("access" in input) || typeof input.access !== "string") return
  if (!("expires" in input) || typeof input.expires !== "number") return
  return {
    refresh: input.refresh,
    access: input.access,
    expires: input.expires,
  }
}

function copilot(input: unknown) {
  const base = oauth(input)
  if (!base) return
  return {
    ...base,
    enterpriseUrl:
      input && typeof input === "object" && "enterpriseUrl" in input && typeof input.enterpriseUrl === "string"
        ? input.enterpriseUrl
        : undefined,
  } satisfies CopilotAuth
}

function codex(input: unknown) {
  const base = oauth(input)
  if (!base) return
  return {
    ...base,
    accountId: input && typeof input === "object" && "accountId" in input && typeof input.accountId === "string" ? input.accountId : undefined,
  } satisfies CodexAuth
}

function from(input: unknown) {
  if (!input || typeof input !== "object") return {}
  const file = input as Record<string, unknown>
  return {
    copilot: copilot(file.copilot),
    codex: codex(file.codex),
  } satisfies File
}

export function file() {
  return process.env.RUNTIME_AUTH_PATH ?? path.join(process.cwd(), ".tmp", "auth.json")
}

export function parse(text: string) {
  return from(JSON.parse(text) as unknown)
}

async function raw() {
  const src = Bun.file(file())
  if (!(await src.exists())) return {}
  const data = await src.json()
  return data && typeof data === "object" ? (data as Record<string, unknown>) : {}
}

function normalized(input: Record<string, unknown>) {
  const next = { ...input }
  delete next.copilot
  delete next.codex

  const parsed = from(input)
  if (parsed.copilot) next.copilot = parsed.copilot
  if (parsed.codex) next.codex = parsed.codex
  return next
}

async function write(data: Record<string, unknown>) {
  await mkdir(path.dirname(file()), { recursive: true })
  await Bun.write(file(), `${JSON.stringify(data, null, 2)}\n`)
}

export async function all() {
  const data = await raw()
  const next = normalized(data)
  if (JSON.stringify(next) !== JSON.stringify(data)) await write(next)
  return from(next)
}

export async function get(id: "copilot"): Promise<CopilotAuth | undefined>
export async function get(id: "codex"): Promise<CodexAuth | undefined>
export async function get(id: keyof File) {
  return (await all())[id]
}

export async function set(id: "copilot", auth: CopilotAuth): Promise<void>
export async function set(id: "codex", auth: CodexAuth): Promise<void>
export async function set(id: keyof File, auth: CopilotAuth | CodexAuth) {
  const next = normalized({ ...(await raw()), [id]: auth })
  await write(next)
}
