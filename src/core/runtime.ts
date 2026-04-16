import type { CodexAuth, CopilotAuth } from "../auth/contracts"
import type { PromptReasoning, ProviderID, ReasoningEffort } from "./contracts"

type RuntimeModelDeps = {
  env?: NodeJS.ProcessEnv
  copilotModels(auth: CopilotAuth): Promise<string[]>
}

const RUNTIME_REASONING_EFFORTS = ["low", "medium", "high"] as const satisfies readonly ReasoningEffort[]
const RUNTIME_REASONING_EFFORTS_XHIGH = [...RUNTIME_REASONING_EFFORTS, "xhigh"] as const satisfies readonly ReasoningEffort[]

export function changedCodexAuth(a: CodexAuth, b: CodexAuth) {
  return a.refresh !== b.refresh || a.access !== b.access || a.expires !== b.expires || a.accountId !== b.accountId
}

export function runtimeDefaultModel(id: ProviderID, env?: NodeJS.ProcessEnv) {
  if (env?.RUNTIME_MODEL) return env.RUNTIME_MODEL
  if (id === "codex") return "gpt-5.4-mini"
  return undefined
}

export async function resolveRuntimeModel(
  id: ProviderID,
  auth: CopilotAuth | CodexAuth,
  deps: RuntimeModelDeps,
  preferred?: string,
) {
  if (preferred) return preferred
  const fallback = runtimeDefaultModel(id, deps.env)
  if (fallback) return fallback
  const models = await deps.copilotModels(auth as CopilotAuth)
  const model = models[0]
  if (!model) throw new Error("no copilot model available")
  return model
}

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === "string" && (RUNTIME_REASONING_EFFORTS_XHIGH as readonly string[]).includes(value)
}

export function runtimeReasoningEfforts(id: ProviderID, model?: string): ReasoningEffort[] {
  if (!model) return []
  if ((id === "codex" || id === "copilot") && model.startsWith("gpt-5.4")) return [...RUNTIME_REASONING_EFFORTS_XHIGH]
  if (id === "codex" && model.startsWith("gpt-5")) return [...RUNTIME_REASONING_EFFORTS]
  if (id === "copilot" && model.startsWith("gpt-5")) return [...RUNTIME_REASONING_EFFORTS]
  return []
}

export function normalizeRuntimeReasoning(
  id: ProviderID,
  model: string,
  reasoning?: PromptReasoning,
): PromptReasoning | undefined {
  const effort = reasoning?.effort
  if (!effort) return undefined
  return runtimeReasoningEfforts(id, model).includes(effort) ? { effort } : undefined
}
