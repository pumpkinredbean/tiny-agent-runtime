import os from "node:os"
import { PKG_NAME, PKG_VERSION } from "../../version"
import type { Adapter } from "../../core/contracts"
import { normalizeRuntimeReasoning } from "../../core/runtime"
import { responses } from "../../core/sse"
import { instructions, mapResponseTools, toCodexResponseInput, withoutSystem } from "../../core/variants"
import type { CodexAuth } from "../../auth/contracts"

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
const ISSUER = "https://auth.openai.com"
const URL = "https://chatgpt.com/backend-api/codex/responses"

const ALLOW = new Set([
  "gpt-5.1-codex",
  "gpt-5.1-codex-max",
  "gpt-5.1-codex-mini",
  "gpt-5.2",
  "gpt-5.2-codex",
  "gpt-5.3-codex",
  "gpt-5.4",
  "gpt-5.4-mini",
])

export type CodexTokens = {
  id_token?: string
  access_token: string
  refresh_token: string
  expires_in?: number
}

export function parseClaims(token: string) {
  const part = token.split(".")[1]
  if (!part) return
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString()) as Record<string, unknown>
  } catch {
    return
  }
}

function account(token?: string) {
  const claims = token ? parseClaims(token) : undefined
  if (!claims) return
  const auth = claims["https://api.openai.com/auth"]
  if (typeof claims.chatgpt_account_id === "string") return claims.chatgpt_account_id
  if (auth && typeof auth === "object" && "chatgpt_account_id" in auth && typeof auth.chatgpt_account_id === "string") {
    return auth.chatgpt_account_id
  }
  const orgs = claims.organizations
  return Array.isArray(orgs) && orgs[0] && typeof orgs[0] === "object" && typeof orgs[0].id === "string"
    ? orgs[0].id
    : undefined
}

export function extractAccountId(tokens: Pick<CodexTokens, "access_token" | "id_token">) {
  return account(tokens.id_token) ?? account(tokens.access_token)
}

function session(token?: string) {
  const claims = token ? parseClaims(token) : undefined
  return claims && typeof claims.session_id === "string" ? claims.session_id : undefined
}

async function refresh(auth: CodexAuth) {
  const res = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: auth.refresh,
      client_id: CLIENT_ID,
    }).toString(),
  })
  if (!res.ok) throw new Error(`codex refresh failed: ${res.status}`)
  const data = (await res.json()) as CodexTokens
  return {
    type: "oauth" as const,
    refresh: data.refresh_token,
    access: data.access_token,
    expires: Date.now() + (data.expires_in ?? 3600) * 1000,
    accountId: extractAccountId(data) ?? auth.accountId,
  }
}

function current(auth: CodexAuth) {
  if (auth.access && auth.expires > Date.now() + 15_000) return auth
  return refresh(auth)
}

export const codex: Adapter<CodexAuth> & {
  allow(model: string): boolean
  models(): string[]
  refresh(auth: CodexAuth): Promise<CodexAuth>
} = {
  id: "codex",
  allow(model) {
    return ALLOW.has(model) || model.includes("codex")
  },
  models() {
    return [...ALLOW]
  },
  refresh,
  async prompt(auth, req) {
    const next = await current(auth)
    if (!codex.allow(req.model)) throw new Error(`codex model not allowed: ${req.model}`)
    const headers: Record<string, string> = {
      Authorization: `Bearer ${next.access}`,
      "Content-Type": "application/json",
      "User-Agent": `${PKG_NAME}/${PKG_VERSION} (${os.platform()} ${os.release()}; ${os.arch()})`,
      originator: "tiny-agent-runtime",
      session_id: req.sessionId ?? session(next.access) ?? crypto.randomUUID(),
    }
    if (next.accountId) headers["ChatGPT-Account-Id"] = next.accountId
    const reasoning = normalizeRuntimeReasoning("codex", req.model, req.reasoning)
    const res = await fetch(URL, {
      method: "POST",
      signal: req.abort,
      headers,
      body: JSON.stringify({
        model: req.model,
        instructions: instructions(req.msg),
        input: toCodexResponseInput(withoutSystem(req.msg)),
        reasoning,
        tools: mapResponseTools(req.tools),
        store: false,
        stream: true,
      }),
    })
    if (!res.ok || !res.body) throw new Error(`codex prompt failed: ${res.status}`)
    return {
      auth: next,
      model: req.model,
      url: URL,
      events: responses(res.body),
    }
  },
}
