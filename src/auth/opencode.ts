import os from "node:os"
import path from "node:path"
import type { BridgeAuth, BridgeID, CodexAuth, CopilotAuth } from "./contracts"

type File = Record<string, BridgeAuth>

function auth(input: unknown) {
  if (!input || typeof input !== "object") return
  if (!("type" in input) || input.type !== "oauth") return
  if (!("refresh" in input) || typeof input.refresh !== "string") return
  if (!("access" in input) || typeof input.access !== "string") return
  if (!("expires" in input) || typeof input.expires !== "number") return
  return {
    refresh: input.refresh,
    access: input.access,
    expires: input.expires,
    accountId: "accountId" in input && typeof input.accountId === "string" ? input.accountId : undefined,
    enterpriseUrl:
      "enterpriseUrl" in input && typeof input.enterpriseUrl === "string" ? input.enterpriseUrl : undefined,
  } satisfies BridgeAuth
}

function from(input: unknown) {
  if (!input || typeof input !== "object") return {}
  return Object.fromEntries(
    Object.entries(input).flatMap(([id, item]) => {
      const hit = auth(item)
      return hit ? [[id, hit]] : []
    }),
  ) as File
}

function data() {
  if (process.env.XDG_DATA_HOME) return process.env.XDG_DATA_HOME
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support")
  if (process.platform === "win32")
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"))
  return path.join(os.homedir(), ".local", "share")
}

export function file() {
  return process.env.OPENCODE_AUTH_PATH ?? path.join(data(), "opencode", "auth.json")
}

export function parse(text: string) {
  return from(JSON.parse(text) as unknown)
}

export async function all() {
  const src = Bun.file(file())
  if (!(await src.exists())) return {}
  return from(await src.json())
}

export async function get(id: "github-copilot"): Promise<CopilotAuth | undefined>
export async function get(id: "openai"): Promise<CodexAuth | undefined>
export async function get(id: BridgeID): Promise<CopilotAuth | CodexAuth | undefined>
export async function get(id: BridgeID) {
  return (await all())[id]
}
