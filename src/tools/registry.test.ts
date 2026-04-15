import { describe, expect, test } from "bun:test"
import type { LoopTool } from "../core/contracts"
import { composeTools, createToolRegistry } from "./registry"

function tool(name: string): LoopTool {
  return {
    name,
    async call() {
      return name
    },
  }
}

describe("tool registry", () => {
  test("merges direct tools and plugin tools", () => {
    const registry = createToolRegistry({
      tools: [tool("direct")],
      plugins: [{ name: "plugin", tools: [tool("plugin")] }],
    })

    expect(registry.list().map((item) => item.name)).toEqual(["direct", "plugin"])
    expect(registry.get("plugin")?.name).toBe("plugin")
  })

  test("keeps direct tool precedence when names collide", () => {
    const direct = tool("shared")
    const plugin = tool("shared")

    const tools = composeTools({
      tools: [direct],
      plugins: [{ tools: [plugin] }],
    })

    expect(tools).toHaveLength(1)
    expect(tools[0]).toBe(direct)
  })
})
