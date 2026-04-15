import type { Msg, Tool } from "./contracts"

export type ChatMessage =
  | {
      role: "system" | "user" | "assistant"
      content: string
    }
  | {
      role: "tool"
      tool_call_id: string
      content: string
    }
  | {
      role: "assistant"
      content: string
      tool_calls: Array<{
        id: string
        type: "function"
        function: {
          name: string
          arguments: string
        }
      }>
    }

export type ResponseInput =
  | {
      role: "system" | "user" | "assistant"
      content: Array<{ type: "input_text"; text: string }>
    }
  | {
      type: "function_call_output"
      call_id: string
      output: string
    }
  | {
      type: "function_call"
      call_id: string
      name: string
      arguments: string
    }

export function mapChatTools(tools?: Tool[]) {
  return tools?.map((item) => ({
    type: "function" as const,
    function: {
      name: item.name,
      description: item.description,
      parameters: item.schema ?? { type: "object", properties: {} },
    },
  }))
}

export function mapResponseTools(tools?: Tool[]) {
  return tools?.map((item) => ({
    type: "function" as const,
    name: item.name,
    description: item.description,
    parameters: item.schema ?? { type: "object", properties: {} },
  }))
}

export function toChatMessage(item: Msg): ChatMessage {
  if ("content" in item && item.role !== "tool") {
    return { role: item.role, content: item.content }
  }

  if (item.role === "tool") {
    return {
      role: "tool",
      tool_call_id: item.id,
      content: item.content,
    }
  }

  return {
    role: "assistant",
    content: "",
    tool_calls: item.calls.map((call) => ({
      id: call.id,
      type: "function",
      function: {
        name: call.name,
        arguments: call.input,
      },
    })),
  }
}

export function toChatMessages(msg: Msg[]) {
  return msg.map((item) => toChatMessage(item))
}

export function toResponseMessage(item: Msg): ResponseInput[] {
  if ("content" in item && item.role !== "tool") {
    return [
      {
        role: item.role,
        content: [{ type: "input_text", text: item.content }],
      },
    ]
  }

  if (item.role === "tool") {
    return [
      {
        type: "function_call_output",
        call_id: item.id,
        output: item.content,
      },
    ]
  }

  return item.calls.map((call) => ({
    type: "function_call",
    call_id: call.id,
    name: call.name,
    arguments: call.input,
  }))
}

export function toResponseInput(msg: Msg[]) {
  return msg.flatMap((item) => toResponseMessage(item))
}

export function toCodexResponseInput(msg: Msg[]) {
  return msg.flatMap((item) => {
    if (item.role === "assistant" && "content" in item) return []
    return toResponseMessage(item)
  })
}

export function instructions(msg: Msg[], fallback = "You are a helpful assistant.") {
  return (
    msg
      .filter((item) => "content" in item && item.role === "system")
      .map((item) => ("content" in item ? item.content : ""))
      .join("\n") || fallback
  )
}

export function withoutSystem(msg: Msg[]) {
  return msg.filter((item) => item.role !== "system")
}
