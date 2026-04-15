import type { LoopTool } from "../core/contracts"
import type { ToolRegistry, ToolRegistryInput } from "./contracts"

function merge(input: ToolRegistryInput): LoopTool[] {
  const seen = new Set<string>()
  const out: LoopTool[] = []

  for (const tool of input.tools ?? []) {
    if (seen.has(tool.name)) continue
    seen.add(tool.name)
    out.push(tool)
  }

  for (const plugin of input.plugins ?? []) {
    for (const tool of plugin.tools ?? []) {
      if (seen.has(tool.name)) continue
      seen.add(tool.name)
      out.push(tool)
    }
  }

  return out
}

export function createToolRegistry(input: ToolRegistryInput = {}): ToolRegistry {
  const tools = merge(input)

  return {
    list() {
      return [...tools]
    },
    get(name) {
      return tools.find((tool) => tool.name === name)
    },
  }
}

export function composeTools(input: ToolRegistryInput = {}) {
  return createToolRegistry(input).list()
}
