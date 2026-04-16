import { afterEach, describe, expect, test } from "bun:test"
import { copilot } from "./provider"
import type { Msg, Tool } from "../../core/contracts"

const originalFetch = globalThis.fetch

type FetchCall = {
  input: RequestInfo | URL
  init?: RequestInit
}

function ok() {
  return new Response("data: [DONE]\n\n", {
    headers: { "Content-Type": "text/event-stream" },
  })
}

function capture() {
  const calls: FetchCall[] = []
  globalThis.fetch = (async (input, init) => {
    calls.push({ input, init })
    return ok()
  }) as typeof globalThis.fetch
  return calls
}

function body(call: FetchCall) {
  expect(typeof call.init?.body).toBe("string")
  return JSON.parse(call.init?.body as string) as Record<string, unknown>
}

function headers(call: FetchCall) {
  return call.init?.headers as Record<string, string>
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("copilot provider request shape", () => {
  test("sends claude chat/completions request without reasoning extras", async () => {
    const calls = capture()
    const tools: Tool[] = [{ name: "weather", description: "Look up weather", schema: { type: "object" } }]
    const msg: Msg[] = [
      { role: "system", content: "Be concise" },
      { role: "user", content: "Weather?" },
      { role: "assistant", calls: [{ id: "call_1", name: "weather", input: '{"city":"Seoul"}' }] },
      { role: "tool", id: "call_1", name: "weather", content: "Sunny" },
      { role: "assistant", content: "It is sunny." },
    ]

    await copilot.prompt(
      { refresh: "refresh-token", access: "access-token", expires: Date.now() + 60_000 },
      { model: "claude-sonnet-4", msg, tools, max: 256, reasoning: { effort: "high" } },
    )

    expect(calls).toHaveLength(1)
    expect(String(calls[0]?.input)).toBe("https://api.githubcopilot.com/chat/completions")

    const requestHeaders = headers(calls[0]!)
    expect(requestHeaders.Authorization).toBe("Bearer refresh-token")
    expect(requestHeaders["Content-Type"]).toBe("application/json")
    expect(requestHeaders["Openai-Intent"]).toBe("conversation-edits")
    expect(requestHeaders["User-Agent"]).toContain("@tiny-agent/tiny-agent-runtime")
    expect(requestHeaders["x-initiator"]).toBe("agent")

    expect(body(calls[0]!)).toEqual({
      model: "claude-sonnet-4",
      messages: [
        { role: "system", content: "Be concise" },
        { role: "user", content: "Weather?" },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "weather", arguments: '{"city":"Seoul"}' },
            },
          ],
        },
        { role: "tool", tool_call_id: "call_1", content: "Sunny" },
        { role: "assistant", content: "It is sunny." },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "weather",
            description: "Look up weather",
            parameters: { type: "object" },
          },
        },
      ],
      stream: true,
      max_tokens: 256,
    })
  })

  test("sends responses request shape", async () => {
    const calls = capture()
    const msg: Msg[] = [
      { role: "system", content: "Be concise" },
      { role: "user", content: "Say hi" },
    ]

    await copilot.prompt(
      { refresh: "refresh-token", access: "access-token", expires: Date.now() + 60_000, enterpriseUrl: "github.example.com" },
      {
        model: "gpt-5.4",
        msg,
        reasoning: { effort: "xhigh" },
        tools: [{ name: "ping" }],
        max: 128,
      },
    )

    expect(calls).toHaveLength(1)
    expect(String(calls[0]?.input)).toBe("https://copilot-api.github.example.com/responses")

    const requestHeaders = headers(calls[0]!)
    expect(requestHeaders.Authorization).toBe("Bearer refresh-token")
    expect(requestHeaders["Content-Type"]).toBe("application/json")
    expect(requestHeaders["x-initiator"]).toBe("user")

    expect(body(calls[0]!)).toEqual({
      model: "gpt-5.4",
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: "Be concise" }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: "Say hi" }],
        },
      ],
      reasoning: { effort: "xhigh" },
      tools: [
        {
          type: "function",
          name: "ping",
          description: undefined,
          parameters: { type: "object", properties: {} },
        },
      ],
      store: false,
      stream: true,
      max_output_tokens: undefined,
    })
  })

  test("omits unsupported reasoning for non-reasoning copilot models", async () => {
    const calls = capture()

    await copilot.prompt(
      { refresh: "refresh-token", access: "access-token", expires: Date.now() + 60_000 },
      {
        model: "gpt-4.1",
        msg: [{ role: "user", content: "Hi" }],
        reasoning: { effort: "high" },
      },
    )

    expect(body(calls[0]!)).toEqual({
      model: "gpt-4.1",
      messages: [{ role: "user", content: "Hi" }],
      tools: undefined,
      stream: true,
      max_tokens: undefined,
    })
  })
})
