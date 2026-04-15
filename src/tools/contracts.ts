import type { LoopTool } from "../core/contracts"

export type ToolPlugin = {
  name?: string
  tools?: LoopTool[]
}

export type ToolRegistryInput = {
  tools?: LoopTool[]
  plugins?: ToolPlugin[]
}

export type ToolRegistry = {
  list(): LoopTool[]
  get(name: string): LoopTool | undefined
}
