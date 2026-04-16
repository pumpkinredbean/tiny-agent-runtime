import { getAuth, setAuth } from "../src/auth/store"
import type { CodexAuth, CopilotAuth } from "../src/auth/contracts"
import { mergeUsage } from "../src/core/usage"
import { changedCodexAuth } from "../src/core/runtime"
import type { Part, ProviderID, Usage } from "../src/core/contracts"

function fail(message: string): never {
  throw new Error(message)
}

export function requireLiveOptIn(name: string) {
  if (process.env.RUNTIME_LIVE_VALIDATION === "1" || process.env.LIVE_VALIDATION === "1") return
  fail(`Refusing to run ${name} without RUNTIME_LIVE_VALIDATION=1 (or LIVE_VALIDATION=1).`)
}

export async function requireProviderAuth(id: "copilot"): Promise<CopilotAuth>
export async function requireProviderAuth(id: "codex"): Promise<CodexAuth>
export async function requireProviderAuth(id: ProviderID) {
  const auth = id === "copilot" ? await getAuth("copilot") : await getAuth("codex")
  if (!auth) fail(`Missing ${id} auth in runtime store. Run: bun run login:${id}`)
  return auth
}

export async function persistAuth(id: "copilot", prev: CopilotAuth, next: CopilotAuth): Promise<void>
export async function persistAuth(id: "codex", prev: CodexAuth, next: CodexAuth): Promise<void>
export async function persistAuth(id: ProviderID, prev: CopilotAuth | CodexAuth, next: CopilotAuth | CodexAuth) {
  if (id === "codex") {
    if (changedCodexAuth(next as CodexAuth, prev as CodexAuth)) await setAuth("codex", next as CodexAuth)
    return
  }

  if (JSON.stringify(prev) !== JSON.stringify(next)) await setAuth("copilot", next as CopilotAuth)
}

export async function collect(events: AsyncIterable<Part>) {
  let text = ""
  let usage: Usage = {}
  const parts: Part[] = []

  for await (const part of events) {
    parts.push(part)
    if (part.type === "error") fail(part.text)
    if (part.type === "text") text += part.text
    if (part.type === "usage") usage = mergeUsage(usage, part.usage)
  }

  return { text: text.trim(), usage, parts }
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message)
}

export function logUsage(label: string, usage: Usage) {
  const bits = [
    usage.inputTokens !== undefined ? `input=${usage.inputTokens}` : undefined,
    usage.outputTokens !== undefined ? `output=${usage.outputTokens}` : undefined,
    usage.totalTokens !== undefined ? `total=${usage.totalTokens}` : undefined,
    usage.reasoningTokens !== undefined ? `reasoning=${usage.reasoningTokens}` : undefined,
    usage.cachedInputTokens !== undefined ? `cached=${usage.cachedInputTokens}` : undefined,
  ].filter(Boolean)

  console.error(bits.length ? `${label} usage ${bits.join(" ")}` : `${label} usage unavailable`)
}
