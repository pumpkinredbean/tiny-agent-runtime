export type ProviderID = "copilot" | "codex"

export type Role = "system" | "user" | "assistant" | "tool"

export type Call = {
  id: string
  name: string
  input: string
}

export type Msg =
  | {
      role: "system" | "user" | "assistant"
      content: string
    }
  | {
      role: "assistant"
      calls: Call[]
    }
  | {
      role: "tool"
      id: string
      name: string
      content: string
      error?: boolean
    }

export type Tool = {
  name: string
  description?: string
  schema?: unknown
}

export type Prompt = {
  model: string
  msg: Msg[]
  max?: number
  tools?: Tool[]
  abort?: AbortSignal
}

export type Part =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool"; call: Call }
  | { type: "done"; reason?: string }
  | { type: "error"; text: string; raw?: unknown }

export type Run<Auth> = {
  auth: Auth
  model: string
  url: string
  events: AsyncIterable<Part>
}

export type Adapter<Auth> = {
  id: ProviderID
  prompt(auth: Auth, req: Prompt): Promise<Run<Auth>>
}

export type LoopTool = Tool & {
  call(input: unknown, ctx: { abort?: AbortSignal; call: Call; step: number }): Promise<string>
}

export type LoopStop = "done" | "abort" | "limit" | "repeat"

export type LoopInput<Auth> = {
  adapter: Adapter<Auth>
  auth: Auth
  model: string
  msg: Msg[]
  max?: number
  maxSteps?: number
  tools?: LoopTool[]
  abort?: AbortSignal
  onPart?: (part: Part) => void | Promise<void>
}

export type LoopResult<Auth> = {
  auth: Auth
  msg: Msg[]
  steps: number
  stop: LoopStop
  text: string
}
