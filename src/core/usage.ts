import type { Usage } from "./contracts"

function num(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function record(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined
}

function pickCost(input: Record<string, unknown>) {
  const cost = record(input.cost)
  if (cost) return cost
  const costs = record(input.costs)
  if (costs) return costs
  const rate = record(input.usage_cost)
  if (rate) return rate
}

export function normalizeUsage(input: unknown): Usage | undefined {
  const value = record(input)
  if (!value) return

  const inputDetails = record(value.input_tokens_details ?? value.prompt_tokens_details)
  const outputDetails = record(value.output_tokens_details ?? value.completion_tokens_details)
  const usage: Usage = {
    inputTokens: num(value.input_tokens ?? value.prompt_tokens),
    outputTokens: num(value.output_tokens ?? value.completion_tokens),
    totalTokens: num(value.total_tokens),
    reasoningTokens: num(outputDetails?.reasoning_tokens),
    cachedInputTokens: num(inputDetails?.cached_tokens),
    cost: pickCost(value),
  }

  return Object.values(usage).some((item) => item !== undefined) ? usage : undefined
}

export function mergeUsage(...items: Array<Usage | undefined>): Usage {
  const merged: Usage = {}

  for (const item of items) {
    if (!item) continue
    if (item.inputTokens !== undefined) merged.inputTokens = (merged.inputTokens ?? 0) + item.inputTokens
    if (item.outputTokens !== undefined) merged.outputTokens = (merged.outputTokens ?? 0) + item.outputTokens
    if (item.totalTokens !== undefined) merged.totalTokens = (merged.totalTokens ?? 0) + item.totalTokens
    if (item.reasoningTokens !== undefined) merged.reasoningTokens = (merged.reasoningTokens ?? 0) + item.reasoningTokens
    if (item.cachedInputTokens !== undefined) merged.cachedInputTokens = (merged.cachedInputTokens ?? 0) + item.cachedInputTokens
    if (item.cost) merged.cost = { ...(merged.cost ?? {}), ...item.cost }
  }

  return merged
}

export function formatUsage(usage: Usage) {
  const parts: string[] = []
  if (usage.inputTokens !== undefined) parts.push(`input=${usage.inputTokens}`)
  if (usage.outputTokens !== undefined) parts.push(`output=${usage.outputTokens}`)
  if (usage.totalTokens !== undefined) parts.push(`total=${usage.totalTokens}`)
  if (usage.reasoningTokens !== undefined) parts.push(`reasoning=${usage.reasoningTokens}`)
  if (usage.cachedInputTokens !== undefined) parts.push(`cached_input=${usage.cachedInputTokens}`)
  if (usage.cost) parts.push(`cost=${JSON.stringify(usage.cost)}`)
  return parts.join(" ")
}
