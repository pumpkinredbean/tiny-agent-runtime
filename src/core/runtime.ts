import type { CodexAuth, CopilotAuth } from "../auth/contracts"
import type { ProviderID } from "./contracts"

type RuntimeModelDeps = {
  env?: NodeJS.ProcessEnv
  copilotModels(auth: CopilotAuth): Promise<string[]>
}

export function changedCodexAuth(a: CodexAuth, b: CodexAuth) {
  return a.refresh !== b.refresh || a.access !== b.access || a.expires !== b.expires || a.accountId !== b.accountId
}

export async function resolveRuntimeModel(
  id: ProviderID,
  auth: CopilotAuth | CodexAuth,
  deps: RuntimeModelDeps,
  preferred?: string,
) {
  if (preferred) return preferred
  if (deps.env?.RUNTIME_MODEL) return deps.env.RUNTIME_MODEL
  if (id === "codex") return "gpt-5.4-mini"
  const models = await deps.copilotModels(auth as CopilotAuth)
  const model = models[0]
  if (!model) throw new Error("no copilot model available")
  return model
}
